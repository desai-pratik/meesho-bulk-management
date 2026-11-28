// Helper function to check if an element is part of an OTP flow or "Proceed to Upload" warning modal
function getProtectedCheckScript() {
    return `
        function isProtectedElement(el) {
            let curr = el;
            for (let k = 0; k < 8; k++) {
                if (!curr) break;
                const text = (curr.innerText || curr.textContent || '').toLowerCase();
                // 1. Delivery & OTP popups
                if (text.includes('otp') || text.includes('shadowfax') || text.includes('valmo') || text.includes('delhivery') || text.includes('ecom express') || text.includes('xpressbees')) {
                    return true;
                }
                // 2. Feature risk warning popup (Must click "Proceed to Upload", NOT close!)
                if (text.includes('proceed to upload') || text.includes('risk of features deactivation') || text.includes('suspected to list fake') || text.includes('watch guidelines')) {
                    return true;
                }
                // 3. Outdated template toast / warning
                if (text.includes('template version outdated') || text.includes('download latest template')) {
                    return true;
                }
                curr = curr.parentElement;
            }
            return false;
        }
    `;
}

// Function to explicitly click "Proceed to Upload" popup if present on the page
async function handleProceedToUpload(page) {
    try {
        const proceedBtn = page.getByRole('button', { name: /Proceed to Upload/i })
            .or(page.locator('button, [role="button"], a').filter({ hasText: /Proceed to Upload/i }))
            .first();

        if (await proceedBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
            console.log("  > [handleProceedToUpload] Detected 'Proceed to Upload' popup! Clicking 'Proceed to Upload'...");
            await proceedBtn.click({ timeout: 3000 }).catch(() => proceedBtn.evaluate(el => el.click()));
            await page.waitForTimeout(1500);
            return true;
        }

        // Also check via DOM evaluation in case it's in a custom component/shadow DOM
        const clickedViaDom = await page.evaluate(() => {
            const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, span, div'));
            for (const el of candidates) {
                const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
                if (txt === 'proceed to upload' || (txt.includes('proceed to upload') && txt.length < 50)) {
                    const clickable = el.closest('button') || el.closest('[role="button"]') || el;
                    if (clickable && window.getComputedStyle(clickable).display !== 'none' && window.getComputedStyle(clickable).visibility !== 'hidden') {
                        clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        if (typeof clickable.click === 'function') clickable.click();
                        return true;
                    }
                }
            }
            return false;
        }).catch(() => false);

        if (clickedViaDom) {
            console.log("  > [handleProceedToUpload] Clicked 'Proceed to Upload' via DOM evaluation!");
            await page.waitForTimeout(1500);
            return true;
        }
    } catch (e) { }
    return false;
}

// Function to inject background interval poller to continuously nuke popups on all navigations
async function injectBackgroundPoller(page) {
    try {
        const script = () => {
            if (window.__nukePollerIntervalActive) return;
            window.__nukePollerIntervalActive = true;

            const isProtectedElement = (el) => {
                let curr = el;
                for (let k = 0; k < 8; k++) {
                    if (!curr) break;
                    const text = (curr.innerText || curr.textContent || '').toLowerCase();
                    if (text.includes('otp') || text.includes('shadowfax') || text.includes('valmo') || text.includes('delhivery') || text.includes('ecom express') || text.includes('xpressbees')) {
                        return true;
                    }
                    if (text.includes('proceed to upload') || text.includes('risk of features deactivation') || text.includes('suspected to list fake') || text.includes('watch guidelines')) {
                        return true;
                    }
                    if (text.includes('template version outdated') || text.includes('download latest template')) {
                        return true;
                    }
                    curr = curr.parentElement;
                }
                return false;
            };

            const runNuke = () => {
                try {
                    // 0. FIRST PRIORITY: If "Proceed to Upload" is visible, click it immediately! DO NOT close or hide it!
                    const allClickables = Array.from(document.querySelectorAll('button, [role="button"], a, span, div'));
                    for (const el of allClickables) {
                        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
                        if (txt === 'proceed to upload' || (txt.includes('proceed to upload') && txt.length < 50)) {
                            const clickable = el.closest('button') || el.closest('[role="button"]') || el;
                            if (clickable && window.getComputedStyle(clickable).display !== 'none' && window.getComputedStyle(clickable).visibility !== 'hidden') {
                                clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                if (typeof clickable.click === 'function') clickable.click();
                                return; // Stop this cycle immediately so it can proceed
                            }
                        }
                    }

                    // 1. Close buttons matching SVG / cross icons / close labels
                    const allEls = Array.from(document.querySelectorAll('div, span, button, a, img, svg, p, h4, h2'));
                    for (const el of allEls) {
                        let isClose = false;

                        // Check attributes for cross or close
                        if (el.attributes) {
                            for (let j = 0; j < el.attributes.length; j++) {
                                const val = (el.attributes[j].value || '').toLowerCase();
                                if (/cross[-_](black|grey|gray|white)\.svg/.test(val) || val === 'close' || val.includes('close-icon') || val.includes('close-modal')) {
                                    isClose = true;
                                    break;
                                }
                            }
                        }

                        // Check computed style background
                        if (!isClose) {
                            const computedStyle = window.getComputedStyle(el);
                            const bgImg = computedStyle.backgroundImage || '';
                            if (/cross[-_](black|grey|gray|white)\.svg/.test(bgImg)) {
                                isClose = true;
                            }
                        }

                        // Check aria-label or text content
                        if (!isClose && (el.tagName === 'BUTTON' || el.tagName === 'SPAN' || el.tagName === 'DIV' || el.tagName === 'SVG')) {
                            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                            if (aria === 'close' || aria === 'close modal' || aria === 'dismiss') {
                                isClose = true;
                            }
                        }

                        if (isClose) {
                            // SKIP IF PROTECTED (OTP or Proceed to Upload modal)
                            if (isProtectedElement(el)) continue;

                            const clickable = el.closest('button') || el.closest('a') || el;
                            if (clickable && window.getComputedStyle(clickable).display !== 'none') {
                                clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                if (typeof clickable.click === 'function') {
                                    clickable.click();
                                }
                            }
                        }
                    }

                    // 2. Target "NEW TEMPLATE" popup or floating dialogs specifically
                    const dialogs = Array.from(document.querySelectorAll('div[role="dialog"], .MuiModal-root, [class*="modal" i]'));
                    for (const diag of dialogs) {
                        if (isProtectedElement(diag)) continue;
                        const diagText = (diag.innerText || '').toLowerCase();
                        if (diagText.includes('new template') || diagText.includes('wrong & defective return price') || diagText.includes('download new template')) {
                            const closeBtn = diag.querySelector('button, svg, [aria-label*="close" i], [class*="close" i]');
                            if (closeBtn) {
                                const clickable = closeBtn.closest('button') || closeBtn;
                                clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                if (typeof clickable.click === 'function') clickable.click();
                            }
                            diag.style.setProperty('display', 'none', 'important');
                            diag.style.setProperty('pointer-events', 'none', 'important');
                        }
                    }
                } catch(err) {}
            };

            // Run immediately, then poll every 1200ms (avoids CPU/DOM thrashing that causes browser hangs)
            runNuke();
            setInterval(runNuke, 1200);
        };

        // 1. Inject on current page immediately
        await page.evaluate(script).catch(() => {});

        // 2. Register for all future pages/navigations in this context
        const context = page.context();
        if (context && !context.__nukePollerRegistered) {
            context.__nukePollerRegistered = true;
            await context.addInitScript(script).catch(() => {});
        }
    } catch(e) {}
}

// SAFER NUCLEAR OPTION: Only remove actual modals/popups
async function nukePopups(page) {
    try {
        await injectBackgroundPoller(page);

        // 0. FIRST CHECK FOR "PROCEED TO UPLOAD" POPUP BEFORE ANY ESCAPE OR CLOSE
        const proceedHandled = await handleProceedToUpload(page);
        if (proceedHandled) {
            return { authClicked: true, actionTaken: true };
        }

        // Try pressing Escape in Playwright to dismiss any open modal (EXCEPT Protected Modals)
        try {
            const hasModal = await page.evaluate(() => {
                const diag = document.querySelector('div[role="dialog"], .MuiModal-root, [class*="modal" i]');
                if (!diag) return false;
                const text = (diag.innerText || '').toLowerCase();
                // Avoid OTP and Proceed to Upload modals
                if (text.includes('otp') || text.includes('shadowfax') || text.includes('valmo') || text.includes('delhivery')) return false;
                if (text.includes('proceed to upload') || text.includes('risk of features deactivation') || text.includes('suspected to list fake') || text.includes('watch guidelines')) return false;
                return true;
            });
            if (hasModal) {
                await page.keyboard.press('Escape').catch(() => {});
                await page.waitForTimeout(200);
            }
        } catch (e) { }

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

            function isProtectedElement(el) {
                let curr = el;
                for (let k = 0; k < 8; k++) {
                    if (!curr) break;
                    const text = (curr.innerText || curr.textContent || '').toLowerCase();
                    if (text.includes('otp') || text.includes('shadowfax') || text.includes('valmo') || text.includes('delhivery') || text.includes('ecom express') || text.includes('xpressbees')) {
                        return true;
                    }
                    if (text.includes('proceed to upload') || text.includes('risk of features deactivation') || text.includes('suspected to list fake') || text.includes('watch guidelines')) {
                        return true;
                    }
                    if (text.includes('template version outdated') || text.includes('download latest template')) {
                        return true;
                    }
                    curr = curr.parentElement;
                }
                return false;
            }

            let actionTaken = false;
            let authorisedSpecial = false;

            // 0. HANDLE SPECIAL AUTH POPUPS (Must click, not close!)
            const buttonsOrLinks = Array.from(document.querySelectorAll('button, [role="button"], a, span, div'));
            for (const el of buttonsOrLinks) {
                const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
                if (txt === 'proceed to upload' || (txt.includes('proceed to upload') && txt.length < 50)) {
                    const clickable = el.closest('button') || el.closest('[role="button"]') || el;
                    if (clickable && window.getComputedStyle(clickable).display !== 'none' && window.getComputedStyle(clickable).visibility !== 'hidden') {
                        clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        if (typeof clickable.click === 'function') {
                            clickable.click();
                        }
                        authorisedSpecial = true;
                        actionTaken = true;
                        break;
                    }
                }
            }
            if (authorisedSpecial) return { authClicked: true, actionTaken: true };

            // 0.1 Click explicitly specified Close SVG/Image buttons (like Meesho's cross-black/grey/white SVGs)
            const allElements = Array.from(document.querySelectorAll('div, span, button, a, img, svg, p, h4, h2'));
            for (const el of allElements) {
                try {
                    let hasSvg = false;

                    // 1. Check all HTML attributes (e.g. src, style, data-src, etc.)
                    if (el.attributes) {
                        for (let j = 0; j < el.attributes.length; j++) {
                            const val = (el.attributes[j].value || '').toLowerCase();
                            if (/cross[-_](black|grey|gray|white)\.svg/.test(val) || val === 'close' || val.includes('close-icon') || val.includes('close-modal')) {
                                hasSvg = true;
                                break;
                            }
                        }
                    }

                    // 2. Check stylesheet/computed background-image if not found in attributes
                    if (!hasSvg) {
                        const computedStyle = window.getComputedStyle(el);
                        const bgImg = computedStyle.backgroundImage || '';
                        if (/cross[-_](black|grey|gray|white)\.svg/.test(bgImg)) {
                            hasSvg = true;
                        }
                    }

                    if (!hasSvg && (el.tagName === 'BUTTON' || el.tagName === 'SPAN' || el.tagName === 'DIV' || el.tagName === 'SVG')) {
                        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                        if (aria === 'close' || aria === 'close modal' || aria === 'dismiss') {
                            hasSvg = true;
                        }
                    }

                    if (hasSvg) {
                        if (!isProtectedElement(el)) {
                            const clickable = el.closest('button') || el.closest('a') || el;
                            if (clickable && window.getComputedStyle(clickable).display !== 'none') {
                                // Dispatch low-level mouse click
                                clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                // Fallback standard click if function exists
                                if (typeof clickable.click === 'function') {
                                    clickable.click();
                                }
                                actionTaken = true;
                            }
                        }
                    }
                } catch (e) {}
            }

            // Helper to check if an element is a floating overlay
            function isFloating(el) {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                return style.position === 'fixed' || style.position === 'absolute' || parseInt(style.zIndex || 0) > 10;
            }

            // 1. Target recognized annoying panels specifically and hide them
            const allDivs = Array.from(document.querySelectorAll('div, p, h4, h2'));
            for (const el of allDivs) {
                if (el.innerText && (
                    el.innerText.includes('Notifications') ||
                    el.innerText.includes('Losing') ||
                    el.innerText.includes('Meesho Fast Program') ||
                    (el.innerText.includes('Announcement') && !el.innerText.includes('Important Announcements'))
                )) {
                    if (isProtectedElement(el)) continue;
                    let parent = null;
                    let current = el;
                    while (current && current.tagName !== 'BODY') {
                        if (isFloating(current)) {
                            parent = current;
                            break;
                        }
                        current = current.parentElement;
                    }
                    if (parent && parent.tagName !== 'BODY' && parent.id !== 'root' && isCentral(parent)) {
                        if (parent.style.display !== 'none') {
                            parent.style.setProperty('display', 'none', 'important');
                            actionTaken = true;
                        }
                    }
                }
            }

            // 2. Hide Generic Modals/Dialogs/Backdrops (EXCEPT PROTECTED ONES)
            const selectors = [
                'div[role="dialog"]',
                '.MuiModal-root',
                '.MuiBackdrop-root',
                '[class*="backdrop"]',
                '[class*="joyride"]',
                '[class*="tour"]',
                '[class*="guide"]',
                'div[aria-label="Close modal"]'
            ];
            document.querySelectorAll(selectors.join(', ')).forEach(el => {
                if (isProtectedElement(el)) return;

                if (isCentral(el) && isFloating(el)) {
                    const closeInside = el.querySelector('button, svg, [aria-label*="close" i]');
                    if (closeInside) {
                        const clickable = closeInside.closest('button') || closeInside;
                        try {
                            clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                            if (typeof clickable.click === 'function') clickable.click();
                        } catch(e) {}
                    }

                    if (el.style.display !== 'none') {
                        el.style.setProperty('display', 'none', 'important');
                        el.style.setProperty('pointer-events', 'none', 'important');
                        actionTaken = true;
                    }
                }
            });

            // 3. Fallback: try organically clicking any close SVG icons ONLY in central popups
            document.querySelectorAll('svg').forEach(svg => {
                if (isProtectedElement(svg)) return;

                const path = svg.querySelector('path');
                const aria = (svg.getAttribute('aria-label') || '').toLowerCase();
                const cls = (svg.getAttribute('class') || '').toLowerCase();
                if (cls.includes('close') || aria.includes('close') ||
                    (path && path.getAttribute('d') && path.getAttribute('d').length < 200 && path.getAttribute('d').includes('M'))) {

                    let isPopup = false;
                    let curr = svg;
                    let popupContainer = null;
                    while (curr && curr.tagName !== 'BODY') {
                        const style = window.getComputedStyle(curr);
                        if ((style.position === 'fixed' || style.position === 'absolute') && parseInt(style.zIndex || 0) > 10) {
                            if (style.display !== 'none') {
                                isPopup = true;
                                popupContainer = curr;
                            }
                            break;
                        }
                        curr = curr.parentElement;
                    }

                    // IF it's in a popup AND the popup is in the center of the screen
                    if (isPopup && isCentral(popupContainer)) {
                        try {
                            const clickable = svg.closest('button') || svg;
                            clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                            if (typeof clickable.click === 'function') clickable.click();
                            actionTaken = true;
                        } catch (e) { }
                    }
                }
            });

            // Clean up body overflow/pointer-events if a modal blocked page scrolling/clicks
            if (document.body) {
                if (document.body.style.overflow === 'hidden') {
                    document.body.style.overflow = 'auto';
                }
                if (document.body.style.pointerEvents === 'none') {
                    document.body.style.pointerEvents = 'auto';
                }
            }

            return { authClicked: false, actionTaken: actionTaken };
        });
        return result;
    } catch (e) {
        return { actionTaken: false };
    }
}

// Function to clear dashboard immediately after login
async function clearDashboard(page) {
    try {
        console.log("  > Checking for dashboard ads/popups...");
        await nukePopups(page);
    } catch (e) {
        console.log("  > Error in clearDashboard: " + e.message);
    }
}

// Dedicated helper to check immediately for upload error toasts (e.g. outdated template)
async function checkUploadError(page) {
    try {
        // 1. Direct Playwright locator check for outdated template / download latest template
        const outdatedLoc = page.getByText(/Template version outdated|download latest template/i).first();
        if (await outdatedLoc.isVisible({ timeout: 200 }).catch(() => false)) {
            const raw = (await outdatedLoc.innerText().catch(() => '')) || 'Template version outdated, download latest template';
            return `Upload failed: ${raw.trim().replace(/\s+/g, ' ')}`;
        }

        // 2. High-priority DOM evaluate check across all toasts, alerts, and notifications
        const domErr = await page.evaluate(() => {
            const els = Array.from(document.querySelectorAll('div, span, p, [role="alert"], [class*="toast" i], [class*="snackbar" i], [class*="alert" i], [class*="notification" i]'));
            for (const el of els) {
                const txt = (el.innerText || el.textContent || '').trim();
                if (!txt || txt.length > 250) continue;
                if (/template version outdated/i.test(txt) || /download latest template/i.test(txt)) {
                    const style = window.getComputedStyle(el);
                    if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                        return txt.replace(/\s+/g, ' ');
                    }
                }
            }
            return null;
        }).catch(() => null);

        if (domErr) {
            return `Upload failed: ${domErr}`;
        }
    } catch (e) {}
    return null;
}

module.exports = { nukePopups, clearDashboard, handleProceedToUpload, checkUploadError };
