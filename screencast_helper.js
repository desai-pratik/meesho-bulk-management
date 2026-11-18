const Module = require('module');
const originalRequire = Module.prototype.require;

let isShuttingDown = false;
let currentBrowser = null;

function handleShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[ScreencastHelper] Received ${signal}. Terminating bot process immediately...`);
    if (currentBrowser) {
        try {
            currentBrowser.close().catch(() => {});
        } catch (e) {}
    }
    setTimeout(() => process.exit(0), 100);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

let stealthChromium = null;
try {
    const { chromium } = require('playwright-extra');
    const stealth = require('puppeteer-extra-plugin-stealth')();
    // Disable outdated evasions that forge mismatched OS/UA/Sec-CH-UA/WebGL signatures flagged by Akamai WAF:
    // - user-agent-override forces Windows UA on Linux TCP stack and injects Chrome 89 '" Not;A Brand";v="99"'
    // - webgl.vendor forces macOS 'Intel Iris OpenGL Engine' on Linux/Windows
    // - navigator.languages hardcodes ['en-US', 'en'] regardless of context locale
    stealth.enabledEvasions.delete('user-agent-override');
    stealth.enabledEvasions.delete('webgl.vendor');
    stealth.enabledEvasions.delete('navigator.languages');
    chromium.use(stealth);
    stealthChromium = chromium;
} catch (e) {
    console.warn("[ScreencastHelper] Could not initialize playwright-extra stealth plugin:", e.message);
}

// Intercept require('playwright') to inject stealth mode, headed/headless settings, and screencast streaming
Module.prototype.require = function (id) {
    if (id === 'playwright') {
        const playwright = originalRequire.apply(this, arguments);
        const targetChromium = stealthChromium || playwright.chromium;
        wrapPlaywright(targetChromium);
        return {
            ...playwright,
            chromium: targetChromium
        };
    }
    return originalRequire.apply(this, arguments);
};

function wrapPlaywright(chromiumLauncher) {
    if (chromiumLauncher && !chromiumLauncher._isWrapped) {
        chromiumLauncher._isWrapped = true;
        const originalLaunch = chromiumLauncher.launch;
        
        chromiumLauncher.launch = async function (options = {}) {
            const fs = require('fs');
            // Ensure Xvfb virtual display is running and ready on Linux
            let hasLinuxDisplay = false;
            if (process.platform === 'linux') {
                try {
                    const { execSync, spawn } = require('child_process');
                    execSync('which Xvfb', { stdio: 'ignore' });
                    if (!fs.existsSync('/tmp/.X11-unix/X99')) {
                        try { fs.unlinkSync('/tmp/.X99-lock'); } catch (e) {}
                        const xvfb = spawn('Xvfb', [':99', '-screen', '0', '1920x1080x24', '-ac', '-nolisten', 'tcp'], {
                            detached: true,
                            stdio: 'ignore'
                        });
                        xvfb.unref();
                        // Wait up to 2s for Xvfb socket to be ready
                        for (let i = 0; i < 20; i++) {
                            if (fs.existsSync('/tmp/.X11-unix/X99')) break;
                            await new Promise(r => setTimeout(r, 100));
                        }
                    }
                    if (fs.existsSync('/tmp/.X11-unix/X99')) {
                        process.env.DISPLAY = ':99';
                        hasLinuxDisplay = true;
                        console.log('[ScreencastHelper] Using Xvfb virtual display on DISPLAY=:99');
                    }
                } catch (e) {
                    console.warn('[ScreencastHelper] Xvfb not available, falling back to headless:', e.message);
                }
            }

            // Determine headless mode:
            // Running headed (headless: false) inside Xvfb bypasses Akamai WAF headless detection.
            const isHeadless = process.env.HEADLESS === 'true' || (process.platform === 'linux' && !hasLinuxDisplay);
            if (isHeadless) {
                options.headless = true;
            } else {
                options.headless = false;
            }
            
            if (!options.args) {
                options.args = [];
            }
            
            // Essential container & Akamai WAF bypass flags for Linux / Docker / Render
            const essentialArgs = [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--enable-features=CDPScreenshotNewSurface',
                '--disable-blink-features=AutomationControlled',
                '--disable-http2',
                '--disable-infobars',
                '--lang=en-US,en'
            ];
            
            for (const arg of essentialArgs) {
                if (!options.args.includes(arg)) {
                    options.args.push(arg);
                }
            }

            // Ensure --enable-automation is always stripped across all bot scripts
            if (!options.ignoreDefaultArgs) {
                options.ignoreDefaultArgs = ['--enable-automation'];
            } else if (Array.isArray(options.ignoreDefaultArgs) && !options.ignoreDefaultArgs.includes('--enable-automation')) {
                options.ignoreDefaultArgs.push('--enable-automation');
            }

            // Support optional proxy configuration via environment variables (e.g. for Indian residential proxy on cloud hosts)
            if (process.env.PROXY_SERVER && !options.proxy) {
                options.proxy = {
                    server: process.env.PROXY_SERVER.trim()
                };
                if (process.env.PROXY_USERNAME) options.proxy.username = process.env.PROXY_USERNAME.trim();
                if (process.env.PROXY_PASSWORD) options.proxy.password = process.env.PROXY_PASSWORD.trim();
                console.log(`[ScreencastHelper] Routing browser traffic via proxy: ${options.proxy.server}`);
            }
            
            if (!options.headless) {
                options.args = options.args.filter(arg => arg !== '--start-maximized');
                if (process.platform === 'linux') {
                    // Inside virtual Xvfb display, keep normal on-screen coordinates so WAF geometry checks pass
                    options.args.push('--window-position=0,0');
                    options.args.push('--window-size=1920,1080');
                } else {
                    // On desktop OS (Windows/macOS), position window off-screen so it doesn't interrupt the user
                    options.args.push('--window-position=-2000,-2000');
                    options.args.push('--window-size=1280,800');
                }
            }

            // Prefer official Google Chrome channel if available for real TLS / JA3 / JA4 fingerprint
            let browser = null;
            const originalChannel = options.channel;
            if (!originalChannel && process.env.USE_CHROME_CHANNEL !== 'false') {
                try {
                    options.channel = 'chrome';
                    browser = await originalLaunch.call(chromiumLauncher, options);
                } catch (e) {
                    delete options.channel;
                }
            }

            if (!browser) {
                try {
                    browser = await originalLaunch.call(chromiumLauncher, options);
                } catch (e) {
                    // If headed launch failed (e.g. X server issue), fall back to headless so bot still runs
                    if (!options.headless) {
                        console.warn('[ScreencastHelper] Headed launch failed, retrying in headless mode:', e.message);
                        options.headless = true;
                        browser = await originalLaunch.call(chromiumLauncher, options);
                    } else {
                        throw e;
                    }
                }
            }
            currentBrowser = browser;
            
            // Wrap browser context and page creations to inject screencasting
            const originalClose = browser.close;
            browser.close = async function () {
                isShuttingDown = true;
                currentBrowser = null;
                try {
                    await originalClose.apply(browser, arguments);
                } catch (e) {
                    console.error("Error closing browser:", e.message);
                }
                setTimeout(() => process.exit(0), 200);
            };

            const originalNewContext = browser.newContext;
            browser.newContext = async function (contextOptions = {}) {
                if (isShuttingDown || !browser.isConnected()) {
                    throw new Error("Target page, context or browser has been closed");
                }
                const sanitizedOptions = { ...contextOptions };
                // Remove hardcoded/mismatched userAgent so native browser UA, TCP OS stack, and Client-Hints stay 100% consistent
                delete sanitizedOptions.userAgent;
                delete sanitizedOptions.locale;
                if (!sanitizedOptions.timezoneId) sanitizedOptions.timezoneId = 'Asia/Kolkata';
                sanitizedOptions.extraHTTPHeaders = {
                    'Accept-Language': 'en-US,en;q=0.9',
                    ...(sanitizedOptions.extraHTTPHeaders || {})
                };

                const context = await originalNewContext.call(browser, sanitizedOptions);
                
                const originalNewPage = context.newPage;
                context.newPage = async function () {
                    if (isShuttingDown || !browser.isConnected()) {
                        throw new Error("Target page, context or browser has been closed");
                    }
                    const page = await originalNewPage.apply(context, arguments);
                    enhancePageForWAF(page);
                    setupScreencast(page);
                    return page;
                };
                return context;
            };

            const originalNewPage = browser.newPage;
            browser.newPage = async function () {
                if (isShuttingDown || !browser.isConnected()) {
                    throw new Error("Target page, context or browser has been closed");
                }
                const page = await originalNewPage.apply(browser, arguments);
                enhancePageForWAF(page);
                setupScreencast(page);
                return page;
            };
            
            return browser;
        };
    }
}

function enhancePageForWAF(page) {
    if (!page || page._wafEnhanced) return;
    page._wafEnhanced = true;

    const originalGoto = page.goto;
    page.goto = async function (url, options = {}) {
        const isMeeshoLogin = typeof url === 'string' && url.includes('supplier.meesho.com/panel/v3/new/root/login');

        if (isMeeshoLogin && !page._meeshoWarmupDone) {
            page._meeshoWarmupDone = true;
            try {
                // Warm up Akamai cookies (ak_bmsc / bm_sz / _abck) on the public root domain first
                await originalGoto.call(page, 'https://supplier.meesho.com/', {
                    waitUntil: 'domcontentloaded',
                    timeout: 20000
                });
                await page.waitForTimeout(1500);
                try {
                    await page.mouse.move(250 + Math.floor(Math.random() * 150), 220 + Math.floor(Math.random() * 150));
                } catch (e) {}
            } catch (e) {
                // Continue to target URL even if warm-up times out
            }
        }

        const gotoOpts = isMeeshoLogin
            ? { referer: 'https://supplier.meesho.com/', ...options }
            : options;

        let response = await originalGoto.call(page, url, gotoOpts);

        if (isMeeshoLogin) {
            try {
                const title = await page.title().catch(() => '');
                const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
                if (title.includes('Access Denied') || bodyText.includes("You don't have permission to access")) {
                    console.warn('[ScreencastHelper] Akamai Access Denied detected on initial login navigation. Retrying via supplier homepage...');
                    await page.context().clearCookies().catch(() => {});
                    await page.waitForTimeout(2000);
                    await originalGoto.call(page, 'https://supplier.meesho.com/', {
                        waitUntil: 'domcontentloaded',
                        timeout: 20000
                    }).catch(() => {});
                    await page.waitForTimeout(2000);
                    response = await originalGoto.call(page, url, gotoOpts);

                    const retryTitle = await page.title().catch(() => '');
                    const retryBody = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
                    if (retryTitle.includes('Access Denied') || retryBody.includes("You don't have permission to access")) {
                        console.error('[ScreencastHelper] Akamai WAF blocked access from this server IP (Geo/Datacenter IP block). Set PROXY_SERVER env var to an Indian proxy if running on a US/foreign cloud host.');
                    }
                }
            } catch (e) {}
        }

        return response;
    };
}

async function setupScreencast(page) {
    if (!process.send) return;

    try {
        // Start a DevTools Protocol session to stream compositor frames natively
        const client = await page.context().newCDPSession(page);
        
        await client.send('Page.startScreencast', {
            format: 'jpeg',
            quality: 60,
            maxWidth: 1024,
            maxHeight: 768,
            everyNthFrame: 1 // Stream every frame natively generated
        });

        client.on('Page.screencastFrame', async (frame) => {
            try {
                if (page.isClosed()) return;
                
                const url = page.url();
                process.send({
                    type: 'screencast',
                    image: `data:image/jpeg;base64,${frame.data}`,
                    url: url
                });

                // Acknowledge receipt of the frame so Chrome continues sending new frames
                await client.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
            } catch (err) {
                // Ignore session close / ack errors
            }
        });
    } catch (e) {
        // Fallback: 1000ms screenshot polling in case CDP fails
        let isCapturing = false;
        const interval = setInterval(async () => {
            if (page.isClosed() || isShuttingDown) {
                clearInterval(interval);
                return;
            }
            if (isCapturing) return;
            isCapturing = true;

            try {
                const screenshotBuffer = await page.screenshot({
                    type: 'jpeg',
                    quality: 50
                });
                const base64 = screenshotBuffer.toString('base64');
                const url = page.url();
                
                process.send({
                    type: 'screencast',
                    image: `data:image/jpeg;base64,${base64}`,
                    url: url
                });
            } catch (err) {
                if (err.message.includes('closed') || err.message.includes('Target closed') || err.message.includes('Browser closed')) {
                    clearInterval(interval);
                }
            } finally {
                isCapturing = false;
            }
        }, 1000);
    }
}
