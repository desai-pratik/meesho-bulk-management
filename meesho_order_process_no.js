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
const DOWNLOAD_PATH = path.join(__dirname, 'labels');

// Ensure download directory exists
if (!fs.existsSync(DOWNLOAD_PATH)) {
    fs.mkdirSync(DOWNLOAD_PATH, { recursive: true });
}

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
            const nukeResult = await nukePopups(page);
            if (nukeResult && nukeResult.authClicked) {
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
                        console.log("  > Retrying action...");
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

async function processAccount(browser, account) {
    const { username, password } = account;
    console.log(`\n=== Starting Account: ${username} ===`);

    const context = await browser.newContext({
        viewport: null,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        acceptDownloads: true // Crucial for downloading labels automatically
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

    let globalError = null;
    let labelDownloaded = false;

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

        // 3. Go to Orders section
        console.log(`[${username}] Going to Orders page...`);
        const ordersMenu = page.getByText('Orders', { exact: true }).first();
        await clickWithRetry(page, ordersMenu, 'Orders Menu');
        await page.waitForTimeout(3000);
        await nukePopups(page);

        // --- PENDING ORDERS HANDLING ---
        console.log(`[${username}] Checking Pending Orders...`);
        try {
            const pendingTab = page.getByRole('tab', { name: /Pending/i }).or(page.getByText('Pending').first());
            await clickWithRetry(page, pendingTab, 'Pending Tab');
            await page.waitForTimeout(3000);
            await nukePopups(page);

            // Attempt to look for checkboxes to select all in the table header or globally
            const selectAllPending = page.locator('input[type="checkbox"]').first();
            if (await selectAllPending.isVisible()) {
                console.log(`[${username}] Selecting all pending orders...`);
                await selectAllPending.check();
                await page.waitForTimeout(1000);
            }

            // Click the specific "Accept Selected Orders" button at the bottom
            const acceptBtn = page.locator('button:has-text("Accept Selected Orders")').last();

            if (await acceptBtn.isVisible()) {
                console.log(`[${username}] Found Accept Selected Orders button. Clicking...`);
                await clickWithRetry(page, acceptBtn, 'Accept Orders Button');

                await page.waitForTimeout(1000); // Tiny pause for animation

                try {
                    const confirmPopupBtn = page.getByRole('button', { name: 'Accept Order', exact: true }).last();

                    if (await confirmPopupBtn.isVisible()) {
                        console.log(`[${username}] Clicking 'Accept Order' in popup...`);
                        await confirmPopupBtn.click({ force: true });

                        // Wait for "Got it" success popup dynamically, handling any loading duration
                        console.log(`[${username}] Waiting for loading to finish and success confirmation popup to appear...`);
                        try {
                            const gotItClicked = await page.waitForFunction(() => {
                                const btns = Array.from(document.querySelectorAll('button'));
                                const gotItBtn = btns.find(b => b.innerText && (b.innerText.trim().toLowerCase() === 'got it'));
                                // offsetParent !== null is a fast way to check if an element is visibly rendered in the DOM
                                if (gotItBtn && gotItBtn.offsetParent !== null) {
                                    gotItBtn.click();
                                    return true;
                                }
                                return false;
                            }, { timeout: 90000, polling: 1000 }); // Poll every 1 second for up to 90 seconds

                            if (gotItClicked) {
                                console.log(`[${username}] Found 'Got it' button and clicked it.`);
                            }
                            await page.waitForTimeout(2000); // 2 seconds leeway for the popup to completely animate out
                        } catch (e) {
                            console.log(`[${username}] 'Got it' popup did not appear in time. Proceeding...`);
                        }

                        console.log(`[${username}] Orders accepted explicitly from popup.`);
                    }
                } catch (e) {
                    console.log(`[${username}] Popup handling skipped or errored: ${e.message}`);
                }

            } else {
                console.log(`[${username}] No Accept Selected Orders button found. Probably no pending orders.`);
            }

        } catch (e) {
            console.log(`[${username}] Expected UI flow for pending not found, or no pending orders: ${e.message}`);
        }

        // --- READY TO SHIP HANDLING ---
        // console.log(`[${username}] Waiting 10 Seconds for orders to move to Ready to Ship...`);
        // await page.waitForTimeout(10000); // 10 seconds wait
        await page.reload();
        // await page.waitForTimeout(5000);
        await clearDashboard(page);

        console.log(`[${username}] Moving to Ready to Ship tab...`);
        try {
            const readyTab = page.getByRole('tab', { name: /Ready to Ship/i }).or(page.getByText('Ready to Ship', { exact: true }).first());
            await clickWithRetry(page, readyTab, 'Ready to Ship Tab');
            await page.waitForTimeout(3000);
            await nukePopups(page);

            // --- FILTER: Label Downloaded = No ---
            try {
                console.log(`[${username}] Applying filter: Label Downloaded -> No`);
                
                // Find the dropdown containing "Label downloaded"
                const labelDropdown = page.getByText('Label downloaded', { exact: false }).last();
                await clickWithRetry(page, labelDropdown, 'Label Downloaded Dropdown');
                await page.waitForTimeout(1000); // Wait for dropdown to open
                
                // Click the "No" option
                const noOption = page.getByText('No', { exact: true }).last();
                await noOption.waitFor({ state: 'visible', timeout: 3000 });
                await noOption.click({ force: true });
                
                // Wait for the table to reload with the filtered data
                console.log(`[${username}] Waiting 3 seconds for filtered results to load...`);
                await page.waitForTimeout(3000);
                
                // Close the dropdown if it didn't auto-close (by clicking the header again or clicking elsewhere)
                // Sometimes clicking away is safer
                await page.mouse.click(10, 10);
                await page.waitForTimeout(1000);
            } catch (e) {
                console.log(`[${username}] Failed to apply filter 'Label Downloaded -> No': ${e.message}`);
            }

            // Select all ready to ship orders
            const selectAllReady = page.locator('input[type="checkbox"]').first();
            try {
                // Wait up to 10 seconds for the table to fully render
                await selectAllReady.waitFor({ state: 'visible', timeout: 10000 });
                console.log(`[${username}] Selecting all ready to ship orders...`);
                await selectAllReady.check({ force: true });
                await page.waitForTimeout(1000);
            } catch (e) {
                console.log(`[${username}] 'Select All' checkbox not visible or timed out.`);
            }

            // Click the main bottom Label button
            const generateLabelBtn = page.getByRole('button', { name: 'Label', exact: true }).last()
                .or(page.locator('button:has-text("Label")').last());

            try {
                // Wait for the label button to ensure table is ready
                await generateLabelBtn.waitFor({ state: 'visible', timeout: 5000 });
                console.log(`[${username}] Found main 'Label' button. Clicking...`);
                await clickWithRetry(page, generateLabelBtn, 'Generate Labels Button');

                // Wait for popup dialog
                console.log(`[${username}] Waiting for popup to generate labels...`);
                const popupDialog = page.getByRole('dialog').first();
                await popupDialog.waitFor({ state: 'visible', timeout: 15000 });

                // Now wait for the actual inner "Label" button to appear (meaning progress bar is done) OR an error
                console.log(`[${username}] Waiting for progress bar to finish...`);
                const innerLabelBtn = popupDialog.locator('button:has-text("Label")').first()
                    .or(popupDialog.getByRole('button', { name: 'Label', exact: true }).first());
                const errorText = popupDialog.getByText('Temporary Issue', { exact: false });
                
                const targetLocator = innerLabelBtn.or(errorText);
                await targetLocator.waitFor({ state: 'visible', timeout: 60000 });

                if (await errorText.isVisible()) {
                    console.log(`[${username}] WARNING: Temporary Issue with Label Generation detected! Clicking 'Got it'...`);
                    const gotItBtn = popupDialog.getByRole('button', { name: 'Got it', exact: true }).or(popupDialog.locator('button:has-text("Got it")'));
                    if (await gotItBtn.isVisible()) {
                        await gotItBtn.click({ force: true });
                        await page.waitForTimeout(1000);
                    }
                    
                    console.log(`[${username}] Process ends here for this account due to temporary issue.`);
                    return { username, labelDownloaded: false, infoMessage: "Temporary Issue - some orders not downloaded" };
                }

                console.log(`[${username}] Labels generated successfully!`);

                // Uncheck manifest
                const manifestCheckbox = popupDialog.locator('input[type="checkbox"]').first();
                if (await manifestCheckbox.isVisible()) {
                    const isChecked = await manifestCheckbox.isChecked();
                    if (isChecked) {
                        console.log(`[${username}] Unchecking 'Download Manifest'...`);
                        await manifestCheckbox.uncheck({ force: true });
                        await page.waitForTimeout(500);
                    }
                }

                // Click final download button
                console.log(`[${username}] Clicking final Label download button...`);
                const downloadPromise = page.waitForEvent('download', { timeout: 30000 });

                // Click directly to avoid locator.first() compilation bugs inside clickWithRetry
                await innerLabelBtn.click({ force: true });

                const download = await downloadPromise;
                const prefix = username.split('@')[0] || 'account';
                const ts = new Date().toISOString().replace(/[:.]/g, '-');
                const downloadPath = path.join(DOWNLOAD_PATH, `${prefix}_labels_${ts}.pdf`);

                await download.saveAs(downloadPath);
                console.log(`[${username}] SUCCESS: Labels downloaded to ${downloadPath}`);
                labelDownloaded = true;
                await logBotSuccess(path.basename(__filename), username, `Labels downloaded successfully to ${path.basename(downloadPath)}`);

            } catch (e) {
                console.log(`[${username}] Expected UI flow for 'Label' generation failed or no ready to ship orders: ${e.message}`);
            }

        } catch (e) {
            console.log(`[${username}] Expected flow for Ready to Ship not completed: ${e.message}`);
        }


    } catch (e) {
        console.error(`Error with account ${username}:`, e.message);
        globalError = e.message;
        try {
            await logBotError(path.basename(__filename), username, e.message, typeof page !== 'undefined' ? page : null);
        } catch (err) {
            console.log("error for screenshot", err)
        }
    } finally {
        console.log(`[${username}] Closing session...`);
        try {
            await context.close();
        } catch (e) { }
    }
    return { username, labelDownloaded, globalError };
}

async function runBot() {
    const accounts = await getAccounts();

    if (accounts.length === 0) {
        console.error(`Error: No accounts loaded.`);
        return;
    }
    console.log(`Loaded ${accounts.length} accounts.`);
    console.log(`Labels will be saved to: ${DOWNLOAD_PATH}`);

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

    // Processing accounts one by one
    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];

        const result = await asyncLocalStorage.run(account.username, () => processAccount(browser, account));
        results.push(result);

        if (i < accounts.length - 1) {
            console.log("Waiting 5 seconds before next account...");
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    console.log("\nAll accounts processed.");

    // --- FINAL SUMMARY ---
    console.log("\n==========================================");
    console.log("       ORDER PROCESSING SUMMARY           ");
    console.log("==========================================");

    results.forEach(r => {
        console.log(`\nACCOUNT: ${r.username}`);
        if (r.globalError) {
            console.log(`  STATUS: ❌ Session Failed - ${r.globalError}`);
        } else if (r.infoMessage) {
            console.log(`  STATUS: ℹ️ Information - ${r.infoMessage}`);
        } else if (r.labelDownloaded) {
            console.log(`  STATUS: ✅ Labels Downloaded Successfully`);
        } else {
            console.log(`  STATUS: ⚠️ Evaluated, but no labels were downloaded (no orders?)`);
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
