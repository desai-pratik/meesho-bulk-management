const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

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
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.csv');
const OTPS_FILE = path.join(__dirname, 'return_otps.json');

function updateReturnOTPs(username, extractedOtps) {
    try {
        let otps = [];
        if (fs.existsSync(OTPS_FILE)) {
            try {
                otps = JSON.parse(fs.readFileSync(OTPS_FILE, 'utf8'));
            } catch (err) {}
        }
        
        // Remove old entries for this account
        otps = otps.filter(o => o.account !== username);
        
        // Add new entries
        for (const [courier, otp] of Object.entries(extractedOtps)) {
            otps.push({
                account: username,
                courier: courier,
                otp: otp,
                timestamp: new Date().toISOString()
            });
        }
        
        fs.writeFileSync(OTPS_FILE, JSON.stringify(otps, null, 2));
    } catch (e) {
        console.error("Error updating return OTPs:", e.message);
    }
}

async function loadAccounts() {
    try {
        if (!fs.existsSync(ACCOUNTS_FILE)) {
            return [];
        }
        const csvText = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
        const lines = csvText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('username,'));
        
        let allAccounts = lines.map(line => {
            const parts = line.split(',');
            const username = parts[0]?.replace(/^"|"$/g, '');
            const password = parts[1]?.replace(/^"|"$/g, '');
            const isActiveStr = parts[3]?.replace(/^"|"$/g, '');
            const isActive = isActiveStr ? isActiveStr.trim() === 'true' : true;
            return { username, password, isActive };
        }).filter(acc => acc.username && acc.password && acc.isActive);
        
        // If TARGET_ACCOUNT is set, filter for it
        if (process.env.TARGET_ACCOUNT) {
            allAccounts = allAccounts.filter(acc => acc.username === process.env.TARGET_ACCOUNT);
        }
        
        return allAccounts;
    } catch (e) {
        console.error("Error reading accounts.csv:", e.message);
        return [];
    }
}

async function fetchReturnOTPs(browser, account) {
    const { username, password } = account;
    console.log(`\n=== Fetching Return OTPs: ${username} ===`);

    const sessionPath = path.join(__dirname, 'sessions', `${username}.json`);
    let contextOptions = {
        viewport: null,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    };
    if (fs.existsSync(sessionPath)) {
        contextOptions.storageState = sessionPath;
    }
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
        await page.goto(LOGIN_URL, { timeout: 30000 });

        try {
            await Promise.race([
                page.waitForSelector('input[name="emailOrMobile"]', { timeout: 15000 }),
                page.getByText('Orders', { exact: true }).first().waitFor({ timeout: 15000 })
            ]);
        } catch (e) {
            console.log(`[${username}] Warning: Timeout waiting for page to load.`);
        }

        const emailInput = page.getByRole('textbox', { name: 'Email Id or mobile number' });
        if (await emailInput.isVisible()) {
            console.log(`[${username}] Not logged in. Logging in now...`);
            await emailInput.fill(username);
            await page.getByRole('textbox', { name: 'Password' }).fill(password);
            await page.getByRole('button', { name: 'Log in', exact: true }).click();
            try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch (e) {}
            await context.storageState({ path: sessionPath });
        } else {
            console.log(`[${username}] Successfully used saved session!`);
            await context.storageState({ path: sessionPath });
        }

        await page.waitForTimeout(3000);

        // Close any popups that might intercept clicks
        console.log(`[${username}] Closing any popups...`);
        await page.evaluate(() => {
            const winW = window.innerWidth;
            document.querySelectorAll('svg').forEach(svg => {
                const rect = svg.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                if (rect.width > 0 && rect.height > 0 && cx > winW * 0.2 && cx < winW * 0.8) {
                    let parent = svg;
                    while (parent && parent.tagName !== 'BODY') {
                        const style = window.getComputedStyle(parent);
                        if ((style.position === 'fixed' || style.position === 'absolute') && parseInt(style.zIndex || 0) > 10) {
                            try { svg.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch(e){}
                            return;
                        }
                        parent = parent.parentElement;
                    }
                }
            });
            document.querySelectorAll('div').forEach(div => {
                const style = window.getComputedStyle(div);
                const zIndex = style.zIndex;
                if (zIndex && parseInt(zIndex) >= 50 && (style.position === 'fixed' || style.position === 'absolute')) {
                    div.style.setProperty('display', 'none', 'important');
                }
            });
        });
        await page.waitForTimeout(1000);

        // Click on Returns tab
        console.log(`[${username}] Navigating to Returns tab...`);
        try {
            const returnsLink = page.getByText('Returns', { exact: true }).first();
            await returnsLink.waitFor({ timeout: 10000 });
            await returnsLink.click({ force: true });
            await page.waitForTimeout(2000);
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            await page.waitForTimeout(5000);
        } catch (err) {
            console.log(`[${username}] Could not find Returns tab, trying direct URL...`);
            await page.goto('https://supplier.meesho.com/panel/v3/new/returns', { timeout: 30000 });
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            await page.waitForTimeout(6000);
        }

        // Check for "View more OTPs"
        try {
            const viewMoreBtn = page.getByText(/View more OTPs/i, { exact: false });
            if (await viewMoreBtn.isVisible()) {
                console.log(`[${username}] Found "View more OTPs", clicking...`);
                await viewMoreBtn.click({ force: true });
                await page.waitForTimeout(2000); // Wait for popup to open
            }
        } catch (err) {}

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
                            for (let j = 1; j <= 5 && i+j < texts.length; j++) {
                                const nextText = texts[i+j];
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
            updateReturnOTPs(username, extractedData);
            console.log(`[${username}] SUCCESS! Extracted OTPs:`, extractedData);
        } else {
            console.log(`[${username}] No OTPs found on the page (or OTP section not visible).`);
            // Save HTML for debugging
            const html = await page.content();
            fs.writeFileSync(path.join(__dirname, 'returns_debug.html'), html);
            console.log(`[${username}] Saved page HTML to returns_debug.html for debugging.`);
            // Clear existing OTPs for this account since none were found
            updateReturnOTPs(username, {});
        }
        
    } catch (e) {
        console.log(`[${username}] ERROR: ${e.message}`);
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

    // Clear old OTPs before starting the sync
    try {
        fs.writeFileSync(OTPS_FILE, JSON.stringify([]));
        console.log("Cleared old return_otps.json");
    } catch (e) {
        console.error("Failed to clear old OTPs:", e.message);
    }

    const browser = await chromium.launch({
        headless: false,
        args: ['--start-maximized', '--disable-blink-features=AutomationControlled']
    });

    for (let i = 0; i < accounts.length; i++) {
        await fetchReturnOTPs(browser, accounts[i]);
        if (i < accounts.length - 1) {
            console.log("Waiting 5-10 seconds before next account...");
            const delay = Math.floor(Math.random() * (10000 - 5000 + 1)) + 5000;
            await new Promise(r => setTimeout(r, delay));
        }
    }

    console.log("\n=== RETURN OTPS FETCH COMPLETED ===");
    await browser.close();
}

runFetcher().catch(e => console.error(e));
