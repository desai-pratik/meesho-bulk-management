const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { logBotError } = require('./logger');

// Configuration
const LOGIN_URL = 'https://supplier.meesho.com/panel/v3/new/root/login';
const IMAGES_DIR = path.join(__dirname, 'single_catalog_images');
const DEFAULTS_FILE = path.join(__dirname, 'single_catalog_mangalsutras_defaults.json');

// Helper to read accounts
function getAccounts() {
    try {
        const csv = fs.readFileSync('accounts.csv', 'utf8');
        const lines = csv.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('username,'));
        return lines.map(line => {
            const [username, password, name, isActive] = line.split(',');
            return { username, password, name, isActive: isActive ? isActive.trim() === 'true' : true };
        }).filter(acc => acc.isActive);
    } catch (e) {
        console.error("Error reading accounts.csv:", e.message);
        return [];
    }
}

// Helper to get image groups
function getImageGroups() {
    if (!fs.existsSync(IMAGES_DIR)) return [];
    
    const files = fs.readdirSync(IMAGES_DIR).filter(f => !f.startsWith('.'));
    const commonFiles = ['_a.jpg', '_b.jpg', '_c.jpg', '_a.png', '_b.png', '_c.png', '_a.jpeg', '_b.jpeg', '_c.jpeg'];
    
    // Find common images that actually exist in the folder
    const availableCommonFiles = files.filter(f => commonFiles.some(cf => f.endsWith(cf))).map(f => path.join(IMAGES_DIR, f));
    
    // Main images (like isr_2981.jpg)
    const mainImages = files.filter(f => !commonFiles.some(cf => f.endsWith(cf)));
    
    return mainImages.map(img => {
        const ext = path.extname(img);
        const sku = path.basename(img, ext); // e.g., 'isr_2981'
        return {
            sku,
            mainImagePath: path.join(IMAGES_DIR, img),
            commonImagePaths: availableCommonFiles // same common files for every sku
        };
    });
}

// Helper to get defaults
function getDefaults() {
    try {
        if (fs.existsSync(DEFAULTS_FILE)) {
            return JSON.parse(fs.readFileSync(DEFAULTS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error("Error reading single_catalog_mangalsutras_defaults.json:", e.message);
    }
    return {};
}

async function nukePopups(page) {
    // Basic popup closer
    try {
        return await page.evaluate(() => {
            let actionTaken = false;
            
            // Check for specific actionable buttons before generic nuke
            const proceedBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Proceed to Upload'));
            if (proceedBtn) {
                proceedBtn.click();
                return true;
            }
            document.querySelectorAll('div[role="dialog"], .MuiModal-root, .MuiBackdrop-root, [class*="joyride"]').forEach(el => {
                if (el.style.display !== 'none') {
                    el.style.setProperty('display', 'none', 'important');
                    el.style.setProperty('pointer-events', 'none', 'important');
                    actionTaken = true;
                }
            });
            document.querySelectorAll('svg').forEach(svg => {
                if ((svg.getAttribute('class') || '').toLowerCase().includes('close')) {
                    try {
                        const clickable = svg.closest('button') || svg;
                        clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        actionTaken = true;
                    } catch (e) {}
                }
            });
            return actionTaken;
        });
    } catch (e) { return false; }
}

async function clearDashboard(page) {
    await page.waitForTimeout(3000);
    for(let i=0; i<3; i++) { await nukePopups(page); await page.waitForTimeout(500); }
}

async function clickWithRetry(page, locator, name) {
    for (let i = 0; i < 5; i++) {
        try {
            await nukePopups(page);
            const resLoc = locator.first ? locator.first() : locator;
            await resLoc.waitFor({ state: 'visible', timeout: 5000 });
            try { await resLoc.click({ timeout: 3000 }); }
            catch (e) { await resLoc.evaluate(el => el.click()); }
            return;
        } catch (err) {
            await page.waitForTimeout(1000);
        }
    }
    throw new Error(`Failed to click ${name}`);
}

async function fillField(page, name, value, isDropdown=false) {
    if (!value) return;
    try {
        console.log(`  > Filling ${name} with ${value}...`);
        
        if (isDropdown) {
            // Use starts-with to handle ' *' and ' (N)' suffixes, but exclude the 'Length Size (INCH)' table header
            const xpathNameMatch = `starts-with(normalize-space(.), '${name}') and not(contains(normalize-space(.), 'Size (INCH)'))`;
            const patterns = [
                `//span[${xpathNameMatch}]/parent::div/following-sibling::div//input`,
                `//p[${xpathNameMatch}]/parent::div/following-sibling::div//input`,
                `//label[${xpathNameMatch}]/following-sibling::div//input`,
                `//*[${xpathNameMatch}]/ancestor::div[1]/following-sibling::div//input`
            ];
            
            let container;
            let inputNode;
            for (let p of patterns) {
                const c = page.locator(p).first();
                if (await c.isVisible().catch(() => false)) {
                    container = c.locator('..');
                    inputNode = c;
                    break;
                }
            }
            
            if (container) {
                // Try clicking wrapper
                try {
                    await container.click({ timeout: 5000 });
                } catch (e) {
                    await container.click({ force: true });
                }
                await page.waitForTimeout(1000);
                
                // If popup didn't appear, try clicking input directly
                const popup = page.locator('body > div:not([id="root"])').filter({ visible: true }).last();
                if (!(await popup.isVisible().catch(() => false)) && inputNode) {
                    await inputNode.click({ force: true });
                    await page.waitForTimeout(1000);
                }
                
                // 1. Fill search box if one exists and is interactable
                const searchInput = popup.getByPlaceholder('Search', { exact: false }).filter({ visible: true }).last();
                if (await searchInput.isVisible().catch(() => false)) {
                    try {
                        await searchInput.fill('');
                        await searchInput.fill(String(value));
                        await page.waitForTimeout(1500); // Wait for API/React to filter the list!
                    } catch (e) {}
                }

                // 2. Click the option!
                try {
                    const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(`^\\s*${escapeRegExp(String(value))}\\s*$`, 'i');
                    
                    let optionText = popup.getByText(regex).filter({ visible: true }).last();
                    if (!(await optionText.isVisible().catch(() => false))) {
                        optionText = popup.getByText(String(value), { exact: false }).filter({ visible: true }).last();
                    }
                    await optionText.waitFor({ state: 'visible', timeout: 2000 });
                    
                    let foundCheckbox = false;
                    for (let i = 1; i <= 3; i++) {
                        const ancestor = optionText.locator(`xpath=ancestor::*[${i}]`);
                        const inputCheck = ancestor.locator('input[type="checkbox"]');
                        if (await inputCheck.count() > 0) {
                            console.log(`  > Found native checkbox in ancestor ${i} for ${name}`);
                            await inputCheck.first().check({ force: true }).catch(() => inputCheck.first().click({ force: true }));
                            foundCheckbox = true;
                            break;
                        }
                        const svgCheck = ancestor.locator('svg');
                        if (await svgCheck.count() > 0) {
                            console.log(`  > Found SVG in ancestor ${i} for ${name}`);
                            await svgCheck.first().click();
                            foundCheckbox = true;
                            break;
                        }
                    }
                    
                    if (!foundCheckbox) {
                        console.log(`  > No checkbox/SVG found near text for ${name}, clicking text directly...`);
                        await optionText.click();
                    }
                    
                    await page.waitForTimeout(1000);
                } catch (e) {
                    console.log(`  ! Warning: Failed to click option for ${name}. Using keyboard fallback.`);
                    await container.press('Enter');
                    await page.waitForTimeout(500);
                    for (let char of String(value)) {
                        await container.press(char);
                    }
                    await container.press('Enter');
                }
                
                // 3. Check if there is an Apply button for multi-selects (execute even if fallback was used)
                const applyBtn = popup.locator('button, div').filter({ hasText: /^Apply$/i }).last();
                if (await applyBtn.isVisible().catch(() => false)) {
                    await applyBtn.click(); // no force to ensure trusted event
                    await page.waitForTimeout(1000);
                }
                return true;
            } else {
                console.log(`  ! Warning: Could not find dropdown container for ${name}`);
                return false;
            }
        } else {
            // Normal text input
            let input = page.getByPlaceholder(new RegExp(name, 'i')).first();
            
            // Xpath fallback (especially for table inputs without placeholders)
            if (!(await input.isVisible().catch(() => false))) {
                const lowerName = name.toLowerCase();
                const translateFn = `translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')`;
                const patterns = [
                    `//span[contains(${translateFn}, '${lowerName}')]/parent::div/following-sibling::div//*[self::input or self::textarea]`,
                    `//p[contains(${translateFn}, '${lowerName}')]/parent::div/following-sibling::div//*[self::input or self::textarea]`,
                    `//label[contains(${translateFn}, '${lowerName}')]/following-sibling::div//*[self::input or self::textarea]`,
                    `//*[contains(${translateFn}, '${lowerName}')]/ancestor::div[1]/following-sibling::div//*[self::input or self::textarea]`,
                    `//*[contains(${translateFn}, '${lowerName}')]/ancestor::*[1]/following-sibling::*//*[self::input or self::textarea]`,
                    `//th[contains(${translateFn}, '${lowerName}')]/ancestor::table//*[self::input or self::textarea]`, // for table inputs
                    `//div[contains(${translateFn}, '${lowerName}')]/following-sibling::div//*[self::input or self::textarea]` // grid layout tables
                ];
                for (let p of patterns) {
                    const i = page.locator(p).first();
                    if (await i.isVisible().catch(() => false)) {
                        input = i;
                        break;
                    }
                }
            }
            
            if (input && await input.isVisible().catch(() => false)) {
                await input.fill('');
                await input.fill(value);
                await page.waitForTimeout(300);
                return true;
            } else {
                console.log(`  ! Warning: Could not find text input field ${name}`);
                return false;
            }
        }
    } catch (e) {
         console.log(`  ! Error filling ${name}: ${e.message}`);
         return false;
    }
}

// Helper to fill fields in dynamic pricing tables or ARIA grids
async function fillTableField(page, name, value) {
    if (!value) return;
    console.log(`  > Filling table field ${name} with ${value}...`);
    try {
        const debugInfo = await page.evaluate(({ name }) => {
            // Hide tooltips that obscure view
            document.querySelectorAll('div').forEach(div => {
                if (div.innerText && div.innerText.includes('Price updates are now available')) {
                    div.style.display = 'none';
                    div.style.visibility = 'hidden';
                }
            });

            // Find all inputs WITHOUT filtering by visibility, so we get an absolute Playwright index!
            const inputs = Array.from(document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"])'));

            // Candidate headers
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            let node;
            // Check if it's a standard table first
            const ths = Array.from(document.querySelectorAll('th'));
            const matchedTh = ths.find(th => th.innerText.trim().toLowerCase().includes(name.toLowerCase()));
            if (matchedTh) {
                const index = ths.indexOf(matchedTh);
                const tr = document.querySelector('tbody tr');
                if (tr) {
                    const tds = Array.from(tr.querySelectorAll('td, th')); // some rows use th for first cell
                    // If the cell exists, let's mark it
                    if (tds[index]) {
                        return { success: true, isTableCell: true, cellIndex: index };
                    }
                }
            }

            let candidateHeaders = [];
            while (node = walker.nextNode()) {
                if (node.nodeValue.trim().toLowerCase().includes(name.toLowerCase())) {
                    const range = document.createRange();
                    range.selectNodeContents(node);
                    const rect = range.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        candidateHeaders.push({ rect });
                    }
                }
            }

            if (candidateHeaders.length === 0) return { error: "Header not found" };

            let bestInputIndex = -1;
            let minDistance = Infinity;

            for (let header of candidateHeaders) {
                const headerCenterX = header.rect.left + header.rect.width / 2;
                const headerBottom = header.rect.bottom;

                inputs.forEach((inp, idx) => {
                    const inputRect = inp.getBoundingClientRect();
                    
                    // We only want to map to VISIBLE inputs, but we keep the absolute index `idx`
                    if (inputRect.width === 0 || inputRect.height === 0) return;

                    const inputCenterX = inputRect.left + inputRect.width / 2;
                    const inputTop = inputRect.top;

                    if (inputTop >= headerBottom - 30) {
                        const verticalDist = Math.abs(inputTop - headerBottom);
                        const horizontalDist = Math.abs(inputCenterX - headerCenterX);
                        
                        if (horizontalDist < 200) {
                            const score = verticalDist + horizontalDist * 2;
                            if (score < minDistance) {
                                minDistance = score;
                                bestInputIndex = idx;
                            }
                        }
                    }
                });
            }

            if (bestInputIndex === -1) {
                return { error: `Could not visually map header to input` };
            }
            
            return { success: true, bestInputIndex };
        }, { name });

        if (debugInfo.error) {
            console.log(`  ! Warning: Could not fill table field ${name}: ${debugInfo.error}`);
            return;
        }

        if (debugInfo.success) {
            let target;
            let isReadonly = false;
            
            if (debugInfo.isTableCell) {
                // Find the interactive element inside the td
                const td = page.locator(`tbody tr`).first().locator(`td, th`).nth(debugInfo.cellIndex);
                // Look for input, if not found, use the div that looks like a dropdown
                const input = td.locator('input').first();
                if (await input.isVisible().catch(() => false)) {
                    target = input;
                    isReadonly = await target.getAttribute('readonly') !== null;
                } else {
                    // Probably a div dropdown
                    target = td.locator('div').filter({ hasText: /Select/i }).first();
                    if (!(await target.isVisible().catch(() => false))) {
                        // Just click the td itself
                        target = td;
                    }
                    isReadonly = true; // Dropdowns are considered readonly
                }
            } else {
                // Visual mapping fallback
                target = page.locator('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"])').nth(debugInfo.bestInputIndex);
                isReadonly = await target.getAttribute('readonly') !== null;
            }
            
            if (isReadonly) {
                console.log(`  > Table field ${name} is a dropdown. Selecting ${value}...`);
                await target.click({ force: true });
                await page.waitForTimeout(500);
                
                try {
                    const popup = page.locator('div[role="listbox"], ul[role="listbox"], div[role="presentation"]').last();
                    const option = popup.getByText(new RegExp(`^${value}$`, 'i')).first();
                    if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
                        await option.click();
                    } else {
                        throw new Error("Option not found in popup");
                    }
                } catch (e) {
                    // Keyboard fallback
                    for (let char of String(value)) {
                        await target.press(char);
                    }
                    await target.press('Enter');
                }
                await page.waitForTimeout(500);
            } else {
                await target.click({ force: true });
                await target.press('Control+A');
                await target.press('Backspace');
                
                if (target.pressSequentially) {
                    await target.pressSequentially(String(value), { delay: 200 });
                } else {
                    await target.type(String(value), { delay: 200 });
                }
                
                await target.press('Tab');
                await new Promise(r => setTimeout(r, 600));
            }
        }

    } catch (e) {
        console.log(`  ! Warning: Could not fill table field ${name}: ${e.message}`);
    }
}


async function processAccount(browser, account, groups, defaults) {
    const { username, password } = account;
    console.log(`\n=== Starting Single Catalog Uploads for: ${username} ===`);

    const sessionPath = path.join(__dirname, 'sessions', `${username}.json`);
    let contextOptions = { viewport: null };
    if (fs.existsSync(sessionPath)) contextOptions.storageState = sessionPath;
    
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const results = [];

    try {
        await page.goto(LOGIN_URL, { timeout: 30000 });
        
        try {
            await Promise.race([
                page.waitForSelector('input[name="emailOrMobile"]', { timeout: 15000 }),
                page.getByText('Catalog Uploads', { exact: true }).first().waitFor({ timeout: 15000 })
            ]);
        } catch (e) {}

        const emailInput = page.getByRole('textbox', { name: 'Email Id or mobile number' });
        if (await emailInput.isVisible().catch(()=>false)) {
            console.log(`  > Logging in...`);
            await emailInput.fill(username);
            await page.getByRole('textbox', { name: 'Password' }).fill(password);
            await page.getByRole('button', { name: 'Log in', exact: true }).click();
            try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch(e) {}
            await context.storageState({ path: sessionPath });
        } else {
            console.log(`  > Using saved session`);
            await context.storageState({ path: sessionPath });
        }
        
        await clearDashboard(page);

        for (const group of groups) {
            console.log(`\n[${username}] Processing SKU: ${group.sku}`);
            try {
                await page.goto(LOGIN_URL, { timeout: 20000 });
                await clearDashboard(page);
                
                console.log(`  > Opening Catalog Uploads...`);
                await clickWithRetry(page, page.getByText('Catalog Uploads').first(), 'Catalog Uploads');
                
                console.log(`  > Navigating category tree...`);
                await clickWithRetry(page, page.getByRole('button', { name: /Add Single Catalog/i }).or(page.getByText(/Add Single Catalog/i)).first(), 'Add Single Catalog');
                
                await page.waitForTimeout(2000); // Give the page a moment to load the category tree

                // Check for "Proceed to Upload" popup explicitly
                try {
                    const proceedBtn = page.getByRole('button', { name: /Proceed to Upload/i }).first();
                    if (await proceedBtn.isVisible({ timeout: 3000 })) {
                        console.log(`  > Found "Proceed to Upload" popup, clicking it...`);
                        await proceedBtn.click();
                        await page.waitForTimeout(1000);
                    }
                } catch (e) {}
                
                // Use exact: true to avoid clicking breadcrumbs
                await clickWithRetry(page, page.getByText('Women Fashion', { exact: true }).first(), 'Women Fashion');
                await clickWithRetry(page, page.getByText('Accessories', { exact: true }).first(), 'Accessories');
                await clickWithRetry(page, page.getByText('Jewellery', { exact: true }).first(), 'Jewellery');
                await clickWithRetry(page, page.getByText('Mangalsutras', { exact: true }).first(), 'Mangalsutras');
                
                console.log(`  > Uploading main image ${path.basename(group.mainImagePath)}...`);
                await page.screenshot({ path: 'debug_before_upload.png' });
                // Properly trigger file upload by clicking the "Add Product Images" button
                const [fileChooser] = await Promise.all([
                    page.waitForEvent('filechooser'),
                    page.getByText('Add Product Images', { exact: false }).first().click()
                ]);
                await fileChooser.setFiles(group.mainImagePath);
                await page.waitForTimeout(2000);
                await page.screenshot({ path: 'debug_after_upload.png' });
                
                console.log(`  > Handling 'Products in a catalog' popup...`);
                try {
                    const continueBtn = page.getByRole('button', { name: /Continue/i }).first();
                    await continueBtn.waitFor({ state: 'visible', timeout: 15000 });
                    // Do not use clickWithRetry here because nukePopups will hide the dialog!
                    await continueBtn.click();
                    await page.waitForTimeout(1000);
                    await page.screenshot({ path: 'debug_after_continue.png' });
                } catch (e) {
                    console.log(`  > Continue popup did not appear. (Error: ${e.message})`);
                }
                
                console.log(`  > Waiting for form to load...`);
                // Wait for Product Name or Net Weight to appear
                await page.getByText('Net Weight', { exact: false }).first().waitFor({ state: 'visible', timeout: 30000 });
                await page.waitForTimeout(2000);
                
                // Check for "Meesho Recommendation" popup and click "Okay, Understood"
                try {
                    const okayBtn = page.getByText(/Okay, Understood/i).first();
                    await okayBtn.waitFor({ state: 'visible', timeout: 5000 });
                    console.log(`  > Handling 'Meesho Recommendation' popup...`);
                    await okayBtn.click({ force: true });
                    await page.waitForTimeout(1000);
                } catch (e) {
                    // Popup did not appear within 5 seconds, ignore
                }
                
                // Now we are inside the form. Upload the common images
                if (group.commonImagePaths.length > 0) {
                     console.log(`  > Uploading common images inside form...`);
                     const multiInput = page.locator('input[type="file"][multiple]').first();
                     if (await multiInput.isVisible({ timeout: 5000 }).catch(()=>false) || await multiInput.count() > 0) {
                         // Some hidden inputs won't be visible, but we can still set files
                         await multiInput.setInputFiles(group.commonImagePaths);
                     } else {
                         // Fallback just in case
                         const addImagesInput = page.locator('input[type="file"]').last();
                         await addImagesInput.setInputFiles(group.commonImagePaths[0]); // fallback single to avoid crash
                     }
                     await page.waitForTimeout(3000);
                }

                // Fill Form
                console.log(`  > Filling form defaults...`);
                // Top section fields
                await fillField(page, 'GST', defaults.gst, true);
                await fillField(page, 'HSN Code', defaults.hsnCode, true);
                await fillField(page, 'Net Weight', defaults.netWeight, false);
                await fillField(page, 'Product Name', defaults.productName, false);
                
                // Fill Size first to unlock pricing table!
                await fillField(page, 'Size', defaults.size, true);
                
                // Now that Size is filled, pricing table appears
                await page.waitForTimeout(3000); // Give it plenty of time to render the grid

                await fillTableField(page, 'Meesho Price', defaults.meeshoPrice);
                await fillTableField(page, 'Wrong/Defective', defaults.wrongPrice || defaults.wrongDefectiveReturns);
                await fillTableField(page, 'MRP', defaults.mrp);
                await fillTableField(page, 'Inventory', defaults.inventory);
                await fillTableField(page, 'Length Size (INCH)', defaults.lengthSizeInch);
                
                // The user wants SKU ID and Style Code to BOTH be the main image name (group.sku)
                // One might be in the form, the other in the Pricing table, so we fill both just to be safe!
                await fillField(page, 'Style code', group.sku, false);
                await fillTableField(page, 'SKU ID', group.sku);
                
                // Product Details (Screenshot 2) Fields (Product Details)
                await fillField(page, 'Base Metal', defaults.baseMetal, true);
                await fillField(page, 'Generic Name', defaults.genericName, true);
                await fillField(page, 'Net Quantity', defaults.netQuantity, true);
                await fillField(page, 'Occasion', defaults.occasion, true);
                await fillField(page, 'Plating', defaults.plating, true);
                await fillField(page, 'Length', defaults.length, true);
                await fillField(page, 'Product Dimension Unit', defaults.productDimensionUnit, true);
                await fillField(page, 'Product Height', defaults.productHeight, false);
                await fillField(page, 'Product Length', defaults.productLength, false);
                await fillField(page, 'Product Width', defaults.productWidth, false);
                await fillField(page, 'Sizing', defaults.sizing, true);
                await fillField(page, 'Stone Type', defaults.stoneType, true);
                await fillField(page, 'Trend', defaults.trend, true);
                await fillField(page, 'Type', defaults.type, true);
                await fillField(page, 'COUNTRY OF ORIGIN', defaults.countryOfOrigin, true);
                // Manufacturer Details
                await fillField(page, 'Manufacturer Name', defaults.manufacturerName, false);
                let mfgAddrFilled = await fillField(page, 'Manufacturer Address', defaults.manufacturerAddress, false);
                if (!mfgAddrFilled) await fillField(page, 'Manufacturer details', defaults.manufacturerAddress, false);
                
                let mfgPinFilled = await fillField(page, 'Manufacturer Pincode', defaults.manufacturerPincode, false);
                if (!mfgPinFilled) await fillField(page, 'Manufacturer pin code', defaults.manufacturerPincode, false);
                
                // Packer details
                await fillField(page, 'Packer Name', defaults.packerName, false);
                let packerFilled = await fillField(page, 'Packer Address', defaults.packerAddress, false);
                if (!packerFilled) packerFilled = await fillField(page, 'Packer details', defaults.packerAddress, false);
                if (!packerFilled) packerFilled = await fillField(page, 'Packer', defaults.packerAddress, false);
                
                let packerPinFilled = await fillField(page, 'Packer Pincode', defaults.packerPincode, false);
                if (!packerPinFilled) await fillField(page, 'Packer pin code', defaults.packerPincode, false);
                
                // Importer details
                await fillField(page, 'Importer Name', defaults.importerName, false);
                await fillField(page, 'Importer Details', defaults.importerAddress, false);
                
                // Other details
                await fillField(page, 'Add On', defaults.addOn, true);
                await fillField(page, 'Brand', defaults.brand, true);
                await fillField(page, 'Color', defaults.color, true);
                // Optional missing from screenshot but in state
                if (defaults.description) {
                    try {
                        const descInput = page.locator('textarea').first();
                        if (await descInput.count() > 0) {
                             await descInput.fill(defaults.description);
                        }
                    } catch(e) {}
                }
                
                console.log(`  > Submitting catalog...`);
                const submitBtn = page.getByRole('button', { name: 'Submit Catalog' });
                await clickWithRetry(page, submitBtn, 'Submit Catalog');
                
                // Handle the confirmation popup
                console.log(`  > Confirming submission popup...`);
                try {
                    const proceedBtn = page.getByRole('button', { name: 'Proceed' }).first();
                    await proceedBtn.waitFor({ state: 'visible', timeout: 5000 });
                    await proceedBtn.click();
                } catch (e) {
                    console.log(`  ! Proceed button popup not found or failed to click.`);
                }
                
                await page.waitForTimeout(5000); // Wait for success
                results.push({ sku: group.sku, status: 'Success' });
                
            } catch (e) {
                console.error(`  ! Error on ${group.sku}:`, e.message);
                await logBotError(path.basename(__filename), username, e.message, page, group.sku);
                results.push({ sku: group.sku, status: 'Error', reason: e.message });
            }
        }
    } catch (e) {
        console.error(`Global Error: ${e.message}`);
        await logBotError(path.basename(__filename), username, e.message, typeof page !== 'undefined' ? page : null);
    } finally {
        await context.close();
    }
    return results;
}

async function runBot() {
    const accounts = getAccounts();
    const groups = getImageGroups();
    const defaults = getDefaults();
    
    if (groups.length === 0) {
        console.log("No images found in single_catalog_images directory.");
        return;
    }
    
    const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
    
    for (const acc of accounts) {
        await processAccount(browser, acc, groups, defaults);
    }
    
    await browser.close();
    console.log("Done.");
}

runBot();
