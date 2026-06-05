const fs = require('fs');

let content = fs.readFileSync('meesho_jewellery_set_single_catalog_upload.js', 'utf8');

const regex = /await page\.evaluate\(\(\{ headerText, value \}\) => \{[\s\S]*?\}, \{ headerText, value \}\);/m;

const replacementContent = `await page.evaluate(({ headerText, value }) => {
            const escapeRegExp = (string) => string.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
            const regex = new RegExp(\`^\\\\s*\${escapeRegExp(headerText)}\\\\s*$\`, 'i');
            
            // 1. Find the deepest element containing the exact header text
            const elements = Array.from(document.querySelectorAll('*'));
            let targetHeader = null;
            
            for (let el of elements) {
                if (el.innerText && regex.test(el.innerText.trim()) && el.children.length === 0) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        targetHeader = el;
                        break;
                    }
                }
            }
            
            if (!targetHeader) {
                const looseRegex = new RegExp(escapeRegExp(headerText), 'i');
                for (let el of elements) {
                    if (el.innerText && looseRegex.test(el.innerText.trim()) && el.children.length === 0) {
                        const rect = el.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            targetHeader = el;
                            break;
                        }
                    }
                }
            }
            
            if (!targetHeader) throw new Error(\`Header text not found\`);
            
            const headerRect = targetHeader.getBoundingClientRect();
            const headerCenterX = headerRect.left + (headerRect.width / 2);
            
            // 2. Find all visible text/number inputs
            const inputs = Array.from(document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"])'));
            let closestInput = null;
            let closestDist = Infinity;
            
            for (let inp of inputs) {
                const rect = inp.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    // Check if the input is vertically BELOW the header
                    if (rect.top >= (headerRect.bottom - 10)) { // allow slight overlap
                        const inputCenterX = rect.left + (rect.width / 2);
                        const dist = Math.abs(inputCenterX - headerCenterX);
                        
                        // It should be roughly aligned vertically
                        if (dist < 150 && dist < closestDist) {
                            closestDist = dist;
                            closestInput = inp;
                        }
                    }
                }
            }
            
            if (!closestInput) {
                throw new Error(\`Could not map header to input cell visually\`);
            }
            
            closestInput.focus();
            closestInput.value = value;
            closestInput.dispatchEvent(new Event('input', { bubbles: true }));
            closestInput.dispatchEvent(new Event('change', { bubbles: true }));
            closestInput.blur();
        }, { headerText, value });`;

if (regex.test(content)) {
    content = content.replace(regex, replacementContent);
    fs.writeFileSync('meesho_jewellery_set_single_catalog_upload.js', content);
    console.log("Successfully patched meesho_jewellery_set_single_catalog_upload.js!");
} else {
    console.error("Target content not found using regex!");
}
