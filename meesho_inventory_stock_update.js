const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { logBotError, logBotSuccess } = require('./logger');
const { nukePopups, clearDashboard } = require('./nuke_helper');
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

// Configuration
const LOGIN_URL = 'https://supplier.meesho.com/panel/v3/new/root/login';
const UPDATES_FILE = 'inventory_stock_updates.csv';

// Helper to read accounts
async function getAccounts() {
    try {
        const { getAccounts } = require('./accounts_helper');
        return await getAccounts();
    } catch (e) {
        console.error("Error fetching accounts:", e.message);
        return [];
    }
}

// Helper to read inventory stock updates
async function getInventoryUpdates() {
    try {
        const db = await connectDB();
        return await db.collection('inventory_stock_updates').find({}).toArray();
    } catch (e) {
        console.error("Error reading inventory stock updates from MongoDB:", e.message);
        return [];
    }
}



// Dedicated helper to wait strictly for the stock update confirmation toast (e.g., "Stock updated successfully")
async function waitForStockUpdateConfirmation(page, username, sku, timeoutMs = 15000) {
    console.log(`[${username}] Waiting for confirmation toast ("Stock updated successfully") for SKU ${sku}...`);
    const startTime = Date.now();
    const pollInterval = 500;

    while (Date.now() - startTime < timeoutMs) {
        try {
            // 1. Check for success toast or notification banner on page
            const successLocators = [
                page.getByText(/Stock updated successfully/i),
                page.getByText(/^Stock updated successfully$/i),
                page.locator('text=/Stock updated successfully/i'),
                page.locator('div[role="alert"]:has-text("Stock updated successfully")'),
                page.locator('div[role="status"]:has-text("Stock updated successfully")'),
                page.locator('.toast-success, .alert-success, div:has-text("Stock updated successfully")'),
                page.getByText(/Updated successfully/i)
            ];

            for (const loc of successLocators) {
                const count = await loc.count().catch(() => 0);
                for (let i = 0; i < count; i++) {
                    const el = loc.nth(i);
                    if (await el.isVisible().catch(() => false)) {
                        let text = '';
                        try {
                            text = (await el.innerText()).trim();
                        } catch (e) {
                            text = 'Stock updated successfully';
                        }
                        console.log(`[${username}] ✅ Success confirmation detected: "${text}"`);
                        await page.waitForTimeout(1000);
                        return { success: true, message: text };
                    }
                }
            }

            // 2. Check for explicit error banners or toasts indicating failure
            const errorLocators = [
                page.locator('.toast-error, .error-message, .alert-danger'),
                page.getByText(/failed to update stock/i),
                page.getByText(/stock update failed/i),
                page.getByText(/invalid stock/i),
                page.getByText(/something went wrong/i)
            ];

            for (const errLoc of errorLocators) {
                const count = await errLoc.count().catch(() => 0);
                for (let i = 0; i < count; i++) {
                    const el = errLoc.nth(i);
                    if (await el.isVisible().catch(() => false)) {
                        const errText = ((await el.innerText().catch(() => '')) || '').trim();
                        if (errText && !errText.toLowerCase().includes('success')) {
                            throw new Error(`Stock update failed: ${errText}`);
                        }
                    }
                }
            }
        } catch (err) {
            if (err.message && err.message.startsWith('Stock update failed:')) {
                throw err;
            }
        }

        await page.waitForTimeout(pollInterval);
    }

    throw new Error(`Stock update confirmation toast ("Stock updated successfully") was not received within ${timeoutMs / 1000} seconds`);
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
    });

    const page = await context.newPage();
    const results = [];

    try {
        // 1. Login
        console.log(`[${username}] Logging in...`);
        await page.goto(LOGIN_URL, { timeout: 35000, waitUntil: 'domcontentloaded' });

        const emailInput = page.locator('input[name="emailOrPhone"]')
            .or(page.getByRole('textbox', { name: /email/i }))
            .or(page.locator('input[type="text"]').first());
        await emailInput.first().waitFor({ state: 'visible', timeout: 30000 });
        await emailInput.first().fill(username);

        const passwordInput = page.locator('input[name="password"]')
            .or(page.getByRole('textbox', { name: /password/i }))
            .or(page.locator('input[type="password"]').first());
        await passwordInput.first().fill(password);

        const loginBtn = page.getByRole('button', { name: /log\s*in/i })
            .or(page.locator('button[type="submit"]'))
            .or(page.locator('button:has-text("Log in")'));
        await loginBtn.first().click();

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

                        // Step: Wait strictly for confirmation toast "Stock updated successfully"
                        try {
                            const confResult = await waitForStockUpdateConfirmation(page, username, sku, 15000);
                            console.log(`[${username}] ✅ SKU ${sku} stock updated successfully: ${confResult.message}`);
                            results.push({ sku, status: 'Success', message: confResult.message });
                            // ONLY create notification / log success when confirmation toast is detected!
                            await logBotSuccess(path.basename(__filename), username, `SKU ${sku} stock updated successfully.`, sku);
                        } catch (confErr) {
                            console.error(`[${username}] ❌ SKU ${sku} stock update confirmation not seen: ${confErr.message}`);
                            await logBotError(path.basename(__filename), username, `SKU ${sku} stock update failed: ${confErr.message}`, page, sku);
                            results.push({ sku, status: 'Failed', reason: confErr.message });
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

            } catch (e) {
                console.error(`[${username}] Error processing SKU ${sku}:`, e.message);
                await logBotError(path.basename(__filename), username, e.message, page, sku);
                results.push({ sku, status: 'Error', reason: e.message });
            } finally {
                // Reset search for next SKU by clearing search box even if previous SKU failed
                try {
                    const searchBox = page.getByPlaceholder(/search by/i).first();
                    if (await searchBox.isVisible({ timeout: 1500 }).catch(() => false)) {
                        await searchBox.fill('');
                        await page.waitForTimeout(500);
                    }
                } catch (resetErr) {
                    console.log("  > Error resetting search box: " + resetErr.message);
                }
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
    const accounts = await getAccounts();
    const updates = await getInventoryUpdates();

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

runBot().then(async () => {
    try { const { closeDB } = require('./db'); await closeDB(); } catch (e) {}
    process.exit(0);
}).catch(async (err) => {
    console.error("Bot execution failed:", err);
    try { const { closeDB } = require('./db'); await closeDB(); } catch (e) {}
    process.exit(1);
});
