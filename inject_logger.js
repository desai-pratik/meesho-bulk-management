const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter(f => f.startsWith('meesho_') && f.endsWith('.js'));

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;

    // Add require if not present
    if (content.includes('page.screenshot({ path: `error_') || content.includes("page.screenshot({ path: `error_")) {
        if (!content.includes("const { logBotError } = require('./logger');")) {
            content = "const { logBotError } = require('./logger');\n" + content;
            changed = true;
        }
        
        // Replace await page.screenshot({ path: `error_...` })
        const regex = /await page\.screenshot\(\{\s*path:\s*`error_[^`]+`[^}]*\}\);/g;
        content = content.replace(regex, "await logBotError(path.basename(__filename), username, e.message, typeof page !== 'undefined' ? page : null);");
        changed = true;
    }

    if (changed) {
        fs.writeFileSync(file, content);
        console.log(`Updated ${file}`);
    }
});
