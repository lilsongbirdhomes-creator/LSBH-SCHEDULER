const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { requireAuth, requireAdmin, login, changePassword, getCurrentUser } = require('./auth');
const { calculateWeeklyHours, buildRunningTotals, checkHoursLimit, getPayPeriodStart, SHIFT_DEFS } = require('../utils/hours');
const notify = require('../utils/notifications');

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
  if (isAdmin && telegramId !== undefined) { updates.push('telegram_id = ?'); values.push(telegramId); }
  
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
    
    // Notify if newly assigned
    if (assignedTo && assignedTo !== shift.assigned_to && !isOpen) {
      await notify.notifyShiftAssigned(req.db, assignedTo, shift.date, shift.shift_type);
    }
    
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
router.post('/shift-requests', requireAuth, (req, res) => {
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
    
    // Notify target
    await notify.notifyTradeRequestReceived(req.db, theirShift.assigned_to, result.lastInsertRowid);
    
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

module.exports = router;
