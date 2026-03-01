const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

const dbPath = process.env.DATABASE_PATH || '/app/database/scheduler.db';
const db = new Database(dbPath);

console.log('🔧 Initializing database...');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    full_name TEXT,
    role TEXT DEFAULT 'staff',
    job_title TEXT,
    tile_color TEXT DEFAULT '#f5f5f5',
    text_color TEXT DEFAULT 'black',
    email TEXT,
    phone TEXT,
    telegram_id TEXT,
    is_approved INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    must_change_password INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    shift_type TEXT NOT NULL,
    assigned_to INTEGER REFERENCES users(id),
    is_open INTEGER DEFAULT 0,
    is_preliminary INTEGER DEFAULT 0,
    notes TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS shift_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id INTEGER NOT NULL,
    requester_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    admin_note TEXT,
    approved_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS trade_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_shift_id INTEGER NOT NULL,
    target_shift_id INTEGER NOT NULL,
    requester_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    requester_approved INTEGER DEFAULT 0,
    target_approved INTEGER DEFAULT 0,
    admin_approved INTEGER DEFAULT 0,
    requester_note TEXT,
    target_note TEXT,
    admin_note TEXT,
    status TEXT DEFAULT 'pending',
    approved_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS time_off_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL,
    request_type TEXT,
    shift_id INTEGER,
    start_date TEXT,
    end_date TEXT,
    reason TEXT,
    status TEXT DEFAULT 'pending',
    admin_note TEXT,
    approved_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS absences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    reported_by INTEGER NOT NULL,
    reason TEXT,
    reported_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log('✅ Tables created');

// Create admin user
async function createAdmin() {
  const hashedPassword = await bcrypt.hash('admin123', 10);
  
  db.prepare(`
    INSERT OR REPLACE INTO users (id, username, password, full_name, role, job_title, must_change_password)
    VALUES (1, ?, ?, ?, ?, ?, ?)
  `).run('admin', hashedPassword, 'System Admin', 'admin', 'Admin', 0);
  
  console.log('✅ Admin user created (username: admin, password: admin123)');
  
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password, full_name, role)
    VALUES (2, '_open', 'no-login', 'Open Shift', 'system')
  `).run();
  
  console.log('✅ System users created');
  
  db.prepare(`
    INSERT OR REPLACE INTO settings (key, value)
    VALUES ('timezone', 'America/Chicago')
  `).run();
  
  console.log('✅ Settings created');
  console.log('🎉 Database initialization complete!');
  db.close();
}

createAdmin().then(() => process.exit(0)).catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
