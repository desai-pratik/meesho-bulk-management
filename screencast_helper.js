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
                if (currentBrowser === browser) {
                    currentBrowser = null;
                }
                try {
                    await originalClose.apply(browser, arguments);
                } catch (e) {
                    console.error("Error closing browser:", e.message);
                }
            };

            const originalNewContext = browser.newContext;
            browser.newContext = async function (contextOptions = {}) {
                if (isShuttingDown || !browser.isConnected()) {
                    throw new Error("Target page, context or browser has been closed");
                }
                const sanitizedOptions = { ...contextOptions };
                if (!sanitizedOptions.timezoneId) sanitizedOptions.timezoneId = 'Asia/Kolkata';
                if (!sanitizedOptions.locale) sanitizedOptions.locale = 'en-US';
                if (!sanitizedOptions.userAgent) {
                    sanitizedOptions.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
                }

                const context = await originalNewContext.call(browser, sanitizedOptions);

                // Inject stealth and anti-bot evasions across all contexts
                try {
                    await context.addInitScript(() => {
                        // 1. Hide navigator.webdriver
                        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

                        // 2. Mock chrome runtime object
                        window.chrome = {
                            runtime: {},
                            loadTimes: function () { },
                            csi: function () { },
                            app: {}
                        };

                        // 3. Mock realistic languages and plugins
                        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                        const fakePlugins = [
                            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
                        ];
                        Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins });
                    });
                } catch (e) {}

                function wrapPageNavigation(page) {
                    const originalGoto = page.goto;
                    page.goto = async function (url, options) {
                        if (typeof url === 'string') {
                            // 1. Force HTTPS on all Meesho supplier URLs (plain HTTP triggers Akamai Access Denied)
                            if (url.startsWith('http://supplier.meesho.com')) {
                                url = url.replace('http://supplier.meesho.com', 'https://supplier.meesho.com');
                            }

                            // 2. Protect against redundant /login visits when already logged in
                            if (url.includes('/panel/v3/new/root/login')) {
                                const curUrl = page.url();
                                if (curUrl && curUrl.includes('/panel/v3/new/') && !curUrl.includes('/root/login')) {
                                    console.log('[ScreencastHelper] 🛡️ Intercepted redundant LOGIN_URL visit while authenticated. Redirecting to Dashboard.');
                                    url = 'https://supplier.meesho.com/panel/v3/new/growth/cataloging';
                                }
                            }

                            // 3. Fix invalid /services/.../inventory URLs (Akamai blocks direct /services/ microservice paths with Access Denied)
                            if (url.includes('/panel/v3/new/services/') && url.includes('/inventory')) {
                                console.log('[ScreencastHelper] 🛡️ Corrected microservice URL to official Inventory dashboard.');
                                url = 'https://supplier.meesho.com/panel/v3/new/growth/inventory';
                            }
                        }

                        let res;
                        try {
                            res = await originalGoto.call(page, url, options);
                        } catch (err) {
                            throw err;
                        }

                        // Check for Akamai Access Denied on resulting page
                        try {
                            const title = (await page.title().catch(() => '')) || '';
                            const isDenied = title.toLowerCase().includes('access denied') || await page.evaluate(() => {
                                const body = document.body ? document.body.innerText.toLowerCase() : '';
                                return body.includes('access denied') && (body.includes('edgesuite.net') || body.includes('permission to access'));
                            }).catch(() => false);

                            if (isDenied) {
                                console.error('\n⚠️ [Akamai Access Denied Detected]: Access Denied page encountered.');
                                console.error(`  Blocked URL: ${page.url()}`);
                                console.error('  Auto-recovering: Pausing 5s then returning to official dashboard...\n');
                                await page.waitForTimeout(5000);
                                await originalGoto.call(page, 'https://supplier.meesho.com/panel/v3/new/growth/cataloging', { timeout: 25000, waitUntil: 'domcontentloaded' }).catch(() => {});
                            }
                        } catch (e) {}

                        return res;
                    };
                }

                const originalNewPage = context.newPage;
                context.newPage = async function () {
                    if (isShuttingDown || !browser.isConnected()) {
                        throw new Error("Target page, context or browser has been closed");
                    }
                    const page = await originalNewPage.apply(context, arguments);
                    wrapPageNavigation(page);
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

let activePage = null;

async function setupScreencast(page) {
    if (!process.send || !page) return;
    activePage = page;
    if (page._screencastSetup) return;
    page._screencastSetup = true;

    let cdpClient = null;
    let isCapturing = false;
    let lastFrameTime = 0;
    let fallbackInterval = null;

    const emitFrame = (base64Data, url) => {
        if (!process.send || isShuttingDown) return;
        lastFrameTime = Date.now();
        try {
            const img = base64Data.startsWith('data:') ? base64Data : `data:image/jpeg;base64,${base64Data}`;
            const targetUrl = url || (page.isClosed() ? '' : page.url()) || 'https://supplier.meesho.com/';
            process.send({
                type: 'screencast',
                image: img,
                url: targetUrl
            });
        } catch (e) {}
    };

    const startCDP = async () => {
        if (page.isClosed() || isShuttingDown) return;
        try {
            cdpClient = await page.context().newCDPSession(page);

            await cdpClient.send('Page.startScreencast', {
                format: 'jpeg',
                quality: 45,
                maxWidth: 960,
                maxHeight: 600,
                everyNthFrame: 1 // Send on every paint so UI updates live immediately
            });

            cdpClient.on('Page.screencastFrame', (frame) => {
                // Immediately ACK frame to Chrome so Chrome never stalls
                cdpClient.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});

                if (page.isClosed() || activePage !== page) return;

                // Live stream at up to 12.5 FPS (80ms throttle)
                const now = Date.now();
                if (now - lastFrameTime >= 80) {
                    emitFrame(frame.data, page.url());
                }
            });

            cdpClient.on('close', () => { cdpClient = null; });
            cdpClient.on('error', () => { cdpClient = null; });
        } catch (e) {
            cdpClient = null;
        }
    };

    // Fast watchdog heartbeat:
    // 1. Reconnects CDP if closed/dropped
    // 2. If page is idle (no paints for >800ms), takes a quick screenshot so feed stays truly live
    fallbackInterval = setInterval(async () => {
        if (page.isClosed() || isShuttingDown) {
            clearInterval(fallbackInterval);
            return;
        }
        if (activePage !== page) return;

        const timeSinceLastFrame = Date.now() - lastFrameTime;

        if (!cdpClient && timeSinceLastFrame > 1200) {
            await startCDP().catch(() => {});
        }

        if (timeSinceLastFrame >= 800 && !isCapturing) {
            isCapturing = true;
            try {
                const screenshotBuffer = await page.screenshot({
                    type: 'jpeg',
                    quality: 40
                });
                emitFrame(screenshotBuffer.toString('base64'), page.url());
            } catch (err) {
                if (err.message && (err.message.includes('closed') || err.message.includes('Target closed') || err.message.includes('Browser closed'))) {
                    clearInterval(fallbackInterval);
                }
            } finally {
                isCapturing = false;
            }
        }
    }, 600);

    // Immediate frame on navigation
    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame() && activePage === page && !page.isClosed()) {
            setTimeout(async () => {
                try {
                    if (!page.isClosed() && activePage === page) {
                        const buf = await page.screenshot({ type: 'jpeg', quality: 40 });
                        emitFrame(buf.toString('base64'), page.url());
                    }
                } catch (e) {}
            }, 100);
        }
    });

    // Initial CDP start and immediate first frame
    await startCDP();
    try {
        const initialBuffer = await page.screenshot({ type: 'jpeg', quality: 40 });
        emitFrame(initialBuffer.toString('base64'), page.url());
    } catch (e) {}

    page.on('close', () => {
        clearInterval(fallbackInterval);
        if (activePage === page) activePage = null;
    });
}
