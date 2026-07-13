const Module = require('module');
const originalRequire = Module.prototype.require;

// Intercept require('playwright') to inject headless mode and screenshot streaming
Module.prototype.require = function (id) {
    if (id === 'playwright') {
        const playwright = originalRequire.apply(this, arguments);
        wrapPlaywright(playwright);
        return playwright;
    }
    return originalRequire.apply(this, arguments);
};

function wrapPlaywright(playwright) {
    if (playwright.chromium && !playwright.chromium._isWrapped) {
        playwright.chromium._isWrapped = true;
        const originalLaunch = playwright.chromium.launch;
        
        playwright.chromium.launch = async function (options = {}) {
            // Keep headless: false to bypass Akamai WAF detection,
            // but position the window off-screen so it is invisible to the user.
            options.headless = false;
            
            if (!options.args) {
                options.args = [];
            }
            
            // Remove '--start-maximized' to allow off-screen positioning
            options.args = options.args.filter(arg => arg !== '--start-maximized');
            
            // Position the window off-screen and set a default viewport size
            options.args.push('--window-position=-2000,-2000');
            options.args.push('--window-size=1280,800');
            
            const browser = await originalLaunch.call(playwright.chromium, options);
            
            // Wrap browser context and page creations to inject screencasting
            const originalNewContext = browser.newContext;
            browser.newContext = async function (contextOptions) {
                const context = await originalNewContext.call(browser, contextOptions);
                
                const originalNewPage = context.newPage;
                context.newPage = async function () {
                    const page = await originalNewPage.apply(context, arguments);
                    setupScreencast(page);
                    return page;
                };
                return context;
            };

            const originalNewPage = browser.newPage;
            browser.newPage = async function () {
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
