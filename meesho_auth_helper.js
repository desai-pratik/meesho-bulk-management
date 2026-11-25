const fs = require('fs');
const path = require('path');
const { clearDashboard } = require('./nuke_helper');

const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

const LOGIN_URL = 'https://supplier.meesho.com/panel/v3/new/root/login';
const DASHBOARD_URL = 'https://supplier.meesho.com/panel/v3/new/growth/cataloging';

/**
 * Checks if the current page returned Akamai WAF "Access Denied"
 */
async function isAccessDenied(page) {
    try {
        const title = (await page.title().catch(() => '')) || '';
        if (title.toLowerCase().includes('access denied')) return true;

        const isBlocked = await page.evaluate(() => {
            const h1 = document.querySelector('h1');
            const h1Text = (h1 ? h1.innerText : '').toLowerCase();
            if (h1Text.includes('access denied')) return true;

            const bodyText = (document.body ? document.body.innerText : '').toLowerCase();
            return bodyText.includes('access denied') && (bodyText.includes('edgesuite.net') || bodyText.includes('permission to access'));
        }).catch(() => false);

        return isBlocked;
    } catch (e) {
        return false;
    }
}

/**
 * Gets session file path for a username
 */
function getSessionFilePath(username) {
    const safeUser = String(username).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(SESSIONS_DIR, `${safeUser}.json`);
}

/**
 * Loads context options with saved session state if available
 */
function getContextOptionsWithSession(username, baseOptions = {}) {
    const sessionFile = getSessionFilePath(username);
    const options = {
        viewport: null,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        ...baseOptions
    };

    if (fs.existsSync(sessionFile)) {
        try {
            const stat = fs.statSync(sessionFile);
            // Session valid if less than 7 days old and non-empty
            if (stat.size > 50 && (Date.now() - stat.mtimeMs < 7 * 24 * 3600 * 1000)) {
                options.storageState = sessionFile;
            }
        } catch (e) {}
    }
    return options;
}

/**
 * Sensitively verifies if existing session is already logged in, or performs login with anti-detection and rate-limit backoff.
 */
async function ensureMeeshoLogin(page, context, username, password) {
    const sessionFile = getSessionFilePath(username);

    // 1. First test if session is already active (to avoid hitting /login completely!)
    if (fs.existsSync(sessionFile)) {
        console.log(`[${username}] Checking saved session state...`);
        try {
            await page.goto(DASHBOARD_URL, { timeout: 25000, waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2500);

            const currentUrl = page.url();
            const onPanel = currentUrl.includes('/panel/v3/new/') && !currentUrl.includes('/root/login');
            
            if (onPanel && !(await isAccessDenied(page))) {
                console.log(`[${username}] ✓ Active session verified! Already authenticated on Meesho.`);
                await clearDashboard(page);
                // Refresh saved storage state
                if (context && context.storageState) {
                    await context.storageState({ path: sessionFile }).catch(() => {});
                }
                return true;
            }
            console.log(`[${username}] Saved session expired or redirected to login. Refreshing credentials...`);
        } catch (e) {
            console.log(`[${username}] Session test encountered: ${e.message}. Proceeding to login...`);
        }
    }

    // 2. Navigate to LOGIN_URL
    console.log(`[${username}] Navigating to Meesho login...`);
    await page.goto(LOGIN_URL, { timeout: 35000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // 3. Check for Akamai Access Denied
    if (await isAccessDenied(page)) {
        console.error(`\n⚠️ [${username}] [Akamai Rate-Limit Detected] "Access Denied" encountered on login endpoint.`);
        console.error(`  Akamai has throttled requests due to rapid logins.`);
        console.error(`  Pausing 20 seconds before attempting clean reload...`);
        await page.waitForTimeout(20000);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        await page.waitForTimeout(2000);

        if (await isAccessDenied(page)) {
            throw new Error(`Akamai rate-limited access (Access Denied). Please wait a couple minutes before retrying to let the block clear.`);
        }
    }

    // Check if already redirected to dashboard
    const initialUrl = page.url();
    if (initialUrl.includes('/panel/v3/new/') && !initialUrl.includes('/root/login')) {
        console.log(`[${username}] ✓ Already authenticated! Redirected directly to ${initialUrl}`);
        if (context && context.storageState) {
            try {
                await context.storageState({ path: sessionFile });
                console.log(`[${username}] ✓ Session saved to sessions/ for future reuse.`);
            } catch (e) {}
        }
        await clearDashboard(page);
        return true;
    }

    // 4. Fill credentials gently (using force: true to bypass floating label pointer intercept)
    const emailInput = page.locator('input[name="emailOrPhone"]')
        .or(page.getByRole('textbox', { name: /email/i }))
        .or(page.locator('input[type="text"]').first());
    await emailInput.first().waitFor({ state: 'visible', timeout: 30000 });

    console.log(`[${username}] Entering login credentials...`);
    const emailEl = emailInput.first();
    await emailEl.click({ force: true }).catch(() => emailEl.focus().catch(() => {}));
    await emailEl.fill(username);
    await page.waitForTimeout(300);

    const passwordInput = page.locator('input[name="password"]')
        .or(page.getByRole('textbox', { name: /password/i }))
        .or(page.locator('input[type="password"]').first());
    await passwordInput.first().waitFor({ state: 'visible', timeout: 15000 });
    const passwordEl = passwordInput.first();
    await passwordEl.click({ force: true }).catch(() => passwordEl.focus().catch(() => {}));
    await passwordEl.fill(password);
    await page.waitForTimeout(400);

    const loginBtn = page.getByRole('button', { name: /log\s*in/i })
        .or(page.locator('button[type="submit"]'))
        .or(page.locator('button:has-text("Log in")')).first();
    await loginBtn.waitFor({ state: 'visible', timeout: 15000 });
    
    try {
        await loginBtn.click({ timeout: 5000 });
    } catch (btnErr) {
        console.log(`  > Standard click on Login button failed, using force click...`);
        await loginBtn.click({ force: true }).catch(() => loginBtn.evaluate(el => el.click()));
    }

    // Also send Enter if still on login after brief delay
    await page.waitForTimeout(1000);
    if (page.url().includes('/root/login')) {
        await page.keyboard.press('Enter').catch(() => {});
    }

    try {
        await page.waitForLoadState('networkidle', { timeout: 10000 });
    } catch (e) {}

    // Wait for URL to leave login
    let loggedIn = false;
    for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(1000);
        const url = page.url();
        if (url.includes('/panel/v3/new/') && !url.includes('/root/login')) {
            loggedIn = true;
            break;
        }

        const errorText = await page.evaluate(() => {
            const el = document.querySelector('.toast-error, [role="alert"], .error-message, .text-error');
            return el ? el.innerText.trim() : null;
        }).catch(() => null);

        if (errorText) {
            console.log(`[${username}] Login notice: "${errorText}"`);
        }
    }

    const finalUrl = page.url();
    if (loggedIn || (finalUrl.includes('/panel/v3/new/') && !finalUrl.includes('/root/login'))) {
        console.log(`[${username}] ✓ Successfully logged in! Current URL: ${finalUrl}`);

        // 5. Save session state for all future bot runs!
        if (context && context.storageState) {
            try {
                await context.storageState({ path: sessionFile });
                console.log(`[${username}] ✓ Session saved to sessions/ for future reuse (avoids redundant logins).`);
            } catch (e) {}
        }

        await clearDashboard(page);
        return true;
    } else {
        throw new Error(`Login did not transition from login page. Current URL: ${finalUrl}`);
    }
}

module.exports = {
    LOGIN_URL,
    DASHBOARD_URL,
    SESSIONS_DIR,
    isAccessDenied,
    getSessionFilePath,
    getContextOptionsWithSession,
    ensureMeeshoLogin
};
