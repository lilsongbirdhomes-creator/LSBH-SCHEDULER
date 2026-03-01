require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

// Initialize database
const dbPath = process.env.DATABASE_PATH || '/app/database/scheduler.db';
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
console.log('✅ Database connected:', dbPath);

// ── Auto-initialize if tables don't exist ────────────────────────────────
async function initializeDatabase() {
  try {
    // Check if users table exists
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='users'
    `).get();
    
    if (!tableExists) {
      console.log('🔧 First run detected - initializing database...');
      
      // Create all tables
      db.exec(`
        CREATE TABLE users (
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

        CREATE TABLE shifts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          shift_type TEXT NOT NULL,
          assigned_to INTEGER,
          is_open INTEGER DEFAULT 0,
          is_preliminary INTEGER DEFAULT 0,
          notes TEXT,
          created_by INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE shift_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          shift_id INTEGER NOT NULL,
          requester_id INTEGER NOT NULL,
          status TEXT DEFAULT 'pending',
          admin_note TEXT,
          approved_by INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE trade_requests (
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

        CREATE TABLE time_off_requests (
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

        CREATE TABLE absences (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          shift_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          reported_by INTEGER NOT NULL,
          reason TEXT,
          reported_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE settings (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX idx_shifts_date ON shifts(date);
        CREATE INDEX idx_shifts_assigned ON shifts(assigned_to);
      `);
      
      console.log('✅ Tables created');
      
      // Create admin user
      const hashedPassword = await bcrypt.hash('admin123', 10);
      db.prepare(`
        INSERT INTO users (id, username, password, full_name, role, job_title, must_change_password)
        VALUES (1, 'admin', ?, 'System Admin', 'admin', 'Admin', 0)
      `).run(hashedPassword);
      
      // Create _open system user
      db.prepare(`
        INSERT INTO users (id, username, password, full_name, role)
        VALUES (2, '_open', 'no-login', 'Open Shift', 'system')
      `).run();
      
      // Set timezone
      db.prepare(`
        INSERT INTO settings (key, value) VALUES ('timezone', 'America/Chicago')
      `).run();
      
      console.log('✅ Admin user created: admin / admin123');
      console.log('🎉 Database initialization complete!');
    }
  } catch (err) {
    console.error('⚠️  Database init check failed:', err.message);
  }
}

// Run initialization before starting server
initializeDatabase().then(() => {
  // ── Role sync migration ────────────────────────────────────────────────
  try {
    const fixToAdmin = db.prepare(
      "UPDATE users SET role = 'admin' WHERE job_title = 'Admin' AND role != 'admin' AND username != '_open'"
    ).run();
    const fixToStaff = db.prepare(
      "UPDATE users SET role = 'staff' WHERE job_title != 'Admin' AND role = 'admin' AND username != 'admin' AND username != '_open'"
    ).run();
    if (fixToAdmin.changes > 0) console.log('Migration: promoted ' + fixToAdmin.changes + ' user(s) to admin role');
    if (fixToStaff.changes > 0) console.log('Migration: demoted ' + fixToStaff.changes + ' user(s) to staff role');
  } catch (err) {
    console.error('Role migration failed:', err.message);
  }

  // Initialize Telegram bot
  require('./server/telegram');

  // Import routes
  const routes = require('./server/routes');

  const app = express();
  const PORT = process.env.PORT || 3000;

  // Middleware
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));

  // Session configuration
  app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-key',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: { 
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    }
  }));

  // Make database available to routes
  app.use((req, res, next) => {
    req.db = db;
    next();
  });

  // Serve static files
  app.use(express.static(path.join(__dirname, 'public')));

  // API routes
  app.use('/api', routes);

  // Serve main app for all other routes (SPA)
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // Error handling middleware
  app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing database...');
    db.close();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('\nSIGINT received, closing database...');
    db.close();
    process.exit(0);
  });

  // Start server
  app.listen(PORT, () => {
    console.log('');
    console.log('🎉 LilSongBirdHomes Scheduler is running!');
    console.log('');
    console.log(`🌐 Server: http://localhost:${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('');
    console.log('📝 Default login: admin / admin123');
    console.log('');
    if (!process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN === 'your-telegram-bot-token-here') {
      console.log('⚠️  Telegram notifications disabled');
      console.log('   Set TELEGRAM_BOT_TOKEN in .env to enable');
      console.log('');
    }
  });

  module.exports = app;
});
