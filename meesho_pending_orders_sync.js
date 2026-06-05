const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const LOGIN_URL = 'https://supplier.meesho.com/panel/v3/new/root/login';
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.csv');
const STATS_FILE = path.join(__dirname, 'pending_orders_overview_data.json');

// Helper to save order stats
function updateOrderStats(username, pendingCount) {
    try {
        let stats = {};
        if (fs.existsSync(STATS_FILE)) {
            try {
                stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
            } catch (err) {}
        }
        stats[username] = pendingCount;
        fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
    } catch (e) {
        console.error("Error updating order stats:", e.message);
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

    const sessionPath = path.join(__dirname, 'sessions', `${username}.json`);
    let contextOptions = {
        viewport: null,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    };
    if (fs.existsSync(sessionPath)) {
        contextOptions.storageState = sessionPath;
    }
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

        try {
            await Promise.race([
                page.waitForSelector('input[name="emailOrMobile"]', { timeout: 30000 }),
                page.getByText('Orders', { exact: true }).first().waitFor({ timeout: 30000 })
            ]);
        } catch (e) {
            console.log(`[${username}] Warning: Timeout waiting for page to load.`);
        }

        const emailInput = page.getByRole('textbox', { name: 'Email Id or mobile number' });
        if (await emailInput.isVisible()) {
            console.log(`[${username}] Not logged in. Logging in now...`);
            await emailInput.fill(username);
            await page.getByRole('textbox', { name: 'Password' }).fill(password);
            await page.getByRole('button', { name: 'Log in' }).click();
            try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch (e) {}
            // Save session cookies after login
            await context.storageState({ path: sessionPath });
        } else {
            console.log(`[${username}] Successfully used saved session! Skipping login.`);
            // Save again to refresh cookie expiration
            await context.storageState({ path: sessionPath });
        }

        // Wait a bit for the dashboard data to populate
        await page.waitForTimeout(3000);

        console.log(`[${username}] Closing any popups...`);
        await page.evaluate(() => {
            const winW = window.innerWidth;
            
            // 1. Try to click close buttons (SVGs) ONLY in central popups (avoiding sidebars)
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
            
            // 2. Hide common modal/backdrop containers
            document.querySelectorAll('div[role="dialog"], [class*="modal"], [class*="backdrop"]').forEach(div => {
                const style = window.getComputedStyle(div);
                if (style.position === 'fixed' || style.position === 'absolute') {
                    div.style.setProperty('display', 'none', 'important');
                }
            });
        });
        await page.waitForTimeout(1000);

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
            updateOrderStats(username, count);
            console.log(`[${username}] SUCCESS! Recorded ${count} pending orders.`);
        } else {
            console.log(`[${username}] WARNING: Could not find 'Pending Orders' on dashboard.`);
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
        console.log("No accounts found in accounts.csv.");
        return;
    }
    console.log(`Found ${accounts.length} accounts to fetch stats for.`);

    // Clear old stats before starting the sync
    try {
        fs.writeFileSync(STATS_FILE, JSON.stringify({}));
        console.log("Cleared old pending_orders_overview_data.json");
    } catch (e) {
        console.error("Failed to clear old stats:", e.message);
    }

    const browser = await chromium.launch({
        headless: false, // You can set this to true later if you want it completely silent
        args: ['--start-maximized', '--disable-blink-features=AutomationControlled']
    });

    const BATCH_SIZE = 2; // Process 2 accounts at a time
    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
        const batch = accounts.slice(i, i + BATCH_SIZE);
        console.log(`\n=== Processing Batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} accounts) ===`);

        await Promise.all(batch.map(account => fetchAccountStats(browser, account)));

        if (i + BATCH_SIZE < accounts.length) {
            console.log("Batch complete. Waiting 8-12 seconds before next batch to prevent rate-limiting...");
            const delay = Math.floor(Math.random() * (12000 - 8000 + 1)) + 8000;
            await new Promise(r => setTimeout(r, delay));
        }
    }

    console.log("\n=== ALL STATS FETCHED SUCESSFULLY ===");
    await browser.close();
}

runFetcher().catch(e => console.error(e));
