// Function to inject background interval poller to continuously nuke popups on all navigations
async function injectBackgroundPoller(page) {
    try {
        const script = () => {
            if (window.__nukePollerIntervalActive) return;
            window.__nukePollerIntervalActive = true;
            
            setInterval(() => {
                try {
                    const els = Array.from(document.querySelectorAll('div, span, button, a, img, svg, p, h4, h2'));
                    for (const el of els) {
                        let hasSvg = false;
                        
                        // Check attributes
                        if (el.attributes) {
                            for (let j = 0; j < el.attributes.length; j++) {
                                const val = el.attributes[j].value || '';
                                if (val.includes('cross-black.svg') || val.includes('cross-grey.svg') || val.includes('cross-white.svg')) {
                                    hasSvg = true;
                                    break;
                                }
                            }
                        }
                        
                        // Check computed style
                        if (!hasSvg) {
                            const computedStyle = window.getComputedStyle(el);
                            const bgImg = computedStyle.backgroundImage || '';
                            if (bgImg.includes('cross-black.svg') || bgImg.includes('cross-grey.svg') || bgImg.includes('cross-white.svg')) {
                                  hasSvg = true;
                            }
                        }
                        
                        if (hasSvg) {
                            // Check if this close button is part of an OTP popup we want to keep open
                            let isOtpPopup = false;
                            let curr = el;
                            for (let k = 0; k < 6; k++) {
                                if (!curr) break;
                                const text = (curr.innerText || curr.textContent || '').toLowerCase();
                                if (text.includes('otp') || text.includes('shadowfax') || text.includes('valmo') || text.includes('delhivery') || text.includes('ecom express') || text.includes('xpressbees')) {
                                    isOtpPopup = true;
                                    break;
                                }
                                curr = curr.parentElement;
                            }
                            if (isOtpPopup) continue;

                            const clickable = el.closest('button') || el.closest('a') || el;
                            if (clickable && window.getComputedStyle(clickable).display !== 'none') {
                                clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                                if (typeof clickable.click === 'function') {
                                    clickable.click();
                                }
                            }
                        }
                    }
                } catch(err) {}
            }, 500); // Check every 500ms
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

            let actionTaken = false;
            let authorisedSpecial = false;

            // 0. HANDLE SPECIAL AUTH POPUPS (Must click, not close!)
            const buttonsOrLinks = Array.from(document.querySelectorAll('button, a, span'));
            for (const el of buttonsOrLinks) {
                if (el.innerText && el.innerText.trim().toLowerCase() === 'proceed to upload') {
                    const clickable = el.closest('button') || el;
                    clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    authorisedSpecial = true;
                    actionTaken = true;
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
                            const val = el.attributes[j].value || '';
                            if (val.includes('cross-black.svg') || val.includes('cross-grey.svg') || val.includes('cross-white.svg')) {
                                hasSvg = true;
                                break;
                            }
                        }
                    }
                    
                    // 2. Check stylesheet/computed background-image if not found in attributes
                    if (!hasSvg) {
                        const computedStyle = window.getComputedStyle(el);
                        const bgImg = computedStyle.backgroundImage || '';
                        if (bgImg.includes('cross-black.svg') || bgImg.includes('cross-grey.svg') || bgImg.includes('cross-white.svg')) {
                            hasSvg = true;
                        }
                    }
                    
                    if (hasSvg) {
                        // Check if this close button is part of an OTP popup we want to keep open
                        let isOtpPopup = false;
                        let curr = el;
                        for (let k = 0; k < 6; k++) {
                            if (!curr) break;
                            const text = (curr.innerText || curr.textContent || '').toLowerCase();
                            if (text.includes('otp') || text.includes('shadowfax') || text.includes('valmo') || text.includes('delhivery') || text.includes('ecom express') || text.includes('xpressbees')) {
                                isOtpPopup = true;
                                break;
                            }
                            curr = curr.parentElement;
                        }
                        if (!isOtpPopup) {
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

            // 2. Hide Generic Modals/Dialogs/Backdrops
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
                if (isCentral(el) && isFloating(el)) {
                    if (el.style.display !== 'none') {
                        el.style.setProperty('display', 'none', 'important');
                        el.style.setProperty('pointer-events', 'none', 'important');
                        actionTaken = true;
                    }
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
                            actionTaken = true;
                        } catch (e) { }
                    }
                }
            });

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
        await page.waitForTimeout(1000);

        let popupsHandled = 0;
        // Try up to 4 times
        for (let i = 0; i < 4; i++) {
            const nukeResult = await nukePopups(page);
            if (nukeResult && nukeResult.actionTaken) {
                popupsHandled++;
                await page.waitForTimeout(500); // Wait for animations
            } else {
                break;
            }
        }

        if (popupsHandled > 0) {
            console.log(`  > Dashboard popups detected and cleared (Handled: ${popupsHandled}).`);
        } else {
            console.log("  > No dashboard ads/popups found. Proceeding.");
        }
    } catch (e) {
        console.log("  > Error in clearDashboard: " + e.message);
    }
}

module.exports = { nukePopups, clearDashboard };
