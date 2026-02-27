const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { requireAuth, requireAdmin, login, changePassword, getCurrentUser } = require('./auth');
const { calculateWeeklyHours, buildRunningTotals, checkHoursLimit, getPayPeriodStart, SHIFT_DEFS } = require('../utils/hours');
const notify = require('../utils/notifications');
const telegram = require("../server/telegram");

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
  const { newPassword } = req.body;
  const result = await changePassword(req.db, req.session.userId, newPassword);
  
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

// POST /api/staff - Add new staff member (admin only)
router.post('/staff', requireAdmin, async (req, res) => {
  const { username, fullName, role, jobTitle, tileColor, textColor } = req.body;
  
  if (!username || !fullName) {
    return res.status(400).json({ error: 'Username and full name required' });
  }
  
  // Check if username exists
  const existing = req.db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
  if (existing) {
    return res.status(400).json({ error: 'Username already exists' });
  }
  
  const tempPassword = 'temp' + Math.floor(Math.random() * 10000);
  const hashedPassword = await bcrypt.hash(tempPassword, 10);
  
  try {
    const result = req.db.prepare(`
      INSERT INTO users (username, password, full_name, role, job_title, tile_color, text_color)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      username.toLowerCase(),
      hashedPassword,
      fullName,
      role || 'staff',
      jobTitle || 'Caregiver',
      tileColor || '#f5f5f5',
      textColor || 'black'
    );
    
    res.json({ 
      success: true, 
      staffId: result.lastInsertRowid,
      tempPassword 
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create staff member' });
  }
});

// PUT /api/staff/:id - Update staff member
router.put('/staff/:id', requireAuth, async (req, res) => {
  const staffId = parseInt(req.params.id);
  const isAdmin = req.session.role === 'admin';
  
  // Non-admins can only update their own profile
  if (!isAdmin && staffId !== req.session.userId) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  
  const { fullName, role, jobTitle, tileColor, textColor, email, phone, telegramId } = req.body;
  
  // Build update query based on what's provided
  const updates = [];
  const values = [];
  
  if (fullName) { updates.push('full_name = ?'); values.push(fullName); }
  if (isAdmin && role) { updates.push('role = ?'); values.push(role); }
  if (jobTitle) { updates.push('job_title = ?'); values.push(jobTitle); }
  if (tileColor) { updates.push('tile_color = ?'); values.push(tileColor); }
  if (textColor) { updates.push('text_color = ?'); values.push(textColor); }
  if (email !== undefined) { updates.push('email = ?'); values.push(email); }
  if (phone !== undefined) { updates.push('phone = ?'); values.push(phone); }
  if (telegramId !== undefined) { updates.push('telegram_id = ?'); values.push(telegramId || null); }
  
  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  
  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(staffId);
  
  try {
    req.db.prepare(`
      UPDATE users 
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...values);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update staff member' });
  }
});

// DELETE /api/staff/:id - Delete staff member (admin only)
router.delete('/staff/:id', requireAdmin, (req, res) => {
  const staffId = parseInt(req.params.id);
  
  // Can't delete admin
  const user = req.db.prepare('SELECT role FROM users WHERE id = ?').get(staffId);
  if (user && user.role === 'admin') {
    return res.status(400).json({ error: 'Cannot delete admin users' });
  }
  
  try {
    req.db.prepare('DELETE FROM users WHERE id = ?').run(staffId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete staff member' });
  }
});

// POST /api/staff/:id/reset-password (admin only)
router.post('/staff/:id/reset-password', requireAdmin, async (req, res) => {
  const staffId = parseInt(req.params.id);
  const tempPassword = 'temp' + Math.floor(Math.random() * 10000);
  const hashedPassword = await bcrypt.hash(tempPassword, 10);
  
  try {
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

// POST /api/staff/:id/toggle-active (admin only) - Activate/Deactivate staff
router.post('/staff/:id/toggle-active', requireAdmin, (req, res) => {
  const staffId = parseInt(req.params.id);
  const { isActive } = req.body;
  
  // Can't deactivate admin
  const user = req.db.prepare('SELECT role FROM users WHERE id = ?').get(staffId);
  if (user && user.role === 'admin') {
    return res.status(400).json({ error: 'Cannot deactivate admin users' });
  }
  
  try {
    req.db.prepare(`
      UPDATE users 
      SET is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(isActive ? 1 : 0, staffId);
    
    res.json({ success: true, isActive: isActive ? 1 : 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update staff status' });
  }
});

// ═══════════════════════════════════════════════════════════
// SHIFT ROUTES
// ═══════════════════════════════════════════════════════════

// GET /api/shifts - Get shifts with filters
router.get('/shifts', requireAuth, (req, res) => {
  const { startDate, endDate, userId, includeOpen } = req.query;
  const isAdmin = req.session.role === 'admin';
  
  let query = `
    SELECT 
      s.id, s.date, s.shift_type, s.assigned_to, s.is_open, s.is_preliminary, s.notes,
      u.full_name, u.tile_color, u.text_color, u.job_title
    FROM shifts s
    LEFT JOIN users u ON s.assigned_to = u.id
    WHERE 1=1
  `;
  
  const params = [];
  
  if (startDate) {
    query += ' AND s.date >= ?';
    params.push(startDate);
  }
  
  if (endDate) {
    query += ' AND s.date <= ?';
    params.push(endDate);
  }
  
  if (userId) {
    query += ' AND s.assigned_to = ?';
    params.push(parseInt(userId));
  }
  
  // Staff can see ALL shifts (removed filtering)
  // Frontend toggle handles "only my shifts" view
  
  query += ' ORDER BY s.date ASC, CASE s.shift_type WHEN \'morning\' THEN 1 WHEN \'afternoon\' THEN 2 WHEN \'overnight\' THEN 3 END';
  
  const shifts = req.db.prepare(query).all(...params);
  
  // Calculate running hours if we have a date range
  let runningTotals = {};
  if (startDate) {
    const sunday = getPayPeriodStart(startDate);
    runningTotals = buildRunningTotals(req.db, sunday);
  }
  
  // Add running hours to each shift
  const shiftsWithHours = shifts.map(shift => {
    if (shift.assigned_to) {
      const key = `${shift.date}|${shift.assigned_to}|${shift.shift_type}`;
      shift.running_hours = runningTotals[key] || 0;
    }
    return shift;
  });
  
  res.json({ shifts: shiftsWithHours });
});

// GET /api/hours-check - Check if assignment would exceed 40-hour limit
router.get('/hours-check', requireAuth, (req, res) => {
  const { staffId, date, shiftType, excludeShiftId } = req.query;
  
  if (!staffId || !date || !shiftType) {
    return res.status(400).json({ error: 'staffId, date, and shiftType required' });
  }
  
  const check = checkHoursLimit(
    req.db, 
    parseInt(staffId), 
    date, 
    shiftType,
    excludeShiftId ? parseInt(excludeShiftId) : undefined
  );
  
  res.json(check);
});

// POST /api/shifts - Create shift (admin only)
router.post('/shifts', requireAdmin, async (req, res) => {
  const { date, shiftType, assignedTo, isOpen, isPreliminary, notes } = req.body;
  
  if (!date || !shiftType) {
    return res.status(400).json({ error: 'Date and shift type required' });
  }
  
  if (!['morning', 'afternoon', 'overnight'].includes(shiftType)) {
    return res.status(400).json({ error: 'Invalid shift type' });
  }
  
  // Check if shift already exists
  const existing = req.db.prepare(`
    SELECT id FROM shifts 
    WHERE date = ? AND shift_type = ?
  `).get(date, shiftType);
  
  if (existing) {
    return res.status(400).json({ error: 'Shift already exists for this date and time' });
  }
  
  // Check hours limit if assigning to someone
  if (assignedTo && !isOpen) {
    const check = checkHoursLimit(req.db, assignedTo, date, shiftType);
    if (check.wouldExceed) {
      return res.status(400).json({ 
        error: 'Would exceed 40-hour limit',
        details: check
      });
    }
  }
  
  try {
    const result = req.db.prepare(`
      INSERT INTO shifts (date, shift_type, assigned_to, is_open, is_preliminary, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      date,
      shiftType,
      isOpen ? null : assignedTo,
      isOpen ? 1 : 0,
      isPreliminary ? 1 : 0,
      notes,
      req.session.userId
    );
    
    // Send notification if assigned to someone
    if (assignedTo && !isOpen) {
      await notify.notifyShiftAssigned(req.db, assignedTo, date, shiftType);
    }
    
    res.json({ success: true, shiftId: result.lastInsertRowid });
  } catch (err) {
    console.error('Create shift error:', err);
    res.status(500).json({ error: 'Failed to create shift' });
  }
});

// POST /api/shifts/bulk - Create multiple shifts (admin only)
router.post('/shifts/bulk', requireAdmin, async (req, res) => {
  const { shifts } = req.body;
  
  if (!Array.isArray(shifts) || shifts.length === 0) {
    return res.status(400).json({ error: 'Shifts array required' });
  }
  
  let created = 0;
  let skipped = 0;
  const errors = [];
  
  try {
    for (const shift of shifts) {
      const { date, shiftType, assignedTo, isOpen } = shift;
      
      // Check if shift already exists
      const existing = req.db.prepare(`
        SELECT id FROM shifts WHERE date = ? AND shift_type = ?
      `).get(date, shiftType);
      
      if (existing) {
        skipped++;
        continue;
      }
      
      // Check hours limit if assigning
      if (assignedTo && !isOpen) {
        const check = checkHoursLimit(req.db, assignedTo, date, shiftType);
        if (check.wouldExceed) {
          errors.push(`${date} ${shiftType}: Would exceed 40-hour limit for staff`);
          skipped++;
          continue;
        }
      }
      
      // Create shift
      req.db.prepare(`
        INSERT INTO shifts (date, shift_type, assigned_to, is_open, created_by)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        date,
        shiftType,
        isOpen ? null : assignedTo,
        isOpen ? 1 : 0,
        req.session.userId
      );
      
      created++;
    }
    
    res.json({ 
      success: true, 
      created, 
      skipped,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error('Bulk create error:', err);
    res.status(500).json({ error: 'Failed to create shifts' });
  }
});

// POST /api/shifts/copy - Copy shifts from one date range to another (admin only)
router.post('/shifts/copy', requireAdmin, async (req, res) => {
  const { sourceDate, targetDate, copyType, keepAssignments, skipExisting } = req.body;
  
  if (!sourceDate || !targetDate) {
    return res.status(400).json({ error: 'Source and target dates required' });
  }
  
  try {
    // Calculate date range based on copy type
    let sourceStart, sourceEnd;
    const src = new Date(sourceDate);
    
    if (copyType === 'day') {
      sourceStart = sourceDate;
      sourceEnd = sourceDate;
    } else if (copyType === 'week') {
      // Get Sunday of the week
      const day = src.getDay();
      const diff = src.getDate() - day;
      sourceStart = new Date(src.setDate(diff)).toISOString().split('T')[0];
      sourceEnd = new Date(src.setDate(diff + 6)).toISOString().split('T')[0];
    } else if (copyType === 'month') {
      sourceStart = new Date(src.getFullYear(), src.getMonth(), 1).toISOString().split('T')[0];
      sourceEnd = new Date(src.getFullYear(), src.getMonth() + 1, 0).toISOString().split('T')[0];
    }
    
    // Get source shifts
    const sourceShifts = req.db.prepare(`
      SELECT date, shift_type, assigned_to, is_open
      FROM shifts
      WHERE date >= ? AND date <= ?
      ORDER BY date, shift_type
    `).all(sourceStart, sourceEnd);
    
    if (sourceShifts.length === 0) {
      return res.json({ success: true, copied: 0, message: 'No shifts found in source range' });
    }
    
    // Calculate date offset
    const srcDate = new Date(sourceStart);
    const tgtDate = new Date(targetDate);
    const dayOffset = Math.floor((tgtDate - srcDate) / (1000 * 60 * 60 * 24));
    
    let copied = 0;
    let skipped = 0;
    
    for (const shift of sourceShifts) {
      const shiftDate = new Date(shift.date);
      shiftDate.setDate(shiftDate.getDate() + dayOffset);
      const newDate = shiftDate.toISOString().split('T')[0];
      
      // Check if shift already exists
      if (skipExisting) {
        const existing = req.db.prepare(`
          SELECT id FROM shifts WHERE date = ? AND shift_type = ?
        `).get(newDate, shift.shift_type);
        
        if (existing) {
          skipped++;
          continue;
        }
      }
      
      // Create copied shift
      req.db.prepare(`
        INSERT OR REPLACE INTO shifts (date, shift_type, assigned_to, is_open, created_by)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        newDate,
        shift.shift_type,
        keepAssignments ? shift.assigned_to : null,
        keepAssignments ? shift.is_open : 1,
        req.session.userId
      );
      
      copied++;
    }
    
    res.json({ success: true, copied, skipped });
  } catch (err) {
    console.error('Copy shifts error:', err);
    res.status(500).json({ error: 'Failed to copy shifts' });
  }
});

// PUT /api/shifts/:id - Update shift
router.put('/shifts/:id', requireAdmin, async (req, res) => {
  const shiftId = parseInt(req.params.id);
  const { assignedTo, isOpen, isPreliminary, notes } = req.body;
  
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
    
    if (assignedTo !== undefined) { updates.push('assigned_to = ?'); values.push(isOpen ? null : assignedTo); }
    if (isOpen !== undefined) { updates.push('is_open = ?'); values.push(isOpen ? 1 : 0); }
    if (isPreliminary !== undefined) { updates.push('is_preliminary = ?'); values.push(isPreliminary ? 1 : 0); }
    if (notes !== undefined) { updates.push('notes = ?'); values.push(notes); }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(shiftId);
    
    req.db.prepare(`
      UPDATE shifts 
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...values);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update shift' });
  }
});

// DELETE /api/shifts/:id - Delete shift
router.delete('/shifts/:id', requireAdmin, (req, res) => {
  const shiftId = parseInt(req.params.id);
  
  try {
    req.db.prepare('DELETE FROM shifts WHERE id = ?').run(shiftId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete shift' });
  }
});

// ═══════════════════════════════════════════════════════════
// SHIFT REQUEST ROUTES
// ═══════════════════════════════════════════════════════════

// GET /api/shift-requests - Get shift requests
router.get('/shift-requests', requireAuth, (req, res) => {
  const isAdmin = req.session.role === 'admin';
  
  let query = `
    SELECT 
      sr.id, sr.shift_id, sr.requester_id, sr.status, sr.admin_note, sr.created_at,
      s.date, s.shift_type,
      u.full_name as requester_name
    FROM shift_requests sr
    JOIN shifts s ON sr.shift_id = s.id
    JOIN users u ON sr.requester_id = u.id
  `;
  
  if (!isAdmin) {
    query += ' WHERE sr.requester_id = ?';
  }
  
  query += ' ORDER BY sr.created_at DESC';
  
  const requests = isAdmin 
    ? req.db.prepare(query).all()
    : req.db.prepare(query).all(req.session.userId);
  
  res.json({ requests });
});

// POST /api/shift-requests - Create shift request
router.post('/shift-requests', requireAuth, async (req, res) => {
  const { shiftId } = req.body;
  
  if (!shiftId) {
    return res.status(400).json({ error: 'Shift ID required' });
  }
  
  // Verify shift is open
  const shift = req.db.prepare('SELECT id, is_open, date, shift_type FROM shifts WHERE id = ?').get(shiftId);
  if (!shift) {
    return res.status(404).json({ error: 'Shift not found' });
  }
  
  if (!shift.is_open) {
    return res.status(400).json({ error: 'Shift is not open for requests' });
  }
  
  // Check if already requested
  const existing = req.db.prepare(`
    SELECT id FROM shift_requests 
    WHERE shift_id = ? AND requester_id = ? AND status = 'pending'
  `).get(shiftId, req.session.userId);
  
  if (existing) {
    return res.status(400).json({ error: 'You already requested this shift' });
  }
  
  // Check hours limit
  const check = checkHoursLimit(req.db, req.session.userId, shift.date, shift.shift_type);
  if (check.wouldExceed) {
    return res.status(400).json({ 
      error: 'Would exceed 40-hour limit',
      details: check 
    });
  }
  
  try {
    const result = req.db.prepare(`
      INSERT INTO shift_requests (shift_id, requester_id)
      VALUES (?, ?)
    `).run(shiftId, req.session.userId);

    // Notify all admins of the new open shift request
    await notify.notifyAdminShiftRequest(req.db, result.lastInsertRowid);

    res.json({ success: true, requestId: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create shift request' });
  }
});

// POST /api/shift-requests/:id/approve - Approve shift request (admin only)
router.post('/shift-requests/:id/approve', requireAdmin, async (req, res) => {
  const requestId = parseInt(req.params.id);
  const { note } = req.body;
  
  const request = req.db.prepare(`
    SELECT sr.shift_id, sr.requester_id, s.date, s.shift_type
    FROM shift_requests sr
    JOIN shifts s ON sr.shift_id = s.id
    WHERE sr.id = ? AND sr.status = 'pending'
  `).get(requestId);
  
  if (!request) {
    return res.status(404).json({ error: 'Request not found or already processed' });
  }
  
  try {
    // Update request status
    req.db.prepare(`
      UPDATE shift_requests 
      SET status = 'approved', admin_note = ?, approved_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(note, req.session.userId, requestId);
    
    // Assign shift to requester
    req.db.prepare(`
      UPDATE shifts
      SET assigned_to = ?, is_open = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(request.requester_id, request.shift_id);
    
    // Send notification
    await notify.notifyShiftRequestApproved(req.db, request.requester_id, request.shift_id, note);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve request' });
  }
});

// POST /api/shift-requests/:id/deny - Deny shift request (admin only)
router.post('/shift-requests/:id/deny', requireAdmin, async (req, res) => {
  const requestId = parseInt(req.params.id);
  const { note } = req.body;
  
  try {
    const request = req.db.prepare(`
      SELECT shift_id, requester_id FROM shift_requests WHERE id = ?
    `).get(requestId);
    
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    req.db.prepare(`
      UPDATE shift_requests 
      SET status = 'denied', admin_note = ?, approved_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(note, req.session.userId, requestId);
    
    // Send notification
    await notify.notifyShiftRequestDenied(req.db, request.requester_id, request.shift_id, note);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deny request' });
  }
});

// ═══════════════════════════════════════════════════════════
// TRADE REQUEST ROUTES
// ═══════════════════════════════════════════════════════════

// GET /api/trade-requests - Get trade requests
router.get('/trade-requests', requireAuth, (req, res) => {
  const isAdmin = req.session.role === 'admin';
  
  let query = `
    SELECT 
      tr.id, tr.requester_id, tr.target_id, tr.status,
      tr.requester_shift_id, tr.target_shift_id,
      tr.requester_approved, tr.target_approved, tr.admin_approved,
      tr.requester_note, tr.target_note, tr.admin_note, tr.created_at,
      u1.full_name as requester_name,
      u2.full_name as target_name,
      s1.date as req_date, s1.shift_type as req_shift,
      s2.date as tgt_date, s2.shift_type as tgt_shift
    FROM trade_requests tr
    JOIN users u1 ON tr.requester_id = u1.id
    JOIN users u2 ON tr.target_id = u2.id
    JOIN shifts s1 ON tr.requester_shift_id = s1.id
    JOIN shifts s2 ON tr.target_shift_id = s2.id
  `;
  
  if (!isAdmin) {
    query += ' WHERE tr.requester_id = ? OR tr.target_id = ?';
  }
  
  query += ' ORDER BY tr.created_at DESC';
  
  const requests = isAdmin 
    ? req.db.prepare(query).all()
    : req.db.prepare(query).all(req.session.userId, req.session.userId);
  
  res.json({ requests });
});

// POST /api/trade-requests - Create trade request
router.post('/trade-requests', requireAuth, async (req, res) => {
  const { myShiftId, theirShiftId, note } = req.body;
  
  if (!myShiftId || !theirShiftId) {
    return res.status(400).json({ error: 'Both shift IDs required' });
  }
  
  // Verify both shifts
  const myShift = req.db.prepare(`
    SELECT id, assigned_to, date, shift_type FROM shifts WHERE id = ?
  `).get(myShiftId);
  
  const theirShift = req.db.prepare(`
    SELECT id, assigned_to, date, shift_type FROM shifts WHERE id = ?
  `).get(theirShiftId);
  
  if (!myShift || !theirShift) {
    return res.status(404).json({ error: 'One or both shifts not found' });
  }
  
  if (myShift.assigned_to !== req.session.userId) {
    return res.status(403).json({ error: 'You are not assigned to the first shift' });
  }
  
  if (!theirShift.assigned_to) {
    return res.status(400).json({ error: 'Target shift is not assigned' });
  }
  
  // Check 40-hour limit for BOTH staff members BEFORE creating request
  // Requester will GIVE their shift and GET the target's shift
  const requesterCheck = checkHoursLimit(
    req.db,
    req.session.userId,
    theirShift.date,
    theirShift.shift_type,
    myShiftId // Exclude their current shift since they're giving it away
  );
  
  if (requesterCheck.wouldExceed) {
    return res.status(400).json({
      error: 'Trade request denied: You would exceed 40-hour weekly limit',
      details: requesterCheck
    });
  }
  
  // Target will GIVE their shift and GET the requester's shift
  const targetCheck = checkHoursLimit(
    req.db,
    theirShift.assigned_to,
    myShift.date,
    myShift.shift_type,
    theirShiftId // Exclude their current shift since they're giving it away
  );
  
  if (targetCheck.wouldExceed) {
    return res.status(400).json({
      error: 'Trade request denied: Target staff would exceed 40-hour weekly limit',
      details: targetCheck
    });
  }
  
  try {
    const result = req.db.prepare(`
      INSERT INTO trade_requests (
        requester_shift_id, target_shift_id, 
        requester_id, target_id, requester_note
      ) VALUES (?, ?, ?, ?, ?)
    `).run(myShiftId, theirShiftId, req.session.userId, theirShift.assigned_to, note);
    
    // Notify all three parties
    await Promise.all([
      // Requester: "You sent a swap request"
      notify.notifyTradeRequestSent(req.db, req.session.userId, result.lastInsertRowid),
      // Target: "You received a swap request" (includes schedule link)
      notify.notifyTradeRequestReceived(req.db, theirShift.assigned_to, result.lastInsertRowid),
      // All admins: "A swap request was sent between X and Y"
      notify.notifyAdminTradeRequest(req.db, result.lastInsertRowid)
    ]);

    res.json({ success: true, requestId: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create trade request' });
  }
});

// POST /api/trade-requests/:id/approve - Approve trade request (as target staff)
router.post('/trade-requests/:id/approve', requireAuth, async (req, res) => {
  const requestId = parseInt(req.params.id);
  const { note } = req.body;
  
  const trade = req.db.prepare(`
    SELECT id, requester_id, target_id, status
    FROM trade_requests
    WHERE id = ?
  `).get(requestId);
  
  if (!trade) {
    return res.status(404).json({ error: 'Trade request not found' });
  }
  
  if (trade.target_id !== req.session.userId) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  
  if (trade.status !== 'pending') {
    return res.status(400).json({ error: 'Trade already processed' });
  }
  
  try {
    req.db.prepare(`
      UPDATE trade_requests
      SET target_approved = 1, target_note = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(note, requestId);
    
    // Notify requester
    await notify.notifyTradeApproved(req.db, trade.requester_id, requestId);
    
    res.json({ success: true, message: 'Trade approved, waiting for admin approval' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve trade' });
  }
});

// POST /api/trade-requests/:id/deny - Deny trade request (as target staff)
router.post('/trade-requests/:id/deny', requireAuth, async (req, res) => {
  const requestId = parseInt(req.params.id);
  const { note } = req.body;
  
  const trade = req.db.prepare(`
    SELECT id, requester_id, target_id, target_approved FROM trade_requests WHERE id = ?
  `).get(requestId);
  
  if (!trade) {
    return res.status(404).json({ error: 'Trade request not found' });
  }
  
  if (trade.target_id !== req.session.userId) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  
  try {
    req.db.prepare(`
      UPDATE trade_requests
      SET status = 'denied', target_note = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(note, requestId);
    
    // Notify requester
    const targetUser = req.db.prepare('SELECT full_name FROM users WHERE id = ?').get(trade.target_id);
    await notify.notifyTradeDenied(req.db, trade.requester_id, targetUser.full_name, note);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deny trade' });
  }
});

// POST /api/trade-requests/:id/finalize - Admin finalize trade
router.post('/trade-requests/:id/finalize', requireAdmin, async (req, res) => {
  const requestId = parseInt(req.params.id);
  const { note } = req.body;
  
  const trade = req.db.prepare(`
    SELECT 
      tr.requester_shift_id, tr.target_shift_id,
      tr.requester_id, tr.target_id,
      tr.requester_approved, tr.target_approved,
      s1.date as requester_shift_date, s1.shift_type as requester_shift_type,
      s2.date as target_shift_date, s2.shift_type as target_shift_type
    FROM trade_requests tr
    JOIN shifts s1 ON tr.requester_shift_id = s1.id
    JOIN shifts s2 ON tr.target_shift_id = s2.id
    WHERE tr.id = ?
  `).get(requestId);
  
  if (!trade) {
    return res.status(404).json({ error: 'Trade not found' });
  }
  
  if (!trade.requester_approved || !trade.target_approved) {
    return res.status(400).json({ error: 'Both parties must approve first' });
  }
  
  // Check 40-hour limit for BOTH staff members in affected pay periods
  // Requester will LOSE their shift and GAIN the target's shift
  const requesterCheck = checkHoursLimit(
    req.db, 
    trade.requester_id, 
    trade.target_shift_date, 
    trade.target_shift_type,
    trade.requester_shift_id // Exclude their current shift since they're giving it away
  );
  
  if (requesterCheck.wouldExceed) {
    return res.status(400).json({ 
      error: `Trade denied: ${trade.requester_id === req.session.userId ? 'You' : 'Requester'} would exceed 40-hour limit`,
      details: requesterCheck,
      staffMember: 'requester'
    });
  }
  
  // Target will LOSE their shift and GAIN the requester's shift
  const targetCheck = checkHoursLimit(
    req.db,
    trade.target_id,
    trade.requester_shift_date,
    trade.requester_shift_type,
    trade.target_shift_id // Exclude their current shift since they're giving it away
  );
  
  if (targetCheck.wouldExceed) {
    return res.status(400).json({ 
      error: `Trade denied: Target staff would exceed 40-hour limit`,
      details: targetCheck,
      staffMember: 'target'
    });
  }
  
  try {
    // Swap shift assignments
    req.db.prepare(`
      UPDATE shifts SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(trade.requester_id, trade.target_shift_id);
    
    req.db.prepare(`
      UPDATE shifts SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(trade.target_id, trade.requester_shift_id);
    
    // Update trade status
    req.db.prepare(`
      UPDATE trade_requests
      SET status = 'approved', admin_approved = 1, admin_note = ?, approved_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(note, req.session.userId, requestId);
    
    // Notify both parties
    await notify.notifyTradeFinalized(req.db, requestId, note);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Trade finalize error:', err);
    res.status(500).json({ error: 'Failed to finalize trade' });
  }
});

// ═══════════════════════════════════════════════════════════
// TIME OFF REQUEST ROUTES
// ═══════════════════════════════════════════════════════════

// GET /api/time-off-requests - Get time off requests
router.get('/time-off-requests', requireAuth, (req, res) => {
  const isAdmin = req.session.role === 'admin';
  
  let query = `
    SELECT 
      tor.id, tor.requester_id, tor.request_type, tor.shift_id,
      tor.start_date, tor.end_date, tor.reason, tor.status,
      tor.admin_note, tor.created_at,
      u.full_name as requester_name,
      s.date as shift_date, s.shift_type
    FROM time_off_requests tor
    JOIN users u ON tor.requester_id = u.id
    LEFT JOIN shifts s ON tor.shift_id = s.id
  `;
  
  if (!isAdmin) {
    query += ' WHERE tor.requester_id = ?';
  }
  
  query += ' ORDER BY tor.created_at DESC';
  
  const requests = isAdmin 
    ? req.db.prepare(query).all()
    : req.db.prepare(query).all(req.session.userId);
  
  res.json({ requests });
});

// POST /api/time-off-requests - Create time off request
router.post('/time-off-requests', requireAuth, (req, res) => {
  const { requestType, shiftId, startDate, endDate, reason } = req.body;
  
  if (!requestType || !['assigned_shift', 'future_vacation'].includes(requestType)) {
    return res.status(400).json({ error: 'Invalid request type' });
  }
  
  if (requestType === 'assigned_shift' && !shiftId) {
    return res.status(400).json({ error: 'Shift ID required for assigned shift requests' });
  }
  
  if (requestType === 'future_vacation' && !startDate) {
    return res.status(400).json({ error: 'Start date required for vacation requests' });
  }
  
  try {
    const result = req.db.prepare(`
      INSERT INTO time_off_requests (
        requester_id, request_type, shift_id, start_date, end_date, reason
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      req.session.userId,
      requestType,
      shiftId || null,
      startDate || null,
      endDate || null,
      reason || null
    );
    
    res.json({ success: true, requestId: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create time off request' });
  }
});

// POST /api/time-off-requests/:id/approve - Approve time off (admin only)
router.post('/time-off-requests/:id/approve', requireAdmin, async (req, res) => {
  const requestId = parseInt(req.params.id);
  const { note } = req.body;
  
  try {
    req.db.prepare(`
      UPDATE time_off_requests
      SET status = 'approved', admin_note = ?, approved_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(note, req.session.userId, requestId);
    
    // If it's an assigned shift, mark shift as open
    const request = req.db.prepare(`
      SELECT shift_id FROM time_off_requests WHERE id = ?
    `).get(requestId);
    
    if (request.shift_id) {
      req.db.prepare(`
        UPDATE shifts SET assigned_to = NULL, is_open = 1 WHERE id = ?
      `).run(request.shift_id);
    }
    
    // Notify requester
    await notify.notifyTimeOffApproved(req.db, requestId);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve time off' });
  }
});

// POST /api/time-off-requests/:id/deny - Deny time off (admin only)
router.post('/time-off-requests/:id/deny', requireAdmin, async (req, res) => {
  const requestId = parseInt(req.params.id);
  const { note } = req.body;
  
  try {
    req.db.prepare(`
      UPDATE time_off_requests
      SET status = 'denied', admin_note = ?, approved_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(note, req.session.userId, requestId);
    
    // Notify requester
    await notify.notifyTimeOffDenied(req.db, requestId, note);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deny time off' });
  }
});

// ═══════════════════════════════════════════════════════════
// EMERGENCY ABSENCE ROUTES
// ═══════════════════════════════════════════════════════════

// POST /api/absences - Report emergency absence
router.post('/absences', requireAuth, async (req, res) => {
  const { shiftId, reason } = req.body;
  
  if (!shiftId) {
    return res.status(400).json({ error: 'Shift ID required' });
  }
  
  const shift = req.db.prepare(`
    SELECT id, assigned_to, date FROM shifts WHERE id = ?
  `).get(shiftId);
  
  if (!shift) {
    return res.status(404).json({ error: 'Shift not found' });
  }
  
  const isAdmin = req.session.role === 'admin';
  
  // Non-admins can only report their own absences
  if (!isAdmin && shift.assigned_to !== req.session.userId) {
    return res.status(403).json({ error: 'Can only report your own absences' });
  }
  
  try {
    req.db.prepare(`
      INSERT INTO absences (shift_id, user_id, reported_by, reason)
      VALUES (?, ?, ?, ?)
    `).run(shiftId, shift.assigned_to, req.session.userId, reason);
    
    // Notify all admins
    const staffUser = req.db.prepare('SELECT full_name FROM users WHERE id = ?').get(shift.assigned_to);
    await notify.notifyEmergencyAbsence(req.db, shiftId, staffUser.full_name);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to report absence' });
  }
});

// ═══════════════════════════════════════════════════════════
// DASHBOARD / STATS ROUTES
// ═══════════════════════════════════════════════════════════

// GET /api/dashboard - Get user dashboard data
router.get('/dashboard', requireAuth, (req, res) => {
  const isAdmin = req.session.role === 'admin';
  const userId = req.session.userId;
  
  if (isAdmin) {
    // Admin dashboard
    const pendingShiftRequests = req.db.prepare(`
      SELECT COUNT(*) as count FROM shift_requests WHERE status = 'pending'
    `).get().count;
    
    const pendingTrades = req.db.prepare(`
      SELECT COUNT(*) as count FROM trade_requests 
      WHERE status = 'pending' AND requester_approved = 1 AND target_approved = 1
    `).get().count;
    
    const pendingTimeOff = req.db.prepare(`
      SELECT COUNT(*) as count FROM time_off_requests WHERE status = 'pending'
    `).get().count;
    
    const recentAbsences = req.db.prepare(`
      SELECT COUNT(*) as count FROM absences 
      WHERE reported_at >= datetime('now', '-7 days')
    `).get().count;
    
    res.json({
      pendingApprovals: {
        shiftRequests: pendingShiftRequests,
        trades: pendingTrades,
        timeOff: pendingTimeOff,
        total: pendingShiftRequests + pendingTrades + pendingTimeOff
      },
      recentAbsences
    });
  } else {
    // Staff dashboard
    const today = new Date().toISOString().split('T')[0];
    const weekLater = new Date();
    weekLater.setDate(weekLater.getDate() + 7);
    const weekLaterStr = weekLater.toISOString().split('T')[0];
    
    const upcomingShifts = req.db.prepare(`
      SELECT s.id, s.date, s.shift_type
      FROM shifts s
      WHERE s.assigned_to = ? AND s.date >= ? AND s.date <= ?
      ORDER BY s.date ASC, 
        CASE s.shift_type 
          WHEN 'morning' THEN 1 
          WHEN 'afternoon' THEN 2 
          WHEN 'overnight' THEN 3 
        END
    `).all(userId, today, weekLaterStr);
    
    const weeklyHours = calculateWeeklyHours(req.db, userId, today);
    
    const pendingRequests = req.db.prepare(`
      SELECT COUNT(*) as count FROM shift_requests 
      WHERE requester_id = ? AND status = 'pending'
    `).get(userId).count;
    
    res.json({
      upcomingShifts,
      weeklyHours,
      pendingRequests
    });
  }
});

// ═══════════════════════════════════════════════════════════
// DATA EXPORT/IMPORT (for database persistence workaround)
// ═══════════════════════════════════════════════════════════

// GET /api/export-data - Export all staff and shifts (admin only)
router.get('/export-data', requireAdmin, (req, res) => {
  try {
    // Export all staff (except system accounts)
    // password is the bcrypt hash — safe to store in backup, never plaintext
    const staff = req.db.prepare(`
      SELECT id, username, password, full_name, role, job_title,
             tile_color, text_color, email, phone, telegram_id,
             is_approved, is_active, must_change_password
      FROM users
      WHERE username != '_open'
      ORDER BY id
    `).all();
    
    // Separate admin data (to restore telegram_id but not password)
    const adminData = staff.find(s => s.username === 'admin');
    const regularStaff = staff.filter(s => s.username !== 'admin');
    
    // Export all shifts
    const shifts = req.db.prepare(`
      SELECT s.id, s.date, s.shift_type, s.assigned_to, s.is_open, 
             s.is_preliminary, s.notes,
             u.username as assigned_username
      FROM shifts s
      LEFT JOIN users u ON s.assigned_to = u.id
      ORDER BY s.date, s.shift_type
    `).all();
    
    // Export shift templates if they exist
    let templates = null;
    try {
      const templatesRow = req.db.prepare('SELECT value FROM settings WHERE key = ?').get('shift_templates');
      if (templatesRow) {
        templates = JSON.parse(templatesRow.value);
      }
    } catch (err) {
      // Settings table might not exist yet
    }
    
    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      staff: regularStaff,
      shifts: shifts,
      templates: templates,
      adminTelegramId: adminData?.telegram_id || null  // Save admin's telegram ID separately
    };
    
    res.json(exportData);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// POST /api/import-data - Import staff and shifts (admin only)
router.post('/import-data', requireAdmin, async (req, res) => {
  const { staff, shifts, templates, adminTelegramId } = req.body;
  
  if (!staff || !shifts) {
    return res.status(400).json({ error: 'Invalid import data' });
  }
  
  try {
    let staffImported = 0;
    
    // Restore admin's Telegram ID if provided
    if (adminTelegramId) {
      req.db.prepare(`
        UPDATE users 
        SET telegram_id = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE username = 'admin'
      `).run(adminTelegramId);
      console.log('✅ Admin Telegram ID restored:', adminTelegramId);
    }
    let shiftsImported = 0;
    let staffIdMap = {}; // Map old IDs to new IDs
    
    // Import staff members
    for (const person of staff) {
      // Skip system users (admin and _open are hard-coded)
      if (person.username === "admin" || person.username === "_open") {
        const existing = req.db.prepare("SELECT id FROM users WHERE username = ?").get(person.username);
        if (existing) staffIdMap[person.id] = existing.id;
        continue;
      }
      // Skip if username already exists
      const existing = req.db.prepare('SELECT id FROM users WHERE username = ?').get(person.username);
      
      if (existing) {
        // User exists, map the ID
        staffIdMap[person.id] = existing.id;
        continue;
      }
      
      // Use the exported password hash if present, otherwise generate a temp one
      // (person.password is a bcrypt hash from the backup — never plaintext)
      const passwordToStore = person.password
        ? person.password
        : await bcrypt.hash('temp' + Math.random().toString(36).slice(2, 8), 10);
      // If we have a real hash from backup, honour the must_change_password flag from export.
      // If we had to generate a temp password, force a change on next login.
      const mustChange = person.password
        ? (person.must_change_password !== undefined ? person.must_change_password : 0)
        : 1;

      const result = req.db.prepare(`
        INSERT INTO users (username, password, full_name, role, job_title, 
                          tile_color, text_color, email, phone, telegram_id,
                          is_approved, is_active, must_change_password)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        person.username,
        passwordToStore,
        person.full_name,
        person.role,
        person.job_title,
        person.tile_color,
        person.text_color,
        person.email,
        person.phone,
        person.telegram_id,
        person.is_approved !== undefined ? person.is_approved : 1,
        person.is_active !== undefined ? person.is_active : 1,
        mustChange
      );
      
      staffIdMap[person.id] = result.lastInsertRowid;
      staffImported++;
    }
    
    // Import shifts
    for (const shift of shifts) {
      // Check if shift already exists
      const existing = req.db.prepare(`
        SELECT id FROM shifts WHERE date = ? AND shift_type = ?
      `).get(shift.date, shift.shift_type);
      
      if (existing) {
        shiftsImported++; // Count as imported (already exists)
        continue;
      }
      
      // Map the assigned_to ID
      let assignedTo = null;
      if (shift.assigned_to && !shift.is_open) {
        assignedTo = staffIdMap[shift.assigned_to];
        if (!assignedTo) {
          // Try to find by username
          if (shift.assigned_username) {
            const user = req.db.prepare('SELECT id FROM users WHERE username = ?').get(shift.assigned_username);
            if (user) {
              assignedTo = user.id;
            }
          }
        }
      }
      
      req.db.prepare(`
        INSERT INTO shifts (date, shift_type, assigned_to, is_open, is_preliminary, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        shift.date,
        shift.shift_type,
        assignedTo,
        shift.is_open ? 1 : 0,
        shift.is_preliminary ? 1 : 0,
        shift.notes,
        req.session.userId
      );
      
      shiftsImported++;
    }
    
    // Import templates if provided
    if (templates) {
      try {
        // Create settings table if it doesn't exist
        req.db.prepare(`
          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `).run();
        
        req.db.prepare(`
          INSERT OR REPLACE INTO settings (key, value, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
        `).run('shift_templates', JSON.stringify(templates));
      } catch (err) {
        console.error('Template import error:', err);
      }
    }
    
    res.json({ 
      success: true, 
      staffImported,
      shiftsImported,
      message: `Imported ${staffImported} staff and ${shiftsImported} shifts`
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Failed to import data: ' + err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// SHIFT TEMPLATES
// ═══════════════════════════════════════════════════════════

// GET /api/shift-templates - Get shift templates
router.get('/shift-templates', requireAuth, (req, res) => {
  try {
    // Create settings table if it doesn't exist
    req.db.prepare(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    const result = req.db.prepare('SELECT value FROM settings WHERE key = ?').get('shift_templates');
    
    if (result) {
      res.json(JSON.parse(result.value));
    } else {
      // Return defaults
      res.json({
        morning: { label: 'Morning', time: '7:00 AM – 3:00 PM', hours: 8.0, icon: '🌅' },
        afternoon: { label: 'Afternoon', time: '3:00 PM – 7:00 PM', hours: 4.0, icon: '🌆' },
        overnight: { label: 'Overnight', time: '7:00 PM – 7:00 AM', hours: 12.0, icon: '🌙' }
      });
    }
  } catch (err) {
    console.error('Get templates error:', err);
    res.status(500).json({ error: 'Failed to get templates' });
  }
});

// POST /api/shift-templates - Save shift templates (admin only)
router.post('/shift-templates', requireAdmin, (req, res) => {
  const { morning, afternoon, overnight } = req.body;
  
  if (!morning || !afternoon || !overnight) {
    return res.status(400).json({ error: 'All shift templates required' });
  }
  
  try {
    // Create settings table if it doesn't exist
    req.db.prepare(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
    
    const templates = { morning, afternoon, overnight };
    
    req.db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `).run('shift_templates', JSON.stringify(templates));
    
    res.json({ success: true });
  } catch (err) {
    console.error('Save templates error:', err);
    res.status(500).json({ error: 'Failed to save templates' });
  }
});

// ═══════════════════════════════════════════════════════════
// SCHEDULE NOTIFICATIONS
// ═══════════════════════════════════════════════════════════

// POST /api/send-schedule-notifications - Send notifications for schedule changes
router.post('/send-schedule-notifications', requireAdmin, async (req, res) => {
  const { changes } = req.body;
  
  console.log("📤 Received changes to notify:", JSON.stringify(changes, null, 2));
  if (!changes || !Array.isArray(changes)) {
    return res.status(400).json({ error: 'Changes array required' });
  }
  
  try {
    const notifications = {}; // Group by staff ID
    
    // Process each change and group by affected staff
    for (const change of changes) {
      const { originalStaffId, newStaffId, date, shiftType, isOpen } = change;
      
      console.log("🔍 Processing change:", {originalStaffId, newStaffId, date, shiftType});
      // Notify staff who was unassigned
      if (originalStaffId && originalStaffId !== newStaffId) {
        if (!notifications[originalStaffId]) notifications[originalStaffId] = [];
        console.log(">>> Will notify REMOVED for staff ID:", originalStaffId);
        notifications[originalStaffId].push({
          type: 'removed',
          date,
          shiftType
        });
      }
      
      // Notify staff who was assigned
      if (newStaffId && newStaffId !== originalStaffId) {
        if (!notifications[newStaffId]) notifications[newStaffId] = [];
        console.log(">>> Will notify ASSIGNED for staff ID:", newStaffId);
        notifications[newStaffId].push({
          type: 'assigned',
          date,
          shiftType
        });
      }
    console.log("📊 Grouped notifications by staff:", notifications);
    }
    console.log("📋 Staff IDs to notify:", Object.keys(notifications));
    
    // Send notifications
    let notified = 0;
    for (const [staffId, staffChanges] of Object.entries(notifications)) {
      try {
        console.log("🔍 Looking up staff ID:", staffId);
        const staff = req.db.prepare("SELECT telegram_id, full_name FROM users WHERE id = ?").get(parseInt(staffId));
        console.log("🔍 Staff found:", staff);
        
        if (staff && staff.telegram_id) {
          let message = `📅 Schedule Update for ${staff.full_name}:\n\n`;
          
          staffChanges.forEach(change => {
            const readableDate = new Date(change.date).toLocaleDateString('en-US', { 
              weekday: 'short', 
              month: 'short', 
              day: 'numeric' 
            });
            
            if (change.type === 'assigned') {
              message += `✅ Assigned: ${change.shiftType} shift on ${readableDate}\n`;
            } else if (change.type === 'removed') {
              message += `❌ Removed: ${change.shiftType} shift on ${readableDate}\n`;
            }
          });
          
          
          // Add web app link
          message += "\n🔗 Check the schedule for details:\n";
          message += process.env.APP_URL || "https://your-app.railway.app";
          await telegram.sendNotification(staff.telegram_id, message);
          notified++;
          console.log("📧 Sending to", staff.full_name, ":", message);
        }
      } catch (err) {
        console.error(`Failed to notify staff ${staffId}:`, err);
      }
    }
    
    res.json({ success: true, notified, totalChanges: changes.length });
  } catch (err) {
    console.error('Send notifications error:', err);
    res.status(500).json({ error: 'Failed to send notifications' });
  }
});

// POST /api/remind-admin-notifications - Remind admin to send notifications
router.post('/remind-admin-notifications', requireAdmin, async (req, res) => {
  const { changeCount } = req.body;
  const adminId = req.session.userId;
  
  try {
    const admin = req.db.prepare('SELECT telegram_id, full_name FROM users WHERE id = ?').get(adminId);
    
    if (admin && admin.telegram_id) {
      const message = `⏰ Reminder: You have ${changeCount} unsent schedule ${changeCount === 1 ? 'change' : 'changes'}.\n\nDon't forget to send notifications!\n\n🔗 ${process.env.APP_URL || 'https://your-app.railway.app'}`;
      await telegram.sendNotification(admin.telegram_id, message);
      res.json({ success: true });
    } else {
      res.json({ success: false, reason: 'No Telegram ID for admin' });
    }
  } catch (err) {
    console.error('Reminder error:', err);
    res.status(500).json({ error: 'Failed to send reminder' });
  }
});


// ═══════════════════════════════════════════════════════════
// ISSUE REPORTING
// ═══════════════════════════════════════════════════════════

// POST /api/report-issue - Staff reports a general issue
router.post('/report-issue', requireAuth, async (req, res) => {
  const { details, notifyAdmin } = req.body;
  if (!details || !details.trim()) {
    return res.status(400).json({ error: 'Details required' });
  }

  try {
    // Always notify House Manager
    const houseManagers = req.db.prepare(`
      SELECT id, telegram_id, full_name FROM users
      WHERE job_title = 'House Manager' AND is_active = 1 AND telegram_id IS NOT NULL
    `).all();

    const admins = notifyAdmin
      ? req.db.prepare(`
          SELECT id, telegram_id, full_name FROM users
          WHERE (role = 'admin' OR job_title = 'Admin') AND is_active = 1 AND telegram_id IS NOT NULL
        `).all()
      : [];

    const reporter = req.db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.session.userId);
    const message =
      `⚠️ <b>Issue Report</b>\n\n` +
      `<b>Reported by:</b> ${reporter?.full_name || 'Staff'}\n` +
      `<b>Time:</b> ${new Date().toLocaleString('en-US')}\n\n` +
      `<b>Details:</b>\n${details}`;

    const recipients = [
      ...houseManagers,
      ...(notifyAdmin ? admins : [])
    ];

    const seen = new Set();
    let notified = 0;
    for (const r of recipients) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      if (r.telegram_id) {
        await telegram.sendNotification(r.telegram_id, message);
        notified++;
      }
    }

    res.json({ success: true, notified });
  } catch (err) {
    console.error('Report issue error:', err);
    res.status(500).json({ error: 'Failed to report issue' });
  }
});

// ═══════════════════════════════════════════════════════════
// ENHANCED ABSENCE - notify on-duty staff too
// Override the existing /api/absences to add on-duty notification
// ═══════════════════════════════════════════════════════════

// POST /api/absences/enhanced - Enhanced absence with on-duty flag
router.post('/absences/enhanced', requireAuth, async (req, res) => {
  const { shiftId, reason, reportedWhileOnDuty } = req.body;
  if (!shiftId) return res.status(400).json({ error: 'Shift ID required' });

  const shift = req.db.prepare('SELECT id, assigned_to, date, shift_type FROM shifts WHERE id = ?').get(shiftId);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });

  if (shift.assigned_to !== req.session.userId) {
    return res.status(403).json({ error: 'Can only report your own absences' });
  }

  try {
    req.db.prepare(`
      INSERT INTO absences (shift_id, user_id, reported_by, reason)
      VALUES (?, ?, ?, ?)
    `).run(shiftId, shift.assigned_to, req.session.userId, reason);

    const staffUser = req.db.prepare('SELECT full_name FROM users WHERE id = ?').get(shift.assigned_to);
    const shiftDef = { morning: 'Morning', afternoon: 'Afternoon', overnight: 'Overnight' }[shift.shift_type];
    const dateStr = new Date(shift.date + 'T12:00:00').toLocaleDateString('en-US',
      { weekday: 'short', month: 'short', day: 'numeric' });

    const baseMsg =
      `🚨 <b>Emergency Absence</b>\n\n` +
      `<b>Staff:</b> ${staffUser?.full_name}\n` +
      `<b>Shift:</b> ${dateStr} — ${shiftDef}\n` +
      `<b>Reason:</b> ${reason}\n\n` +
      `Immediate coverage needed!`;

    // Always notify House Managers and Admins
    const houseManagers = req.db.prepare(`
      SELECT telegram_id FROM users WHERE job_title = 'House Manager' AND is_active = 1 AND telegram_id IS NOT NULL
    `).all();
    const admins = req.db.prepare(`
      SELECT telegram_id FROM users WHERE (role = 'admin' OR job_title = 'Admin') AND is_active = 1 AND telegram_id IS NOT NULL
    `).all();

    const notifyList = [...houseManagers, ...admins];

    // If NOT reported while on duty, also notify current shift staff member
    if (!reportedWhileOnDuty) {
      const today = new Date().toISOString().split('T')[0];
      const currentShiftTypes = ['morning', 'afternoon', 'overnight'];
      const now = new Date();
      const hour = now.getHours();
      const currentType = hour < 7 ? 'overnight' : hour < 15 ? 'morning' : hour < 19 ? 'afternoon' : 'overnight';

      const onDuty = req.db.prepare(`
        SELECT u.telegram_id FROM shifts s
        JOIN users u ON s.assigned_to = u.id
        WHERE s.date = ? AND s.shift_type = ? AND s.assigned_to != ? AND u.telegram_id IS NOT NULL
        LIMIT 1
      `).get(today, currentType, req.session.userId);

      if (onDuty) notifyList.push(onDuty);
    }

    const seen = new Set();
    for (const r of notifyList) {
      if (!r.telegram_id || seen.has(r.telegram_id)) continue;
      seen.add(r.telegram_id);
      await telegram.sendNotification(r.telegram_id, baseMsg);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Enhanced absence error:', err);
    res.status(500).json({ error: 'Failed to report absence' });
  }
});

// ═══════════════════════════════════════════════════════════
// CONTACT - send Telegram from one staff to another
// ═══════════════════════════════════════════════════════════

// POST /api/contact-telegram - Send a Telegram message to a staff member
router.post('/contact-telegram', requireAuth, async (req, res) => {
  const { targetStaffId, message } = req.body;
  if (!targetStaffId || !message) {
    return res.status(400).json({ error: 'targetStaffId and message required' });
  }

  const sender = req.db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.session.userId);
  const target = req.db.prepare('SELECT telegram_id, full_name FROM users WHERE id = ?').get(targetStaffId);

  if (!target) return res.status(404).json({ error: 'Staff member not found' });
  if (!target.telegram_id) return res.status(400).json({ error: 'That staff member has no Telegram linked' });

  const fullMsg =
    `💬 <b>Message from ${sender?.full_name || 'A colleague'}</b>\n\n${message}\n\n` +
    `<i>(Reply via Telegram or phone)</i>`;

  const sent = await telegram.sendNotification(target.telegram_id, fullMsg);
  if (!sent) return res.status(500).json({ error: 'Failed to send Telegram message' });

  res.json({ success: true });
});


module.exports = router;
