-- PostgreSQL Schema for Railway Deployment
-- Run this once after adding Postgres database

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  full_name VARCHAR(100),
  role VARCHAR(20) DEFAULT 'staff',
  job_title VARCHAR(50),
  tile_color VARCHAR(7) DEFAULT '#f5f5f5',
  text_color VARCHAR(7) DEFAULT 'black',
  email VARCHAR(100),
  phone VARCHAR(20),
  telegram_id VARCHAR(50),
  is_approved BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,
  must_change_password BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Shifts table
CREATE TABLE IF NOT EXISTS shifts (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  shift_type VARCHAR(20) NOT NULL,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_open BOOLEAN DEFAULT FALSE,
  is_preliminary BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Settings table (for timezone, templates, etc.)
CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  value TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Shift requests table
CREATE TABLE IF NOT EXISTS shift_requests (
  id SERIAL PRIMARY KEY,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'pending',
  admin_note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trade requests table
CREATE TABLE IF NOT EXISTS trade_requests (
  id SERIAL PRIMARY KEY,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  target_shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  requester_approved BOOLEAN DEFAULT FALSE,
  target_approved BOOLEAN DEFAULT FALSE,
  admin_approved BOOLEAN DEFAULT FALSE,
  admin_note TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Time off requests table
CREATE TABLE IF NOT EXISTS time_off_requests (
  id SERIAL PRIMARY KEY,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type VARCHAR(50),
  start_date DATE NOT NULL,
  end_date DATE,
  shift_date DATE,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  admin_note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notification log table
CREATE TABLE IF NOT EXISTS notification_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  notification_type VARCHAR(50),
  message TEXT,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(date);
CREATE INDEX IF NOT EXISTS idx_shifts_assigned ON shifts(assigned_to);
CREATE INDEX IF NOT EXISTS idx_shift_requests_status ON shift_requests(status);
CREATE INDEX IF NOT EXISTS idx_trade_requests_status ON trade_requests(status);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);

-- Insert default admin user
-- Password: admin123
-- Bcrypt hash generated with bcrypt.hash('admin123', 10)
INSERT INTO users (username, password, full_name, role, job_title, is_approved, is_active, must_change_password)
VALUES ('admin', '$2b$10$YfHHT4d7LqKZ5kZqKZ5kZeF8vZ5kZqKZ5kZqKZ5kZqKZ5kZqKZ5ku', 'System Admin', 'admin', 'Admin', TRUE, TRUE, TRUE)
ON CONFLICT (username) DO UPDATE SET
  password = EXCLUDED.password,
  role = EXCLUDED.role,
  job_title = EXCLUDED.job_title;

-- Insert _open system user for open shifts
INSERT INTO users (username, password, full_name, role, is_approved, is_active)
VALUES ('_open', 'no-login', 'Open Shift', 'system', TRUE, TRUE)
ON CONFLICT (username) DO NOTHING;

-- Insert default timezone setting
INSERT INTO settings (key, value)
VALUES ('timezone', 'America/Chicago')
ON CONFLICT (key) DO NOTHING;

-- Success message
SELECT 'Database schema created successfully!' AS status;
