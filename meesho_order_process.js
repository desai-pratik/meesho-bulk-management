const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Configuration
const LOGIN_URL = 'https://supplier.meesho.com/panel/v3/new/root/login';
const DOWNLOAD_PATH = String.raw`C:\Jewellery-Agent\labels`;

// Ensure download directory exists
if (!fs.existsSync(DOWNLOAD_PATH)) {
    fs.mkdirSync(DOWNLOAD_PATH, { recursive: true });
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

// FAST MODE: Minimal delay
async function randomDelay(page) {
    await page.waitForTimeout(2000)//s just for stability
}

// SAFER NUCLEAR OPTION: Only remove actual modals/popups
async function nukePopups(page) {
    try {
        const result = await page.evaluate(() => {
            // Helper to check if an element is roughly in the center or covers the screen
            function isCentral(el) {
                if (!el) return false;
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return false;

                const winW = window.innerWidth;
                const cx = rect.left + rect.width / 2;

                // Consider it a popup if:
                // 1. It covers more than 80% width of the screen (backdrops) OR
                // 2. Its center X is between 20% and 80% of the screen (avoids left/right sidebars entirely)
                return (rect.width > winW * 0.8) || (cx > winW * 0.2 && cx < winW * 0.8);
            }

            // 0. HANDLE SPECIAL AUTH POPUPS (Must click, not close!)
            let authorisedSpecial = false;
            const buttonsOrLinks = Array.from(document.querySelectorAll('button, a, span'));
            for (const el of buttonsOrLinks) {
                if (el.innerText && el.innerText.trim().toLowerCase() === 'proceed to upload') {
                    const clickable = el.closest('button') || el;
                    clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    authorisedSpecial = true;
                }
            }
            if (authorisedSpecial) return 'auth_clicked'; // Exit evaluation early to allow React to process the click properly!

            // 1. Target recognized annoying panels specifically and hide them
            const allDivs = Array.from(document.querySelectorAll('div, p, h4, h2'));
            for (const el of allDivs) {
                if (el.innerText && (
                    el.innerText.includes('Notifications') ||
                    el.innerText.includes('Losing') ||
                    el.innerText.includes('Meesho Fast Program') ||
                    (el.innerText.includes('Announcement') && !el.innerText.includes('mportant Announcements'))
                )) {
                    let parent = el.closest('div[role="presentation"], div[class*="MuiPaper"], div[role="dialog"]');
                    if (!parent) {
                        let current = el.parentElement;
                        while (current && current.tagName !== 'BODY') {
                            const style = window.getComputedStyle(current);
                            if (style.position === 'fixed' || parseInt(style.zIndex || 0) > 100) {
                                parent = current;
                                break;
                            }
                            current = current.parentElement;
                        }
                    }
                    if (parent && parent.tagName !== 'BODY' && parent.id !== 'root' && isCentral(parent)) {
                        parent.style.setProperty('display', 'none', 'important');
                    }
                }
            }

            // 2. Hide Generic Modals/Dialogs/Backdrops
            const selectors = [
                'div[role="dialog"]',
                '.MuiModal-root',
                '.MuiBackdrop-root',
                '[class*="backdrop"]',
                '[class*="joyride"]',
                '[class*="tour"]',
                '[class*="guide"]'
            ];
            document.querySelectorAll(selectors.join(', ')).forEach(el => {
                if (isCentral(el)) {
                    el.style.setProperty('display', 'none', 'important');
                    el.style.setProperty('pointer-events', 'none', 'important');
                }
            });

            // 3. Fallback: try organically clicking any close SVG icons ONLY in central popups
            document.querySelectorAll('svg').forEach(svg => {
                // Heuristic for X cross icons
                const path = svg.querySelector('path');
                if ((svg.getAttribute('class') || '').toLowerCase().includes('close') ||
                    (path && path.getAttribute('d') && path.getAttribute('d').length < 200 && path.getAttribute('d').includes('M'))) {

                    let isPopup = false;
                    let curr = svg;
                    let popupContainer = null;
                    while (curr && curr.tagName !== 'BODY') {
                        const style = window.getComputedStyle(curr);
                        if ((style.position === 'fixed' || style.position === 'absolute') && parseInt(style.zIndex || 0) > 10) {
                            isPopup = true;
                            popupContainer = curr;
                            break;
                        }
                        curr = curr.parentElement;
                    }

                    // IF it's in a popup AND the popup is in the center of the screen
                    if (isPopup && isCentral(popupContainer)) {
                        try {
                            const clickable = svg.closest('button') || svg;
                            clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        } catch (e) { }
                    }
                }
            });
            return 'cleaned';
        });
        return result === 'auth_clicked';
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
            if (authClicked) {
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
        await page.getByRole('button', { name: 'Log in' }).click();

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
        console.log(`[${username}] Waiting 10 Seconds for orders to move to Ready to Ship...`);
        await page.waitForTimeout(10000); // 10 seconds wait
        await page.reload();
        await page.waitForTimeout(5000);
        await clearDashboard(page);

        console.log(`[${username}] Moving to Ready to Ship tab...`);
        try {
            const readyTab = page.getByRole('tab', { name: /Ready to Ship/i }).or(page.getByText('Ready to Ship', { exact: true }).first());
            await clickWithRetry(page, readyTab, 'Ready to Ship Tab');
            await page.waitForTimeout(3000);
            await nukePopups(page);

            // Select all ready to ship orders
            const selectAllReady = page.locator('input[type="checkbox"]').first();
            try {
                // Wait up to 10 seconds for the table to fully render
                await selectAllReady.waitFor({ state: 'visible', timeout: 10000 });
                console.log(`[${username}] Selecting all ready to ship orders...`);
                await selectAllReady.check({ force: true });
                await page.waitForTimeout(1000);
            } catch(e) {
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

                // Now wait for the actual inner "Label" button to appear (meaning progress bar is done)
                console.log(`[${username}] Waiting for progress bar to finish...`);
                const innerLabelBtn = popupDialog.locator('button:has-text("Label")').first()
                    .or(popupDialog.getByRole('button', { name: 'Label', exact: true }).first());
                await innerLabelBtn.waitFor({ state: 'visible', timeout: 60000 });
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

            } catch(e) {
                console.log(`[${username}] Expected UI flow for 'Label' generation failed or no ready to ship orders: ${e.message}`);
            }

        } catch (e) {
            console.log(`[${username}] Expected flow for Ready to Ship not completed: ${e.message}`);
        }


    } catch (e) {
        console.error(`Error with account ${username}:`, e.message);
        globalError = e.message;
        try {
            await page.screenshot({ path: `error_orders_${username.split('@')[0]}.png`, timeout: 5000 });
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
    const accounts = getAccounts();

    if (accounts.length === 0) {
        console.error(`Error: No accounts loaded.`);
        return;
    }
    console.log(`Loaded ${accounts.length} accounts.`);
    console.log(`Labels will be saved to: ${DOWNLOAD_PATH}`);

    const browser = await chromium.launch({
        headless: false,
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

        const result = await processAccount(browser, account);
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
