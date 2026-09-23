const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { logBotError, logBotSuccess } = require('./logger');
const { nukePopups, clearDashboard } = require('./nuke_helper');
const { connectDB } = require('./db');

const { AsyncLocalStorage } = require('async_hooks');
const asyncLocalStorage = new AsyncLocalStorage();
const origLog = console.log;
console.log = (...args) => {
    const user = asyncLocalStorage.getStore();
    if (user && typeof args[0] === 'string') {
        if (args[0].match(/^\s*[>!]/)) {
            args[0] = `[${user}] ` + args[0].trimStart();
        }
    }
    origLog(...args);
};

// Configuration
const LOGIN_URL = 'https://supplier.meesho.com/panel/v3/new/root/login';
const IMAGES_DIR = path.join(__dirname, 'single_catalog_images');

// Helper to read accounts
async function getAccounts() {
    try {
        const { connectDB } = require('./db');
        const db = await connectDB();
        const accounts = await db.collection('accounts').find({ isActive: true }).toArray();
        return accounts;
    } catch (e) {
        console.error("Error fetching accounts from DB:", e.message);
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
    
    // Main images (like jg_1001.jpg)
    const mainImages = files.filter(f => !commonFiles.some(cf => f.endsWith(cf)));
    
    return mainImages.map(img => {
        const ext = path.extname(img);
        const sku = path.basename(img, ext);
        return {
            sku,
            mainImagePath: path.join(IMAGES_DIR, img),
            commonImagePaths: availableCommonFiles
        };
    });
}

// Helper to get defaults
async function getDefaults() {
    try {
        const db = await connectDB();
        const record = await db.collection('catalog_defaults').findOne({
            $or: [{ category: 'jugs' }, { category: 'jug' }]
        });
        if (record && record.defaults) {
            return record.defaults;
        }
    } catch (e) {
        console.error("Error reading defaults from MongoDB:", e.message);
    }

    const localPath = path.join(__dirname, 'single_catalog_jugs_defaults.json');
    if (fs.existsSync(localPath)) {
        try {
            return JSON.parse(fs.readFileSync(localPath, 'utf8'));
        } catch (e) {}
    }

    return {};
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

async function fillField(page, name, value, isDropdown=false, sectionHeader=null) {
    if (!value && value !== 0) return false;
    try {
        console.log(`  > Filling ${name} with ${value}...`);
        
        if (isDropdown) {
            const prefix = sectionHeader ? `//*[normalize-space(.)='${sectionHeader}']/following::` : `//`;
            const xpathNameMatch = `starts-with(normalize-space(.), '${name}') and not(contains(normalize-space(.), 'Size (INCH)'))`;
            const patterns = [
                `${prefix}span[${xpathNameMatch}]/parent::div/following-sibling::div//input`,
                `${prefix}p[${xpathNameMatch}]/parent::div/following-sibling::div//input`,
                `${prefix}label[${xpathNameMatch}]/following-sibling::div//input`,
                `${prefix}*[${xpathNameMatch}]/ancestor::div[1]/following-sibling::div//input`,
                `${prefix}*[${xpathNameMatch}]/ancestor::*[1]/following-sibling::*//input`
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
                try {
                    await container.click({ timeout: 5000 });
                } catch (e) {
                    await container.click({ force: true });
                }
                await page.waitForTimeout(1000);
                
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
                        await page.waitForTimeout(1500);
                    } catch (e) {}
                }

                // 2. Click the option
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
                        console.log(`  > Clicking option text directly for ${name}...`);
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
                
                // 3. Check if there is an Apply button
                const applyBtn = popup.locator('button, div').filter({ hasText: /^Apply$/i }).last();
                if (await applyBtn.isVisible().catch(() => false)) {
                    await applyBtn.click();
                    await page.waitForTimeout(1000);
                }
                return true;
            } else {
                console.log(`  ! Warning: Could not find dropdown container for ${name}`);
                return false;
            }
        } else {
            // Normal text input
            let input = null;
            if (!sectionHeader) {
                input = page.getByPlaceholder(new RegExp(name, 'i')).first();
            }
            
            if (!input || !(await input.isVisible().catch(() => false))) {
                const lowerName = name.toLowerCase();
                const translateFn = `translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')`;
                const prefix = sectionHeader ? `//*[normalize-space(.)='${sectionHeader}']/following::` : `//`;
                const patterns = [
                    `${prefix}span[contains(${translateFn}, '${lowerName}')]/parent::div/following-sibling::div//*[self::input or self::textarea]`,
                    `${prefix}p[contains(${translateFn}, '${lowerName}')]/parent::div/following-sibling::div//*[self::input or self::textarea]`,
                    `${prefix}label[contains(${translateFn}, '${lowerName}')]/following-sibling::div//*[self::input or self::textarea]`,
                    `${prefix}*[contains(${translateFn}, '${lowerName}')]/ancestor::div[1]/following-sibling::div//*[self::input or self::textarea]`,
                    `${prefix}*[contains(${translateFn}, '${lowerName}')]/ancestor::*[1]/following-sibling::*//*[self::input or self::textarea]`,
                    `${prefix}th[contains(${translateFn}, '${lowerName}')]/ancestor::table//*[self::input or self::textarea]`,
                    `${prefix}div[contains(${translateFn}, '${lowerName}')]/following-sibling::div//*[self::input or self::textarea]`
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
                await input.fill(String(value));
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
    if (!value && value !== 0) return;
    console.log(`  > Filling table field ${name} with ${value}...`);
    try {
        const debugInfo = await page.evaluate(({ name }) => {
            document.querySelectorAll('div').forEach(div => {
                if (div.innerText && div.innerText.includes('Price updates are now available')) {
                    div.style.display = 'none';
                    div.style.visibility = 'hidden';
                }
            });

            const inputs = Array.from(document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"])'));

            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            let node;
            const ths = Array.from(document.querySelectorAll('th'));
            const matchedTh = ths.find(th => th.innerText.trim().toLowerCase().includes(name.toLowerCase()));
            if (matchedTh) {
                const index = ths.indexOf(matchedTh);
                const tr = document.querySelector('tbody tr');
                if (tr) {
                    const tds = Array.from(tr.querySelectorAll('td, th'));
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

            return { success: true, bestInputIndex };
        }, { name });

        if (debugInfo && debugInfo.success) {
            let target;
            let isReadonly = false;
            
            if (debugInfo.isTableCell) {
                const tr = page.locator('tbody tr').first();
                const td = tr.locator('td, th').nth(debugInfo.cellIndex);
                const inp = td.locator('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"])').first();
                if (await inp.isVisible().catch(() => false)) {
                    target = inp;
                    isReadonly = await target.getAttribute('readonly') !== null;
                } else {
                    target = td.locator('div').filter({ hasText: /Select/i }).first();
                    if (!(await target.isVisible().catch(() => false))) {
                        target = td;
                    }
                    isReadonly = true;
                }
            } else {
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
    console.log(`\n=== Starting Jugs Single Catalog Uploads for: ${username} ===`);

    let contextOptions = { viewport: null };
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const results = [];

    try {
        await page.goto(LOGIN_URL, { timeout: 30000 });

        const emailInput = page.getByRole('textbox', { name: 'Email Id or mobile number' });
        await emailInput.waitFor({ state: 'visible', timeout: 15000 });

        console.log(`  > Logging in...`);
        await emailInput.fill(username);
        await page.getByRole('textbox', { name: 'Password' }).fill(password);
        await page.getByRole('button', { name: 'Log in', exact: true }).click();
        try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch(e) {}
        
        await clearDashboard(page);

        for (const group of groups) {
            console.log(`\n[${username}] Processing Jugs SKU: ${group.sku}`);
            try {
                await page.goto(LOGIN_URL, { timeout: 20000 });
                await clearDashboard(page);
                
                console.log(`  > Opening Catalog Uploads...`);
                await clickWithRetry(page, page.getByText('Catalog Uploads').first(), 'Catalog Uploads');
                
                console.log(`  > Navigating category tree to Jugs...`);
                await clickWithRetry(page, page.getByRole('button', { name: /Add Single Catalog/i }).or(page.getByText(/Add Single Catalog/i)).first(), 'Add Single Catalog');
                
                await page.waitForTimeout(2000);

                // Check for "Proceed to Upload" popup explicitly
                try {
                    const proceedBtn = page.getByRole('button', { name: /Proceed to Upload/i }).first();
                    if (await proceedBtn.isVisible({ timeout: 3000 })) {
                        console.log(`  > Found "Proceed to Upload" popup, clicking it...`);
                        await proceedBtn.click();
                        await page.waitForTimeout(1000);
                    }
                } catch (e) {}
                
                // Navigate category tree: Home & Kitchen > Kitchen & Dining > Dinnerware > Jugs
                await clickWithRetry(page, page.getByText('Home & Kitchen', { exact: true }).first(), 'Home & Kitchen');
                await clickWithRetry(page, page.getByText('Kitchen & Dining', { exact: true }).first(), 'Kitchen & Dining');
                await clickWithRetry(page, page.getByText('Dinnerware', { exact: true }).first(), 'Dinnerware');
                await clickWithRetry(page, page.getByText('Jugs', { exact: true }).first(), 'Jugs');
                
                console.log(`  > Uploading main image ${path.basename(group.mainImagePath)}...`);
                const [fileChooser] = await Promise.all([
                    page.waitForEvent('filechooser'),
                    page.getByText('Add Product Images', { exact: false }).first().click()
                ]);
                await fileChooser.setFiles(group.mainImagePath);
                await page.waitForTimeout(2000);
                
                console.log(`  > Handling 'Products in a catalog' popup...`);
                try {
                    const continueBtn = page.getByRole('button', { name: /Continue/i }).first();
                    await continueBtn.waitFor({ state: 'visible', timeout: 15000 });
                    await continueBtn.click();
                    await page.waitForTimeout(1000);
                } catch (e) {
                    console.log(`  > Continue popup did not appear. (Error: ${e.message})`);
                }
                
                console.log(`  > Waiting for form to load...`);
                await page.getByText('Net Weight', { exact: false }).first().waitFor({ state: 'visible', timeout: 30000 });
                await page.waitForTimeout(2000);
                
                // Check for "Meesho Recommendation" popup and click "Okay, Understood"
                try {
                    const okayBtn = page.getByText(/Okay, Understood/i).first();
                    await okayBtn.waitFor({ state: 'visible', timeout: 5000 });
                    console.log(`  > Handling 'Meesho Recommendation' popup...`);
                    await okayBtn.click({ force: true });
                    await page.waitForTimeout(1000);
                } catch (e) {}
                
                // Upload side / common images
                if (group.commonImagePaths.length > 0) {
                     console.log(`  > Uploading common images inside form...`);
                     const multiInput = page.locator('input[type="file"][multiple]').first();
                     if (await multiInput.isVisible({ timeout: 5000 }).catch(()=>false) || await multiInput.count() > 0) {
                         await multiInput.setInputFiles(group.commonImagePaths);
                     } else {
                         const addImagesInput = page.locator('input[type="file"]').last();
                         await addImagesInput.setInputFiles(group.commonImagePaths[0]);
                     }
                     await page.waitForTimeout(3000);
                }

                // Fill Top Section
                console.log(`  > Filling form defaults...`);
                await fillField(page, 'GST', defaults.gst || '18', true);
                await fillField(page, 'HSN Code', defaults.hsnCode || '392410', true);
                await fillField(page, 'Net Weight', defaults.netWeight || '300', false);
                await fillField(page, 'Style code', group.sku, false);
                await fillField(page, 'Product Name', defaults.productName || 'Premium Plastic Water Jug with Lid and Handle (2 Litre) | BPA-Free Floral Printed Water Pitcher', false);
                
                // Size selection unlocks pricing table
                await fillField(page, 'Size', defaults.size || 'Free Size', true, 'Product, Size and Inventory');
                await page.waitForTimeout(3000);

                // Pricing Table
                await fillTableField(page, 'Meesho Price', defaults.meeshoPrice || '189');
                await fillTableField(page, 'Wrong/Defective', defaults.wrongPrice || defaults.wrongDefectiveReturns || '179');
                await fillTableField(page, 'MRP', defaults.mrp || '499');
                await fillTableField(page, 'Inventory', defaults.inventory || '1000');
                await fillTableField(page, 'SKU ID', group.sku);
                
                // Product Details Section (as per Meesho Jugs category)
                await fillField(page, 'Color', defaults.color || 'Multicolor', true, 'Product Details');
                await fillField(page, 'Generic Name', defaults.genericName || 'Jugs', true, 'Product Details');
                await fillField(page, 'Material', defaults.material || 'Plastic', true, 'Product Details');
                await fillField(page, 'Net Quantity', defaults.netQuantity || 'Pack Of 1', true, 'Product Details');
                await fillField(page, 'Product Breadth', defaults.productBreadth || '5', true, 'Product Details');
                await fillField(page, 'Product Height', defaults.productHeight || '9', true, 'Product Details');
                await fillField(page, 'Product Length', defaults.productLength || '5', true, 'Product Details');
                await fillField(page, 'Product Unit', defaults.productUnit || defaults.productDimensionUnit || 'Inch', true, 'Product Details');
                await fillField(page, 'Product Weight', defaults.productWeight || '300', true, 'Product Details');
                await fillField(page, 'Product Weight Unit', defaults.productWeightUnit || 'G', true, 'Product Details');
                await fillField(page, 'Type', defaults.type || 'Water Jug', true, 'Product Details');
                await fillField(page, 'COUNTRY OF ORIGIN', defaults.countryOfOrigin || 'India', true, 'Product Details');

                // Manufacturer Details (inside Product Details on Meesho)
                await fillField(page, 'Manufacturer Name', defaults.manufacturerName || 'bazar', false, 'Product Details');
                let mfgAddrFilled = await fillField(page, 'Manufacturer Address', defaults.manufacturerAddress || 'yogichowk', false, 'Product Details');
                if (!mfgAddrFilled) await fillField(page, 'Manufacturer details', defaults.manufacturerAddress || 'yogichowk', false, 'Product Details');
                
                let mfgPinFilled = await fillField(page, 'Manufacturer Pincode', defaults.manufacturerPincode || '395010', false, 'Product Details');
                if (!mfgPinFilled) await fillField(page, 'Manufacturer pin code', defaults.manufacturerPincode || '395010', false, 'Product Details');
                
                // Packer Details
                await fillField(page, 'Packer Name', defaults.packerName || defaults.manufacturerName || 'bazar', false, 'Product Details');
                let packerFilled = await fillField(page, 'Packer Address', defaults.packerAddress || defaults.manufacturerAddress || 'yogichowk', false, 'Product Details');
                if (!packerFilled) packerFilled = await fillField(page, 'Packer details', defaults.packerAddress || defaults.manufacturerAddress || 'yogichowk', false, 'Product Details');
                
                let packerPinFilled = await fillField(page, 'Packer Pincode', defaults.packerPincode || defaults.manufacturerPincode || '395010', false, 'Product Details');
                if (!packerPinFilled) await fillField(page, 'Packer pin code', defaults.packerPincode || defaults.manufacturerPincode || '395010', false, 'Product Details');

                // Other Attributes Section (Screenshot 3)
                if (defaults.addOn || defaults.addOns) {
                    await fillField(page, 'Add Ons', defaults.addOn || defaults.addOns, true, 'Other Attributes');
                }
                if (defaults.brand) {
                    await fillField(page, 'Brand', defaults.brand, true, 'Other Attributes');
                }
                if (defaults.sizeInLtrs || defaults.capacityInL) {
                    await fillField(page, 'Size (in ltrs)', defaults.sizeInLtrs || defaults.capacityInL || '2', true, 'Other Attributes');
                }
                if (defaults.volumeUnits || defaults.volumeUnit) {
                    await fillField(page, 'Volume Units', defaults.volumeUnits || defaults.volumeUnit || 'L', true, 'Other Attributes');
                }
                if (defaults.description) {
                    let descFilled = await fillField(page, 'Description', defaults.description, false, 'Other Attributes');
                    if (!descFilled) {
                        descFilled = await fillField(page, 'Product Description', defaults.description, false, 'Other Attributes');
                    }
                    if (!descFilled) {
                        try {
                            const descInput = page.locator('textarea').first();
                            if (await descInput.count() > 0) {
                                await descInput.fill(defaults.description);
                            }
                        } catch(e) {}
                    }
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
                
                await page.waitForTimeout(5000);
                results.push({ sku: group.sku, status: 'Success' });
                await logBotSuccess(path.basename(__filename), username, `Jugs catalog uploaded successfully for SKU group: ${group.sku}`, group.sku);
                
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
    const accounts = await getAccounts();
    const groups = getImageGroups();
    const defaults = await getDefaults();
    
    if (groups.length === 0) {
        console.log("No images found in single_catalog_images directory.");
        return;
    }
    
    const browser = await chromium.launch({
        headless: process.env.HEADLESS === 'true' ? true : false,
        args: ['--start-maximized']
    });
    
    for (const acc of accounts) {
        await asyncLocalStorage.run(acc.username, () => processAccount(browser, acc, groups, defaults));
    }
    
    await browser.close();
    console.log("Done.");
}

runBot();
