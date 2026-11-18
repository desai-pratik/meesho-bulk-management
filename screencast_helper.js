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

// Intercept require('playwright') to inject headed/headless settings and screencast streaming
Module.prototype.require = function (id) {
    if (id === 'playwright') {
        const playwright = originalRequire.apply(this, arguments);
        wrapPlaywright(playwright.chromium);
        return playwright;
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
            // Running headed (headless: false) inside Xvfb on Linux or headed off-screen on Windows
            const isHeadless = process.env.HEADLESS === 'true' || (process.platform === 'linux' && !hasLinuxDisplay);
            if (isHeadless) {
                options.headless = true;
            } else {
                options.headless = false;
            }
            
            if (!options.args) {
                options.args = [];
            }
            
            // Essential container flags for Linux / Docker / Render & bot stealth
            const essentialArgs = [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--enable-features=CDPScreenshotNewSurface',
                '--disable-blink-features=AutomationControlled',
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

            // Support optional proxy configuration via environment variables
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
                    // Inside virtual Xvfb display, keep normal on-screen coordinates
                    options.args.push('--window-position=0,0');
                    options.args.push('--window-size=1920,1080');
                } else {
                    // On desktop OS (Windows/macOS), position window off-screen so it doesn't interrupt the user
                    options.args.push('--window-position=-2000,-2000');
                    options.args.push('--window-size=1280,800');
                }
            }

            let browser = null;
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
                if (!sanitizedOptions.timezoneId) sanitizedOptions.timezoneId = 'Asia/Kolkata';

                const context = await originalNewContext.call(browser, sanitizedOptions);
                
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
        console.error("Failed to start CDP screencast, falling back to screenshot polling:", e.message);
        
        // Fallback: 1000ms screenshot polling in case CDP fails
        let isCapturing = false;
        const interval = setInterval(async () => {
            if (page.isClosed()) {
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
