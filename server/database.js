// Database singleton - shared across all modules
const Database = require('better-sqlite3');
const path = require('path');

// Railway persistent volume path
const DB_PATH = process.env.DATABASE_PATH || '/app/database/scheduler.db';
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

console.log('✅ Database module loaded:', DB_PATH);

module.exports = db;
