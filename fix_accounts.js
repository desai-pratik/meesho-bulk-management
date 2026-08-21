const fs = require('fs');
const path = require('path');

const getAccountsReplacement = `async function getAccounts() {
    try {
        const { connectDB } = require('./db');
        const db = await connectDB();
        const accounts = await db.collection('accounts').find({ isActive: true }).toArray();
        return accounts;
    } catch (e) {
        console.error("Error fetching accounts from DB:", e.message);
        return [];
    }
}`;

const loadAccountsReplacement = `async function loadAccounts() {
    try {
        const { connectDB } = require('./db');
        const db = await connectDB();
        let allAccounts = await db.collection('accounts').find({ isActive: true }).toArray();

        // If TARGET_ACCOUNT is set, filter for it (supports comma-separated list of accounts)
        if (process.env.TARGET_ACCOUNT) {
            const targets = process.env.TARGET_ACCOUNT.split(',').map(t => t.trim());
            allAccounts = allAccounts.filter(acc => targets.includes(acc.username));
        }

        return allAccounts;
    } catch (e) {
        console.error("Error fetching accounts from DB:", e.message);
        return [];
    }
}`;

const files = fs.readdirSync(__dirname).filter(f => f.startsWith('meesho_') && f.endsWith('.js'));

for (let file of files) {
    const filePath = path.join(__dirname, file);
    let content = fs.readFileSync(filePath, 'utf8');

    // Replace function getAccounts() { ... }
    content = content.replace(/function getAccounts\(\) \{[\s\S]+?return \[\];\r?\n\s*\}\r?\n\}/, getAccountsReplacement);
    
    // Replace async function getAccounts() { ... } (if already async)
    content = content.replace(/async function getAccounts\(\) \{[\s\S]+?return \[\];\r?\n\s*\}\r?\n\}/, getAccountsReplacement);
    
    // Replace async function loadAccounts() { ... }
    content = content.replace(/async function loadAccounts\(\) \{[\s\S]+?return \[\];\r?\n\s*\}\r?\n\}/, loadAccountsReplacement);

    // Replace the call if not already awaited
    content = content.replace(/const accounts = getAccounts\(\);/g, 'const accounts = await getAccounts();');
    
    // Remove the ACCOUNTS_FILE const
    content = content.replace(/const ACCOUNTS_FILE = path\.join\(__dirname, 'accounts\.csv'\);\r?\n?/g, '');
    content = content.replace(/const ACCOUNTS_FILE = 'accounts\.csv';\r?\n?/g, '');

    fs.writeFileSync(filePath, content, 'utf8');
    console.log("Processed " + file);
}
