const { logBotError, logBotSuccess } = require('./logger');
const { nukePopups, clearDashboard, handleProceedToUpload, checkUploadError } = require('./nuke_helper');
const { ensureMeeshoLogin, getContextOptionsWithSession, DASHBOARD_URL } = require('./meesho_auth_helper');
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
async function getAccounts() {
    try {
        const { getAccounts } = require('./accounts_helper');
        return await getAccounts();
    } catch (e) {
        console.error("Error fetching accounts:", e.message);
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

// Dedicated helper to wait strictly for the bulk upload confirmation toast or modal banner
async function waitForBulkUploadConfirmation(page, username, fileName, timeoutMs = 60000) {
    console.log(`[${username}] Upload submitted for ${fileName}. Waiting for confirmation toast ("File has been uploaded successfully")...`);
    const startTime = Date.now();
    const pollInterval = 1000;

    while (Date.now() - startTime < timeoutMs) {
        try {
            // 0. CHECK IMMEDIATELY FOR OUTDATED TEMPLATE OR UPLOAD ERRORS (Skip waiting 60s!)
            const instantErr = await checkUploadError(page);
            if (instantErr) {
                console.error(`[${username}] ❌ Immediate upload error detected: "${instantErr}"`);
                throw new Error(instantErr);
            }

            // 1. Check for success toast or banner on page
            const successLocators = [
                page.getByText(/File (has been )?uploaded successfully/i),
                page.getByText(/uploaded successfully/i),
                page.getByText(/Your File ID is/i),
                page.locator('text=/File (has been )?uploaded successfully/i'),
                page.locator('div[role="alert"]:has-text("uploaded successfully")'),
                page.locator('div[role="status"]:has-text("uploaded successfully")'),
                page.locator('div:has-text("File has been uploaded successfully")'),
                page.locator('div:has-text("File uploaded successfully")'),
                page.getByText('Follow steps to increase visibility for new catalog', { exact: false })
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
                            text = 'File has been uploaded successfully';
                        }
                        console.log(`[${username}] ✅ Success confirmation detected: "${text}"`);
                        await page.waitForTimeout(3000);
                        return { success: true, message: text };
                    }
                }
            }

            // 2. Check for explicit error banners or toasts indicating upload failure
            const errorLocators = [
                page.getByText(/template version outdated/i),
                page.getByText(/download latest template/i),
                page.locator('.toast-error, .error-message, .alert-danger, [role="alert"]'),
                page.getByText(/upload failed/i),
                page.getByText(/failed to upload/i),
                page.getByText(/invalid file/i),
                page.getByText(/error in file/i),
                page.getByText(/something went wrong/i)
            ];

            for (const errLoc of errorLocators) {
                const count = await errLoc.count().catch(() => 0);
                for (let i = 0; i < count; i++) {
                    const el = errLoc.nth(i);
                    if (await el.isVisible().catch(() => false)) {
                        const errText = ((await el.innerText().catch(() => '')) || '').trim();
                        if (errText && !errText.toLowerCase().includes('success')) {
                            throw new Error(`Upload failed: ${errText}`);
                        }
                    }
                }
            }
        } catch (err) {
            if (err.message && err.message.startsWith('Upload failed:')) {
                throw err;
            }
            // Ignore transient locator query errors while DOM updates
        }

        await page.waitForTimeout(pollInterval);
    }

    throw new Error(`Upload confirmation toast ("File has been uploaded successfully") was not received within ${timeoutMs / 1000} seconds`);
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

            // Immediately check and handle "Proceed to Upload" popup if triggered
            await handleProceedToUpload(page);

            // Immediately nuke popups that might have been triggered by clicking
            const postNuke = await nukePopups(page);
            if (postNuke && postNuke.authClicked) {
                await page.waitForTimeout(1500);
            }

            if (verifyLocator) {
                const resolvedVerify = verifyLocator.first ? verifyLocator.first() : verifyLocator;
                try {
                    await resolvedVerify.waitFor({ state: 'visible', timeout: 5000 });
                    return; // Success!
                } catch (e) {
                    console.log(`  > Clicked '${name}', but next step didn't appear in 5s.`);
                    const proceedClicked = await handleProceedToUpload(page);
                    if (proceedClicked) {
                        try {
                            await resolvedVerify.waitFor({ state: 'visible', timeout: 5000 });
                            return; // Success after proceeding!
                        } catch (err2) {}
                    }
                    await nukePopups(page);

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

    const contextOptions = getContextOptionsWithSession(username, { viewport: null });
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    const fileResults = [];
    let globalError = null;

    try {
        await ensureMeeshoLogin(page, context, username, password);

        // Loop through ALL files
        for (let i = 0; i < uploadFiles.length; i++) {
            if (!browser || !browser.isConnected() || !page || page.isClosed()) {
                console.error(`[${username}] ⚠️ Browser or target page is closed. Aborting remaining files.`);
                globalError = "Target page, context or browser has been closed";
                break;
            }
            const currentFile = uploadFiles[i];
            const fileName = path.basename(currentFile);
            console.log(`\n[${username}] Processing File ${i + 1}/${uploadFiles.length}: ${fileName}`);

            try {
                if (i > 0) {
                    console.log(`[${username}] Resetting to Dashboard for next file...`);
                    try {
                        await page.goto(DASHBOARD_URL, { timeout: 20000, waitUntil: 'domcontentloaded' });
                        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
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

                // Check immediately if selecting file triggered "Template version outdated"
                const fileSelectErr = await checkUploadError(page);
                if (fileSelectErr) {
                    console.error(`[${username}] ❌ File selection error: "${fileSelectErr}". Moving to next file immediately...`);
                    throw new Error(fileSelectErr);
                }

                // Step H: Click Upload/Submit
                console.log(`[${username}] Looking for final 'Upload' button...`);
                
                const isIgnoredButton = (rawText) => {
                    const t = (rawText || '').toLowerCase().trim();
                    return t.includes('how to') ||
                           t.includes('in bulk') ||
                           t.includes('template') ||
                           t.includes('guide') ||
                           t.includes('help') ||
                           t.includes('video') ||
                           t.includes('download') ||
                           t.includes('remove') ||
                           t.includes('choose file');
                };

                let uploadClicked = false;

                // Priority 1: Exact match for button with name / text 'Upload' or 'Submit'
                const exactBtn = page.getByRole('button', { name: /^upload$/i })
                    .or(page.getByRole('button', { name: /^submit$/i }))
                    .or(page.locator('button').filter({ hasText: /^upload$/i }))
                    .or(page.locator('button').filter({ hasText: /^submit$/i }))
                    .or(page.getByText('Upload', { exact: true }));

                const exactCount = await exactBtn.count();
                for (let i = 0; i < exactCount; i++) {
                    const btn = exactBtn.nth(i);
                    if (await btn.isVisible().catch(() => false)) {
                        const text = (await btn.innerText().catch(() => '')).trim();
                        if (!isIgnoredButton(text)) {
                            console.log(`[${username}] Found exact button: "${text}". Clicking...`);
                            await nukePopups(page);
                            await clickWithRetry(page, btn, text);
                            uploadClicked = true;
                            break;
                        }
                    }
                }

                // Priority 2: Fallback to broader button selector if exact match not found
                if (!uploadClicked) {
                    const candidateBtns = page.locator('button, [role="button"]');
                    const candCount = await candidateBtns.count();
                    for (let i = 0; i < candCount; i++) {
                        const btn = candidateBtns.nth(i);
                        if (await btn.isVisible().catch(() => false)) {
                            const text = (await btn.innerText().catch(() => '')).trim();
                            if (/^(upload|submit)$/i.test(text) || (text.toLowerCase().includes('upload') && !isIgnoredButton(text))) {
                                console.log(`[${username}] Found fallback button: "${text}". Clicking...`);
                                await nukePopups(page);
                                await clickWithRetry(page, btn, text);
                                uploadClicked = true;
                                break;
                            }
                        }
                    }
                }

                if (!uploadClicked) {
                    throw new Error("Final 'Upload' button was not found or could not be clicked");
                }

                // Check immediately before waiting if error appeared upon click
                const preWaitErr = await checkUploadError(page);
                if (preWaitErr) {
                    console.error(`[${username}] ❌ Upload error: "${preWaitErr}". Moving to next file immediately...`);
                    throw new Error(preWaitErr);
                }

                // Step I: Wait strictly for confirmation toast "File has been uploaded successfully"
                const uploadResult = await waitForBulkUploadConfirmation(page, username, fileName, 60000);

                fileResults.push({ file: fileName, status: 'Success', message: uploadResult.message });
                await logBotSuccess(path.basename(__filename), username, `Uploaded bulk catalog file successfully: ${fileName}`, null, fileName);

            } catch (e) {
                console.error(`[${username}] Failed to upload ${fileName}: ${e.message}`);
                fileResults.push({ file: fileName, status: 'Failed', reason: e.message });
                try {
                    const validPage = (typeof page !== 'undefined' && page && !page.isClosed()) ? page : null;
                    await logBotError(path.basename(__filename), username, `Failed to upload file ${fileName}: ${e.message}`, validPage, null, fileName);
                } catch (err) {
                    console.log("error logging failure", err);
                }

                const isTargetClosed = e.message && (
                    e.message.includes('Target page, context or browser has been closed') ||
                    e.message.includes('Target closed') ||
                    e.message.includes('browser has been closed')
                );
                if (isTargetClosed || !browser || !browser.isConnected() || !page || page.isClosed()) {
                    console.error(`[${username}] ⚠️ Browser/page closed unexpectedly. Aborting remaining files for ${username}.`);
                    globalError = e.message;
                    const remainingFiles = uploadFiles.slice(i + 1);
                    for (const remFile of remainingFiles) {
                        const remFileName = path.basename(remFile);
                        fileResults.push({ file: remFileName, status: 'Failed', reason: `Aborted: browser session closed (${e.message})` });
                        try {
                            await logBotError(path.basename(__filename), username, `File not uploaded: ${remFileName} (Aborted: session closed)`, null, null, remFileName);
                        } catch (err) { }
                    }
                    break;
                }
            }
        }

    } catch (e) {
        console.error(`Error with account ${username}:`, e.message);
        globalError = e.message;
        try {
            const validPage = (typeof page !== 'undefined' && page && !page.isClosed()) ? page : null;
            await logBotError(path.basename(__filename), username, `Account error: ${e.message}`, validPage);
            if (fileResults.length === 0 && uploadFiles && uploadFiles.length > 0) {
                for (const remFile of uploadFiles) {
                    const remFileName = path.basename(remFile);
                    fileResults.push({ file: remFileName, status: 'Failed', reason: `Account error: ${e.message}` });
                    try {
                        await logBotError(path.basename(__filename), username, `File not uploaded: ${remFileName} (Account login/setup failed)`, null, null, remFileName);
                    } catch (err) { }
                }
            }
        } catch (err) {
            console.log("error logging session failure", err);
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

    const launchBrowser = async () => {
        return await chromium.launch({
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
    };

    let browser = await launchBrowser();

    const results = [];
    const BATCH_SIZE = 1;
    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
        if (!browser || !browser.isConnected()) {
            console.log("Browser disconnected/closed. Launching fresh browser instance...");
            try {
                browser = await launchBrowser();
            } catch (err) {
                console.error("Failed to relaunch browser:", err.message);
                break;
            }
        }
        const batch = accounts.slice(i, i + BATCH_SIZE);
        console.log(`\n=== Processing Batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} accounts) ===`);

        const batchResults = await Promise.all(batch.map(account => asyncLocalStorage.run(account.username, () => processAccount(browser, account, uploadFiles))));
        results.push(...batchResults);

        if (i + BATCH_SIZE < accounts.length) {
            console.log("Recycling browser session for next batch...");
            try {
                if (browser && browser.isConnected()) {
                    await browser.close().catch(() => {});
                }
            } catch (e) { }
            browser = null;

            console.log("Batch complete. Waiting 8-12 seconds to prevent rate-limiting...");
            const delay = Math.floor(Math.random() * (12000 - 8000 + 1)) + 8000;
            await new Promise(r => setTimeout(r, delay));
        }
    }

    try {
        if (browser && browser.isConnected()) {
            await browser.close().catch(() => {});
        }
    } catch (e) { }

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

}

runBot().then(async () => {
    try { const { closeDB } = require('./db'); await closeDB(); } catch (e) {}
    process.exit(0);
}).catch(async (err) => {
    console.error("Bot execution failed:", err);
    try { const { closeDB } = require('./db'); await closeDB(); } catch (e) {}
    process.exit(1);
});
