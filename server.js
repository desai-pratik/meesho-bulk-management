require('dotenv').config();

// Polyfill missing browser globals for pdf-parse
global.DOMMatrix = class DOMMatrix {};
global.ImageData = class ImageData {};
global.Path2D = class Path2D {};

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');
const { connectDB } = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/single_catalog_images', express.static(path.join(__dirname, 'single_catalog_images')));
app.use('/error_screenshots', express.static(path.join(__dirname, 'error_screenshots')));
app.use('/product_images', express.static(path.join(__dirname, 'product_images')));

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
const getProductImagesPath = () => {
    const dir = path.join(__dirname, 'product_images');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
};
const getUploadedPdfsPath = () => {
    const dir = path.join(__dirname, 'uploaded_pdfs');
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
    if (category === 'water_bottles' || category === 'tumbler') {
        return path.join(__dirname, 'single_catalog_water_bottles_defaults.json');
    }
    if (category === 'jugs' || category === 'jug') {
        return path.join(__dirname, 'single_catalog_jugs_defaults.json');
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

// Multer Config for SKU Product Images
const skuImageStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, getProductImagesPath());
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});
const uploadSkuImage = multer({ storage: skuImageStorage });

// Multer Config for Meesho Label PDFs
const pdfStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, getUploadedPdfsPath());
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});
const uploadPdf = multer({ storage: pdfStorage });

// --- DATABASE SYNC & INITIALIZATION LAYER ---



async function initializeDB() {
    try {
        const db = await connectDB();
        console.log("Connected to MongoDB successfully.");

        // Ensure isActive is NOT stored in MongoDB accounts collection (selection is kept locally)
        await db.collection('accounts').updateMany({ isActive: { $exists: true } }, { $unset: { isActive: "" } });

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

        // 3. Migrate Single Catalog Defaults
        const defaultsColl = db.collection('catalog_defaults');
        const categories = ['jewellery_set', 'mangalsutras', 'mattress_protection', 'water_bottles'];
        for (const cat of categories) {
            const exists = await defaultsColl.findOne({ category: cat });
            if (!exists) {
                const p = getSingleCatalogDefaultsPath(cat);
                if (fs.existsSync(p)) {
                    try {
                        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
                        await defaultsColl.updateOne(
                            { category: cat },
                            { $set: { defaults: data } },
                            { upsert: true }
                        );
                        console.log(`Seeded ${cat} single catalog defaults to MongoDB.`);
                    } catch (e) {}
                }
            }
        }

        // 4. Notifications are stored strictly in client localStorage (not in JSON file, not in MongoDB)
        try {
            const legacyErrorsFile = path.join(__dirname, 'errors.json');
            if (fs.existsSync(legacyErrorsFile)) {
                fs.unlinkSync(legacyErrorsFile);
            }
            const errorCols = await db.listCollections({ name: 'errors' }).toArray();
            if (errorCols.length > 0) {
                await db.collection('errors').drop();
                console.log("Dropped legacy errors collection from MongoDB Atlas.");
            }
        } catch (e) { }

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

        // 7. Ensure Indexes for SKU Mapping
        try {
            await db.collection('sku_mappings').createIndex({ sku: 1 }, { unique: true });
            console.log("MongoDB sku_mappings index verified/created.");
        } catch (idxErr) {
            console.warn("Index check failed or already exists:", idxErr.message);
        }



    } catch (e) {
        console.error("Failed to initialize database or perform migration:", e.message);
    }
}

// --- AUTHENTICATION CONFIG & MIDDLEWARE ---

const JWT_SECRET = process.env.JWT_SECRET || 'meesho-sync-hub-secret-key-super-secure';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

// Helper to send email OTP
async function sendOTPEmail(email, otp) {
    if (!SMTP_USER || !SMTP_PASS) {
        console.log(`[AUTH OTP DEV FALLBACK] SMTP is not configured. OTP for ${email} is: ${otp}`);
        return { success: true, fallback: true };
    }

    const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS
        }
    });

    const mailOptions = {
        from: `"Meesho Sync Hub" <${SMTP_USER}>`,
        to: email,
        subject: 'Meesho Sync Hub OTP Verification Code',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0f111a; color: #f8fafc; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08);">
                <h2 style="background: linear-gradient(to right, #6366f1, #ec4899); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-align: center; margin-bottom: 20px;">Meesho Sync Hub</h2>
                <p>Hello,</p>
                <p>Use the following 6-digit verification code to complete your request:</p>
                <div style="text-align: center; margin: 30px 0;">
                    <span style="font-size: 2.5rem; font-weight: bold; letter-spacing: 6px; padding: 10px 20px; background: rgba(255,255,255,0.08); border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); color: #ec4899;">${otp}</span>
                </div>
                <p>This code is valid for 5 minutes. Do not share this code with anyone.</p>
                <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.08); margin: 30px 0;">
                <p style="font-size: 0.8rem; color: #94a3b8; text-align: center;">© 2026 Meesho Sync Hub. All rights reserved.</p>
            </div>
        `
    };

    await transporter.sendMail(mailOptions);
    return { success: true };
}

// JWT Token Authentication Middleware
function authenticateToken(req, res, next) {
    if (
        req.path.startsWith('/auth/') ||
        req.path.startsWith('/api/auth/') ||
        req.path === '/api/notifications/emit' ||
        req.path.startsWith('/error_screenshots')
    ) {
        return next();
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access denied: No token provided' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// Register authentication verification middleware for all api routes
app.use('/api', authenticateToken);

// --- AUTHENTICATION ROUTES ---

// Register User
app.post('/api/auth/register', async (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
        return res.status(400).json({ error: 'All fields (email, password, name) are required' });
    }

    try {
        const db = await connectDB();
        const usersColl = db.collection('users');

        const existingUser = await usersColl.findOne({ email: email.toLowerCase().trim() });
        if (existingUser && existingUser.isVerified) {
            return res.status(400).json({ error: 'User with this email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

        const userData = {
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            name: name.trim(),
            isVerified: false,
            otp,
            otpExpiry,
            createdAt: new Date()
        };

        if (existingUser) {
            await usersColl.updateOne({ email: email.toLowerCase().trim() }, { $set: userData });
        } else {
            await usersColl.insertOne(userData);
        }

        const sendResult = await sendOTPEmail(userData.email, otp);

        res.json({ 
            success: true, 
            message: 'Verification OTP sent to your email',
            fallback: sendResult.fallback || false
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Verify OTP
app.post('/api/auth/verify-otp', async (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) {
        return res.status(400).json({ error: 'Email and OTP are required' });
    }

    try {
        const db = await connectDB();
        const usersColl = db.collection('users');

        const user = await usersColl.findOne({ email: email.toLowerCase().trim() });
        if (!user) {
            return res.status(400).json({ error: 'User not found' });
        }

        if (user.otp !== otp) {
            return res.status(400).json({ error: 'Invalid verification code' });
        }

        if (new Date() > new Date(user.otpExpiry)) {
            return res.status(400).json({ error: 'Verification code has expired' });
        }

        await usersColl.updateOne(
            { email: email.toLowerCase().trim() },
            { 
                $set: { isVerified: true },
                $unset: { otp: "", otpExpiry: "" }
            }
        );

        const token = jwt.sign(
            { email: user.email, name: user.name },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            message: 'Account verified successfully',
            token,
            user: { email: user.email, name: user.name }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    try {
        const db = await connectDB();
        const usersColl = db.collection('users');

        const user = await usersColl.findOne({ email: email.toLowerCase().trim() });
        if (!user) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        if (!user.isVerified) {
            return res.status(400).json({ error: 'Account is not verified. Please register again to get a new code.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign(
            { email: user.email, name: user.name },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            message: 'Logged in successfully',
            token,
            user: { email: user.email, name: user.name }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Resend OTP
app.post('/api/auth/resend-otp', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    try {
        const db = await connectDB();
        const usersColl = db.collection('users');

        const user = await usersColl.findOne({ email: email.toLowerCase().trim() });
        if (!user) {
            return res.status(400).json({ error: 'User not found' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

        await usersColl.updateOne(
            { email: email.toLowerCase().trim() },
            { $set: { otp, otpExpiry } }
        );

        const sendResult = await sendOTPEmail(user.email, otp);

        res.json({ 
            success: true, 
            message: 'Verification OTP sent to your email',
            fallback: sendResult.fallback || false
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Password Reset Request
app.post('/api/auth/reset-password-request', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    try {
        const db = await connectDB();
        const usersColl = db.collection('users');

        const user = await usersColl.findOne({ email: email.toLowerCase().trim() });
        if (!user) {
            return res.status(400).json({ error: 'User with this email does not exist' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

        await usersColl.updateOne(
            { email: email.toLowerCase().trim() },
            { $set: { otp, otpExpiry } }
        );

        const sendResult = await sendOTPEmail(user.email, otp);

        res.json({ 
            success: true, 
            message: 'Password reset OTP sent to your email',
            fallback: sendResult.fallback || false
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Password Reset Confirm
app.post('/api/auth/reset-password-confirm', async (req, res) => {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
        return res.status(400).json({ error: 'Email, OTP, and new password are required' });
    }

    try {
        const db = await connectDB();
        const usersColl = db.collection('users');

        const user = await usersColl.findOne({ email: email.toLowerCase().trim() });
        if (!user) {
            return res.status(400).json({ error: 'User not found' });
        }

        if (user.otp !== otp) {
            return res.status(400).json({ error: 'Invalid reset code' });
        }

        if (new Date() > new Date(user.otpExpiry)) {
            return res.status(400).json({ error: 'Reset code has expired' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await usersColl.updateOne(
            { email: email.toLowerCase().trim() },
            { 
                $set: { password: hashedPassword, isVerified: true },
                $unset: { otp: "", otpExpiry: "" }
            }
        );

        res.json({ success: true, message: 'Password updated successfully. You can now login.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get Current User Profile
app.get('/api/profile', async (req, res) => {
    try {
        const db = await connectDB();
        const usersColl = db.collection('users');
        const user = await usersColl.findOne({ email: req.user.email });
        if (!user) {
            return res.status(404).json({ error: 'User profile not found' });
        }
        res.json({
            success: true,
            user: {
                name: user.name,
                email: user.email,
                createdAt: user.createdAt
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Update Profile
app.post('/api/profile/update', async (req, res) => {
    const { name, password } = req.body;
    try {
        const db = await connectDB();
        const usersColl = db.collection('users');

        const updateData = {};
        if (name && name.trim()) {
            updateData.name = name.trim();
        }
        if (password && password.trim()) {
            if (password.trim().length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters' });
            }
            updateData.password = await bcrypt.hash(password, 10);
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        await usersColl.updateOne(
            { email: req.user.email },
            { $set: updateData }
        );

        // Fetch updated user to return
        const updatedUser = await usersColl.findOne({ email: req.user.email });

        // Generate a new token with updated name
        const token = jwt.sign(
            { email: updatedUser.email, name: updatedUser.name },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            message: 'Profile updated successfully',
            token,
            user: { email: updatedUser.email, name: updatedUser.name }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- API ENDPOINTS ---

// Accounts
app.get('/api/accounts', async (req, res) => {
    try {
        const { getAccounts } = require('./accounts_helper');
        const accounts = await getAccounts({ all: true });
        res.json(accounts);
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch accounts from DB: " + e.message });
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
                name: acc.name ? acc.name.trim() : ''
            })));
        }

        // Clean up any lingering isActive in MongoDB
        await accountsColl.updateMany({ isActive: { $exists: true } }, { $unset: { isActive: "" } });

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

// Helper for parsing inventory Excel
function parseInventoryExcelFile(filePath, mode = 'price') {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];

    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!rows || rows.length === 0) return [];

    let skuColIdx = -1;
    let valColIdx = -1;
    let startRowIdx = 0;

    for (let r = 0; r < Math.min(5, rows.length); r++) {
        const row = rows[r];
        if (!Array.isArray(row)) continue;

        for (let c = 0; c < row.length; c++) {
            const cellStr = String(row[c] || '').trim().toLowerCase();
            if (skuColIdx === -1 && (cellStr.includes('sku') || cellStr.includes('style') || cellStr.includes('item') || cellStr.includes('product') || cellStr.includes('code'))) {
                skuColIdx = c;
            }
            if (valColIdx === -1) {
                if (mode === 'price') {
                    if (cellStr.includes('price') || cellStr.includes('mrp') || cellStr.includes('rate') || cellStr.includes('cost') || cellStr.includes('amount') || cellStr.includes('₹')) {
                        valColIdx = c;
                    }
                } else {
                    if (cellStr.includes('stock') || cellStr.includes('qty') || cellStr.includes('quantity') || cellStr.includes('count') || cellStr.includes('unit') || cellStr.includes('inventory')) {
                        valColIdx = c;
                    }
                }
            }
        }

        if (skuColIdx !== -1 && valColIdx !== -1) {
            startRowIdx = r + 1;
            break;
        }
    }

    if (skuColIdx === -1) skuColIdx = 0;
    if (valColIdx === -1) valColIdx = (skuColIdx === 0 ? 1 : 0);

    const results = [];
    const seen = new Set();
    for (let r = startRowIdx; r < rows.length; r++) {
        const row = rows[r];
        if (!Array.isArray(row) || row.length === 0) continue;

        let rawSku = String(row[skuColIdx] || '').trim();
        let rawVal = row[valColIdx];

        if (!rawSku) continue;
        const lowerSku = rawSku.toLowerCase();
        if (lowerSku === 'sku' || lowerSku === 'style id' || lowerSku === 'style_id' || lowerSku === 'item' || lowerSku === 'product sku') {
            continue;
        }

        let cleanedVal = String(rawVal !== undefined && rawVal !== null ? rawVal : '').trim();
        cleanedVal = cleanedVal.replace(/[₹$,\s]/g, '');
        if (cleanedVal === '' || isNaN(Number(cleanedVal))) continue;

        const numVal = Math.round(Number(cleanedVal));
        if (numVal < 0) continue;

        if (!seen.has(rawSku)) {
            seen.add(rawSku);
            results.push({
                sku: rawSku,
                [mode === 'price' ? 'price' : 'stock']: String(numVal)
            });
        }
    }
    return results;
}

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
            const toInsert = updates.map(u => ({ sku: u.sku.trim(), price: String(u.price) }));
            await priceColl.insertMany(toInsert);
        }

        res.json({ success: true, count: updates.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/inventory-updates/upload-excel', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No Excel file uploaded' });
        }

        const items = parseInventoryExcelFile(req.file.path, 'price');
        const append = req.query.append === 'true';

        const db = await connectDB();
        const priceColl = db.collection('inventory_price_updates');

        if (!append) {
            await priceColl.deleteMany({});
            if (items.length > 0) {
                await priceColl.insertMany(items);
            }
        } else {
            for (const item of items) {
                await priceColl.updateOne(
                    { sku: item.sku },
                    { $set: item },
                    { upsert: true }
                );
            }
        }

        res.json({
            success: true,
            message: `Excel uploaded and processed successfully. ${items.length} items parsed.`,
            count: items.length,
            items: items
        });
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
            const toInsert = updates.map(u => ({ sku: u.sku.trim(), stock: String(u.stock) }));
            await stockColl.insertMany(toInsert);
        }

        res.json({ success: true, count: updates.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/inventory-stock-updates/upload-excel', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No Excel file uploaded' });
        }

        const items = parseInventoryExcelFile(req.file.path, 'stock');
        const append = req.query.append === 'true';

        const db = await connectDB();
        const stockColl = db.collection('inventory_stock_updates');

        if (!append) {
            await stockColl.deleteMany({});
            if (items.length > 0) {
                await stockColl.insertMany(items);
            }
        } else {
            for (const item of items) {
                await stockColl.updateOne(
                    { sku: item.sku },
                    { $set: item },
                    { upsert: true }
                );
            }
        }

        res.json({
            success: true,
            message: `Excel uploaded and processed successfully. ${items.length} items parsed.`,
            count: items.length,
            items: items
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Inventory Excel Upload (Price)
app.post('/api/inventory-updates/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const filePath = req.file.path;
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        const parsed = [];
        for (const row of rows) {
            // Accept headers case-insensitively
            const sku = (row['SKU'] || row['sku'] || row['Style ID'] || row['style_id'] || row['StyleID'] || '').toString().trim();
            const price = (row['Price'] || row['price'] || row['New Price'] || row['MRP'] || row['mrp'] || '').toString().trim();
            if (sku && price) {
                parsed.push({ sku, price: Number(price) });
            }
        }

        // Clean up uploaded file
        fs.unlink(filePath, () => {});

        res.json({ success: true, count: parsed.length, rows: parsed });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Inventory Excel Upload (Stock)
app.post('/api/inventory-stock-updates/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const filePath = req.file.path;
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        const parsed = [];
        for (const row of rows) {
            const sku = (row['SKU'] || row['sku'] || row['Style ID'] || row['style_id'] || row['StyleID'] || '').toString().trim();
            const stock = (row['Stock'] || row['stock'] || row['Quantity'] || row['quantity'] || row['qty'] || row['QTY'] || '').toString().trim();
            if (sku && stock) {
                parsed.push({ sku, stock: Number(stock) });
            }
        }

        // Clean up uploaded file
        fs.unlink(filePath, () => {});

        res.json({ success: true, count: parsed.length, rows: parsed });
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
        if (record && record.defaults) {
            res.json(record.defaults);
        } else {
            const p = getSingleCatalogDefaultsPath(category);
            if (fs.existsSync(p)) {
                try {
                    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
                    res.json(data);
                } catch (err) {
                    res.json({});
                }
            } else {
                res.json({});
            }
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

// --- PRODUCT SKU IMAGES API ---
app.get('/api/sku-images', async (req, res) => {
    try {
        const db = await connectDB();
        const images = await db.collection('product_images').find({}).toArray();
        res.json(images);
    } catch (e) {
        try {
            const dir = getProductImagesPath();
            const files = fs.readdirSync(dir);
            const list = files.map(file => {
                const sku = path.parse(file).name;
                return {
                    sku,
                    filename: file,
                    url: `/product_images/${file}`
                };
            });
            res.json(list);
        } catch (err) {
            res.status(500).json({ error: e.message });
        }
    }
});

app.post('/api/sku-images', uploadSkuImage.array('files'), async (req, res) => {
    try {
        const db = await connectDB();
        const collection = db.collection('product_images');
        const results = [];
        
        for (let file of req.files) {
            const sku = path.parse(file.originalname).name.trim();
            const filename = file.filename;
            const url = `/product_images/${filename}`;
            const record = {
                sku,
                filename,
                url,
                uploadDate: new Date()
            };
            
            await collection.updateOne(
                { sku },
                { $set: record },
                { upsert: true }
            );
            results.push(record);
        }
        
        res.json({ success: true, message: 'SKU images uploaded successfully', files: results });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/sku-images/:sku', async (req, res) => {
    try {
        const { sku } = req.params;
        const db = await connectDB();
        const collection = db.collection('product_images');
        
        const record = await collection.findOne({ sku });
        if (record) {
            const filepath = path.join(getProductImagesPath(), record.filename);
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath);
            }
            await collection.deleteOne({ sku });
            res.json({ success: true, message: 'SKU image deleted' });
        } else {
            const dir = getProductImagesPath();
            const files = fs.readdirSync(dir);
            const foundFile = files.find(f => path.parse(f).name === sku);
            if (foundFile) {
                fs.unlinkSync(path.join(dir, foundFile));
                res.json({ success: true, message: 'SKU image file deleted' });
            } else {
                res.status(404).json({ error: 'SKU image not found' });
            }
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- MEESHO ORDER PDFS API ---
app.get('/api/order-pdfs', async (req, res) => {
    try {
        const db = await connectDB();
        const dir = getUploadedPdfsPath();
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const files = fs.readdirSync(dir);
        
        const list = [];
        for (let file of files) {
            const stats = fs.statSync(path.join(dir, file));
            const count = await db.collection('order_labels').countDocuments({ pdfName: file });
            list.push({
                name: file,
                size: stats.size,
                uploadDate: stats.mtime,
                ordersCount: count
            });
        }
        res.json(list);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/order-pdfs', uploadPdf.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No PDF file uploaded' });
        }
        
        const db = await connectDB();
        const collection = db.collection('order_labels');
        const pdfPath = req.file.path;
        const filename = req.file.filename;
        const dataBuffer = fs.readFileSync(pdfPath);
        const parser = new pdfParse.PDFParse({ data: dataBuffer });
        const result = await parser.getText();
        await parser.destroy();
        
        const pages = result.pages || [];
        
        let successCount = 0;
        let errors = [];
        const bulkOps = [];
        
        for (let page of pages) {
            const text = page.text;
            const pageNum = page.num;
            const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
            
            let orderId = '';
            const orderMatch = text.match(/\b(3\d{14,17}(?:_\d+)?)\b/);
            if (orderMatch) {
                orderId = orderMatch[1];
            }
            
            let awb = '';
            const awbMatch = text.match(/\b(VL\d{10,14}|SF\w{8,12})\b/i);
            if (awbMatch) {
                awb = awbMatch[1];
            } else {
                const numericMatches = text.matchAll(/\b(\d{10,15})\b/g);
                for (const match of numericMatches) {
                    const val = match[1];
                    if (!orderId || (!orderId.includes(val) && !val.includes(orderId))) {
                        awb = val;
                        break;
                    }
                }
            }
            
            if (!awb) {
                for (let line of lines) {
                    const clean = line.replace(/\s+/g, '');
                    if (/^VL\d{11}$/i.test(clean)) {
                        awb = clean.toUpperCase();
                        break;
                    }
                    if (/^\d{10,15}$/.test(clean) && (!orderId || !orderId.startsWith(clean))) {
                        awb = clean;
                        break;
                    }
                }
            }
            
            let sku = '';
            const skuHeaderIndex = lines.findIndex(l => {
                const up = l.toUpperCase();
                return up.includes('SKU') && (up.includes('SIZE') || up.includes('ORDER'));
            });
            if (skuHeaderIndex !== -1 && skuHeaderIndex < lines.length - 1) {
                const nextLine = lines[skuHeaderIndex + 1];
                sku = nextLine.split(/\s+/)[0];
            }
            
            let customerName = '';
            const custIndex = lines.findIndex(l => l.toLowerCase().includes('customer address'));
            if (custIndex !== -1 && custIndex < lines.length - 1) {
                customerName = lines[custIndex + 1];
            }
            
            if (orderId || awb) {
                const cleanAwb = awb.trim();
                const cleanOrderId = orderId.trim();
                const cleanSku = sku.trim();
                const cleanName = customerName.trim();
                
                bulkOps.push({
                    updateOne: {
                        filter: { orderId: cleanOrderId },
                        update: {
                            $set: {
                                awb: cleanAwb || cleanOrderId,
                                orderId: cleanOrderId,
                                sku: cleanSku,
                                customerName: cleanName || 'Unknown Customer',
                                pdfName: filename,
                                uploadDate: new Date()
                            }
                        },
                        upsert: true
                    }
                });
                successCount++;
            } else {
                errors.push(`Page ${pageNum}: Could not find Order No or AWB barcode.`);
            }
        }
        
        if (bulkOps.length > 0) {
            await collection.bulkWrite(bulkOps, { ordered: false });
        }
        
        res.json({
            success: true,
            message: `Parsed PDF successfully. Imported ${successCount} orders.`,
            filename: filename,
            importedCount: successCount,
            errorsCount: errors.length,
            errors: errors
        });
        
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/order-pdfs/:filename', async (req, res) => {
    try {
        const { filename } = req.params;
        const sanitized = path.basename(filename);
        const filepath = path.join(getUploadedPdfsPath(), sanitized);
        
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
        }
        
        const db = await connectDB();
        await db.collection('order_labels').deleteMany({ pdfName: sanitized });
        
        res.json({ success: true, message: 'PDF and associated orders deleted successfully' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- BARCODE LOOKUP API ---
app.get('/api/lookup-barcode', async (req, res) => {
    try {
        const { barcode } = req.query;
        if (!barcode) {
            return res.status(400).json({ error: 'Barcode parameter is required' });
        }
        
        const db = await connectDB();
        const cleanBarcode = barcode.trim();
        
        const order = await db.collection('order_labels').findOne({
            $or: [
                { awb: cleanBarcode },
                { orderId: cleanBarcode },
                { awb: { $regex: cleanBarcode, $options: 'i' } },
                { orderId: { $regex: cleanBarcode, $options: 'i' } }
            ]
        });
        
        if (!order) {
            return res.status(404).json({ error: 'Order not found for scanned barcode' });
        }
        
        // Find mapped design name (if any)
        const mapping = await db.collection('sku_mappings').findOne({ sku: order.sku });
        const designName = mapping ? mapping.designName : order.sku;
        
        // Find matching image (using designName first, fallback to raw sku)
        let skuImage = null;
        
        // Try searching product_images collection by designName
        skuImage = await db.collection('product_images').findOne({ 
            sku: { $regex: new RegExp(`^${designName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i') } 
        });
        
        // Fallback: search product_images collection by raw sku (if different from designName)
        if (!skuImage && designName !== order.sku) {
            skuImage = await db.collection('product_images').findOne({ 
                sku: { $regex: new RegExp(`^${order.sku.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i') } 
            });
        }
        
        // Try searching filesystem by designName or raw sku
        if (!skuImage) {
            const dir = getProductImagesPath();
            if (fs.existsSync(dir)) {
                const files = fs.readdirSync(dir);
                // Try finding by designName
                let foundFile = files.find(f => path.parse(f).name.toLowerCase() === designName.toLowerCase());
                // Fallback to raw sku
                if (!foundFile && designName !== order.sku) {
                    foundFile = files.find(f => path.parse(f).name.toLowerCase() === order.sku.toLowerCase());
                }
                
                if (foundFile) {
                    skuImage = {
                        sku: designName,
                        filename: foundFile,
                        url: `/product_images/${foundFile}`
                    };
                }
            }
        }
        
        res.json({
            success: true,
            order: {
                ...order,
                designName: mapping ? mapping.designName : ''
            },
            skuImage: skuImage || null
        });
        
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- SKU MAPPINGS EXCEL API ---
app.post('/api/sku-mappings', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No Excel file uploaded' });
        }
        
        const db = await connectDB();
        const collection = db.collection('sku_mappings');
        
        const workbook = XLSX.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        
        // Convert sheet to row arrays [ [sku, designName], [sku, designName] ]
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        const bulkOps = [];
        const batchSize = 50000;
        let importedCount = 0;
        
        for (let row of rows) {
            if (!Array.isArray(row) || row.length === 0) continue;
            
            const sku = String(row[0] || '').trim();
            const designName = String(row[1] || '').trim();
            
            if (sku && designName && sku.toLowerCase() !== 'sku') {
                bulkOps.push({
                    updateOne: {
                        filter: { sku: sku },
                        update: {
                            $set: {
                                sku: sku,
                                designName: designName,
                                updatedAt: new Date()
                            }
                        },
                        upsert: true
                    }
                });
            }
        }
        
        // Execute bulkWrite in batches
        for (let i = 0; i < bulkOps.length; i += batchSize) {
            const batch = bulkOps.slice(i, i + batchSize);
            await collection.bulkWrite(batch, { ordered: false });
            importedCount += batch.length;
        }
        
        // Store upload stats
        await db.collection('mapping_stats').updateOne(
            { name: 'last_import' },
            {
                $set: {
                    filename: req.file.originalname,
                    importedCount: importedCount,
                    uploadDate: new Date()
                }
            },
            { upsert: true }
        );
        
        res.json({
            success: true,
            message: `Successfully parsed spreadsheet. Imported/Updated ${importedCount} SKU mappings.`,
            importedCount
        });
        
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/sku-mappings/stats', async (req, res) => {
    try {
        const db = await connectDB();
        const totalMappings = await db.collection('sku_mappings').countDocuments();
        const lastImport = await db.collection('mapping_stats').findOne({ name: 'last_import' });
        res.json({
            totalMappings,
            lastImport: lastImport || null
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/sku-mappings/search', async (req, res) => {
    try {
        const { q, page = 1, limit = 20 } = req.query;
        const db = await connectDB();
        
        const query = {};
        if (q) {
            query.$or = [
                { sku: { $regex: q, $options: 'i' } },
                { designName: { $regex: q, $options: 'i' } }
            ];
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await db.collection('sku_mappings').countDocuments(query);
        const mappings = await db.collection('sku_mappings')
            .find(query)
            .skip(skip)
            .limit(parseInt(limit))
            .toArray();
            
        res.json({
            mappings,
            total,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/parsed-orders', async (req, res) => {
    try {
        const db = await connectDB();
        const orders = await db.collection('order_labels').find({}).sort({ uploadDate: -1 }).toArray();
        res.json(orders);
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

// Notifications (Stored strictly in client localStorage, zero JSON file on disk, zero DB storage)
app.post('/api/notifications/emit', (req, res) => {
    try {
        const notif = req.body;
        if (notif && typeof notif === 'object') {
            io.emit('notification', notif);
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

// Proxy Settings (persisted in MongoDB so Render deployments can route through an Indian proxy without redeploying)
app.get('/api/proxy-settings', async (req, res) => {
    try {
        const db = await connectDB();
        const doc = await db.collection('settings').findOne({ key: 'proxy' });
        res.json({
            server: (doc && doc.server) || process.env.PROXY_SERVER || '',
            username: (doc && doc.username) || process.env.PROXY_USERNAME || '',
            password: (doc && doc.password) || process.env.PROXY_PASSWORD || ''
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/proxy-settings', async (req, res) => {
    try {
        const { server = '', username = '', password = '' } = req.body || {};
        const db = await connectDB();
        await db.collection('settings').updateOne(
            { key: 'proxy' },
            {
                $set: {
                    key: 'proxy',
                    server: String(server).trim(),
                    username: String(username).trim(),
                    password: String(password).trim(),
                    updatedAt: new Date()
                }
            },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/run/:scriptName', async (req, res) => {
    const { scriptName } = req.params;
    const { account, selectedAccounts } = req.body || {};

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

        // Inject saved proxy settings from MongoDB if present
        try {
            const db = await connectDB();
            const proxyDoc = await db.collection('settings').findOne({ key: 'proxy' });
            if (proxyDoc && proxyDoc.server) {
                env.PROXY_SERVER = proxyDoc.server;
                if (proxyDoc.username) env.PROXY_USERNAME = proxyDoc.username;
                if (proxyDoc.password) env.PROXY_PASSWORD = proxyDoc.password;
            }
        } catch (e) {}

        if (account) {
            env.TARGET_ACCOUNT = String(account).trim();
        } else if (selectedAccounts !== undefined) {
            if (Array.isArray(selectedAccounts)) {
                env.TARGET_ACCOUNT = selectedAccounts.length > 0
                    ? selectedAccounts.map(a => String(a).trim()).filter(Boolean).join(',')
                    : '__NO_ACCOUNTS_SELECTED__';
            } else if (typeof selectedAccounts === 'string' && selectedAccounts.trim()) {
                env.TARGET_ACCOUNT = selectedAccounts.trim();
            }
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
            if (message && message.type === 'notification') {
                io.emit('notification', message.data);
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
        try {
            proc.child.kill('SIGTERM');
            setTimeout(() => {
                try {
                    if (proc.child.exitCode === null) {
                        proc.child.kill('SIGKILL');
                    }
                } catch (e) {}
            }, 1500);
        } catch (e) {}
        activeProcesses.delete(scriptName);
        io.emit('log', { script: scriptName, type: 'system', message: 'Process stopped by user' });
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
server.listen(PORT, '0.0.0.0', async () => {
    console.log(`Backend server running on http://0.0.0.0:${PORT}`);
    // Auto-start virtual X display on Linux if not already running
    if (process.platform === 'linux') {
        try {
            const { execSync, spawn } = require('child_process');
            execSync('which Xvfb', { stdio: 'ignore' });
            if (!fs.existsSync('/tmp/.X11-unix/X99')) {
                try { fs.unlinkSync('/tmp/.X99-lock'); } catch (e) {}
                const xvfb = spawn('Xvfb', [':99', '-screen', '0', '1920x1080x24', '-ac', '-nolisten', 'tcp'], {
                    detached: true,
                    stdio: 'ignore'
                });
                xvfb.unref();
            }
            process.env.DISPLAY = ':99';
            console.log('Virtual X display started via Xvfb on DISPLAY=:99');
        } catch (e) {
            console.warn('Xvfb not available on host:', e.message);
        }
    }
    await initializeDB();
});
