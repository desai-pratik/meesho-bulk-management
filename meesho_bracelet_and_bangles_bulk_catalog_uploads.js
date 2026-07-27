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
const FILE_PATH = path.join(__dirname, 'uploaded-files');

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
        const errorText = page.getByText('We are having trouble showing this data', { exact: false });
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
            if (verifyLocator) {
                const resolvedVerify = verifyLocator.first ? verifyLocator.first() : verifyLocator;
                try {
                    if (await resolvedVerify.isVisible()) {
                        console.log(`  > [${name}] Next step naturally appeared! Proceeding...`);
                        return; // Success!
                    }
                } catch (e) { }
            }

            await handleErrorPage(page);

            const authClicked = await nukePopups(page);
            if (authClicked && authClicked.authClicked) {
                console.log(`  > Special Auth button clicked. Waiting for page state to advance...`);
                await page.waitForTimeout(2000);

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

            try {
                await resolvedLocator.click({ timeout: 3000 });
            } catch (clickErr) {
                console.log(`  > Standard click on '${name}' intercepted. Forcing via DOM...`);
                try {
                    await resolvedLocator.evaluate(el => el.click());
                } catch (e) { /* ignore evaluate error */ }
            }

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

    const fileResults = [];
    let globalError = null;

    try {
        console.log(`[${username}] Navigating to Meesho...`);
        await page.goto(LOGIN_URL, { timeout: 30000 });

        const emailInput = page.getByRole('textbox', { name: 'Email Id or mobile number' });
        await emailInput.waitFor({ state: 'visible', timeout: 30000 });

        console.log(`[${username}] Logging in now...`);
        await emailInput.fill(username);
        await page.getByRole('textbox', { name: 'Password' }).fill(password);
        await page.getByRole('button', { name: 'Log in', exact: true }).click();
        try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch (e) {}

        await clearDashboard(page);

        // Loop through ALL files
        for (let i = 0; i < uploadFiles.length; i++) {
            const currentFile = uploadFiles[i];
            const fileName = path.basename(currentFile);
            console.log(`\n[${username}] Processing File ${i + 1}/${uploadFiles.length}: ${fileName}`);

            try {
                if (i > 0) {
                    console.log(`[${username}] Resetting to Dashboard for next file...`);
                    try {
                        await page.goto(LOGIN_URL, { timeout: 20000 });
                        await page.waitForLoadState('networkidle', { timeout: 5000 });
                    } catch (e) {
                        console.log(`[${username}] Navigation timed out. Continuing anyway...`);
                    }
                    await clearDashboard(page);
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

                // Step D: Accessories -> Verify 'Jewellery' appears
                console.log(`[${username}] Looking for 'Accessories'...`);
                const jewelleryBtn = page.getByText('Jewellery', { exact: true });
                await clickWithRetry(page, accessoriesBtn, 'Accessories', jewelleryBtn);

                // Step E: Jewellery -> Verify 'Bracelet & Bangles' appears
                console.log(`[${username}] Looking for 'Jewellery'...`);
                const braceletBanglesBtn = page.getByText('Bracelet & Bangles', { exact: true });
                await clickWithRetry(page, jewelleryBtn, 'Jewellery', braceletBanglesBtn);

                // Step F: Bracelet & Bangles -> Verify 'Choose File' / 'Upload Template File' appears
                console.log(`[${username}] Looking for 'Bracelet & Bangles'...`);
                const chooseFileWait = page.getByRole('button', { name: 'Choose File' }).or(page.getByText('Upload Template File', { exact: true }));
                await clickWithRetry(page, braceletBanglesBtn, 'Bracelet & Bangles', chooseFileWait);

                // Step G: Choose File
                console.log(`[${username}] Looking for 'Choose File'...`);
                await clickWithRetry(page, chooseFileWait, 'Choose File');

                try {
                    await page.locator('input[type="file"]').first().setInputFiles(currentFile);
                } catch (e) {
                    await chooseFileWait.setInputFiles(currentFile);
                }
                console.log(`[${username}] File selected: ${fileName}`);
                await randomDelay(page);

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
                            await nukePopups(page);
                            await clickWithRetry(page, btn, text);
                            break;
                        }
                    }
                }

                console.log(`[${username}] Upload finished for ${fileName}. Waiting 10 seconds...`);
                await page.waitForTimeout(30000);

                fileResults.push({ file: fileName, status: 'Success' });
                await logBotSuccess(path.basename(__filename), username, `Uploaded bulk catalog file successfully: ${fileName}`);

            } catch (e) {
                console.error(`[${username}] Failed to upload ${fileName}: ${e.message}`);
                fileResults.push({ file: fileName, status: 'Failed', reason: e.message });
                try {
                    await logBotError(path.basename(__filename), username, e.message, typeof page !== 'undefined' ? page : null);
                } catch (err) {
                    console.log("error logging failure", err)
                }
            }
        }

    } catch (e) {
        console.error(`Error with account ${username}:`, e.message);
        globalError = e.message;
        try {
            await logBotError(path.basename(__filename), username, e.message, typeof page !== 'undefined' ? page : null);
        } catch (err) {
            console.log("error logging session failure", err)
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
    const accounts = getAccounts();
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
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    });

    const results = [];
    const BATCH_SIZE = 1;
    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
        const batch = accounts.slice(i, i + BATCH_SIZE);
        console.log(`\n=== Processing Batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} accounts) ===`);

        const batchResults = await Promise.all(batch.map(account => asyncLocalStorage.run(account.username, () => processAccount(browser, account, uploadFiles))));
        results.push(...batchResults);

        console.log("Batch complete. Waiting 8-12 seconds to prevent rate-limiting...");
        const delay = Math.floor(Math.random() * (12000 - 8000 + 1)) + 8000;
        await new Promise(r => setTimeout(r, delay));
    }

    console.log("\nAll accounts processed.");

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
