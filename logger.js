const path = require('path');
const fs = require('fs');

function emitNotification(logEntry) {
    // 1. Send via IPC if running as a child process of server.js
    if (typeof process.send === 'function') {
        try {
            process.send({ type: 'notification', data: logEntry });
            return;
        } catch (e) { }
    }

    // 2. If running standalone / terminal, emit via HTTP to server.js
    try {
        const http = require('http');
        const data = JSON.stringify(logEntry);
        const req = http.request({
            hostname: '127.0.0.1',
            port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
            path: '/api/notifications/emit',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            },
            timeout: 2000
        });
        req.on('error', () => { });
        req.write(data);
        req.end();
    } catch (e) { }
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
            id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            bot: botName,
            account: username,
            sku: sku,
            file: file,
            message: errorMessage,
            screenshot: screenshotSaved ? filename : null,
            type: 'error',
            timestamp: new Date().toISOString()
        };

        emitNotification(logEntry);
    } catch (e) {
        console.error("Failed to log bot error:", e.message);
    }
}

async function logBotSuccess(botName, username, successMessage, sku = null, file = null) {
    try {
        const logEntry = {
            id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            bot: botName,
            account: username,
            sku: sku,
            file: file,
            message: successMessage,
            type: 'success',
            timestamp: new Date().toISOString()
        };

        emitNotification(logEntry);
    } catch (e) {
        console.error("Failed to log bot success:", e.message);
    }
}

module.exports = { logBotError, logBotSuccess };
