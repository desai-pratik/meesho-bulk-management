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
async async function getAccounts() {
    try {
        const { connectDB } = require('./db');
        const db = await connectDB();
        const accounts = await db.collection('accounts').find({ isActive: true }).toArray();
        return accounts;
    } catch (e) {
        console.error("Error fetching accounts from DB:", e.message);
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
        const inventoryMenu = page.getByText('Inventory', { exact: true }).first();
        await clickWithRetry(page, inventoryMenu, 'Inventory Menu');
        await page.waitForTimeout(3000);
        await nukePopups(page);

        // 3. Process SKUs
        for (const update of updates) {
            const { sku, price } = update;
            console.log(`[${username}] Processing SKU: ${sku} -> Price: ${price}`);
            
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
                
                await page.waitForTimeout(3000); // Wait for table to load

                // Find the "Edit" button in the Actions column for the specific SKU
                // We look for a row that contains the SKU and then find the Edit button in it
                const skuRow = page.locator('tr').filter({ hasText: sku }).first();
                const editBtn = skuRow.locator('div, span, button').filter({ hasText: /^Edit$/ }).first();
                
                if (await editBtn.isVisible()) {
                    await clickWithRetry(page, editBtn, `Edit button for ${sku}`);
                    await page.waitForTimeout(4000); // Wait for Edit page to load

                    // Update Meesho Price
                    // Based on the error log, the input has name="meesho_price"
                    let finalInput = null;
                    
                    // Strategy 1: Use exact name attribute (Confirmed from error log)
                    const exactInput = page.locator('input[name="meesho_price"]').first();
                    if (await exactInput.isVisible()) {
                        finalInput = exactInput;
                    }

                    // Strategy 2: Find input by walking up from "Meesho Price" text
                    if (!finalInput) {
                        const priceLabel = page.getByText('Meesho Price', { exact: false }).first();
                        if (await priceLabel.isVisible()) {
                            const container = priceLabel.locator('..').locator('..');
                            const inputInContainer = container.locator('input').first();
                            if (await inputInContainer.isVisible()) {
                                finalInput = inputInContainer;
                            }
                        }
                    }

                    // Strategy 3: Fallback to more generic but restricted selectors
                    if (!finalInput || !(await finalInput.isVisible())) {
                        finalInput = page.locator('input[name*="price"]').first()
                            .or(page.getByPlaceholder(/₹/).first())
                            .or(page.locator('input[type="number"]').filter({ has: page.locator('..').getByText(/price/i) }).first());
                    }

                    if (finalInput && await finalInput.isVisible()) {
                        // Calculate return price (Meesho Price - 10)
                        const returnPrice = (parseInt(price) - 10).toString();
                        
                        // Fill Meesho Price
                        await finalInput.click();
                        await page.keyboard.press('Control+A');
                        await page.keyboard.press('Backspace');
                        await finalInput.fill(price);
                        
                        // Fill Wrong/Defective Returns Price
                        const returnInput = page.locator('input[name="only_wrong_return_price"]').first();
                        if (await returnInput.isVisible()) {
                            await returnInput.click();
                            await page.keyboard.press('Control+A');
                            await page.keyboard.press('Backspace');
                            await returnInput.fill(returnPrice);
                            console.log(`  > Prices filled: Meesho=${price}, Return=${returnPrice}.`);
                        } else {
                            console.log(`  > Prices filled: Meesho=${price}. Return field not found.`);
                        }

                        console.log(`  > Clicking Submit Request...`);
                        
                        // Submit
                        const submitBtn = page.getByRole('button', { name: 'Submit Request', exact: true });
                        await clickWithRetry(page, submitBtn, `Submit Request for ${sku}`);
                        
                        // Success Check: Green popup or success message
                        try {
                            const successMsg = page.getByText(/successfully|updated|request submitted/i);
                            await successMsg.waitFor({ state: 'visible', timeout: 10000 });
                            console.log(`[${username}] ✅ SKU ${sku} update request submitted.`);
                            results.push({ sku, status: 'Success' });
                            await logBotSuccess(path.basename(__filename), username, `SKU ${sku} update request submitted successfully.`, sku);
                        } catch (e) {
                            console.log(`  > Success message not detected, but request was submitted.`);
                            results.push({ sku, status: 'Success (Check Portal)', info: 'Submitted but no confirmation seen' });
                            await logBotSuccess(path.basename(__filename), username, `SKU ${sku} update request submitted (but no confirmation seen).`, sku);
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
                
                // Reset search for next SKU safely by clicking Inventory menu again
                try {
                    const inventoryMenu = page.getByText('Inventory', { exact: true }).first();
                    await clickWithRetry(page, inventoryMenu, 'Inventory Menu');
                    await page.waitForTimeout(1000);
                } catch (e) {
                    console.log("  > Error resetting to Inventory: " + e.message);
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
