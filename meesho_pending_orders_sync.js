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
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.csv');
// Helper to save order stats
async function updateOrderStats(username, pendingCount) {
    try {
        const db = await connectDB();
        await db.collection('stats').updateOne(
            { account: username },
            { $set: { pendingOrders: pendingCount, timestamp: new Date().toISOString() } },
            { upsert: true }
        );
    } catch (e) {
        console.error("Error updating order stats in MongoDB:", e.message);
    }
}

async function loadAccounts() {
    try {
        if (!fs.existsSync(ACCOUNTS_FILE)) {
            return [];
        }
        const csvText = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
        const lines = csvText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('username,'));
        
        return lines.map(line => {
            const parts = line.split(',');
            // Handle quotes if they exist
            const username = parts[0]?.replace(/^"|"$/g, '');
            const password = parts[1]?.replace(/^"|"$/g, '');
            const isActiveStr = parts[3]?.replace(/^"|"$/g, '');
            const isActive = isActiveStr ? isActiveStr.trim() === 'true' : true;
            return { username, password, isActive };
        }).filter(acc => acc.username && acc.password && acc.isActive);
    } catch (e) {
        console.error("Error reading accounts.csv:", e.message);
        return [];
    }
}

async function clickWithRetry(page, locator, name) {
    for (let i = 0; i < 3; i++) {
        try {
            await locator.click({ timeout: 10000 });
            return;
        } catch (e) {
            console.log(`  > Retrying click on ${name}...`);
            await page.waitForTimeout(1000);
        }
    }
    throw new Error(`Failed to click ${name}`);
}

async function fetchAccountStats(browser, account) {
    const { username, password } = account;
    console.log(`\n=== Fetching Stats: ${username} ===`);

    let contextOptions = {
        viewport: null,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    };
    const context = await browser.newContext(contextOptions);
    
    // Inject stealth scripts to look like a human
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

        const emailInput = page.getByRole('textbox', { name: 'Email Id or mobile number' });
        await emailInput.waitFor({ state: 'visible', timeout: 30000 });

        console.log(`[${username}] Logging in...`);
        await emailInput.fill(username);
        await page.getByRole('textbox', { name: 'Password' }).fill(password);
        await page.getByRole('button', { name: 'Log in', exact: true }).click();
        try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch (e) {}

        // Wait a bit for the dashboard data to populate
        await page.waitForTimeout(3000);

        // Close any popups that might intercept clicks
        await clearDashboard(page);

        console.log(`[${username}] Extracting Pending Orders from Dashboard...`);
        const count = await page.evaluate(() => {
            const elements = document.querySelectorAll('div, p, span');
            for (let el of elements) {
                if (el.textContent && el.textContent.trim() === 'Pending Orders') {
                    const parent = el.parentElement;
                    if (parent) {
                        const text = parent.textContent.replace('Pending Orders', '').trim();
                        // text should be something like "12 >"
                        const match = text.match(/\d+/);
                        if (match) {
                            return parseInt(match[0], 10);
                        }
                    }
                }
            }
            return null; // Not found
        });

        if (count !== null) {
            await updateOrderStats(username, count);
            console.log(`[${username}] SUCCESS! Recorded ${count} pending orders.`);
            await logBotSuccess(path.basename(__filename), username, `Recorded ${count} pending orders successfully.`);
        } else {
            console.log(`[${username}] WARNING: Could not find 'Pending Orders' on dashboard.`);
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
        console.log("No accounts found in accounts.csv.");
        return;
    }
    console.log(`Found ${accounts.length} accounts to fetch stats for.`);

    // Clear old stats before starting the sync
    try {
        const db = await connectDB();
        await db.collection('stats').deleteMany({});
        console.log("Cleared old pending orders stats in MongoDB.");
    } catch (e) {
        console.error("Failed to clear old stats in MongoDB:", e.message);
    }

    const browser = await chromium.launch({
        headless: process.env.HEADLESS === 'true' ? true : false,
        args: ['--start-maximized', '--disable-blink-features=AutomationControlled']
    });

    const BATCH_SIZE = 2; // Process 2 accounts at a time
    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
        const batch = accounts.slice(i, i + BATCH_SIZE);
        console.log(`\n=== Processing Batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} accounts) ===`);
        await Promise.all(batch.map(account => fetchAccountStats(browser, account)));
    }

    console.log("\n=== ALL STATS FETCHED SUCESSFULLY ===");
    await browser.close();
}

runFetcher().catch(e => console.error(e));
