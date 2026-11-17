const fs = require('fs');
const path = require('path');

const getAccountsReplacement = `async function getAccounts() {
    try {
        const { getAccounts } = require('./accounts_helper');
        return await getAccounts();
    } catch (e) {
        console.error("Error fetching accounts:", e.message);
        return [];
    }
}`;

const loadAccountsReplacement = `async function loadAccounts() {
    try {
        const { loadAccounts } = require('./accounts_helper');
        return await loadAccounts();
    } catch (e) {
        console.error("Error fetching accounts:", e.message);
        return [];
    }
}`;

const files = fs.readdirSync(__dirname).filter(f => f.startsWith('meesho_') && f.endsWith('.js'));

for (let file of files) {
    const filePath = path.join(__dirname, file);
    let content = fs.readFileSync(filePath, 'utf8');

    // Replace function getAccounts() { ... }
    content = content.replace(/(?:async\s+)?function\s+getAccounts\s*\([^)]*\)\s*\{[\s\S]*?return\s+\[\];\s*\}\s*\}/, getAccountsReplacement);
    
    // Replace async function loadAccounts() { ... }
    content = content.replace(/(?:async\s+)?function\s+loadAccounts\s*\([^)]*\)\s*\{[\s\S]*?return\s+\[\];\s*\}\s*\}/, loadAccountsReplacement);

    fs.writeFileSync(filePath, content, 'utf8');
    console.log("Processed " + file);
}
