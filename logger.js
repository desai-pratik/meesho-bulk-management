const fs = require('fs');
const path = require('path');

const ERRORS_FILE = path.join(__dirname, 'errors.json');

function appendLocalLog(logEntry) {
    let logs = [];
    if (fs.existsSync(ERRORS_FILE)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(ERRORS_FILE, 'utf8'));
            if (Array.isArray(parsed)) {
                logs = parsed;
            }
        } catch (e) {
            console.error("Failed to parse local errors.json, starting fresh:", e.message);
        }
    }
    logs.unshift(logEntry);
    fs.writeFileSync(ERRORS_FILE, JSON.stringify(logs, null, 2), 'utf8');
}

async function logBotError(botName, username, errorMessage, page, sku = null, file = null) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `error_${botName.replace(/\s+/g, '_')}_${username}_${timestamp}.png`;
        const screenshotDir = path.join(__dirname, 'error_screenshots');
        const screenshotPath = path.join(screenshotDir, filename);
        
        let screenshotSaved = false;
        if (page) {
            try {
                if (!fs.existsSync(screenshotDir)) {
                    fs.mkdirSync(screenshotDir, { recursive: true });
                }
                await page.screenshot({ path: screenshotPath, timeout: 5000 });
                screenshotSaved = true;
            } catch (e) {
                console.log("Failed to take screenshot:", e.message);
            }
        }
        
        const logEntry = {
            bot: botName,
            account: username,
            sku: sku,
            file: file,
            message: errorMessage,
            screenshot: screenshotSaved ? filename : null,
            type: 'error',
            timestamp: new Date().toISOString()
        };

        // Write to local errors.json
        try {
            appendLocalLog(logEntry);
        } catch (fsErr) {
            console.error("Failed to log error to local errors.json:", fsErr.message);
        }
    } catch (e) {
        console.error("Failed to log bot error:", e.message);
    }
}

async function logBotSuccess(botName, username, successMessage, sku = null, file = null) {
    try {
        const logEntry = {
            bot: botName,
            account: username,
            sku: sku,
            file: file,
            message: successMessage,
            type: 'success',
            timestamp: new Date().toISOString()
        };

        // Write to local errors.json
        try {
            appendLocalLog(logEntry);
        } catch (fsErr) {
            console.error("Failed to log success to local errors.json:", fsErr.message);
        }
    } catch (e) {
        console.error("Failed to log bot success:", e.message);
    }
}

module.exports = { logBotError, logBotSuccess };
