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
    const adminExists = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('admin');
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

// Helper function to hash passwords
const hashPassword = (password) => bcrypt.hashSync(password, 10);

// Insert admin user
db.prepare(`
  INSERT INTO users (username, password, full_name, role, job_title, tile_color, text_color, must_change_password, is_approved)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  'admin',
  hashPassword('password123'),
  'Admin User',
  'admin',
  'Administrator',
  '#dce8ff',
  'black',
  0,
  1
);
console.log('✅ Admin user created (username: admin, password: password123)');

// Insert Open Shift placeholder
db.prepare(`
  INSERT INTO users (username, password, full_name, role, job_title, tile_color, text_color, must_change_password, is_approved, is_active)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  '_open',
  hashPassword(Math.random().toString()),
  'Open Shift',
  'system',
  'Open Shift',
  '#f5f5f5',
  'black',
  0,
  1,
  0
);
console.log('✅ Open shift placeholder created');

console.log('\n🎉 Database initialization complete!\n');
console.log('📝 You can now add your staff members through the admin interface\n');

db.close();
