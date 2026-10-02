const Database = require("better-sqlite3");

const db = new Database("licenses.db");

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key TEXT UNIQUE NOT NULL,
    customer TEXT NOT NULL,
    type TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    max_activations INTEGER DEFAULT 1,
    activations INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TEXT NOT NULL
  );
`);

module.exports = db;