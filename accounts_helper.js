const fs = require('fs');
const path = require('path');
const { connectDB } = require('./db');

const SELECTION_FILE = path.join(__dirname, 'selected_accounts.json');

/**
 * Reads the local account selection mapping from selected_accounts.json.
 * Returns null if file doesn't exist or is invalid.
 */
function getLocalSelection() {
    try {
        if (fs.existsSync(SELECTION_FILE)) {
            const raw = fs.readFileSync(SELECTION_FILE, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error("Error reading selected_accounts.json:", e.message);
    }
    return null;
}

/**
 * Saves the local account selection mapping to selected_accounts.json.
 */
function saveLocalSelection(selection) {
    try {
        fs.writeFileSync(SELECTION_FILE, JSON.stringify(selection, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error("Error writing selected_accounts.json:", e.message);
        return false;
    }
}

/**
 * Returns accounts to run.
 * Reads accounts directly from MongoDB.
 * 1. If TARGET_ACCOUNT environment variable is set (supports single username or comma-separated list),
 *    filters accounts to only those targets.
 * 2. If TARGET_ACCOUNT is NOT set, falls back to the local selection in selected_accounts.json.
 */
async function getAccounts(options = {}) {
    try {
        const db = await connectDB();
        let allAccounts = await db.collection('accounts').find({}).toArray();

        if (options && options.all) {
            return allAccounts;
        }

        // 1. If TARGET_ACCOUNT is set, filter for it
        if (process.env.TARGET_ACCOUNT) {
            const rawTargets = process.env.TARGET_ACCOUNT.trim();
            if (rawTargets.toLowerCase() === '__no_accounts_selected__') {
                return [];
            }
            const targets = rawTargets.split(',')
                .map(t => t.trim().toLowerCase())
                .filter(Boolean);

            if (targets.length === 0) {
                return [];
            }
            allAccounts = allAccounts.filter(acc => acc.username && targets.includes(acc.username.trim().toLowerCase()));
            return allAccounts;
        }

        // 2. Fallback to local selection file (selected_accounts.json)
        const localSelection = getLocalSelection();
        if (localSelection) {
            let allowedUsernames = null;
            if (Array.isArray(localSelection)) {
                allowedUsernames = localSelection.map(u => String(u).trim().toLowerCase()).filter(Boolean);
            } else if (typeof localSelection === 'object') {
                allowedUsernames = Object.keys(localSelection)
                    .filter(k => localSelection[k] === true)
                    .map(u => u.trim().toLowerCase());
            }

            if (allowedUsernames !== null) {
                return allAccounts.filter(acc => acc.username && allowedUsernames.includes(acc.username.trim().toLowerCase()));
            }
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
    getAccounts,
    loadAccounts
};
