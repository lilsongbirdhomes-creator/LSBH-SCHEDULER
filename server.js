require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const { Pool } = require('pg');

// Initialize PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test connection
pool.on('connect', () => {
  console.log('✅ PostgreSQL database connected');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL connection error:', err);
});

// ── Startup migration: keep role in sync with job_title ──────────────────
// Runs every deploy — self-heals any mismatch from manual edits or imports.
// Rule: job_title = 'Admin'  -> role = 'admin'
//       anything else        -> role = 'staff'  (never touches system accounts)
async function syncRoles() {
  try {
    const fixToAdmin = await pool.query(
      "UPDATE users SET role = 'admin' WHERE job_title = 'Admin' AND role != 'admin' AND username != '_open'"
    );
    
    const fixToStaff = await pool.query(
      "UPDATE users SET role = 'staff' WHERE job_title != 'Admin' AND role = 'admin' AND username != 'admin' AND username != '_open'"
    );
    
    if (fixToAdmin.rowCount > 0) {
      console.log('Migration: promoted ' + fixToAdmin.rowCount + ' user(s) to admin role');
    }
    if (fixToStaff.rowCount > 0) {
      console.log('Migration: demoted ' + fixToStaff.rowCount + ' user(s) to staff role');
    }
  } catch (err) {
    console.error('Role migration failed:', err.message);
  }
}

// Run role sync on startup
syncRoles();

// ─────────────────────────────────────────────────────────────────────────

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

// Make database pool available to routes
app.use((req, res, next) => {
  req.db = pool;
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
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database pool...');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\nSIGINT received, closing database pool...');
  await pool.end();
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
