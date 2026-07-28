const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://pratikdesai2274_db_user:EzWjY6aVqJC9jiLW@cluster0.v127c7y.mongodb.net/?appName=Cluster0";

let client = null;
let db = null;

async function connectDB() {
    if (db) return db;
    if (!client) {
        client = new MongoClient(MONGODB_URI);
        await client.connect();
    }
    db = client.db('meesho_bulk_management');
    return db;
}

module.exports = { connectDB, MONGODB_URI };
