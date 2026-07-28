const path = require('path');
const { connectDB } = require('./db');

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
        
        const logEntry = {
            bot: botName,
            account: username,
            sku: sku,
            message: errorMessage,
            screenshot: screenshotSaved ? filename : null,
            type: 'error',
            timestamp: new Date().toISOString()
        };

        // Write to MongoDB only
        try {
            const db = await connectDB();
            await db.collection('errors').insertOne(logEntry);
        } catch (dbErr) {
            console.error("Failed to log error to MongoDB:", dbErr.message);
        }
    } catch (e) {
        console.error("Failed to log bot error:", e.message);
    }
}

async function logBotSuccess(botName, username, successMessage, sku = null) {
    try {
        const logEntry = {
            bot: botName,
            account: username,
            sku: sku,
            message: successMessage,
            type: 'success',
            timestamp: new Date().toISOString()
        };

        // Write to MongoDB only
        try {
            const db = await connectDB();
            await db.collection('errors').insertOne(logEntry);
        } catch (dbErr) {
            console.error("Failed to log success to MongoDB:", dbErr.message);
        }
    } catch (e) {
        console.error("Failed to log bot success:", e.message);
    }
}

module.exports = { logBotError, logBotSuccess };
