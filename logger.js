const fs = require('fs');
const path = require('path');

async function logBotError(botName, username, errorMessage, page, sku = null) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `error_${botName.replace(/\s+/g, '_')}_${username}_${timestamp}.png`;
        const screenshotPath = path.join(__dirname, 'error_screenshots', filename);
        
        let screenshotSaved = false;
        if (page) {
            try {
                await page.screenshot({ path: screenshotPath, timeout: 5000 });
                screenshotSaved = true;
            } catch (e) {
                console.log("Failed to take screenshot:", e.message);
            }
        }
        
        const errorsPath = path.join(__dirname, 'errors.json');
        let errors = [];
        if (fs.existsSync(errorsPath)) {
            try { errors = JSON.parse(fs.readFileSync(errorsPath, 'utf8')); } catch (e) {}
        }
        
        errors.unshift({ // Add to top
            bot: botName,
            account: username,
            sku: sku,
            message: errorMessage,
            screenshot: screenshotSaved ? filename : null,
            timestamp: new Date().toISOString()
        });
        
        fs.writeFileSync(errorsPath, JSON.stringify(errors, null, 2));
    } catch (e) {
        console.error("Failed to log bot error:", e.message);
    }
}

module.exports = { logBotError };
