// database/init.js - Initialize SQLite Database with System Users
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'scheduler.db');

// Check if database already exists and has data
if (fs.existsSync(dbPath)) {
  console.log('📦 Database file exists, checking if initialized...');
  const db = new Database(dbPath);
  
  try {
    const adminExists = db.prepare('SELECT COUNT(*) as count FROM users WHERE username = ?').get('admin');
    if (adminExists && adminExists.count > 0) {
      console.log('✅ Database already initialized with admin user');
      console.log('   Skipping initialization to preserve existing data');
      db.close();
      process.exit(0);
    }
  } catch (err) {
    console.log('⚠️  Database exists but appears empty or corrupted, reinitializing...');
    db.close();
    fs.unlinkSync(dbPath);
  }
}

const db = new Database(dbPath);
console.log('📦 Creating new database...');

// Read and execute schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);
console.log('✅ Schema created');

// Hash password function
const hashPassword = (password) => bcrypt.hashSync(password, 10);

// SYSTEM USER 1: Admin (System Administrator)
db.prepare(`
  INSERT INTO users (username, password, full_name, role, job_title, tile_color, text_color, must_change_password, is_approved, is_active)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  'admin',
  hashPassword('password123'),
  'System Administrator',
  'admin',
  'Admin',
  '#dce8ff',
  'black',
  0, // Don't force password change
  1, // Approved
  1  // Active
);
console.log('✅ System Administrator created (username: admin, password: password123)');

// SYSTEM USER 2: Open Shift Placeholder (NOT assignable, NOT countable)
db.prepare(`
  INSERT INTO users (username, password, full_name, role, job_title, tile_color, text_color, must_change_password, is_approved, is_active)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  '_open',
  hashPassword(Math.random().toString()), // Random unguessable password
  'Open Shift',
  'system',
  'Open Shift',
  '#f5f5f5',
  '#666',
  0, // No password change needed (can't login anyway)
  1, // Approved
  0  // INACTIVE - cannot login
);
console.log('✅ Open Shift placeholder created (system user, no hours counted)');

db.close();
console.log('\n🎉 Database initialization complete!\n');
console.log('📝 System users created:');
console.log('   - admin / password123 (System Administrator)');
console.log('   - _open (Open Shift placeholder - not assignable)\n');
console.log('📝 You can now add your staff members through the admin interface\n');
