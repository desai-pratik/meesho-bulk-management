const fs = require('fs');
const path = require('path');
const { connectDB } = require('./db');

const SELECTION_FILE = path.join(__dirname, 'selected_accounts.json');

function getLocalSelection() {
    try {
        if (fs.existsSync(SELECTION_FILE)) {
            const data = fs.readFileSync(SELECTION_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("Error reading selected_accounts.json:", e.message);
    }
    return {};
}

function saveLocalSelection(selectionMap) {
    try {
        fs.writeFileSync(SELECTION_FILE, JSON.stringify(selectionMap, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error("Error writing selected_accounts.json:", e.message);
        return false;
    }
}

function updateLocalAccountSelection(username, isSelected) {
    const current = getLocalSelection();
    current[username] = Boolean(isSelected);
    return saveLocalSelection(current);
}

/**
 * Returns accounts to run. By default, only returns accounts that are selected locally
 * and match TARGET_ACCOUNT if specified.
 */
async function getAccounts(options = {}) {
    try {
        const db = await connectDB();
        let allAccounts = await db.collection('accounts').find({}).toArray();
        const selection = getLocalSelection();

        if (options.all) {
            // Return all accounts with isActive attached from local selection
            return allAccounts.map(acc => ({
                ...acc,
                isActive: selection[acc.username] !== false
            }));
        }

        // Filter only locally selected accounts
        allAccounts = allAccounts.filter(acc => selection[acc.username] !== false);

        // If TARGET_ACCOUNT is set, filter for it (supports single username or comma-separated list of accounts)
        if (process.env.TARGET_ACCOUNT) {
            const targets = process.env.TARGET_ACCOUNT.split(',').map(t => t.trim().toLowerCase());
            allAccounts = allAccounts.filter(acc => targets.includes(acc.username.toLowerCase()));
        }

        return allAccounts;
    } catch (e) {
        console.error("Error fetching accounts:", e.message);
        return [];
    }
}

// Alias for loadAccounts
const loadAccounts = getAccounts;

module.exports = {
    SELECTION_FILE,
    getLocalSelection,
    saveLocalSelection,
    updateLocalAccountSelection,
    getAccounts,
    loadAccounts
};

