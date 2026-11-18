const Module = require('module');
const path = require('path');
const fs = require('fs');
const originalRequire = Module.prototype.require;

let isShuttingDown = false;
const activeContexts = new Set();
let profileCounter = 0;

function handleShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[ScreencastHelper] Received ${signal}. Terminating bot process immediately...`);
    for (const ctx of activeContexts) {
        try {
            ctx.close().catch(() => {});
        } catch (e) {}
    }
    activeContexts.clear();
    setTimeout(() => process.exit(0), 100);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

// Playwright's default --disable-features string that disables AcceptCHFrame (TLS 1.3 ALPS Client Hints) and HttpsUpgrades
const PLAYWRIGHT_DEFAULT_DISABLE_FEATURES =
    '--disable-features=AcceptCHFrame,AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument,OptimizationHints';

// Replacement --disable-features that keeps AcceptCHFrame, HttpsUpgrades, and ThirdPartyStoragePartitioning ENABLED
const STEALTH_DISABLE_FEATURES =
    '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,LensOverlay,MediaRouter,PaintHolding,Translate,AutoDeElevate,RenderDocument,OptimizationHints,AutomationControlled';

let stealthChromium = null;
try {
    const { chromium } = require('playwright-extra');
    const stealth = require('puppeteer-extra-plugin-stealth')();
    // Disable outdated 2021 evasions that conflict with modern Chrome & CDP Windows 11 emulation
    stealth.enabledEvasions.delete('user-agent-override');
    stealth.enabledEvasions.delete('webgl.vendor');
    stealth.enabledEvasions.delete('navigator.languages');
    chromium.use(stealth);
    stealthChromium = chromium;
} catch (e) {
    console.warn("[ScreencastHelper] Could not initialize playwright-extra stealth plugin:", e.message);
}

// Intercept require('playwright') to inject persistent Chrome profile mode, WAF bypass, and screencast streaming
Module.prototype.require = function (id) {
    if (id === 'playwright') {
        const playwright = originalRequire.apply(this, arguments);
        const targetChromium = stealthChromium || playwright.chromium;
        wrapPlaywright(targetChromium, playwright.chromium);
        return {
            ...playwright,
            chromium: targetChromium
        };
    }
    return originalRequire.apply(this, arguments);
};

async function ensureLinuxXvfb() {
    if (process.platform !== 'linux') return true;
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
            for (let i = 0; i < 20; i++) {
                if (fs.existsSync('/tmp/.X11-unix/X99')) break;
                await new Promise(r => setTimeout(r, 100));
            }
        }
        if (fs.existsSync('/tmp/.X11-unix/X99')) {
            process.env.DISPLAY = ':99';
            console.log('[ScreencastHelper] Using Xvfb virtual display on DISPLAY=:99');
            return true;
        }
    } catch (e) {
        console.warn('[ScreencastHelper] Xvfb not available, falling back to headless:', e.message);
    }
    return false;
}

function buildLaunchOptions(baseOptions = {}, contextOptions = {}, hasLinuxDisplay = true) {
    const options = { ...baseOptions, ...contextOptions };
    delete options.userAgent;
    delete options.locale;

    const isHeadless = process.env.HEADLESS === 'true' || (process.platform === 'linux' && !hasLinuxDisplay);
    options.headless = isHeadless;
    options.viewport = null;
    if (!options.timezoneId) options.timezoneId = 'Asia/Kolkata';

    options.args = Array.isArray(baseOptions.args) ? [...baseOptions.args] : [];

    const essentialArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--enable-features=AcceptCHFrame,CDPScreenshotNewSurface',
        '--disable-blink-features=AutomationControlled',
        STEALTH_DISABLE_FEATURES,
        '--disable-infobars',
        '--no-first-run',
        '--no-default-browser-check',
        '--lang=en-US,en'
    ];

    for (const arg of essentialArgs) {
        if (!options.args.includes(arg)) {
            options.args.push(arg);
        }
    }

    if (!options.headless) {
        options.args = options.args.filter(arg => arg !== '--start-maximized');
        if (process.platform === 'linux') {
            options.args.push('--window-position=0,0');
            options.args.push('--window-size=1920,1080');
        } else {
            options.args.push('--window-position=-2000,-2000');
            options.args.push('--window-size=1280,800');
        }
    }

    options.ignoreDefaultArgs = [
        '--enable-automation',
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-component-extensions-with-background-pages',
        PLAYWRIGHT_DEFAULT_DISABLE_FEATURES
    ];

    if (process.env.PROXY_SERVER && !options.proxy) {
        let rawProxy = process.env.PROXY_SERVER.trim();
        const isPrivateLanIp = /^(https?:\/\/|socks5:\/\/)?(192\.168\.|10\.|127\.|localhost)/i.test(rawProxy);
        if (process.platform === 'linux' && isPrivateLanIp) {
            console.warn(`[ScreencastHelper] Ignoring private LAN IP (${rawProxy}) in PROXY_SERVER on cloud container.`);
        } else {
            if (!/^(https?|socks4|socks5):\/\//i.test(rawProxy)) {
                rawProxy = `http://${rawProxy}`;
            }
            options.proxy = { server: rawProxy };
            if (process.env.PROXY_USERNAME) options.proxy.username = process.env.PROXY_USERNAME.trim();
            if (process.env.PROXY_PASSWORD) options.proxy.password = process.env.PROXY_PASSWORD.trim();
            console.log(`[ScreencastHelper] Routing browser traffic via proxy: ${options.proxy.server}`);
        }
    }

    return options;
}

async function configurePageStealthAndCDP(page) {
    if (!page || page._cdpStealthConfigured) return;
    page._cdpStealthConfigured = true;

    try {
        const client = await page.context().newCDPSession(page);
        const ver = await client.send('Browser.getVersion');
        const fullVer = (ver && ver.product && ver.product.includes('/'))
            ? ver.product.split('/')[1]
            : '143.0.7499.4';
        const major = fullVer.split('.')[0] || '143';

        const brands = [
            { brand: 'Not-A.Brand', version: '99' },
            { brand: 'Google Chrome', version: major },
            { brand: 'Chromium', version: major }
        ];
        const fullVersionList = [
            { brand: 'Not-A.Brand', version: '99.0.0.0' },
            { brand: 'Google Chrome', version: fullVer },
            { brand: 'Chromium', version: fullVer }
        ];

        await client.send('Emulation.setUserAgentOverride', {
            userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
            acceptLanguage: 'en-US,en',
            platform: 'Win32',
            userAgentMetadata: {
                brands,
                fullVersionList,
                fullVersion: fullVer,
                platform: 'Windows',
                platformVersion: '15.0.0',
                architecture: 'x86',
                model: '',
                mobile: false,
                bitness: '64',
                wow64: false
            }
        });
    } catch (e) {
        // Ignore CDP override errors on closed pages
    }
}

async function applyContextStealthInitScripts(context) {
    try {
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

            if (!window.chrome) {
                window.chrome = {};
            }
            if (!window.chrome.runtime) {
                window.chrome.runtime = {};
            }

            // Mask Linux software SwiftShader WebGL with genuine Windows Direct3D11 Intel UHD ANGLE strings
            const patchWebGL = (proto) => {
                if (!proto || !proto.getParameter) return;
                const origGetParameter = proto.getParameter;
                proto.getParameter = function (param) {
                    if (param === 37445) return 'Google Inc. (Intel)';
                    if (param === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics (0x000046A3) Direct3D11 vs_5_0 ps_5_0, D3D11)';
                    return origGetParameter.apply(this, arguments);
                };
            };
            if (typeof WebGLRenderingContext !== 'undefined') patchWebGL(WebGLRenderingContext.prototype);
            if (typeof WebGL2RenderingContext !== 'undefined') patchWebGL(WebGL2RenderingContext.prototype);
        });
    } catch (e) {}
}

function wrapPlaywright(chromiumLauncher, rawChromium) {
    if (chromiumLauncher && !chromiumLauncher._isWrapped) {
        chromiumLauncher._isWrapped = true;
        const persistentLauncher = rawChromium || chromiumLauncher;

        chromiumLauncher.launch = async function (baseLaunchOptions = {}) {
            const hasLinuxDisplay = await ensureLinuxXvfb();

            // Return a controller that spawns a genuine non-incognito Persistent Chrome Profile per context
            const virtualBrowser = {
                isConnected: () => !isShuttingDown,
                newContext: async function (contextOptions = {}) {
                    if (isShuttingDown) {
                        throw new Error("Target page, context or browser has been closed");
                    }

                    const profileId = `profile_${++profileCounter}`;
                    const profilesRoot = path.join(__dirname, '.chrome_profiles');
                    const userDataDir = path.join(profilesRoot, profileId);
                    try {
                        fs.mkdirSync(userDataDir, { recursive: true });
                        // Clean any stale SingletonLock from previous runs
                        try { fs.unlinkSync(path.join(userDataDir, 'SingletonLock')); } catch (e) {}
                        try { fs.unlinkSync(path.join(userDataDir, 'SingletonCookie')); } catch (e) {}
                        try { fs.unlinkSync(path.join(userDataDir, 'SingletonSocket')); } catch (e) {}
                    } catch (e) {}

                    const launchOpts = buildLaunchOptions(baseLaunchOptions, contextOptions, hasLinuxDisplay);
                    let context = null;

                    // Prefer official Google Chrome channel if available
                    if (!launchOpts.channel && process.env.USE_CHROME_CHANNEL !== 'false') {
                        try {
                            context = await persistentLauncher.launchPersistentContext(userDataDir, {
                                ...launchOpts,
                                channel: 'chrome'
                            });
                        } catch (e) {
                            context = null;
                        }
                    }

                    if (!context) {
                        try {
                            context = await persistentLauncher.launchPersistentContext(userDataDir, launchOpts);
                        } catch (e) {
                            if (!launchOpts.headless) {
                                console.warn('[ScreencastHelper] Headed persistent launch failed, retrying headless:', e.message);
                                launchOpts.headless = true;
                                context = await persistentLauncher.launchPersistentContext(userDataDir, launchOpts);
                            } else {
                                throw e;
                            }
                        }
                    }

                    activeContexts.add(context);
                    await applyContextStealthInitScripts(context);

                    // Configure existing default tab from persistent profile
                    const initialPages = context.pages();
                    let reusedInitialPage = false;
                    for (const p of initialPages) {
                        await configurePageStealthAndCDP(p);
                        enhancePageForWAF(p);
                        setupScreencast(p);
                    }

                    const originalNewPage = context.newPage;
                    context.newPage = async function () {
                        if (isShuttingDown) {
                            throw new Error("Target page, context or browser has been closed");
                        }
                        // Reuse the initial non-incognito tab created by launchPersistentContext on first newPage() call
                        if (!reusedInitialPage && context.pages().length > 0 && !context.pages()[0].isClosed()) {
                            reusedInitialPage = true;
                            const firstPage = context.pages()[0];
                            await configurePageStealthAndCDP(firstPage);
                            enhancePageForWAF(firstPage);
                            setupScreencast(firstPage);
                            return firstPage;
                        }
                        const page = await originalNewPage.apply(context, arguments);
                        await configurePageStealthAndCDP(page);
                        enhancePageForWAF(page);
                        setupScreencast(page);
                        return page;
                    };

                    const originalContextClose = context.close;
                    context.close = async function () {
                        activeContexts.delete(context);
                        try {
                            await originalContextClose.apply(context, arguments);
                        } catch (e) {}
                    };

                    return context;
                },
                newPage: async function () {
                    const ctx = await virtualBrowser.newContext();
                    return await ctx.newPage();
                },
                close: async function () {
                    isShuttingDown = true;
                    for (const ctx of Array.from(activeContexts)) {
                        try {
                            await ctx.close();
                        } catch (e) {}
                    }
                    activeContexts.clear();
                    setTimeout(() => process.exit(0), 200);
                }
            };

            return virtualBrowser;
        };
    }
}

function enhancePageForWAF(page) {
    if (!page || page._wafEnhanced) return;
    page._wafEnhanced = true;

    const originalGoto = page.goto;
    page.goto = async function (url, options = {}) {
        await configurePageStealthAndCDP(page);
        const isMeeshoLogin = typeof url === 'string' && url.includes('supplier.meesho.com/panel/v3/new/root/login');

        if (isMeeshoLogin && !page._meeshoWarmupDone) {
            page._meeshoWarmupDone = true;
            try {
                await originalGoto.call(page, 'https://supplier.meesho.com/', {
                    waitUntil: 'domcontentloaded',
                    timeout: 20000
                });
                await page.waitForTimeout(1500);
                try {
                    await page.mouse.move(250 + Math.floor(Math.random() * 150), 220 + Math.floor(Math.random() * 150));
                } catch (e) {}
            } catch (e) {}
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
                    await configurePageStealthAndCDP(page);
                    await originalGoto.call(page, 'https://supplier.meesho.com/', {
                        waitUntil: 'domcontentloaded',
                        timeout: 20000
                    }).catch(() => {});
                    await page.waitForTimeout(2000);
                    response = await originalGoto.call(page, url, gotoOpts);
                }
            } catch (e) {}
        }

        return response;
    };
}

async function setupScreencast(page) {
    if (!process.send || !page || page._screencastSetup) return;
    page._screencastSetup = true;

    try {
        const client = await page.context().newCDPSession(page);
        
        await client.send('Page.startScreencast', {
            format: 'jpeg',
            quality: 60,
            maxWidth: 1024,
            maxHeight: 768,
            everyNthFrame: 1
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

                await client.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
            } catch (err) {}
        });
    } catch (e) {
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
