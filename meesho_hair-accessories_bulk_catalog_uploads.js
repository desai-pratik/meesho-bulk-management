const { logBotError, logBotSuccess } = require('./logger');
const { nukePopups, clearDashboard } = require('./nuke_helper');
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

// Configuration
const LOGIN_URL = 'https://supplier.meesho.com/panel/v3/new/root/login';
// UPDATE THIS TO YOUR FOLDER PATH
// const FILE_PATH = String.raw`c:\Users\ASUS\Downloads\pratik`;
const FILE_PATH = path.join(__dirname, 'uploaded-files');

// Helper to read accounts
async function getAccounts() {
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

// Helper to find files
function getUploadFiles() {
    if (fs.existsSync(FILE_PATH)) {
        const stats = fs.statSync(FILE_PATH);
        if (stats.isDirectory()) {
            // Get all .xlsx files in the directory
            const files = fs.readdirSync(FILE_PATH)
                .filter(f => !f.startsWith('.') && f.endsWith('.xlsx'))
                .map(f => path.join(FILE_PATH, f));
            return files;
        } else {
            return [FILE_PATH];
        }
    }
    return [];
}

// FAST MODE: Minimal delay
async function randomDelay(page) {
    await page.waitForTimeout(2000)//s just for stability
}



// Dedicated function to handle the "We are having trouble" error page
async function handleErrorPage(page) {
    try {
        // Check for the specific error text
        const errorText = page.getByText('We are having trouble showing this data', { exact: false });
        // Use waitFor instead of isVisible to avoid instant resolution
        try {
            await errorText.waitFor({ state: 'visible', timeout: 1000 });
            console.log("  > Detected 'We are having trouble' error page.");

            const retryBtn = page.getByRole('button', { name: /retry/i }).or(page.getByText('Retry', { exact: true }));
            try {
                await retryBtn.waitFor({ state: 'visible', timeout: 1000 });
                console.log("  > Clicking 'Retry' button...");
                await retryBtn.click({ force: true });
                await page.waitForTimeout(3000); // Wait for reload

                // Check AGAIN
                try {
                    await errorText.waitFor({ state: 'visible', timeout: 1000 });
                    console.log("  > 'Retry' didn't work. Forcing Page Reload...");
                    await page.reload();
                    await page.waitForTimeout(5000);
                    await clearDashboard(page);
                } catch (e) { }
            } catch (e) {
                console.log("  > Error text found but 'Retry' button not visible. Reloading...");
                await page.reload();
                await page.waitForTimeout(5000);
                await clearDashboard(page);
            }
            return true; // We handled an error
        } catch (e) {
            // Not visible
        }
    } catch (e) {
        // Ignore errors during check
    }
    return false; // No error found
}

// Helper to click with retry, popup handling, verification, AND ERROR PAGE HANDLING
async function clickWithRetry(page, locator, name, verifyLocator = null) {
    for (let i = 0; i < 5; i++) {
        try {
            // Early skip: Check if target state naturally appeared (e.g., from an auth popup resolving)
            if (verifyLocator) {
                const resolvedVerify = verifyLocator.first ? verifyLocator.first() : verifyLocator;
                try {
                    if (await resolvedVerify.isVisible()) {
                        console.log(`  > [${name}] Next step naturally appeared! Proceeding...`);
                        return; // Success!
                    }
                } catch (e) { }
            }

            // 0. CHECK FOR ERROR PAGE FIRST
            await handleErrorPage(page);

            // 1. Nuke before clicking
            const authClicked = await nukePopups(page);
            if (authClicked && authClicked.authClicked) {
                console.log(`  > Special Auth button clicked. Waiting for page state to advance...`);
                await page.waitForTimeout(2000);

                // Immediately check if the target has appeared after the transition
                if (verifyLocator) {
                    const resolvedVerify = verifyLocator.first ? verifyLocator.first() : verifyLocator;
                    try {
                        if (await resolvedVerify.isVisible()) {
                            console.log(`  > [${name}] Navigated natively via auth popup. Proceeding...`);
                            return;
                        }
                    } catch (e) { }
                }
            }

            // 2. Wait for element to be visible (solves the instant-timeout of isVisible() bug)
            const resolvedLocator = locator.first ? locator.first() : locator;
            try {
                await resolvedLocator.waitFor({ state: 'visible', timeout: 5000 });
            } catch (e) {
                console.log(`  > '${name}' not visible yet...`);
                if (i === 4) console.log(`  > Debug: Current URL is ${page.url()}`);
                await handleErrorPage(page);
                await page.waitForTimeout(1000);
                continue;
            }

            // 3. Click (First try gentle playwright click, fallback to forced DOM click)
            try {
                await resolvedLocator.click({ timeout: 3000 });
            } catch (clickErr) {
                console.log(`  > Standard click on '${name}' intercepted. Forcing via DOM...`);
                try {
                    await resolvedLocator.evaluate(el => el.click());
                } catch (e) { /* ignore evaluate error */ }
            }

            // 4. Verify (if provided)
            if (verifyLocator) {
                const resolvedVerify = verifyLocator.first ? verifyLocator.first() : verifyLocator;
                try {
                    await resolvedVerify.waitFor({ state: 'visible', timeout: 5000 });
                    return; // Success!
                } catch (e) {
                    console.log(`  > Clicked '${name}', but next step didn't appear in 5s.`);

                    const handled = await handleErrorPage(page);
                    if (handled) {
                        console.log("  > Retrying action after handling error page...");
                    } else {
                        if (name === 'Catalog Uploads' && i >= 2) {
                            console.log("  > 'Catalog Uploads' stuck. Reloading page...");
                            await page.reload();
                            await page.waitForTimeout(5000);
                            await clearDashboard(page); // Clear ads again after reload
                        } else {
                            console.log("  > Retrying action...");
                        }
                    }
                    continue; // Retry the loop
                }
            }
            return; // Success (no verification needed)
        } catch (globalErr) {
            console.log(`  > Attempt on '${name}' failed internally. Retrying...`);
            await nukePopups(page);
            await page.waitForTimeout(500);
        }
        await page.waitForTimeout(500);
    }
    throw new Error(`Failed to click '${name}' (or verify next step) after 5 attempts.`);
}

async function processAccount(browser, account, uploadFiles) {
    const { username, password } = account;
    console.log(`\n=== Starting Account: ${username} ===`);

    const context = await browser.newContext({
        viewport: null,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });

    // Inject stealth scripts to look like a human
    await context.addInitScript(() => {
        // Remove webdriver property
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        // Mock plugins to appear as a regular browser
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        // Mock languages
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        // Add fake chrome object
        window.chrome = { runtime: {} };
    });

    const page = await context.newPage();

    const fileResults = [];
    let globalError = null;

    try {
        // 1. Login
        console.log(`[${username}] Navigating to login...`);
        await page.goto(LOGIN_URL, { timeout: 30000 });

        await page.getByRole('textbox', { name: 'Email Id or mobile number' }).fill(username);
        await page.getByRole('textbox', { name: 'Password' }).fill(password);

        console.log(`[${username}] Logging in...`);
        await page.getByRole('button', { name: 'Log in', exact: true }).click();

        // Wait for Dashboard
        try {
            await page.waitForLoadState('networkidle', { timeout: 10000 });
        } catch (e) { }

        // 2. Clear Dashboard Ads
        await clearDashboard(page);

        // Loop through ALL files
        for (let i = 0; i < uploadFiles.length; i++) {
            const currentFile = uploadFiles[i];
            const fileName = path.basename(currentFile);
            console.log(`\n[${username}] Processing File ${i + 1}/${uploadFiles.length}: ${fileName}`);

            try {
                // REFRESH PAGE before starting a new file
                if (i > 0) {
                    console.log(`[${username}] Resetting to Dashboard for next file...`);
                    try {
                        // Use goto LOGIN_URL instead of reload() for better stability
                        await page.goto(LOGIN_URL, { timeout: 20000 });
                        await page.waitForLoadState('networkidle', { timeout: 5000 });
                    } catch (e) {
                        console.log(`[${username}] Navigation timed out. Continuing anyway...`);
                    }
                    await clearDashboard(page); // Clear ads again after reload
                }

                // Step A: Catalog Uploads -> Verify 'Add Catalog in Bulk' appears
                console.log(`[${username}] Looking for 'Catalog Uploads'...`);
                const addCatalogBtn = page.getByRole('button', { name: 'Add Catalog in Bulk' });
                await clickWithRetry(page, page.getByText('Catalog Uploads'), 'Catalog Uploads', addCatalogBtn);

                // Step B: Add Catalog in Bulk -> Verify 'Women Fashion' appears
                console.log(`[${username}] Looking for 'Add Catalog in Bulk'...`);
                const womenFashionBtn = page.getByText('Women Fashion', { exact: true });
                await clickWithRetry(page, addCatalogBtn, 'Add Catalog in Bulk', womenFashionBtn);

                // Step C: Women Fashion -> Verify 'Accessories' appears
                console.log(`[${username}] Looking for 'Women Fashion'...`);
                const accessoriesBtn = page.getByText('Accessories', { exact: true });
                await clickWithRetry(page, womenFashionBtn, 'Women Fashion', accessoriesBtn);

                // Step D: Accessories -> Verify 'Hair Accessories' appears
                console.log(`[${username}] Looking for 'Accessories'...`);
                const hairAccessoriesCategoryBtn = page.getByText('Hair Accessories', { exact: true }).first();
                await clickWithRetry(page, accessoriesBtn, 'Accessories', hairAccessoriesCategoryBtn);

                // Step E: Hair Accessories Category -> Verify 'Hair Accessories' Subcategory appears
                console.log(`[${username}] Looking for 'Hair Accessories Category'...`);
                // Using .last() as it will be the second 'Hair Accessories' to appear in the column to the right
                const hairAccessoriesSubcategoryBtn = page.getByText('Hair Accessories', { exact: true }).last();
                await clickWithRetry(page, hairAccessoriesCategoryBtn, 'Hair Accessories Category', hairAccessoriesSubcategoryBtn);

                // Step F: Hair Accessories Subcategory -> Verify 'Choose File' appears
                console.log(`[${username}] Looking for 'Hair Accessories Subcategory'...`);
                const chooseFileWait = page.getByRole('button', { name: 'Choose File' }).or(page.getByText('Upload Template File', { exact: true }));
                await clickWithRetry(page, hairAccessoriesSubcategoryBtn, 'Hair Accessories Subcategory', chooseFileWait);

                // Step G: Choose File
                console.log(`[${username}] Looking for 'Choose File'...`);
                await clickWithRetry(page, chooseFileWait, 'Choose File');

                try {
                    await page.locator('input[type="file"]').first().setInputFiles(currentFile);
                } catch (e) {
                    await chooseFileWait.setInputFiles(currentFile);
                }
                console.log(`[${username}] File selected: ${fileName}`);
                await randomDelay(page); // Keep a small delay here for file to attach

                // Step H: Click Upload/Submit
                console.log(`[${username}] Looking for final 'Upload' button...`);
                const submitBtn = page.getByRole('button', { name: /upload/i })
                    .or(page.getByRole('button', { name: /submit/i }))
                    .or(page.getByText('Upload', { exact: true }));

                if (await submitBtn.count() > 0) {
                    const buttons = await submitBtn.all();
                    for (const btn of buttons) {
                        if (await btn.isVisible()) {
                            const text = await btn.innerText();
                            if (text.toLowerCase().includes('catalog upload')) continue;

                            console.log(`[${username}] Found button: ${text}. Clicking...`);
                            await nukePopups(page); // Nuke one last time before clicking upload
                            await clickWithRetry(page, btn, text);
                            break;
                        }
                    }
                }

                console.log(`[${username}] Upload finished for ${fileName}. Waiting 10 seconds...`);
                await page.waitForTimeout(30000); // Reduced to 10s

                fileResults.push({ file: fileName, status: 'Success' });
                await logBotSuccess(path.basename(__filename), username, `Uploaded bulk catalog file successfully: ${fileName}`);

            } catch (e) {
                console.error(`[${username}] Failed to upload ${fileName}: ${e.message}`);
                fileResults.push({ file: fileName, status: 'Failed', reason: e.message });
                // Attempt to take a screenshot of the failure
                try {
                    await logBotError(path.basename(__filename), username, e.message, typeof page !== 'undefined' ? page : null);
                } catch (err) {
                    console.log("error for gaurav 303", err)
                }
            }
        }

    } catch (e) {
        console.error(`Error with account ${username}:`, e.message);
        globalError = e.message;
        try {
            await logBotError(path.basename(__filename), username, e.message, typeof page !== 'undefined' ? page : null);
        } catch (err) {
            console.log("error for gaurav at 312", err)
        }
    } finally {
        console.log(`[${username}] Closing session...`);
        try {
            await context.close();
        } catch (e) { }
    }
    return { username, fileResults, globalError };
}

async function runBot() {
    const accounts = await getAccounts();
    const uploadFiles = getUploadFiles();

    if (uploadFiles.length === 0) {
        console.error(`Error: No files found at ${FILE_PATH}`);
        return;
    }
    console.log(`Found ${uploadFiles.length} files to upload.`);
    console.log(`Loaded ${accounts.length} accounts.`);

    const browser = await chromium.launch({
        headless: process.env.HEADLESS === 'true' ? true : false,
        args: [
            '--start-maximized',
            '--disable-blink-features=AutomationControlled', // Disable bot detection feature
            '--disable-infobars',
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ],
        ignoreDefaultArgs: ['--enable-automation'] // Hide "Chrome is being controlled by automated test software" bar
    });

    const results = [];

    // Batch Processing
    const BATCH_SIZE = 1; // Keep at 2 for stability
    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
        const batch = accounts.slice(i, i + BATCH_SIZE);
        console.log(`\n=== Processing Batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} accounts) ===`);

        const batchResults = await Promise.all(batch.map(account => asyncLocalStorage.run(account.username, () => processAccount(browser, account, uploadFiles))));
        results.push(...batchResults);

        console.log("Batch complete. Waiting 5 seconds...");
        await new Promise(r => setTimeout(r, 5000));
    }

    console.log("\nAll accounts processed.");

    // --- FINAL SUMMARY (Moved BEFORE browser.close to ensure it prints) ---
    console.log("\n==========================================");
    console.log("           EXECUTION SUMMARY              ");
    console.log("==========================================");

    results.forEach(r => {
        console.log(`\nACCOUNT: ${r.username}`);
        if (r.globalError) {
            console.log(`  STATUS: Session Failed - ${r.globalError}`);
        }

        if (r.fileResults && r.fileResults.length > 0) {
            r.fileResults.forEach(f => {
                const statusStr = f.status === 'Success' ? '✅ Success' : '❌ Failed';
                console.log(`  ${statusStr.padEnd(12)} : ${f.file} ${f.status === 'Failed' ? `(${f.reason})` : ''}`);
            });
        } else if (!r.globalError) {
            console.log(`  STATUS: No files processed.`);
        }
    });
    console.log("\n==========================================\n");

    try {
        await browser.close();
    } catch (e) {
        console.log("Error closing browser (ignored).");
    }
}

runBot();
