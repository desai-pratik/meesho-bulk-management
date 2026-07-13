const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/single_catalog_images', express.static(path.join(__dirname, 'single_catalog_images')));
app.use('/error_screenshots', express.static(path.join(__dirname, 'error_screenshots')));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // allow frontend to connect
        methods: ["GET", "POST"]
    }
});

// Map of currently running processes
const activeProcesses = new Map();

// Helpers
const getAccountsPath = () => path.join(__dirname, 'accounts.csv');
const getUploadsPath = () => {
    const dir = path.join(__dirname, 'uploaded-files');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
};
const getSingleCatalogImagesPath = () => {
    const dir = path.join(__dirname, 'single_catalog_images');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
};
const getErrorScreenshotsPath = () => {
    const dir = path.join(__dirname, 'error_screenshots');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
};

// Multer Config for Bulk Uploads (.xlsx)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, getUploadsPath());
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname); // Keep original filename
    }
});
const upload = multer({ storage: storage });

// Multer Config for Single Catalog Images (.jpg, .png)
const imageStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, getSingleCatalogImagesPath());
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});
const uploadImage = multer({ storage: imageStorage });

app.get('/api/accounts', (req, res) => {
    try {
        if (!fs.existsSync(getAccountsPath())) {
            return res.json([]);
        }
        const csv = fs.readFileSync(getAccountsPath(), 'utf8');
        const lines = csv.split('\n').filter(l => l.trim().length > 0);

        let accounts = [];
        // Assuming first line might be header or might not be.
        // Let's just treat everything as "username,password"
        for (let line of lines) {
            if (line.startsWith('username,')) continue; // skip header if exists
            const [username, password, name, isActive] = line.split(',');
            if (username && password) {
                accounts.push({
                    username: username.trim(),
                    password: password.trim(),
                    name: name ? name.trim() : '',
                    isActive: isActive ? isActive.trim() === 'true' : true
                });
            }
        }
        res.json(accounts);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/accounts', (req, res) => {
    try {
        const { accounts } = req.body;
        if (!Array.isArray(accounts)) {
            return res.status(400).json({ error: 'Accounts should be an array' });
        }

        let csvContent = 'username,password,name,isActive\n';
        for (let acc of accounts) {
            csvContent += `${acc.username},${acc.password},${acc.name || ''},${acc.isActive !== false}\n`;
        }

        fs.writeFileSync(getAccountsPath(), csvContent, 'utf8');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- INVENTORY UPDATES ENDPOINTS ---
function getInventoryUpdatesPath() {
    return path.join(__dirname, 'inventory_updates.csv');
}

app.get('/api/inventory-updates', (req, res) => {
    try {
        let updates = [];
        const updatesPath = getInventoryUpdatesPath();
        if (fs.existsSync(updatesPath)) {
            const csvText = fs.readFileSync(updatesPath, 'utf8');
            const lines = csvText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('sku,'));
            for (let line of lines) {
                const parts = line.split(',');
                if (parts.length >= 2) {
                    updates.push({ sku: parts[0], price: parts[1] });
                }
            }
        }
        res.json(updates);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/inventory-updates', (req, res) => {
    try {
        const { updates } = req.body;
        if (!Array.isArray(updates)) {
            return res.status(400).json({ error: 'Updates should be an array' });
        }

        let csvContent = 'sku,price\n';
        for (let update of updates) {
            csvContent += `${update.sku},${update.price}\n`;
        }

        fs.writeFileSync(getInventoryUpdatesPath(), csvContent, 'utf8');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- INVENTORY STOCK UPDATES ENDPOINTS ---
function getInventoryStockUpdatesPath() {
    return path.join(__dirname, 'inventory_stock_updates.csv');
}

app.get('/api/inventory-stock-updates', (req, res) => {
    try {
        let updates = [];
        const updatesPath = getInventoryStockUpdatesPath();
        if (fs.existsSync(updatesPath)) {
            const csvText = fs.readFileSync(updatesPath, 'utf8');
            const lines = csvText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('sku,'));
            for (let line of lines) {
                const parts = line.split(',');
                if (parts.length >= 2) {
                    updates.push({ sku: parts[0], stock: parts[1] });
                }
            }
        }
        res.json(updates);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/inventory-stock-updates', (req, res) => {
    try {
        const { updates } = req.body;
        if (!Array.isArray(updates)) {
            return res.status(400).json({ error: 'Updates should be an array' });
        }

        let csvContent = 'sku,stock\n';
        for (let update of updates) {
            csvContent += `${update.sku},${update.stock}\n`;
        }

        fs.writeFileSync(getInventoryStockUpdatesPath(), csvContent, 'utf8');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- SINGLE CATALOG DEFAULTS ENDPOINTS ---
function getSingleCatalogDefaultsPath(category = 'jewellery_set') {
    if (category === 'mangalsutras') {
        return path.join(__dirname, 'single_catalog_mangalsutras_defaults.json');
    }
    if (category === 'mattress_protection') {
        return path.join(__dirname, 'single_catalog_mattress_protection_defaults.json');
    }
    return path.join(__dirname, 'single_catalog_jewellery_set_defaults.json');
}

app.get('/api/single-catalog-defaults', (req, res) => {
    try {
        const category = req.query.category || 'jewellery_set';
        const defaultsPath = getSingleCatalogDefaultsPath(category);
        if (fs.existsSync(defaultsPath)) {
            const data = fs.readFileSync(defaultsPath, 'utf8');
            res.json(JSON.parse(data));
        } else {
            res.json({});
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/single-catalog-defaults', (req, res) => {
    try {
        const category = req.query.category || 'jewellery_set';
        const defaults = req.body;
        fs.writeFileSync(getSingleCatalogDefaultsPath(category), JSON.stringify(defaults, null, 2), 'utf8');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- SINGLE CATALOG IMAGES ENDPOINTS ---

app.get('/api/single-catalog-images', (req, res) => {
    try {
        const dir = getSingleCatalogImagesPath();
        const files = fs.readdirSync(dir);
        const fileDetails = files.map(filename => {
            const stats = fs.statSync(path.join(dir, filename));
            return {
                name: filename,
                size: stats.size,
                mtime: stats.mtime
            };
        });
        res.json(fileDetails);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/single-catalog-images', uploadImage.array('files'), (req, res) => {
    try {
        res.json({ success: true, message: 'Images uploaded successfully', files: req.files });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/single-catalog-images', (req, res) => {
    try {
        const dir = getSingleCatalogImagesPath();
        const files = fs.readdirSync(dir);
        for (const file of files) {
            fs.unlinkSync(path.join(dir, file));
        }
        res.json({ success: true, message: 'All images deleted' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/single-catalog-images/:filename', (req, res) => {
    try {
        const { filename } = req.params;
        const sanitizedFilename = path.basename(filename);
        const filepath = path.join(getSingleCatalogImagesPath(), sanitizedFilename);

        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            res.json({ success: true, message: 'Image deleted' });
        } else {
            res.status(404).json({ error: 'Image not found' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// --- FILE MANAGER ENDPOINTS ---

app.get('/api/files', (req, res) => {
    try {
        const dir = getUploadsPath();
        const files = fs.readdirSync(dir);
        const fileDetails = files.map(filename => {
            const stats = fs.statSync(path.join(dir, filename));
            return {
                name: filename,
                size: stats.size,
                mtime: stats.mtime
            };
        });
        res.json(fileDetails);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/files', upload.array('files'), (req, res) => {
    try {
        res.json({ success: true, message: 'Files uploaded successfully', files: req.files });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/files/:filename', (req, res) => {
    try {
        const { filename } = req.params;
        // prevent directory traversal attacks
        const sanitizedFilename = path.basename(filename);
        const filepath = path.join(getUploadsPath(), sanitizedFilename);

        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            res.json({ success: true, message: 'File deleted' });
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- STATS ENDPOINT ---
app.get('/api/stats', (req, res) => {
    try {
        const statsPath = path.join(__dirname, 'pending_orders_overview_data.json');
        if (fs.existsSync(statsPath)) {
            const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
            // Convert to array format for Recharts
            const data = Object.keys(stats).map(username => ({
                account: username,
                pendingOrders: stats[username]
            }));
            res.json(data);
        } else {
            res.json([]);
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- ERRORS ENDPOINT ---
app.get('/api/errors', (req, res) => {
    try {
        const errorsPath = path.join(__dirname, 'errors.json');
        if (fs.existsSync(errorsPath)) {
            const errors = JSON.parse(fs.readFileSync(errorsPath, 'utf8'));
            res.json(errors);
        } else {
            res.json([]);
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/errors', (req, res) => {
    try {
        const errorsPath = path.join(__dirname, 'errors.json');
        // We might want to optionally delete the screenshots too, but just clearing the JSON is enough for the UI
        fs.writeFileSync(errorsPath, JSON.stringify([]));
        // Clear screenshots folder
        const screenshotsDir = getErrorScreenshotsPath();
        const files = fs.readdirSync(screenshotsDir);
        for (const file of files) {
            if (file.endsWith('.png')) {
                fs.unlinkSync(path.join(screenshotsDir, file));
            }
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/errors/:index', (req, res) => {
    try {
        const index = parseInt(req.params.index, 10);
        const errorsPath = path.join(__dirname, 'errors.json');
        if (fs.existsSync(errorsPath)) {
            let errors = JSON.parse(fs.readFileSync(errorsPath, 'utf8'));
            if (index >= 0 && index < errors.length) {
                const removed = errors.splice(index, 1)[0];
                fs.writeFileSync(errorsPath, JSON.stringify(errors, null, 2));
                if (removed.screenshot) {
                    const screenshotPath = path.join(getErrorScreenshotsPath(), removed.screenshot);
                    if (fs.existsSync(screenshotPath)) {
                        fs.unlinkSync(screenshotPath);
                    }
                }
            }
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/return-otps', (req, res) => {
    try {
        const otpsPath = path.join(__dirname, 'return_otps.json');
        if (fs.existsSync(otpsPath)) {
            const otps = JSON.parse(fs.readFileSync(otpsPath, 'utf8'));
            res.json(otps);
        } else {
            res.json([]);
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.get('/api/scripts', (req, res) => {
    try {
        const files = fs.readdirSync(__dirname);
        const scripts = files.filter(f => f.startsWith('meesho_') && f.endsWith('.js'));

        const scriptInfo = scripts.map(s => {
            let name = s.replace('meesho_', '').replace('.js', '').replace(/_/g, ' ');
            // capitalize
            name = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

            const isRunning = activeProcesses.has(s);
            const proc = isRunning ? activeProcesses.get(s) : null;

            return {
                filename: s,
                name: name,
                isRunning: isRunning,
                startTime: proc ? proc.startTime : null
            };
        });

        res.json(scriptInfo);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/run/:scriptName', (req, res) => {
    const { scriptName } = req.params;
    const { account } = req.body || {};

    // basic validation
    if (!scriptName.startsWith('meesho_') || !scriptName.endsWith('.js')) {
        return res.status(400).json({ error: 'Invalid script name' });
    }

    const scriptPath = path.join(__dirname, scriptName);
    if (!fs.existsSync(scriptPath)) {
        return res.status(404).json({ error: 'Script not found' });
    }

    if (activeProcesses.has(scriptName)) {
        return res.status(400).json({ error: 'Script is already running' });
    }

    try {
        const env = Object.assign({}, process.env);
        delete env.NODE_OPTIONS;
        if (account) {
            env.TARGET_ACCOUNT = account;
        }

        const startTime = Date.now();

        const child = spawn(process.execPath, ['-r', './screencast_helper.js', scriptName], {
            cwd: __dirname,
            env,
            stdio: ['pipe', 'pipe', 'pipe', 'ipc']
        });
        activeProcesses.set(scriptName, { child, startTime });

        child.on('message', (message) => {
            if (message && message.type === 'screencast') {
                io.emit('screencast', {
                    script: scriptName,
                    image: message.image,
                    url: message.url
                });
            }
        });

        child.stdout.on('data', (data) => {
            const msg = data.toString();
            console.log(`[${scriptName}] ${msg.trim()}`);
            io.emit('log', { script: scriptName, type: 'info', message: msg });
        });

        child.stderr.on('data', (data) => {
            const msg = data.toString();
            console.error(`[${scriptName} ERROR] ${msg.trim()}`);
            io.emit('log', { script: scriptName, type: 'error', message: msg });
        });

        child.on('close', (code) => {
            console.log(`[${scriptName}] Exited with code ${code}`);
            io.emit('log', { script: scriptName, type: 'system', message: `Process exited with code ${code}` });
            activeProcesses.delete(scriptName);
            io.emit('processStatus', { script: scriptName, status: 'stopped' });
        });

        io.emit('processStatus', {
            script: scriptName,
            status: 'running',
            startTime
        });
        res.json({ success: true, message: 'Script started' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/stop/:scriptName', (req, res) => {
    const { scriptName } = req.params;

    if (activeProcesses.has(scriptName)) {
        const proc = activeProcesses.get(scriptName);
        proc.child.kill('SIGTERM');
        activeProcesses.delete(scriptName);
        io.emit('log', { script: scriptName, type: 'system', message: 'Process killed by user' });
        io.emit('processStatus', { script: scriptName, status: 'stopped' });
        return res.json({ success: true, message: 'Script stopped' });
    }

    res.status(404).json({ error: 'Script is not running' });
});

// Serve built static frontend files
app.use(express.static(path.join(__dirname, 'frontend/dist')));

// Fallback all routes to index.html for client-side routing (React Router)
app.get('*any', (req, res, next) => {
    // If request starts with /api or is for static folders, skip to let express handle it/return 404
    if (req.path.startsWith('/api') || req.path.startsWith('/single_catalog_images') || req.path.startsWith('/error_screenshots')) {
        return next();
    }
    res.sendFile(path.join(__dirname, 'frontend/dist', 'index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});
