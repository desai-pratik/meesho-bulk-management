const { chromium } = require('playwright');
const { nukePopups, clearDashboard } = require('./nuke_helper');
const fs = require('fs');
const path = require('path');
const { logBotError, logBotSuccess } = require('./logger');
const { connectDB } = require('./db');

const { AsyncLocalStorage } = require('async_hooks');
const asyncLocalStorage = new AsyncLocalStorage();
const origLog = console.log;
console.log = (...args) => {
    const user = asyncLocalStorage.getStore();
    if (user && typeof args[0] === 'string') {
        if (args[0].match(/^\s*[>!]/)) {
            args[0] = `[${user}] ` + args[0].trimStart();
        }
    }
    origLog(...args);
};

const LOGIN_URL = 'https://supplier.meesho.com/panel/v3/new/root/login';
async function updateReturnOTPs(username, extractedOtps) {
    try {
        const db = await connectDB();
        const otpsColl = db.collection('return_otps');
        // Remove old entries for this account
        await otpsColl.deleteMany({ account: username });
        
        // Add new entries
        const toInsert = [];
        for (const [courier, otp] of Object.entries(extractedOtps)) {
            toInsert.push({
                account: username,
                courier: courier,
                otp: otp,
                timestamp: new Date().toISOString()
            });
        }
        if (toInsert.length > 0) {
            await otpsColl.insertMany(toInsert);
        }
    } catch (e) {
        console.error("Error updating return OTPs in MongoDB:", e.message);
    }
}

async function loadAccounts() {
    try {
        const { connectDB } = require('./db');
        const db = await connectDB();
        let allAccounts = await db.collection('accounts').find({ isActive: true }).toArray();

        // If TARGET_ACCOUNT is set, filter for it (supports comma-separated list of accounts)
        if (process.env.TARGET_ACCOUNT) {
            const targets = process.env.TARGET_ACCOUNT.split(',').map(t => t.trim());
            allAccounts = allAccounts.filter(acc => targets.includes(acc.username));
        }

        return allAccounts;
    } catch (e) {
        console.error("Error fetching accounts from DB:", e.message);
        return [];
    }
}

async function fetchReturnOTPs(browser, account) {
    const { username, password } = account;
    console.log(`\n=== Fetching Return OTPs: ${username} ===`);

    let contextOptions = {
        viewport: null,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    };
    const context = await browser.newContext(contextOptions);

    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {} };
    });

    const page = await context.newPage();

    try {
        console.log(`[${username}] Navigating to Meesho...`);
        await page.goto(LOGIN_URL, { timeout: 3000 });

        const emailInput = page.getByRole('textbox', { name: 'Email Id or mobile number' });
        await emailInput.waitFor({ state: 'visible', timeout: 3000 });

        console.log(`[${username}] Logging in...`);
        await emailInput.fill(username);
        await page.getByRole('textbox', { name: 'Password' }).fill(password);
        await page.getByRole('button', { name: 'Log in', exact: true }).click();

        try { await page.waitForLoadState('networkidle', { timeout: 1000 }); } catch (e) { }
        await page.waitForTimeout(300);

        // Close any popups that might intercept clicks
        await clearDashboard(page);

        // Click on Returns tab
        console.log(`[${username}] Navigating to Returns tab...`);
        try {
            const returnsLink = page.getByText('Returns', { exact: true }).first();
            await returnsLink.waitFor({ timeout: 1000 });
            await returnsLink.click({ force: true });
            await page.waitForTimeout(200);
            await page.waitForLoadState('networkidle', { timeout: 1000 }).catch(() => { });
            await page.waitForTimeout(1000);
        } catch (err) {
            console.log(`[${username}] Could not find Returns tab, trying direct URL...`);
            await page.goto('https://supplier.meesho.com/panel/v3/new/returns', { timeout: 3000 });
            await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => { });
            await page.waitForTimeout(600);
        }

        // Check for "View more OTPs"
        try {
            const viewMoreBtn = page.getByText(/View more OTPs/i, { exact: false });
            if (await viewMoreBtn.isVisible()) {
                console.log(`[${username}] Found "View more OTPs", clicking...`);
                await viewMoreBtn.click({ force: true });
                await page.waitForTimeout(200); // Wait for popup to open
            }
        } catch (err) { }

        console.log(`[${username}] Extracting OTPs...`);

        // Strategy: Get all text from the page and look for Courier names and nearby 4-6 digit numbers.
        // Also look explicitly for typical OTP phrases like "OTP: 1234" or "Shadowfax: 1234".
        // Since we don't know the exact structure, we use a broad extraction.

        const extractedData = await page.evaluate(() => {
            const result = {};
            // Look for known courier partners in all elements
            const couriers = ['shadowfax', 'valmo', 'delhivery', 'ecom express', 'xpressbees'];

            // Helper to get text nodes
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            let node;
            const texts = [];
            while ((node = walker.nextNode())) {
                const text = node.nodeValue.trim();
                if (text.length > 0) texts.push(text);
            }

            // Find courier names and the nearest following number that could be an OTP
            for (let i = 0; i < texts.length; i++) {
                const t = texts[i].toLowerCase();
                for (let c of couriers) {
                    if (t.includes(c)) {
                        // Look at this text and the next few texts for a number (4 to 6 digits)
                        let foundOtp = null;

                        // Check if OTP is in the same string (e.g. "Shadowfax - 123456")
                        const inlineMatch = texts[i].match(/(?:otp)?[^\d]*(\d{4,6})/i);
                        if (inlineMatch && inlineMatch[1]) {
                            foundOtp = inlineMatch[1];
                        } else {
                            // Check next few strings
                            for (let j = 1; j <= 5 && i + j < texts.length; j++) {
                                const nextText = texts[i + j];
                                const match = nextText.match(/^(\d{4,6})$/);
                                if (match) {
                                    foundOtp = match[1];
                                    break;
                                }
                                // also check if next text is "123456" inside something else
                                const match2 = nextText.match(/(?:otp:? ?)?(\d{4,6})/i);
                                if (match2) {
                                    foundOtp = match2[1];
                                    break;
                                }
                            }
                        }

                        if (foundOtp) {
                            // Capitalize courier name
                            const cName = c.charAt(0).toUpperCase() + c.slice(1);
                            result[cName] = foundOtp;
                        }
                    }
                }
            }
            return result;
        });

        if (Object.keys(extractedData).length > 0) {
            await updateReturnOTPs(username, extractedData);
            console.log(`[${username}] SUCCESS! Extracted OTPs:`, extractedData);
            await logBotSuccess(path.basename(__filename), username, `Extracted OTPs successfully: ${JSON.stringify(extractedData)}`);
        } else {
            console.log(`[${username}] No OTPs found on the page (or OTP section not visible). Keep old OTPs.`);
            // Save HTML for debugging
            const html = await page.content();
            fs.writeFileSync(path.join(__dirname, 'returns_debug.html'), html);
            console.log(`[${username}] Saved page HTML to returns_debug.html for debugging.`);
        }

    } catch (e) {
        console.log(`[${username}] ERROR: ${e.message}`);
        await logBotError(path.basename(__filename), username, e.message, typeof page !== 'undefined' ? page : null);
    } finally {
        console.log(`[${username}] Closing session...`);
        await context.close();
    }
}

async function runFetcher() {
    const accounts = await loadAccounts();
    if (accounts.length === 0) {
        console.log("No accounts found to process.");
        return;
    }
    console.log(`Found ${accounts.length} accounts to fetch Return OTPs for.`);
    const browser = await chromium.launch({
        headless: process.env.HEADLESS === 'true' ? true : false,
        args: ['--start-maximized', '--disable-blink-features=AutomationControlled']
    });

    const BATCH_SIZE = 2; // Process 2 accounts at a time
    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
        const batch = accounts.slice(i, i + BATCH_SIZE);
        console.log(`\n=== Processing Batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} accounts) ===`);
        await Promise.all(batch.map(account =>
            asyncLocalStorage.run(account.username, () => fetchReturnOTPs(browser, account))
        ));
    }

    console.log("\n=== RETURN OTPS FETCH COMPLETED ===");
    await browser.close();
}

runFetcher().catch(e => console.error(e));
