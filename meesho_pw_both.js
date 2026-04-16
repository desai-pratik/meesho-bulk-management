const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Configuration
const LOGIN_URL = 'https://supplier.meesho.com/panel/v3/new/root/login';
// UPDATE THIS TO YOUR FOLDER PATH
const FILE_PATH = String.raw`c:\Users\ASUS\Downloads\pratik`;

// Category Paths Configuration
const CATEGORY_PATHS = {
    '1': {
        name: 'Jewellery Set',
        steps: ['Women Fashion', 'Accessories', 'Jewellery', 'Jewellery Set']
    },
    '2': {
        name: 'Hair Accessories',
        steps: ['Women Fashion', 'Accessories', 'Hair Accessories', 'Hair Accessories']
    }
};

// Helper to ask user for input
function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}

// Helper to read accounts
function getAccounts() {
    try {
        const csv = fs.readFileSync('accounts.csv', 'utf8');
        const lines = csv.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('username,'));
        return lines.map(line => {
            const [username, password] = line.split(',');
            return { username, password };
        });
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
    await page.waitForTimeout(500); // Fixed 500ms delay just for stability
}

// SAFER NUCLEAR OPTION: Only remove actual modals/popups
async function nukePopups(page) {
    try {
        await page.evaluate(() => {
            // 1. Remove "Notifications" or "Losing Orders" panels specifically
            const allDivs = Array.from(document.querySelectorAll('div, p, h4'));
            for (const el of allDivs) {
                if (el.innerText && (el.innerText.includes('Notifications') || el.innerText.includes('Losing'))) {
                    let parent = el.closest('div[role="presentation"], div[class*="MuiPaper"]');
                    if (parent) parent.remove();
                }
            }

            // 2. Remove Generic Modals/Dialogs (SAFER CHECK)
            const dialogs = document.querySelectorAll('div[role="dialog"], .MuiModal-root');
            dialogs.forEach(d => d.remove());

            // 3. Remove Backdrops
            document.querySelectorAll('.MuiBackdrop-root').forEach(b => b.remove());

            // 4. Remove Joyride/Tour/Guide tooltips
            document.querySelectorAll('[class*="joyride"], [class*="tour"], [class*="guide"]').forEach(e => e.remove());
        });
        return true;
    } catch (e) {
        return false;
    }
}

// Function to clear dashboard immediately after login
async function clearDashboard(page) {
    console.log("  > Waiting 5s for dashboard ads to load...");
    await page.waitForTimeout(5000);

    console.log("  > Running cleanup loop for 5s...");
    const endTime = Date.now() + 5000;
    while (Date.now() < endTime) {
        await nukePopups(page);
        await page.waitForTimeout(500);
    }
    console.log("  > Dashboard cleanup done.");
}

// Dedicated function to handle the "We are having trouble" error page
async function handleErrorPage(page) {
    try {
        // Check for the specific error text
        const errorText = page.getByText('We are having trouble showing this data', { exact: false });
        if (await errorText.isVisible({ timeout: 1000 })) {
            console.log("  > Detected 'We are having trouble' error page.");

            const retryBtn = page.getByRole('button', { name: /retry/i }).or(page.getByText('Retry', { exact: true }));
            if (await retryBtn.isVisible({ timeout: 1000 })) {
                console.log("  > Clicking 'Retry' button...");
                await retryBtn.click({ force: true });
                await page.waitForTimeout(3000); // Wait for reload

                // Check AGAIN. If still there, force reload.
                if (await errorText.isVisible({ timeout: 1000 })) {
                    console.log("  > 'Retry' didn't work. Forcing Page Reload...");
                    await page.reload();
                    await page.waitForTimeout(5000);
                    await clearDashboard(page);
                }
            } else {
                console.log("  > Error text found but 'Retry' button not visible. Reloading...");
                await page.reload();
                await page.waitForTimeout(5000);
                await clearDashboard(page);
            }
            return true; // We handled an error
        }
    } catch (e) {
        // Ignore errors during check
    }
    return false; // No error found
}

// Helper to click with retry, popup handling, verification, AND ERROR PAGE HANDLING
async function clickWithRetry(page, locator, name, verifyLocator = null) {
    // STRICT MODE FIX: If multiple elements match, default to the LAST one.
    // This is crucial for "Hair Accessories" where the name appears multiple times.
    if (await locator.count() > 1) {
        // console.log(`  > Found multiple elements for '${name}'. Using the last one.`);
        locator = locator.last();
    }

    for (let i = 0; i < 5; i++) {
        try {
            // 0. CHECK FOR ERROR PAGE FIRST
            await handleErrorPage(page);

            // 1. Nuke before clicking
            await nukePopups(page);

            // 2. Check visibility
            if (await locator.isVisible({ timeout: 3000 })) {
                // 3. Click
                await locator.click({ timeout: 3000, force: true });

                // 4. Verify (if provided)
                if (verifyLocator) {
                    try {
                        // STRICT MODE FIX FOR VERIFICATION:
                        // Always wait for the LAST matching element. 
                        // If a new column appeared, it will be the last one.
                        await verifyLocator.last().waitFor({ state: 'visible', timeout: 10000 }); // Increased to 10s
                        return; // Success!
                    } catch (e) {
                        console.log(`  > Clicked '${name}', but next step didn't appear in 10s.`);

                        // Check for Error Page AGAIN after click failure
                        const handled = await handleErrorPage(page);
                        if (handled) {
                            console.log("  > Retrying action after handling error page...");
                        } else {
                            // If it's the "Catalog Uploads" step and it's failing, try reloading the page
                            if (name === 'Catalog Uploads' && i >= 2) {
                                console.log("  > 'Catalog Uploads' stuck. Reloading page...");
                                await page.goto(LOGIN_URL, { timeout: 20000 });
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
            } else {
                console.log(`  > '${name}' not visible yet...`);
                // Log URL for debugging
                if (i === 4) console.log(`  > Debug: Current URL is ${page.url()}`);
                await handleErrorPage(page); // Check if we are on error page
            }
        } catch (e) {
            console.log(`  > Click on '${name}' failed/intercepted. Retrying...`);
            await nukePopups(page);
            await page.waitForTimeout(500);
        }
        await page.waitForTimeout(500);
    }
    throw new Error(`Failed to click '${name}' (or verify next step) after 5 attempts.`);
}

async function processAccount(browser, account, uploadFiles, categoryPath) {
    const { username, password } = account;
    console.log(`\n=== Starting Account: ${username} ===`);

    const context = await browser.newContext({ viewport: null });
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
        await page.getByRole('button', { name: 'Log in' }).click();

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

                // Step B: Add Catalog in Bulk -> Verify First Category appears
                console.log(`[${username}] Looking for 'Add Catalog in Bulk'...`);
                const firstCatBtn = page.getByText(categoryPath.steps[0], { exact: true });
                await clickWithRetry(page, addCatalogBtn, 'Add Catalog in Bulk', firstCatBtn);

                // Dynamic Navigation based on Category Path
                // steps[0] is already verified visible. Now click it to see steps[1], etc.
                for (let j = 0; j < categoryPath.steps.length; j++) {
                    const currentStepName = categoryPath.steps[j];
                    const nextStepName = (j < categoryPath.steps.length - 1) ? categoryPath.steps[j + 1] : 'Choose File';

                    console.log(`[${username}] Clicking '${currentStepName}'...`);
                    const currentBtn = page.getByText(currentStepName, { exact: true });

                    let nextBtn;
                    if (nextStepName === 'Choose File') {
                        // Special handling for the final file input button
                        // Matches "Choose File" OR "Upload Template File" (case insensitive)
                        // STRICT MODE FIX: Use .first() to avoid ambiguity if both exist
                        nextBtn = page.getByRole('button', { name: /choose file|upload template/i }).first();
                    } else {
                        nextBtn = page.getByText(nextStepName, { exact: true });
                    }

                    await clickWithRetry(page, currentBtn, currentStepName, nextBtn);
                }

                // Step G: Choose File
                console.log(`[${username}] Looking for 'Choose File' / 'Upload Template File'...`);
                // STRICT MODE FIX: Use .first() to avoid ambiguity
                const chooseFileBtn = page.getByRole('button', { name: /choose file|upload template/i }).first();
                await clickWithRetry(page, chooseFileBtn, 'Choose File');

                await chooseFileBtn.setInputFiles(currentFile);
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

                console.log(`[${username}] Upload finished for ${fileName}. Waiting 20 seconds...`);
                await page.waitForTimeout(20000); // Increased to 20s

                fileResults.push({ file: fileName, status: 'Success' });

            } catch (e) {
                console.error(`[${username}] Failed to upload ${fileName}: ${e.message}`);
                fileResults.push({ file: fileName, status: 'Failed', reason: e.message });
                // Attempt to take a screenshot of the failure
                try {
                    await page.screenshot({ path: `error_${username}_${fileName}.png`, timeout: 5000 });
                } catch (err) { }
            }
        }

    } catch (e) {
        console.error(`Error with account ${username}:`, e.message);
        globalError = e.message;
        try {
            await page.screenshot({ path: `error_${username}_global.png`, timeout: 5000 });
        } catch (err) { }
    } finally {
        console.log(`[${username}] Closing session...`);
        try {
            await context.close();
        } catch (e) { }
    }
    return { username, fileResults, globalError };
}

async function runBot() {
    // 1. Ask for Category
    console.log("\nSelect Category Mode:");
    console.log("1. Jewellery Set (Default)");
    console.log("2. Hair Accessories");
    const choice = await askQuestion("Enter number (1 or 2): ");

    const selectedCategory = CATEGORY_PATHS[choice.trim()] || CATEGORY_PATHS['1'];
    console.log(`\nSelected Category: ${selectedCategory.name}`);
    console.log(`Path: ${selectedCategory.steps.join(' -> ')}\n`);

    const accounts = getAccounts();
    const uploadFiles = getUploadFiles();

    if (uploadFiles.length === 0) {
        console.error(`Error: No files found at ${FILE_PATH}`);
        return;
    }
    console.log(`Found ${uploadFiles.length} files to upload.`);
    console.log(`Loaded ${accounts.length} accounts.`);

    const browser = await chromium.launch({
        headless: false,
        args: ['--start-maximized']
    });

    const results = [];

    // Batch Processing
    const BATCH_SIZE = 5; // Keep at 2 for stability
    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
        const batch = accounts.slice(i, i + BATCH_SIZE);
        console.log(`\n=== Processing Batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} accounts) ===`);

        const batchResults = await Promise.all(batch.map(account => processAccount(browser, account, uploadFiles, selectedCategory)));
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
