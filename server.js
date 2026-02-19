require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const Database = require('better-sqlite3');

// Initialize database
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'database', 'scheduler.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL'); // Performance optimization

console.log('✅ Database connected:', dbPath);

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
       secure: true,
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
  console.log('📝 Default login: admin / password123');
  console.log('');
  if (!process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN === 'your-telegram-bot-token-here') {
    console.log('⚠️  Telegram notifications disabled');
    console.log('   Set TELEGRAM_BOT_TOKEN in .env to enable');
    console.log('');
  }
});

module.exports = app;
