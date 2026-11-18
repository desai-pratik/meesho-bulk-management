const { connectDB } = require('./db');

/**
 * Returns accounts to run.
 * Reads accounts directly from MongoDB.
 * If TARGET_ACCOUNT environment variable is set (supports single username or comma-separated list),
 * filters accounts to only those targets.
 */
async function getAccounts(options = {}) {
    try {
        const db = await connectDB();
        let allAccounts = await db.collection('accounts').find({}).toArray();

        if (options && options.all) {
            return allAccounts;
        }

        // If TARGET_ACCOUNT is set, filter for it (supports single username or comma-separated list of accounts)
        if (process.env.TARGET_ACCOUNT) {
            const targets = process.env.TARGET_ACCOUNT.split(',')
                .map(t => t.trim().toLowerCase())
                .filter(Boolean);

            if (targets.includes('__no_accounts_selected__') || targets.length === 0) {
                return [];
            }
            allAccounts = allAccounts.filter(acc => acc.username && targets.includes(acc.username.trim().toLowerCase()));
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
    getAccounts,
    loadAccounts
};
