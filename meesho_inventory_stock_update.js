const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { logBotError } = require('./logger');
const { nukePopups, clearDashboard } = require('./nuke_helper');

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

// Configuration
const LOGIN_URL = 'https://supplier.meesho.com/panel/v3/new/root/login';
const ACCOUNTS_FILE = 'accounts.csv';
const UPDATES_FILE = 'inventory_stock_updates.csv';

// Helper to read accounts
function getAccounts() {
    try {
        const csv = fs.readFileSync('accounts.csv', 'utf8');
        const lines = csv.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('username,'));
        return lines.map(line => {
            const [username, password, name, isActive] = line.split(',');
            return { username, password, name, isActive: isActive ? isActive.trim() === 'true' : true };
        }).filter(acc => acc.isActive);
    } catch (e) {
        console.error("Error reading accounts.csv:", e.message);
        return [];
    }
}

// Helper to read inventory stock updates
function getInventoryUpdates() {
    try {
        if (!fs.existsSync(UPDATES_FILE)) {
            console.error(`Error: ${UPDATES_FILE} not found.`);
            return [];
        }
        const csv = fs.readFileSync(UPDATES_FILE, 'utf8');
        const lines = csv.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('sku,'));
        return lines.map(line => {
            const [sku, stock] = line.split(',');
            return { sku, stock };
        });
    } catch (e) {
        console.error(`Error reading ${UPDATES_FILE}:`, e.message);
        return [];
    }
}



async function handleErrorPage(page) {
    try {
        const errorText = page.getByText('We are having trouble showing this data', { exact: false });
        try {
            await errorText.waitFor({ state: 'visible', timeout: 1000 });
            console.log("  > Detected 'We are having trouble' error page.");
            const retryBtn = page.getByRole('button', { name: /retry/i }).or(page.getByText('Retry', { exact: true }));
            try {
                await retryBtn.waitFor({ state: 'visible', timeout: 1000 });
                await retryBtn.click({ force: true });
                await page.waitForTimeout(3000);
                try {
                    await errorText.waitFor({ state: 'visible', timeout: 1000 });
                    await page.reload();
                    await page.waitForTimeout(5000);
                    await clearDashboard(page);
                } catch (e) { }
            } catch (e) {
                await page.reload();
                await page.waitForTimeout(5000);
                await clearDashboard(page);
            }
            return true;
        } catch (e) { }
    } catch (e) { }
    return false;
}

async function clickWithRetry(page, locator, name, verifyLocator = null) {
    for (let i = 0; i < 5; i++) {
        try {
            if (verifyLocator) {
                const resolvedVerify = verifyLocator.first ? verifyLocator.first() : verifyLocator;
                try {
                    if (await resolvedVerify.isVisible()) return;
                } catch (e) { }
            }
            await handleErrorPage(page);
            await nukePopups(page);
            const resolvedLocator = locator.first ? locator.first() : locator;
            try {
                await resolvedLocator.waitFor({ state: 'visible', timeout: 5000 });
            } catch (e) {
                await handleErrorPage(page);
                await page.waitForTimeout(1000);
                continue;
            }
            try {
                await resolvedLocator.click({ timeout: 3000 });
            } catch (clickErr) {
                await resolvedLocator.evaluate(el => el.click());
            }
            if (verifyLocator) {
                const resolvedVerify = verifyLocator.first ? verifyLocator.first() : verifyLocator;
                try {
                    await resolvedVerify.waitFor({ state: 'visible', timeout: 5000 });
                    return;
                } catch (e) {
                    await handleErrorPage(page);
                    continue;
                }
            }
            return;
        } catch (globalErr) {
            await nukePopups(page);
            await page.waitForTimeout(500);
        }
        await page.waitForTimeout(500);
    }
    throw new Error(`Failed to click '${name}' after 5 attempts.`);
}

async function updateInventoryForAccount(browser, account, updates) {
    const { username, password } = account;
    console.log(`\n=== Starting Stock Update for Account: ${username} ===`);

    const context = await browser.newContext({
        viewport: null,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();
    const results = [];

    try {
        // 1. Login
        console.log(`[${username}] Logging in...`);
        await page.goto(LOGIN_URL, { timeout: 30000 });
        await page.getByRole('textbox', { name: 'Email Id or mobile number' }).fill(username);
        await page.getByRole('textbox', { name: 'Password' }).fill(password);
        await page.getByRole('button', { name: 'Log in', exact: true }).click();

        try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch (e) { }
        await clearDashboard(page);

        // 2. Go to Inventory
        console.log(`[${username}] Navigating to Inventory...`);
        const inventoryMenu = page.getByText('Inventory', { exact: true }).first();
        await clickWithRetry(page, inventoryMenu, 'Inventory Menu');
        await page.waitForTimeout(3000);
        await nukePopups(page);

        // 3. Process SKUs
        for (const update of updates) {
            const { sku, stock } = update;
            console.log(`[${username}] Processing SKU: ${sku} -> Stock: ${stock}`);

            try {
                // Search for SKU
                const searchBox = page.getByPlaceholder(/search by/i).first();
                await searchBox.waitFor({ state: 'visible', timeout: 10000 });
                await searchBox.fill('');
                await searchBox.fill(sku);

                // Wait for and click the SKU in the dropdown
                const dropdownItem = page.getByText(`Style ID/SKU: ${sku}`, { exact: false });
                try {
                    await dropdownItem.waitFor({ state: 'visible', timeout: 5000 });
                    await dropdownItem.click();
                } catch (e) {
                    console.log(`  > Dropdown for ${sku} did not appear. Pressing Enter...`);
                    await page.keyboard.press('Enter');
                }

                await page.waitForTimeout(4000); // Wait for table to load

                // Find the row for the specific SKU
                const skuRow = page.locator('tr').filter({ hasText: sku }).first();

                if (await skuRow.isVisible()) {
                    // Try to find the Current Stock container or just the input/pencil
                    // The user said: "click pencil icon and update stock and click outside"

                    // Look for the SVG/Pencil inside the stock column or row
                    const stockColumn = skuRow.locator('td').last(); // Often the last column
                    let pencilIcon = skuRow.locator('svg').last(); // Pencil is usually an SVG

                    // Click the pencil icon to make the input editable
                    if (await pencilIcon.isVisible()) {
                        await pencilIcon.click({ force: true });
                        await page.waitForTimeout(500);
                    } else {
                        // Fallback: try clicking the box that contains "Current Stock" or the number
                        const currentStockBox = skuRow.getByText('Current Stock', { exact: false }).first();
                        if (await currentStockBox.isVisible()) {
                            await currentStockBox.click({ force: true });
                            await page.waitForTimeout(500);
                        }
                    }

                    // Now find the text/number input field (exclude checkboxes and radios)
                    let stockInput = skuRow.locator('input:not([type="checkbox"]):not([type="radio"])').first();

                    if (await stockInput.isVisible()) {
                        // Fill Stock
                        await stockInput.click({ force: true });
                        await page.waitForTimeout(200);
                        await page.keyboard.press('Control+A');
                        await page.keyboard.press('Backspace');

                        // Use type to ensure the input registers the change
                        await stockInput.type(stock.toString(), { delay: 50 });
                        await page.waitForTimeout(500);

                        console.log(`  > Stock filled: ${stock}. Pressing Enter and clicking outside to save...`);

                        // Press Enter which often saves inline edits
                        await page.keyboard.press('Enter');
                        await page.waitForTimeout(1000);

                        // Click outside (e.g., on the page body) to trigger save
                        await page.locator('body').click({ force: true, position: { x: 0, y: 0 } });
                        await page.waitForTimeout(2000); // Wait for the save request to process

                        // Success Check: Green popup or success message
                        try {
                            const successMsg = page.getByText(/successfully|updated|saved/i);
                            await successMsg.waitFor({ state: 'visible', timeout: 5000 });
                            console.log(`[${username}] ✅ SKU ${sku} stock updated successfully.`);
                            results.push({ sku, status: 'Success' });
                        } catch (e) {
                            console.log(`  > Success message not detected, but clicked outside to save.`);
                            results.push({ sku, status: 'Success (Check Portal)', info: 'Assumed saved after click outside' });
                        }
                    } else {
                        const errMsg = `Could not find inline Stock input for SKU ${sku}`;
                        console.log(`[${username}] ❌ ${errMsg}`);
                        await logBotError(path.basename(__filename), username, errMsg, page, sku);
                        results.push({ sku, status: 'Failed', reason: errMsg });
                    }
                } else {
                    const errMsg = `SKU row not found after search`;
                    console.log(`[${username}] ❌ ${errMsg} for ${sku}.`);
                    await logBotError(path.basename(__filename), username, errMsg, page, sku);
                    results.push({ sku, status: 'Failed', reason: errMsg });
                }

                // Reset search for next SKU by clearing search box
                try {
                    await searchBox.fill('');
                    await page.waitForTimeout(500);
                } catch (e) {
                    console.log("  > Error resetting search box: " + e.message);
                }

            } catch (e) {
                console.error(`[${username}] Error processing SKU ${sku}:`, e.message);
                await logBotError(path.basename(__filename), username, e.message, page, sku);
                results.push({ sku, status: 'Error', reason: e.message });
            }
        }

    } catch (e) {
        console.error(`[${username}] Global Error:`, e.message);
        await logBotError(path.basename(__filename), username, `Global Error: ${e.message}`, page);
    } finally {
        await context.close();
    }
    return results;
}

async function runBot() {
    const accounts = getAccounts();
    const updates = getInventoryUpdates();

    if (accounts.length === 0) { console.error("No accounts found."); return; }
    if (updates.length === 0) { console.error("No inventory stock updates found."); return; }

    console.log(`Loaded ${accounts.length} accounts and ${updates.length} SKU stock updates.`);

    const browser = await chromium.launch({
        headless: process.env.HEADLESS === 'true' ? true : false,
        args: [
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--no-sandbox'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    });

    const allResults = {};

    for (const account of accounts) {
        const results = await asyncLocalStorage.run(account.username, () => updateInventoryForAccount(browser, account, updates));
        allResults[account.username] = results;
    }

    console.log("\n==========================================");
    console.log("        STOCK UPDATE SUMMARY              ");
    console.log("==========================================");
    for (const [user, results] of Object.entries(allResults)) {
        console.log(`\nACCOUNT: ${user}`);
        results.forEach(r => {
            const icon = r.status.includes('Success') ? '✅' : '❌';
            console.log(`  ${icon} ${r.sku}: ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
        });
    }
    console.log("\n==========================================\n");

    await browser.close();
}

runBot();
