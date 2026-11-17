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
const UPDATES_FILE = 'inventory_updates.csv';

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

// Helper to read inventory updates
async function getInventoryUpdates() {
    try {
        const db = await connectDB();
        return await db.collection('inventory_price_updates').find({}).toArray();
    } catch (e) {
        console.error("Error reading inventory updates from MongoDB:", e.message);
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

// Dedicated helper to ensure the browser is on the Inventory page with search input ready
async function ensureOnInventoryPage(page) {
    const searchBox = page.getByPlaceholder(/search by/i).first();

    for (let attempt = 0; attempt < 3; attempt++) {
        // 1. If search box is already visible on the inventory table, clear it and return
        if (await searchBox.isVisible({ timeout: 1500 }).catch(() => false)) {
            await searchBox.fill('').catch(() => { });
            await page.waitForTimeout(500);
            return true;
        }

        // 2. If stuck on "Edit Product" page, click "Discard and Go Back"
        const discardBtn = page.getByRole('button', { name: /Discard and Go Back/i })
            .or(page.locator('button, [role="button"]').filter({ hasText: /Discard and Go Back/i }))
            .first();

        if (await discardBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
            console.log("  > Detected 'Edit Product' page. Clicking 'Discard and Go Back'...");
            await discardBtn.click({ timeout: 3000 }).catch(() => discardBtn.evaluate(el => el.click()));
            await page.waitForTimeout(1500);

            // Handle possible confirmation modal ("Discard changes?")
            const confirmDiscard = page.getByRole('button', { name: /^(discard|discard changes|yes|leave)$/i })
                .or(page.locator('button').filter({ hasText: /Discard/i }))
                .first();
            if (await confirmDiscard.isVisible({ timeout: 1000 }).catch(() => false)) {
                console.log("  > Confirming discard dialog...");
                await confirmDiscard.click().catch(() => confirmDiscard.evaluate(el => el.click()));
                await page.waitForTimeout(1500);
            }
        }

        // 3. Check for back arrow / back button on Edit Product header
        const backBtn = page.locator('div, span, button, a').filter({ hasText: /Edit Product/i }).locator('svg, button, a').first();
        if (await backBtn.isVisible({ timeout: 500 }).catch(() => false)) {
            await backBtn.click().catch(() => { });
            await page.waitForTimeout(1000);
        }

        // 4. Try clicking Inventory menu in sidebar if available
        const inventoryMenu = page.getByText('Inventory', { exact: true }).first();
        if (await inventoryMenu.isVisible({ timeout: 1500 }).catch(() => false)) {
            console.log("  > Clicking Inventory sidebar menu...");
            await inventoryMenu.click().catch(() => inventoryMenu.evaluate(el => el.click()));
            await page.waitForTimeout(2000);
        }

        // 5. Try browser back
        if (!(await searchBox.isVisible({ timeout: 1500 }).catch(() => false))) {
            console.log("  > Trying browser goBack()...");
            await page.goBack().catch(() => { });
            await page.waitForTimeout(2000);
        }

        await nukePopups(page).catch(() => { });

        if (await searchBox.isVisible({ timeout: 2000 }).catch(() => false)) {
            await searchBox.fill('').catch(() => { });
            await page.waitForTimeout(500);
            return true;
        }
    }

    // 6. Final Fallback: Direct URL Navigation
    console.log("  > Fallback: Navigating directly to Inventory URL...");
    const curUrl = page.url();
    if (curUrl.includes('/edit-product') || !curUrl.includes('/inventory')) {
        const inventoryUrl = curUrl.replace(/\/edit-product.*$/, '/inventory');
        if (inventoryUrl !== curUrl && inventoryUrl.includes('/inventory')) {
            await page.goto(inventoryUrl, { timeout: 20000 }).catch(() => { });
        } else {
            await page.goto('https://supplier.meesho.com/panel/v3/new/growth/inventory', { timeout: 20000 }).catch(() => { });
        }
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => { });
        await clearDashboard(page).catch(() => { });
    }

    if (await searchBox.isVisible({ timeout: 5000 }).catch(() => false)) {
        await searchBox.fill('').catch(() => { });
        return true;
    }

    return false;
}

async function updateInventoryForAccount(browser, account, updates) {
    const { username, password } = account;
    console.log(`\n=== Starting Inventory Update for Account: ${username} ===`);

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
        await ensureOnInventoryPage(page);

        // 3. Process SKUs
        for (const update of updates) {
            const { sku, price } = update;
            console.log(`\n[${username}] Processing SKU: ${sku} -> Price: ${price}`);

            try {
                // Search for SKU — retry once with a page reload if the search box is not found
                const searchBox = page.getByPlaceholder(/search by/i).first();
                try {
                    await searchBox.waitFor({ state: 'visible', timeout: 20000 });
                } catch (e) {
                    console.log(`  > Search box not visible, reloading inventory page...`);
                    const inventoryMenu = page.getByText('Inventory', { exact: true }).first();
                    await clickWithRetry(page, inventoryMenu, 'Inventory Menu (retry)');
                    await page.waitForTimeout(4000);
                    await nukePopups(page);
                    await searchBox.waitFor({ state: 'visible', timeout: 15000 });
                }
                await searchBox.fill('');
                await searchBox.fill(String(sku));

                // Wait for and click the SKU in the dropdown
                const dropdownItem = page.getByText(`Style ID/SKU: ${sku}`, { exact: false });
                try {
                    await dropdownItem.waitFor({ state: 'visible', timeout: 5000 });
                    await dropdownItem.click();
                } catch (e) {
                    console.log(`  > Dropdown for ${sku} did not appear. Pressing Enter...`);
                    await page.keyboard.press('Enter');
                }

                await page.waitForTimeout(3000); // Wait for table to load

                // Find the "Edit" button in the Actions column for the specific SKU
                // We look for a row that contains the SKU and then find the Edit button in it
                const skuRow = page.locator('tr').filter({ hasText: sku }).first();
                const editBtn = skuRow.locator('div, span, button').filter({ hasText: /^Edit$/ }).first();

                if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await clickWithRetry(page, editBtn, `Edit button for ${sku}`);
                    await page.waitForTimeout(3000); // Wait for Edit page to load

                    // Wait for and find Price input on Edit Product page
                    let finalInput = null;

                    // Strategy 1: Wait for exact name attribute (input[name="meesho_price"])
                    try {
                        const exactInput = page.locator('input[name="meesho_price"]').first();
                        await exactInput.waitFor({ state: 'visible', timeout: 6000 });
                        finalInput = exactInput;
                    } catch (e) { }

                    // Strategy 2: Find input by walking up from "Meesho Price" text
                    if (!finalInput) {
                        try {
                            const priceLabel = page.getByText('Meesho Price', { exact: false }).first();
                            await priceLabel.waitFor({ state: 'visible', timeout: 3000 });
                            const container = priceLabel.locator('..').locator('..');
                            const inputInContainer = container.locator('input').first();
                            if (await inputInContainer.isVisible()) {
                                finalInput = inputInContainer;
                            }
                        } catch (e) { }
                    }

                    // Strategy 3: Find input in price table
                    if (!finalInput) {
                        try {
                            const tableInput = page.locator('table input, [role="table"] input').first();
                            if (await tableInput.isVisible({ timeout: 2000 })) {
                                finalInput = tableInput;
                            }
                        } catch (e) { }
                    }

                    // Strategy 4: Fallback to more generic but restricted selectors
                    if (!finalInput) {
                        const fallbacks = [
                            page.locator('input[name*="price"]').first(),
                            page.getByPlaceholder(/₹/).first(),
                            page.locator('input[type="number"]').filter({ has: page.locator('..').getByText(/price/i) }).first()
                        ];
                        for (const fb of fallbacks) {
                            if (await fb.isVisible({ timeout: 1500 }).catch(() => false)) {
                                finalInput = fb;
                                break;
                            }
                        }
                    }

                    if (finalInput && await finalInput.isVisible()) {
                        // Ensure price is always a string for Playwright fill()
                        const priceStr = String(price);
                        // Calculate return price (Meesho Price - 10)
                        const returnPrice = String(Number(price) - 10);

                        // Fill Meesho Price
                        await finalInput.click();
                        await page.keyboard.press('Control+A');
                        await page.keyboard.press('Backspace');
                        await finalInput.fill(priceStr);

                        // Fill Wrong/Defective Returns Price
                        const returnInput = page.locator('input[name="only_wrong_return_price"]')
                            .or(page.locator('input[name*="wrong_return"]'))
                            .or(page.locator('input[name*="return_price"]'))
                            .or(page.locator('input[name*="return"]'))
                            .first();
                        if (await returnInput.isVisible({ timeout: 1500 }).catch(() => false)) {
                            await returnInput.click();
                            await page.keyboard.press('Control+A');
                            await page.keyboard.press('Backspace');
                            await returnInput.fill(returnPrice);
                            console.log(`  > Prices filled: Meesho=${priceStr}, Return=${returnPrice}.`);
                        } else {
                            console.log(`  > Prices filled: Meesho=${priceStr}. Return field not found.`);
                        }

                        console.log(`  > Clicking Submit Request...`);

                        // Submit
                        const submitBtn = page.getByRole('button', { name: 'Submit Request', exact: true });
                        await clickWithRetry(page, submitBtn, `Submit Request for ${sku}`);

                        // Success Check: Green popup or success message
                        try {
                            const successMsg = page.getByText(/successfully|updated|request submitted/i).first();
                            await successMsg.waitFor({ state: 'visible', timeout: 10000 });
                            console.log(`[${username}] ✅ SKU ${sku} update request submitted successfully.`);
                            results.push({ sku, status: 'Success' });
                            await logBotSuccess(path.basename(__filename), username, `SKU ${sku} update request submitted successfully.`, sku);
                        } catch (e) {
                            const errMsg = `Price update confirmation not seen for SKU ${sku}`;
                            console.log(`[${username}] ❌ ${errMsg}`);
                            results.push({ sku, status: 'Failed', reason: errMsg });
                            await logBotError(path.basename(__filename), username, errMsg, page, sku);
                        }
                    } else {
                        const errMsg = `Could not find Price input for SKU ${sku}`;
                        console.log(`[${username}] ❌ ${errMsg}`);
                        await logBotError(path.basename(__filename), username, errMsg, page, sku);
                        results.push({ sku, status: 'Failed', reason: errMsg });
                    }
                } else {
                    const errMsg = `SKU row or Edit button not found`;
                    console.log(`[${username}] ❌ ${errMsg} for ${sku}.`);
                    await logBotError(path.basename(__filename), username, errMsg, page, sku);
                    results.push({ sku, status: 'Failed', reason: errMsg });
                }

                // Reset search for next SKU: go back to Inventory and wait for the search box to be ready
                try {
                    const inventoryMenu = page.getByText('Inventory', { exact: true }).first();
                    await clickWithRetry(page, inventoryMenu, 'Inventory Menu');
                    await page.waitForTimeout(3000);
                    await nukePopups(page);
                } catch (e) {
                    console.log("  > Error resetting to Inventory: " + e.message);
                }

            } catch (e) {
                console.error(`[${username}] Error processing SKU ${sku}:`, e.message);
                await logBotError(path.basename(__filename), username, e.message, page, sku);
                results.push({ sku, status: 'Error', reason: e.message });
            } finally {
                // ALWAYS guarantee returning to Inventory table for next SKU, even if editing or submitting failed
                try {
                    await ensureOnInventoryPage(page);
                } catch (resetErr) {
                    console.log("  > Error during post-SKU inventory reset: " + resetErr.message);
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
    if (updates.length === 0) { console.error("No inventory updates found."); return; }

    console.log(`Loaded ${accounts.length} accounts and ${updates.length} SKU updates.`);

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
    console.log("       INVENTORY UPDATE SUMMARY           ");
    console.log("==========================================");
    for (const [user, results] of Object.entries(allResults)) {
        console.log(`\nACCOUNT: ${user}`);
        results.forEach(r => {
            const icon = r.status === 'Success' ? '✅' : '❌';
            console.log(`  ${icon} ${r.sku}: ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
        });
    }
    console.log("\n==========================================\n");

    await browser.close();
}

runBot();
