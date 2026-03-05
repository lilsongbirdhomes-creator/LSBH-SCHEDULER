const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { requireAuth, requireAdmin, login, changePassword, getCurrentUser } = require('./auth');
const { calculateWeeklyHours, buildRunningTotals, checkHoursLimit, getPayPeriodStart, SHIFT_DEFS } = require('../utils/hours');
const notify = require('../utils/notifications');
const telegram = require("../server/telegram");

// ═══════════════════════════════════════════════════════════
// HELPER FUNCTIONS FOR DATE OPERATIONS (FIX FOR COPY SHIFTS)
// ═══════════════════════════════════════════════════════════

function formatDateISO(date) {
  // Format date as YYYY-MM-DD without timezone confusion
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(dateStr) {
  // Parse date string safely in UTC
  // Input: "2026-03-05" Output: Date object at midnight UTC
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function getWeekStart(date) {
  // Get Sunday of the week containing the date
  const d = new Date(date);
  const day = d.getDay();  // 0 = Sunday
  const diff = d.getDate() - day;
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function getWeekEnd(date) {
  // Get Saturday of the week (6 days after Sunday)
  const start = getWeekStart(date);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
}

function getMonthStart(date) {
  // Get first day of the month
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function getMonthEnd(date) {
  // Get last day of the month
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

// ═══════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════

// POST /api/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const result = await login(req.db, username, password);
  
  if (result.success) {
    req.session.userId = result.user.id;
    req.session.role = result.user.role;
    req.session.username = result.user.username;
    res.json({ success: true, user: result.user });
  } else {
    res.status(401).json({ error: result.error });
  }
});

// POST /api/logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// GET /api/me
router.get('/me', requireAuth, (req, res) => {
  const user = getCurrentUser(req.db, req.session.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json({ user });
});

// POST /api/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  const { newPassword, currentPassword } = req.body;
  
  if (!newPassword) {
    return res.status(400).json({ error: 'New password required' });
  }
  
  const result = await changePassword(
    req.db, 
    req.session.userId, 
    newPassword,
    currentPassword
  );
  
  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(400).json({ error: result.error });
  }
});

// ═══════════════════════════════════════════════════════════
// USER/STAFF ROUTES
// ═══════════════════════════════════════════════════════════

// GET /api/staff - Get all staff members
router.get('/staff', requireAuth, (req, res) => {
  const isAdmin = req.session.role === 'admin';
  
  let query = `
    SELECT id, username, full_name, role, job_title, 
           tile_color, text_color, email, phone, telegram_id,
           is_approved, is_active
    FROM users
    WHERE role != 'system'
  `;
  
  if (!isAdmin) {
    query += ' AND is_approved = 1 AND is_active = 1';
  }
  
  query += ' ORDER BY role DESC, full_name ASC';
  
  const staff = req.db.prepare(query).all();
  
  // Add Open Shift placeholder
  const openShift = req.db.prepare(`
    SELECT id, username, full_name, role, job_title, tile_color, text_color
    FROM users WHERE username = '_open'
  `).get();
  
  res.json({ staff: openShift ? [openShift, ...staff] : staff });
});

// GET /api/staff/:id - Get single staff member
router.get('/staff/:id', requireAuth, (req, res) => {
  const staffId = parseInt(req.params.id);
  const staff = req.db.prepare(`
    SELECT id, username, full_name, role, job_title, 
           tile_color, text_color, email, phone, telegram_id,
           is_approved, is_active, created_at
    FROM users
    WHERE id = ?
  `).get(staffId);
  
  if (!staff) {
    return res.status(404).json({ error: 'Staff member not found' });
  }
  
  res.json({ staff });
});

// POST /api/staff - Create new staff member (admin only)
router.post('/staff', requireAdmin, async (req, res) => {
  const { username, full_name, role, job_title, email, phone } = req.body;
  
  if (!username || !full_name) {
    return res.status(400).json({ error: 'Username and name required' });
  }
  
  try {
    // Generate temporary password
    const tempPassword = Math.random().toString(36).slice(-8);
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    
    const result = req.db.prepare(`
      INSERT INTO users (username, password, full_name, role, job_title, email, phone, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(username, hashedPassword, full_name, role || 'staff', job_title || '', email || '', phone || '');
    
    res.json({ 
      success: true, 
      userId: result.lastInsertRowid,
      tempPassword 
    });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Failed to create staff member' });
  }
});

// PUT /api/staff/:id - Update staff member (admin only)
router.put('/staff/:id', requireAdmin, async (req, res) => {
  const staffId = parseInt(req.params.id);
  const { full_name, role, job_title, email, phone, telegram_id, is_approved, is_active, tile_color, text_color } = req.body;
  
  try {
    const updates = [];
    const values = [];
    
    if (full_name !== undefined) { updates.push('full_name = ?'); values.push(full_name); }
    if (role !== undefined) { updates.push('role = ?'); values.push(role); }
    if (job_title !== undefined) { updates.push('job_title = ?'); values.push(job_title); }
    if (email !== undefined) { updates.push('email = ?'); values.push(email); }
    if (phone !== undefined) { updates.push('phone = ?'); values.push(phone); }
    if (telegram_id !== undefined) { updates.push('telegram_id = ?'); values.push(telegram_id); }
    if (is_approved !== undefined) { updates.push('is_approved = ?'); values.push(is_approved); }
    if (is_active !== undefined) { updates.push('is_active = ?'); values.push(is_active); }
    if (tile_color !== undefined) { updates.push('tile_color = ?'); values.push(tile_color); }
    if (text_color !== undefined) { updates.push('text_color = ?'); values.push(text_color); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(staffId);
    
    req.db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update staff member' });
  }
});

// POST /api/staff/:id/reset-password - Reset staff password (admin only)
router.post('/staff/:id/reset-password', requireAdmin, async (req, res) => {
  const staffId = parseInt(req.params.id);
  
  try {
    const tempPassword = Math.random().toString(36).slice(-8);
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    
    req.db.prepare(`
      UPDATE users 
      SET password = ?, must_change_password = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(hashedPassword, staffId);
    
    res.json({ success: true, tempPassword });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// DELETE /api/staff/:id - Delete staff member (admin only)
router.delete('/staff/:id', requireAdmin, (req, res) => {
  const staffId = parseInt(req.params.id);
  
  if (staffId === 1) {
    return res.status(400).json({ error: 'Cannot delete admin user' });
  }
  
  try {
    req.db.prepare('DELETE FROM users WHERE id = ?').run(staffId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete staff member' });
  }
});

// ═══════════════════════════════════════════════════════════
// SHIFT ROUTES
// ═══════════════════════════════════════════════════════════

// GET /api/shifts - Get shifts for a date range
router.get('/shifts', requireAuth, (req, res) => {
  const { startDate, endDate } = req.query;
  
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Start and end dates required' });
  }
  
  const shifts = req.db.prepare(`
    SELECT id, date, shift_type, assigned_to, is_open, is_preliminary, notes, start_time, end_time
    FROM shifts
    WHERE date >= ? AND date <= ?
    ORDER BY date, id
  `).all(startDate, endDate);
  
  res.json({ shifts });
});

// POST /api/shifts - Create shift (admin only)
router.post('/shifts', requireAdmin, (req, res) => {
  const { date, shift_type, assigned_to, is_open, start_time, end_time } = req.body;
  
  if (!date || !shift_type) {
    return res.status(400).json({ error: 'Date and shift type required' });
  }
  
  try {
    const result = req.db.prepare(`
      INSERT INTO shifts (date, shift_type, assigned_to, is_open, start_time, end_time, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(date, shift_type, assigned_to || null, is_open ? 1 : 0, start_time || null, end_time || null, req.session.userId);
    
    // Notify assigned staff if not open
    if (assigned_to && !is_open) {
      const user = req.db.prepare('SELECT telegram_id, full_name FROM users WHERE id = ?').get(assigned_to);
      if (user?.telegram_id) {
        notify.notifyShiftAssigned(assigned_to, shift_type, date);
      }
    }
    
    res.json({ success: true, shiftId: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create shift' });
  }
});

// PUT /api/shifts/:id - Update shift (admin only)
router.put('/shifts/:id', requireAdmin, async (req, res) => {
  const shiftId = parseInt(req.params.id);
  const { assignedTo, isOpen, isPreliminary, notes, startTime, endTime } = req.body;
  
  const shift = req.db.prepare('SELECT date, shift_type, assigned_to FROM shifts WHERE id = ?').get(shiftId);
  if (!shift) {
    return res.status(404).json({ error: 'Shift not found' });
  }
  
  // Check hours limit if reassigning
  if (assignedTo !== undefined && assignedTo !== shift.assigned_to && !isOpen) {
    const check = checkHoursLimit(req.db, assignedTo, shift.date, shift.shift_type);
    if (check.wouldExceed) {
      return res.status(400).json({ 
        error: 'Would exceed 40-hour limit',
        details: check
      });
    }
  }
  
  try {
    const updates = [];
    const values = [];
    
    if (assignedTo !== undefined) { updates.push('assigned_to = ?'); values.push(assignedTo); }
    if (isOpen !== undefined) { updates.push('is_open = ?'); values.push(isOpen ? 1 : 0); }
    if (isPreliminary !== undefined) { updates.push('is_preliminary = ?'); values.push(isPreliminary ? 1 : 0); }
    if (notes !== undefined) { updates.push('notes = ?'); values.push(notes); }
    if (startTime !== undefined) { updates.push('start_time = ?'); values.push(startTime); }
    if (endTime !== undefined) { updates.push('end_time = ?'); values.push(endTime); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(shiftId);
    
    req.db.prepare(`UPDATE shifts SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    
    // Notify if assignment changed
    if (assignedTo !== undefined && assignedTo !== null && !isOpen) {
      notify.notifyShiftAssigned(assignedTo, shift.shift_type, shift.date);
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update shift' });
  }
});

// DELETE /api/shifts/:id - Delete shift (admin only)
router.delete('/shifts/:id', requireAdmin, (req, res) => {
  const shiftId = parseInt(req.params.id);
  
  try {
    req.db.prepare('DELETE FROM shifts WHERE id = ?').run(shiftId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete shift' });
  }
});

// POST /api/shifts/copy - Copy shifts from one date range to another (admin only) [FIXED]
router.post('/shifts/copy', requireAdmin, async (req, res) => {
  const { sourceDate, targetDate, copyType, keepAssignments, replaceExisting } = req.body;

  if (!sourceDate || !targetDate) {
    return res.status(400).json({ error: 'Source and target dates required' });
  }

  try {
    // Parse dates safely (avoiding timezone issues)
    const sourceDateObj = parseDate(sourceDate);
    const targetDateObj = parseDate(targetDate);
    
    let sourceStart, sourceEnd;
    
    // Calculate source date range based on copy type
    if (copyType === 'day') {
      // Single day copy
      sourceStart = sourceDate;
      sourceEnd = sourceDate;
    } else if (copyType === 'week') {
      // Full week copy (Sunday through Saturday)
      const weekStart = getWeekStart(sourceDateObj);
      const weekEnd = getWeekEnd(sourceDateObj);
      sourceStart = formatDateISO(weekStart);
      sourceEnd = formatDateISO(weekEnd);
    } else if (copyType === 'month') {
      // Full month copy
      const monthStart = getMonthStart(sourceDateObj);
      const monthEnd = getMonthEnd(sourceDateObj);
      sourceStart = formatDateISO(monthStart);
      sourceEnd = formatDateISO(monthEnd);
    } else {
      return res.status(400).json({ error: 'Invalid copy type' });
    }

    // Fetch ALL source shifts, including custom start_time/end_time and every extra
    // shift on a day (e.g. a 4th trainer shift). Order by id so extras are preserved
    // in insertion order.
    const sourceShifts = req.db.prepare(`
      SELECT id, date, shift_type, assigned_to, is_open, start_time, end_time
      FROM shifts
      WHERE date >= ? AND date <= ?
      ORDER BY date, id
    `).all(sourceStart, sourceEnd);

    if (sourceShifts.length === 0) {
      return res.json({ success: true, copied: 0, message: 'No shifts found in source range' });
    }

    // Calculate date offset (in whole days)
    // This safely converts both dates to UTC and calculates days between
    const srcDate = parseDate(sourceStart);
    const tgtDate = parseDate(targetDate);
    const dayOffset = Math.floor((tgtDate - srcDate) / (1000 * 60 * 60 * 24));

    let copied = 0;
    let skipped = 0;

    // Build a lookup of all existing shifts on target days keyed by "date|shift_type|position"
    // so we can match extras in order without collapsing them.
    // Strategy: for each source day, group its shifts by shift_type. For each group,
    // the first source shift maps to the first existing target shift of that type, etc.
    // This lets us replace the 1st morning shift, 2nd morning shift, etc. independently.

    // Group source shifts by (date, shift_type)
    const sourceGroups = {};
    for (const shift of sourceShifts) {
      const key = `${shift.date}|${shift.shift_type}`;
      if (!sourceGroups[key]) sourceGroups[key] = [];
      sourceGroups[key].push(shift);
    }

    // For each (date, shift_type) group, fetch matching target shifts in id order
    const targetGroups = {};
    for (const key of Object.keys(sourceGroups)) {
      const [sDate, sType] = key.split('|');
      const shiftDate = parseDate(sDate);
      shiftDate.setDate(shiftDate.getDate() + dayOffset);
      const newDate = formatDateISO(shiftDate);
      const tKey = `${newDate}|${sType}`;
      if (!targetGroups[tKey]) {
        targetGroups[tKey] = req.db.prepare(
          'SELECT id FROM shifts WHERE date = ? AND shift_type = ? ORDER BY id'
        ).all(newDate, sType);
      }
    }

    for (const shift of sourceShifts) {
      const shiftDate = parseDate(shift.date);
      shiftDate.setDate(shiftDate.getDate() + dayOffset);
      const newDate = formatDateISO(shiftDate);

      const sKey = `${shift.date}|${shift.shift_type}`;
      const tKey = `${newDate}|${shift.shift_type}`;

      // Determine position of this source shift within its (date, type) group
      const posInGroup = sourceGroups[sKey].indexOf(shift);
      const existingAtPos = targetGroups[tKey] ? targetGroups[tKey][posInGroup] : undefined;

      const newAssignedTo = keepAssignments ? shift.assigned_to : null;
      const newIsOpen     = keepAssignments ? shift.is_open     : 1;
      const newStartTime  = shift.start_time || null;
      const newEndTime    = shift.end_time   || null;

      if (existingAtPos) {
        // A shift of this type already exists at this position on the target day
        if (replaceExisting) {
          // Overwrite it in place
          req.db.prepare(`
            UPDATE shifts
            SET assigned_to = ?, is_open = ?, start_time = ?, end_time = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(newAssignedTo, newIsOpen, newStartTime, newEndTime, existingAtPos.id);
          copied++;
        } else {
          // Skip — leave the existing target shift untouched
          skipped++;
        }
      } else {
        // No existing shift at this position — always insert
        req.db.prepare(`
          INSERT INTO shifts (date, shift_type, assigned_to, is_open, start_time, end_time, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(newDate, shift.shift_type, newAssignedTo, newIsOpen, newStartTime, newEndTime, req.session.userId);
        // Add to targetGroups so subsequent extra shifts in the same group see it
        if (!targetGroups[tKey]) targetGroups[tKey] = [];
        targetGroups[tKey].push({ id: null }); // placeholder; id not needed after insert
        copied++;
      }
    }

    res.json({ success: true, copied, skipped });
  } catch (err) {
    console.error('Copy shifts error:', err);
    res.status(500).json({ error: 'Failed to copy shifts' });
  }
});

// ═══════════════════════════════════════════════════════════
// SHIFT REQUESTS ROUTES
// ═══════════════════════════════════════════════════════════

// GET /api/shift-requests - Get all shift requests (admin) or user's requests (staff)
router.get('/shift-requests', requireAuth, (req, res) => {
  let query;
  let params;
  
  if (req.session.role === 'admin') {
    query = `
      SELECT sr.id, sr.shift_id, sr.requester_id, sr.status, sr.admin_note, sr.approved_by, sr.created_at,
             s.date, s.shift_type, u.full_name, u.username
      FROM shift_requests sr
      JOIN shifts s ON sr.shift_id = s.id
      JOIN users u ON sr.requester_id = u.id
      ORDER BY sr.created_at DESC
    `;
    params = [];
  } else {
    query = `
      SELECT sr.id, sr.shift_id, sr.requester_id, sr.status, sr.admin_note, sr.approved_by, sr.created_at,
             s.date, s.shift_type, u.full_name, u.username
      FROM shift_requests sr
      JOIN shifts s ON sr.shift_id = s.id
      JOIN users u ON sr.requester_id = u.id
      WHERE sr.requester_id = ?
      ORDER BY sr.created_at DESC
    `;
    params = [req.session.userId];
  }
  
  const requests = req.db.prepare(query).all(...params);
  res.json({ requests });
});

// POST /api/shift-requests - Create shift request (staff only)
router.post('/shift-requests', requireAuth, (req, res) => {
  const { shiftId } = req.body;
  
  if (!shiftId) {
    return res.status(400).json({ error: 'Shift ID required' });
  }
  
  // Check if shift exists and is open
  const shift = req.db.prepare('SELECT id, date FROM shifts WHERE id = ? AND is_open = 1').get(shiftId);
  if (!shift) {
    return res.status(400).json({ error: 'Shift not found or not open' });
  }
  
  // Check if user already requested this shift
  const existing = req.db.prepare(
    'SELECT id FROM shift_requests WHERE shift_id = ? AND requester_id = ?'
  ).get(shiftId, req.session.userId);
  
  if (existing) {
    return res.status(400).json({ error: 'You already requested this shift' });
  }
  
  try {
    const result = req.db.prepare(`
      INSERT INTO shift_requests (shift_id, requester_id, status)
      VALUES (?, ?, 'pending')
    `).run(shiftId, req.session.userId);
    
    res.json({ success: true, requestId: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create shift request' });
  }
});

// PUT /api/shift-requests/:id - Approve/reject shift request (admin only)
router.put('/shift-requests/:id', requireAdmin, (req, res) => {
  const requestId = parseInt(req.params.id);
  const { status, adminNote } = req.body;
  
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be approved or rejected' });
  }
  
  try {
    const request = req.db.prepare('SELECT shift_id, requester_id FROM shift_requests WHERE id = ?').get(requestId);
    
    if (status === 'approved') {
      // Assign shift to requester
      req.db.prepare('UPDATE shifts SET assigned_to = ?, is_open = 0 WHERE id = ?')
        .run(request.requester_id, request.shift_id);
      
      // Reject all other requests for this shift
      req.db.prepare('UPDATE shift_requests SET status = ? WHERE shift_id = ? AND id != ?')
        .run('rejected', request.shift_id, requestId);
    }
    
    req.db.prepare(`
      UPDATE shift_requests
      SET status = ?, admin_note = ?, approved_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, adminNote || null, req.session.userId, requestId);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update shift request' });
  }
});

// DELETE /api/shift-requests/:id - Cancel shift request (staff can cancel own, admin can cancel any)
router.delete('/shift-requests/:id', requireAuth, (req, res) => {
  const requestId = parseInt(req.params.id);
  
  const request = req.db.prepare('SELECT requester_id FROM shift_requests WHERE id = ?').get(requestId);
  
  if (!request) {
    return res.status(404).json({ error: 'Request not found' });
  }
  
  if (req.session.role !== 'admin' && request.requester_id !== req.session.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  try {
    req.db.prepare('DELETE FROM shift_requests WHERE id = ?').run(requestId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete shift request' });
  }
});

// ═══════════════════════════════════════════════════════════
// TRADE REQUESTS ROUTES
// ═══════════════════════════════════════════════════════════

// GET /api/trade-requests
router.get('/trade-requests', requireAuth, (req, res) => {
  let query;
  let params;
  
  if (req.session.role === 'admin') {
    query = `
      SELECT tr.id, tr.requester_shift_id, tr.target_shift_id, tr.requester_id, tr.target_id,
             tr.requester_approved, tr.target_approved, tr.admin_approved, tr.status, tr.created_at,
             rs.date as requester_date, rs.shift_type as requester_type, ru.full_name as requester_name,
             ts.date as target_date, ts.shift_type as target_type, tu.full_name as target_name
      FROM trade_requests tr
      JOIN shifts rs ON tr.requester_shift_id = rs.id
      JOIN shifts ts ON tr.target_shift_id = ts.id
      JOIN users ru ON tr.requester_id = ru.id
      JOIN users tu ON tr.target_id = tu.id
      ORDER BY tr.created_at DESC
    `;
    params = [];
  } else {
    query = `
      SELECT tr.id, tr.requester_shift_id, tr.target_shift_id, tr.requester_id, tr.target_id,
             tr.requester_approved, tr.target_approved, tr.admin_approved, tr.status, tr.created_at,
             rs.date as requester_date, rs.shift_type as requester_type, ru.full_name as requester_name,
             ts.date as target_date, ts.shift_type as target_type, tu.full_name as target_name
      FROM trade_requests tr
      JOIN shifts rs ON tr.requester_shift_id = rs.id
      JOIN shifts ts ON tr.target_shift_id = ts.id
      JOIN users ru ON tr.requester_id = ru.id
      JOIN users tu ON tr.target_id = tu.id
      WHERE tr.requester_id = ? OR tr.target_id = ?
      ORDER BY tr.created_at DESC
    `;
    params = [req.session.userId, req.session.userId];
  }
  
  const trades = req.db.prepare(query).all(...params);
  res.json({ trades });
});

// POST /api/trade-requests
router.post('/trade-requests', requireAuth, (req, res) => {
  const { requesterShiftId, targetShiftId, targetId } = req.body;
  
  if (!requesterShiftId || !targetShiftId || !targetId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // Verify requester owns the requester shift
  const requesterShift = req.db.prepare('SELECT assigned_to FROM shifts WHERE id = ?').get(requesterShiftId);
  if (!requesterShift || requesterShift.assigned_to !== req.session.userId) {
    return res.status(403).json({ error: 'You do not own this shift' });
  }
  
  // Verify target owns the target shift
  const targetShift = req.db.prepare('SELECT assigned_to FROM shifts WHERE id = ?').get(targetShiftId);
  if (!targetShift || targetShift.assigned_to !== targetId) {
    return res.status(403).json({ error: 'Target does not own that shift' });
  }
  
  try {
    const result = req.db.prepare(`
      INSERT INTO trade_requests 
      (requester_shift_id, target_shift_id, requester_id, target_id, requester_approved, status)
      VALUES (?, ?, ?, ?, 1, 'pending')
    `).run(requesterShiftId, targetShiftId, req.session.userId, targetId);
    
    res.json({ success: true, tradeId: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create trade request' });
  }
});

// PUT /api/trade-requests/:id/respond - Target responds to trade request
router.put('/trade-requests/:id/respond', requireAuth, (req, res) => {
  const tradeId = parseInt(req.params.id);
  const { approved } = req.body;
  
  const trade = req.db.prepare('SELECT target_id FROM trade_requests WHERE id = ?').get(tradeId);
  
  if (!trade || trade.target_id !== req.session.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  try {
    req.db.prepare(`
      UPDATE trade_requests
      SET target_approved = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(approved ? 1 : 0, tradeId);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update trade request' });
  }
});

// PUT /api/trade-requests/:id/approve - Admin approves/rejects trade
router.put('/trade-requests/:id/approve', requireAdmin, (req, res) => {
  const tradeId = parseInt(req.params.id);
  const { status, adminNote } = req.body;
  
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be approved or rejected' });
  }
  
  try {
    const trade = req.db.prepare(`
      SELECT requester_shift_id, target_shift_id, requester_id, target_id, target_approved
      FROM trade_requests WHERE id = ?
    `).get(tradeId);
    
    if (status === 'approved' && trade.target_approved) {
      // Perform the trade
      req.db.prepare('UPDATE shifts SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(trade.target_id, trade.requester_shift_id);
      req.db.prepare('UPDATE shifts SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(trade.requester_id, trade.target_shift_id);
    }
    
    req.db.prepare(`
      UPDATE trade_requests
      SET admin_approved = ?, status = ?, admin_note = ?, approved_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status === 'approved' ? 1 : 0, status, adminNote || null, req.session.userId, tradeId);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve trade request' });
  }
});

// ═══════════════════════════════════════════════════════════
// TIME OFF ROUTES
// ═══════════════════════════════════════════════════════════

// GET /api/time-off-requests
router.get('/time-off-requests', requireAuth, (req, res) => {
  let query;
  let params;
  
  if (req.session.role === 'admin') {
    query = `
      SELECT id, requester_id, request_type, start_date, end_date, reason, status, admin_note, created_at,
             (SELECT full_name FROM users WHERE id = time_off_requests.requester_id) as requester_name
      FROM time_off_requests
      ORDER BY created_at DESC
    `;
    params = [];
  } else {
    query = `
      SELECT id, requester_id, request_type, start_date, end_date, reason, status, admin_note, created_at
      FROM time_off_requests
      WHERE requester_id = ?
      ORDER BY created_at DESC
    `;
    params = [req.session.userId];
  }
  
  const requests = req.db.prepare(query).all(...params);
  res.json({ requests });
});

// POST /api/time-off-requests
router.post('/time-off-requests', requireAuth, (req, res) => {
  const { request_type, start_date, end_date, reason } = req.body;
  
  if (!request_type || !start_date) {
    return res.status(400).json({ error: 'Type and start date required' });
  }
  
  try {
    const result = req.db.prepare(`
      INSERT INTO time_off_requests (requester_id, request_type, start_date, end_date, reason, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(req.session.userId, request_type, start_date, end_date || null, reason || null);
    
    res.json({ success: true, requestId: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create time off request' });
  }
});

// PUT /api/time-off-requests/:id - Admin approves/rejects
router.put('/time-off-requests/:id', requireAdmin, (req, res) => {
  const requestId = parseInt(req.params.id);
  const { status, adminNote } = req.body;
  
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be approved or rejected' });
  }
  
  try {
    req.db.prepare(`
      UPDATE time_off_requests
      SET status = ?, admin_note = ?, approved_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, adminNote || null, req.session.userId, requestId);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update time off request' });
  }
});

// DELETE /api/time-off-requests/:id
router.delete('/time-off-requests/:id', requireAuth, (req, res) => {
  const requestId = parseInt(req.params.id);
  
  const request = req.db.prepare('SELECT requester_id FROM time_off_requests WHERE id = ?').get(requestId);
  
  if (!request) {
    return res.status(404).json({ error: 'Request not found' });
  }
  
  if (req.session.role !== 'admin' && request.requester_id !== req.session.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  try {
    req.db.prepare('DELETE FROM time_off_requests WHERE id = ?').run(requestId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete time off request' });
  }
});

// ═══════════════════════════════════════════════════════════
// HOURS & ANALYTICS
// ═══════════════════════════════════════════════════════════

// GET /api/hours/:userId
router.get('/hours/:userId', requireAuth, (req, res) => {
  const userId = parseInt(req.params.userId);
  
  if (req.session.role !== 'admin' && req.session.userId !== userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekStartStr = weekStart.toISOString().split('T')[0];
  
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const weekEndStr = weekEnd.toISOString().split('T')[0];
  
  const shifts = req.db.prepare(`
    SELECT date, shift_type FROM shifts
    WHERE assigned_to = ? AND date >= ? AND date <= ?
    ORDER BY date
  `).all(userId, weekStartStr, weekEndStr);
  
  const hours = calculateWeeklyHours(req.db, shifts);
  res.json({ hours, weekStart: weekStartStr, weekEnd: weekEndStr });
});

// ═══════════════════════════════════════════════════════════
// SHIFT TEMPLATES
// ═══════════════════════════════════════════════════════════

// GET /api/shift-templates
router.get('/shift-templates', (req, res) => {
  try {
    const morning = req.db.prepare('SELECT * FROM settings WHERE key = ?').get('shift_morning') || {};
    const afternoon = req.db.prepare('SELECT * FROM settings WHERE key = ?').get('shift_afternoon') || {};
    const overnight = req.db.prepare('SELECT * FROM settings WHERE key = ?').get('shift_overnight') || {};
    
    res.json({
      morning: {
        label: 'Morning',
        time: '7:00 AM – 3:00 PM',
        hours: 8.0
      },
      afternoon: {
        label: 'Afternoon',
        time: '3:00 PM – 7:00 PM',
        hours: 4.0
      },
      overnight: {
        label: 'Overnight',
        time: '7:00 PM – 7:00 AM',
        hours: 12.0
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load shift templates' });
  }
});

// POST /api/shift-templates - Update templates (admin only)
router.post('/shift-templates', requireAdmin, (req, res) => {
  const { morning, afternoon, overnight } = req.body;
  
  try {
    if (morning) {
      req.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('shift_morning', JSON.stringify(morning));
    }
    if (afternoon) {
      req.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('shift_afternoon', JSON.stringify(afternoon));
    }
    if (overnight) {
      req.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('shift_overnight', JSON.stringify(overnight));
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update templates' });
  }
});

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════

// GET /api/settings/timezone
router.get('/settings/timezone', (req, res) => {
  try {
    const setting = req.db.prepare('SELECT value FROM settings WHERE key = ?').get('timezone');
    res.json({ timezone: setting?.value || 'America/Chicago' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load timezone' });
  }
});

// POST /api/settings/timezone - Update timezone (admin only)
router.post('/settings/timezone', requireAdmin, (req, res) => {
  const { timezone } = req.body;
  
  if (!timezone) {
    return res.status(400).json({ error: 'Timezone required' });
  }
  
  try {
    req.db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run('timezone', timezone);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update timezone' });
  }
});

module.exports = router;
