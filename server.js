const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const { connectDB } = require('./db');

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

// Helpers for file paths
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
const getInventoryUpdatesPath = () => path.join(__dirname, 'inventory_updates.csv');
const getInventoryStockUpdatesPath = () => path.join(__dirname, 'inventory_stock_updates.csv');

function getSingleCatalogDefaultsPath(category = 'jewellery_set') {
    if (category === 'mangalsutras') {
        return path.join(__dirname, 'single_catalog_mangalsutras_defaults.json');
    }
    if (category === 'mattress_protection') {
        return path.join(__dirname, 'single_catalog_mattress_protection_defaults.json');
    }
    return path.join(__dirname, 'single_catalog_jewellery_set_defaults.json');
}

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

// --- DATABASE SYNC & INITIALIZATION LAYER ---

async function syncLocalCacheFiles() {
    try {
        const db = await connectDB();

        // Sync only accounts.csv (JSON and inventory CSV cache files are removed as we run exclusively from the DB)
        
        // 1. Sync accounts.csv
        const accounts = await db.collection('accounts').find({}).toArray();
        let csvContent = 'username,password,name,isActive\n';
        for (let acc of accounts) {
            csvContent += `${acc.username},${acc.password},${acc.name || ''},${acc.isActive !== false}\n`;
        }
        fs.writeFileSync(getAccountsPath(), csvContent, 'utf8');

        console.log("Local CSV cache files successfully synced from MongoDB.");
    } catch (e) {
        console.error("Failed to sync local cache files:", e.message);
    }
}

async function initializeDB() {
    try {
        const db = await connectDB();
        console.log("Connected to MongoDB successfully.");

        // 1. Migrate Accounts
        const accountsColl = db.collection('accounts');
        const accountsCount = await accountsColl.countDocuments();
        if (accountsCount === 0) {
            const accountsPath = getAccountsPath();
            if (fs.existsSync(accountsPath)) {
                console.log("Migrating accounts to MongoDB...");
                const csv = fs.readFileSync(accountsPath, 'utf8');
                const lines = csv.split('\n').filter(l => l.trim().length > 0);
                const toInsert = [];
                for (let line of lines) {
                    if (line.startsWith('username,')) continue;
                    const [username, password, name, isActive] = line.split(',');
                    if (username && password) {
                        toInsert.push({
                            username: username.trim(),
                            password: password.trim(),
                            name: name ? name.trim() : '',
                            isActive: isActive ? isActive.trim() === 'true' : true
                        });
                    }
                }
                if (toInsert.length > 0) {
                    await accountsColl.insertMany(toInsert);
                    console.log(`Migrated ${toInsert.length} accounts to MongoDB.`);
                }
            }
        }

        // 2. Migrate Inventory Price & Stock Updates
        const priceColl = db.collection('inventory_price_updates');
        const priceCount = await priceColl.countDocuments();
        if (priceCount === 0) {
            const priceUpdatesPath = getInventoryUpdatesPath();
            if (fs.existsSync(priceUpdatesPath)) {
                console.log("Migrating inventory price updates to MongoDB...");
                const csvText = fs.readFileSync(priceUpdatesPath, 'utf8');
                const lines = csvText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('sku,'));
                const toInsert = [];
                for (let line of lines) {
                    const parts = line.split(',');
                    if (parts.length >= 2) {
                        toInsert.push({ sku: parts[0], price: parts[1] });
                    }
                }
                if (toInsert.length > 0) {
                    await priceColl.insertMany(toInsert);
                    console.log(`Migrated ${toInsert.length} price updates to MongoDB.`);
                }
            }
        }

        const stockColl = db.collection('inventory_stock_updates');
        const stockCount = await stockColl.countDocuments();
        if (stockCount === 0) {
            const stockUpdatesPath = getInventoryStockUpdatesPath();
            if (fs.existsSync(stockUpdatesPath)) {
                console.log("Migrating inventory stock updates to MongoDB...");
                const csvText = fs.readFileSync(stockUpdatesPath, 'utf8');
                const lines = csvText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('sku,'));
                const toInsert = [];
                for (let line of lines) {
                    const parts = line.split(',');
                    if (parts.length >= 2) {
                        toInsert.push({ sku: parts[0], stock: parts[1] });
                    }
                }
                if (toInsert.length > 0) {
                    await stockColl.insertMany(toInsert);
                    console.log(`Migrated ${toInsert.length} stock updates to MongoDB.`);
                }
            }
        }

        // 3. Migrate Single Catalog Defaults (One-time migration check)
        const defaultsColl = db.collection('catalog_defaults');
        const defaultsCount = await defaultsColl.countDocuments();
        if (defaultsCount === 0) {
            const categories = ['jewellery_set', 'mangalsutras', 'mattress_protection'];
            const toInsert = [];
            for (const cat of categories) {
                const p = getSingleCatalogDefaultsPath(cat);
                if (fs.existsSync(p)) {
                    try {
                        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
                        toInsert.push({ category: cat, defaults: data });
                    } catch (e) {}
                }
            }
            if (toInsert.length > 0) {
                console.log("Migrating single catalog defaults to MongoDB...");
                await defaultsColl.insertMany(toInsert);
                console.log(`Migrated ${toInsert.length} single catalog defaults to MongoDB.`);
            }
        }

        // 4. Migrate Errors (One-time migration check)
        const errorsColl = db.collection('errors');
        const errorsCount = await errorsColl.countDocuments();
        if (errorsCount === 0) {
            const errorsPath = path.join(__dirname, 'errors.json');
            if (fs.existsSync(errorsPath)) {
                try {
                    const errors = JSON.parse(fs.readFileSync(errorsPath, 'utf8'));
                    if (Array.isArray(errors) && errors.length > 0) {
                        console.log("Migrating error logs to MongoDB...");
                        await errorsColl.insertMany(errors);
                        console.log(`Migrated ${errors.length} error logs to MongoDB.`);
                    }
                } catch (e) {}
            }
        }

        // 5. Migrate Return OTPs (One-time migration check)
        const otpsColl = db.collection('return_otps');
        const otpsCount = await otpsColl.countDocuments();
        if (otpsCount === 0) {
            const otpsPath = path.join(__dirname, 'return_otps.json');
            if (fs.existsSync(otpsPath)) {
                try {
                    const otps = JSON.parse(fs.readFileSync(otpsPath, 'utf8'));
                    if (Array.isArray(otps) && otps.length > 0) {
                        console.log("Migrating return OTPs to MongoDB...");
                        await otpsColl.insertMany(otps);
                        console.log(`Migrated ${otps.length} return OTPs to MongoDB.`);
                    }
                } catch (e) {}
            }
        }

        // 6. Migrate Stats (One-time migration check)
        const statsColl = db.collection('stats');
        const statsCount = await statsColl.countDocuments();
        if (statsCount === 0) {
            const statsPath = path.join(__dirname, 'pending_orders_overview_data.json');
            if (fs.existsSync(statsPath)) {
                try {
                    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
                    const toInsert = Object.entries(stats).map(([acc, count]) => ({
                        account: acc,
                        pendingOrders: count,
                        timestamp: new Date().toISOString()
                    }));
                    if (toInsert.length > 0) {
                        console.log("Migrating stats to MongoDB...");
                        await statsColl.insertMany(toInsert);
                        console.log(`Migrated ${toInsert.length} stats to MongoDB.`);
                    }
                } catch (e) {}
            }
        }

        await syncLocalCacheFiles();

    } catch (e) {
        console.error("Failed to initialize database or perform migration:", e.message);
    }
}

// --- API ENDPOINTS ---

// Accounts
app.get('/api/accounts', async (req, res) => {
    try {
        const db = await connectDB();
        const accounts = await db.collection('accounts').find({}).toArray();
        res.json(accounts);
    } catch (e) {
        console.warn("DB query failed, falling back to local accounts.csv", e.message);
        try {
            if (!fs.existsSync(getAccountsPath())) {
                return res.json([]);
            }
            const csv = fs.readFileSync(getAccountsPath(), 'utf8');
            const lines = csv.split('\n').filter(l => l.trim().length > 0);
            let accounts = [];
            for (let line of lines) {
                if (line.startsWith('username,')) continue;
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
        } catch (csvErr) {
            res.status(500).json({ error: csvErr.message });
        }
    }
});

app.post('/api/accounts', async (req, res) => {
    try {
        const { accounts } = req.body;
        if (!Array.isArray(accounts)) {
            return res.status(400).json({ error: 'Accounts should be an array' });
        }

        const db = await connectDB();
        const accountsColl = db.collection('accounts');
        await accountsColl.deleteMany({});
        if (accounts.length > 0) {
            await accountsColl.insertMany(accounts.map(acc => ({
                username: acc.username.trim(),
                password: acc.password.trim(),
                name: acc.name ? acc.name.trim() : '',
                isActive: acc.isActive !== false
            })));
        }

        await syncLocalCacheFiles();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Inventory Price Updates
app.get('/api/inventory-updates', async (req, res) => {
    try {
        const db = await connectDB();
        const updates = await db.collection('inventory_price_updates').find({}).toArray();
        res.json(updates.map(u => ({ sku: u.sku, price: u.price })));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/inventory-updates', async (req, res) => {
    try {
        const { updates } = req.body;
        if (!Array.isArray(updates)) {
            return res.status(400).json({ error: 'Updates should be an array' });
        }

        const db = await connectDB();
        const priceColl = db.collection('inventory_price_updates');

        await priceColl.deleteMany({});
        if (updates.length > 0) {
            const toInsert = updates.map(u => ({ sku: u.sku.trim(), price: u.price }));
            await priceColl.insertMany(toInsert);
        }

        await syncLocalCacheFiles();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Inventory Stock Updates
app.get('/api/inventory-stock-updates', async (req, res) => {
    try {
        const db = await connectDB();
        const updates = await db.collection('inventory_stock_updates').find({}).toArray();
        res.json(updates.map(u => ({ sku: u.sku, stock: u.stock })));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/inventory-stock-updates', async (req, res) => {
    try {
        const { updates } = req.body;
        if (!Array.isArray(updates)) {
            return res.status(400).json({ error: 'Updates should be an array' });
        }

        const db = await connectDB();
        const stockColl = db.collection('inventory_stock_updates');

        await stockColl.deleteMany({});
        if (updates.length > 0) {
            const toInsert = updates.map(u => ({ sku: u.sku.trim(), stock: u.stock }));
            await stockColl.insertMany(toInsert);
        }

        await syncLocalCacheFiles();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Single Catalog Defaults
app.get('/api/single-catalog-defaults', async (req, res) => {
    try {
        const category = req.query.category || 'jewellery_set';
        const db = await connectDB();
        const record = await db.collection('catalog_defaults').findOne({ category });
        if (record) {
            res.json(record.defaults);
        } else {
            res.json({});
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/single-catalog-defaults', async (req, res) => {
    try {
        const category = req.query.category || 'jewellery_set';
        const defaults = req.body;

        const db = await connectDB();
        await db.collection('catalog_defaults').updateOne(
            { category },
            { $set: { defaults } },
            { upsert: true }
        );

        await syncLocalCacheFiles();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Single Catalog Images
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

// File Manager (XLSX Uploads)
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

// Stats (Pending Orders Overview)
app.get('/api/stats', async (req, res) => {
    try {
        const db = await connectDB();
        const stats = await db.collection('stats').find({}).toArray();
        res.json(stats.map(s => ({
            account: s.account,
            pendingOrders: s.pendingOrders
        })));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Errors
app.get('/api/errors', async (req, res) => {
    try {
        const db = await connectDB();
        const errors = await db.collection('errors').find({}).sort({ timestamp: -1 }).toArray();
        res.json(errors.map(({ _id, ...rest }) => rest));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/errors', async (req, res) => {
    try {
        const db = await connectDB();
        await db.collection('errors').deleteMany({});
        await syncLocalCacheFiles();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/errors/:index', async (req, res) => {
    try {
        const index = parseInt(req.params.index, 10);
        const db = await connectDB();
        const errors = await db.collection('errors').find({}).sort({ timestamp: -1 }).toArray();
        if (index >= 0 && index < errors.length) {
            const toRemove = errors[index];
            await db.collection('errors').deleteOne({ _id: toRemove._id });

            if (toRemove.screenshot) {
                const screenshotPath = path.join(getErrorScreenshotsPath(), toRemove.screenshot);
                if (fs.existsSync(screenshotPath)) {
                    fs.unlinkSync(screenshotPath);
                }
            }
            await syncLocalCacheFiles();
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Return OTPs
app.get('/api/return-otps', async (req, res) => {
    try {
        const db = await connectDB();
        const otps = await db.collection('return_otps').find({}).toArray();
        res.json(otps.map(({ _id, ...rest }) => rest));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Scripts List & Management
app.get('/api/scripts', (req, res) => {
    try {
        const files = fs.readdirSync(__dirname);
        const scripts = files.filter(f => f.startsWith('meesho_') && f.endsWith('.js'));

        const scriptInfo = scripts.map(s => {
            let name = s.replace('meesho_', '').replace('.js', '').replace(/_/g, ' ');
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

// Serving built frontend files
app.use(express.static(path.join(__dirname, 'frontend/dist')));
app.get('*any', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/single_catalog_images') || req.path.startsWith('/error_screenshots')) {
        return next();
    }
    res.sendFile(path.join(__dirname, 'frontend/dist', 'index.html'));
});

// Server Listen
const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
    await initializeDB();
});
