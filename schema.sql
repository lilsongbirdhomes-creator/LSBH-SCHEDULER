-- LilSongBirdHomes Staff Scheduler Database Schema

-- Users table (staff and admin)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT DEFAULT 'staff', -- 'staff' or 'admin'
    job_title TEXT DEFAULT 'Caregiver',
    tile_color TEXT DEFAULT '#f5f5f5',
    text_color TEXT DEFAULT 'black',
    email TEXT,
    phone TEXT,
    telegram_id TEXT UNIQUE,
    telegram_username TEXT,
    is_approved BOOLEAN DEFAULT 1,
    is_active BOOLEAN DEFAULT 1,
    must_change_password BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Shifts table (all shifts in the system)
CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL, -- ISO date 'YYYY-MM-DD'
    shift_type TEXT NOT NULL, -- 'morning', 'afternoon', 'overnight'
    assigned_to INTEGER, -- user_id or NULL for open shifts
    is_open BOOLEAN DEFAULT 0,
    is_preliminary BOOLEAN DEFAULT 0, -- pending confirmation
    notes TEXT,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Shift requests (staff requesting open shifts)
CREATE TABLE IF NOT EXISTS shift_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id INTEGER NOT NULL,
    requester_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'denied'
    admin_note TEXT,
    approved_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
    FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (approved_by) REFERENCES users(id)
);

-- Trade requests (staff trading shifts with each other)
CREATE TABLE IF NOT EXISTS trade_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_shift_id INTEGER NOT NULL, -- shift being offered
    target_shift_id INTEGER NOT NULL, -- shift being requested
    requester_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    requester_approved BOOLEAN DEFAULT 1, -- initiator auto-approves
    target_approved BOOLEAN DEFAULT 0,
    admin_approved BOOLEAN DEFAULT 0,
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'denied', 'cancelled'
    requester_note TEXT,
    target_note TEXT,
    admin_note TEXT,
    approved_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (requester_shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
    FOREIGN KEY (target_shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
    FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (approved_by) REFERENCES users(id)
);

-- Time off requests
CREATE TABLE IF NOT EXISTS time_off_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL,
    request_type TEXT NOT NULL, -- 'assigned_shift' or 'future_vacation'
    shift_id INTEGER, -- if request_type is 'assigned_shift'
    start_date TEXT, -- if request_type is 'future_vacation'
    end_date TEXT,
    reason TEXT,
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'denied'
    admin_note TEXT,
    approved_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
    FOREIGN KEY (approved_by) REFERENCES users(id)
);

-- Emergency absences
CREATE TABLE IF NOT EXISTS absences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    reported_by INTEGER NOT NULL,
    reason TEXT,
    reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reported_by) REFERENCES users(id)
);

-- Notifications log (for audit trail)
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL, -- 'shift_assigned', 'request_approved', 'trade_request', etc.
    message TEXT NOT NULL,
    sent_via TEXT DEFAULT 'telegram', -- 'telegram', 'email'
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- System settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts(date);
CREATE INDEX IF NOT EXISTS idx_shifts_assigned ON shifts(assigned_to);
CREATE INDEX IF NOT EXISTS idx_shift_requests_status ON shift_requests(status);
CREATE INDEX IF NOT EXISTS idx_trade_requests_status ON trade_requests(status);
CREATE INDEX IF NOT EXISTS idx_time_off_status ON time_off_requests(status);
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);

-- Insert default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('public_schedule_enabled', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('max_hours_per_week', '40');
