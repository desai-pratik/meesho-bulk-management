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
            // Ensure Xvfb virtual display is running if on Linux and no DISPLAY is set
            if (process.platform === 'linux' && !process.env.DISPLAY) {
                try {
                    const { execSync, spawn } = require('child_process');
                    execSync('which Xvfb');
                    const xvfb = spawn('Xvfb', [':99', '-screen', '0', '1920x1080x24', '-ac'], {
                        detached: true,
                        stdio: 'ignore'
                    });
                    xvfb.unref();
                    process.env.DISPLAY = ':99';
                    console.log('[ScreencastHelper] Initialized Xvfb virtual display on DISPLAY=:99');
                } catch (e) {
                    console.warn('[ScreencastHelper] Xvfb not available, running headless:', e.message);
                }
            }

            // Determine headless mode:
            // Running headed (headless: false) is vital to bypass Akamai WAF detection.
            // On Linux containers (Render, Docker), headed mode runs smoothly inside the Xvfb display.
            const isHeadless = process.env.HEADLESS === 'true' || (process.platform === 'linux' && !process.env.DISPLAY);
            if (isHeadless) {
                options.headless = true;
            } else {
                options.headless = false;
            }
            
            if (!options.args) {
                options.args = [];
            }
            
            // Essential container flags for Linux / Docker / Render
            const essentialArgs = [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--enable-features=CDPScreenshotNewSurface',
                '--disable-blink-features=AutomationControlled'
            ];
            
            for (const arg of essentialArgs) {
                if (!options.args.includes(arg)) {
                    options.args.push(arg);
                }
            }
            
            if (!options.headless) {
                // When running headed, position the window off-screen so it is invisible to desktop users
                options.args = options.args.filter(arg => arg !== '--start-maximized');
                options.args.push('--window-position=-2000,-2000');
                options.args.push('--window-size=1280,800');
            }

            // Prefer official Google Chrome channel if available for real TLS / JA3 / JA8 fingerprint
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
                browser = await originalLaunch.call(chromiumLauncher, options);
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
            browser.newContext = async function (contextOptions) {
                if (isShuttingDown || !browser.isConnected()) {
                    throw new Error("Target page, context or browser has been closed");
                }
                const context = await originalNewContext.call(browser, contextOptions);
                
                const originalNewPage = context.newPage;
                context.newPage = async function () {
                    if (isShuttingDown || !browser.isConnected()) {
                        throw new Error("Target page, context or browser has been closed");
                    }
                    const page = await originalNewPage.apply(context, arguments);
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
                setupScreencast(page);
                return page;
            };
            
            return browser;
        };
    }
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
