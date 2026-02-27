const { sendNotification, templates } = require('../server/telegram');
const { formatDate, getDayName, SHIFT_DEFS } = require('./hours');

/**
 * Log notification to database
 */
function logNotification(db, userId, type, message) {
  try {
    db.prepare(`
      INSERT INTO notifications (user_id, type, message, sent_via)
      VALUES (?, ?, ?, 'telegram')
    `).run(userId, type, message);
  } catch (err) {
    console.error('Failed to log notification:', err.message);
  }
}

/**
 * Send shift assigned notification
 */
async function notifyShiftAssigned(db, userId, date, shiftType) {
  const user = db.prepare('SELECT telegram_id, full_name FROM users WHERE id = ?').get(userId);
  if (!user || !user.telegram_id) return false;

  const shiftDef = SHIFT_DEFS[shiftType];
  const message = templates.shiftAssigned(
    user.full_name,
    formatDate(date),
    shiftDef.label,
    shiftDef.time,
    process.env.APP_URL || 'https://your-app.railway.app'
  );

  const sent = await sendNotification(user.telegram_id, message);
  if (sent) {
    logNotification(db, userId, 'shift_assigned', message);
  }
  return sent;
}

/**
 * Send shift request approved notification
 */
async function notifyShiftRequestApproved(db, userId, shiftId, adminNote) {
  const user = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(userId);
  if (!user || !user.telegram_id) return false;

  const shift = db.prepare('SELECT date, shift_type FROM shifts WHERE id = ?').get(shiftId);
  if (!shift) return false;

  const shiftDef = SHIFT_DEFS[shift.shift_type];
  const message = templates.shiftRequestApproved(
    formatDate(shift.date),
    shiftDef.label,
    shiftDef.time,
    process.env.APP_URL || 'https://your-app.railway.app'
  );

  const sent = await sendNotification(user.telegram_id, message);
  if (sent) {
    logNotification(db, userId, 'request_approved', message);
  }
  return sent;
}

/**
 * Send shift request denied notification
 */
async function notifyShiftRequestDenied(db, userId, shiftId, adminNote) {
  const user = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(userId);
  if (!user || !user.telegram_id) return false;

  const shift = db.prepare('SELECT date, shift_type FROM shifts WHERE id = ?').get(shiftId);
  if (!shift) return false;

  const shiftDef = SHIFT_DEFS[shift.shift_type];
  const message = templates.shiftRequestDenied(
    formatDate(shift.date),
    shiftDef.label,
    adminNote,
    process.env.APP_URL || 'https://your-app.railway.app'
  );

  const sent = await sendNotification(user.telegram_id, message);
  if (sent) {
    logNotification(db, userId, 'request_denied', message);
  }
  return sent;
}

/**
 * Send trade request received notification (to target staff)
 */
async function notifyTradeRequestReceived(db, targetId, tradeId) {
  const user = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(targetId);
  if (!user || !user.telegram_id) return false;

  const trade = db.prepare(`
    SELECT 
      tr.id,
      u1.full_name as requester_name,
      s1.date as requester_date, s1.shift_type as requester_shift,
      s2.date as target_date, s2.shift_type as target_shift
    FROM trade_requests tr
    JOIN users u1 ON tr.requester_id = u1.id
    JOIN shifts s1 ON tr.requester_shift_id = s1.id
    JOIN shifts s2 ON tr.target_shift_id = s2.id
    WHERE tr.id = ?
  `).get(tradeId);

  if (!trade) return false;

  const requesterShift = SHIFT_DEFS[trade.requester_shift] || {};
  const targetShift    = SHIFT_DEFS[trade.target_shift]    || {};
  const scheduleUrl    = process.env.APP_URL || 'https://your-app.railway.app';

  const message = templates.tradeRequestReceived(
    trade.requester_name,
    formatDate(trade.requester_date),
    requesterShift.label  || trade.requester_shift,
    requesterShift.time   || '',
    formatDate(trade.target_date),
    targetShift.label     || trade.target_shift,
    targetShift.time      || '',
    scheduleUrl
  );

  const sent = await sendNotification(user.telegram_id, message);
  if (sent) logNotification(db, targetId, 'trade_request', message);
  return sent;
}

/**
 * Send trade request sent confirmation (to requester)
 */
async function notifyTradeRequestSent(db, requesterId, tradeId) {
  const user = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(requesterId);
  if (!user || !user.telegram_id) return false;

  const trade = db.prepare(`
    SELECT 
      u2.full_name as target_name,
      s1.date as req_date, s1.shift_type as req_shift,
      s2.date as tgt_date, s2.shift_type as tgt_shift
    FROM trade_requests tr
    JOIN users u2 ON tr.target_id = u2.id
    JOIN shifts s1 ON tr.requester_shift_id = s1.id
    JOIN shifts s2 ON tr.target_shift_id = s2.id
    WHERE tr.id = ?
  `).get(tradeId);

  if (!trade) return false;

  const myShift    = SHIFT_DEFS[trade.req_shift] || {};
  const theirShift = SHIFT_DEFS[trade.tgt_shift] || {};

  const message = templates.tradeRequestSent(
    trade.target_name,
    formatDate(trade.req_date),
    myShift.label  || trade.req_shift,
    myShift.time   || '',
    formatDate(trade.tgt_date),
    theirShift.label || trade.tgt_shift,
    theirShift.time  || '',
    process.env.APP_URL || 'https://your-app.railway.app'
  );

  const sent = await sendNotification(user.telegram_id, message);
  if (sent) logNotification(db, requesterId, 'trade_sent', message);
  return sent;
}

/**
 * Notify all admins of a new trade request
 */
async function notifyAdminTradeRequest(db, tradeId) {
  const trade = db.prepare(`
    SELECT 
      u1.full_name as requester_name,
      u2.full_name as target_name,
      s1.date as req_date, s1.shift_type as req_shift,
      s2.date as tgt_date, s2.shift_type as tgt_shift
    FROM trade_requests tr
    JOIN users u1 ON tr.requester_id = u1.id
    JOIN users u2 ON tr.target_id = u2.id
    JOIN shifts s1 ON tr.requester_shift_id = s1.id
    JOIN shifts s2 ON tr.target_shift_id = s2.id
    WHERE tr.id = ?
  `).get(tradeId);

  if (!trade) return false;

  const reqShift = SHIFT_DEFS[trade.req_shift] || {};
  const tgtShift = SHIFT_DEFS[trade.tgt_shift] || {};

  const message = templates.tradeRequestAdmin(
    trade.requester_name,
    trade.target_name,
    formatDate(trade.req_date),
    reqShift.label || trade.req_shift,
    reqShift.time  || '',
    formatDate(trade.tgt_date),
    tgtShift.label || trade.tgt_shift,
    tgtShift.time  || ''
  );

  const admins = db.prepare(`
    SELECT id, telegram_id FROM users
    WHERE (role = 'admin' OR job_title = 'Admin') AND is_active = 1 AND telegram_id IS NOT NULL
  `).all();

  let sent = 0;
  for (const admin of admins) {
    if (await sendNotification(admin.telegram_id, message)) {
      logNotification(db, admin.id, 'trade_request_admin', message);
      sent++;
    }
  }
  return sent > 0;
}

/**
 * Notify all admins of a new open shift request
 */
async function notifyAdminShiftRequest(db, shiftRequestId) {
  const req = db.prepare(`
    SELECT 
      sr.shift_id,
      u.full_name as requester_name,
      s.date, s.shift_type
    FROM shift_requests sr
    JOIN users u ON sr.requester_id = u.id
    JOIN shifts s ON sr.shift_id = s.id
    WHERE sr.id = ?
  `).get(shiftRequestId);

  if (!req) return false;

  const shiftDef = SHIFT_DEFS[req.shift_type] || {};

  const message = templates.shiftRequestAdmin(
    req.requester_name,
    formatDate(req.date),
    shiftDef.label || req.shift_type,
    shiftDef.time  || ''
  );

  const admins = db.prepare(`
    SELECT id, telegram_id FROM users
    WHERE (role = 'admin' OR job_title = 'Admin') AND is_active = 1 AND telegram_id IS NOT NULL
  `).all();

  let sent = 0;
  for (const admin of admins) {
    if (await sendNotification(admin.telegram_id, message)) {
      logNotification(db, admin.id, 'shift_request_admin', message);
      sent++;
    }
  }
  return sent > 0;
}

/**
 * Send trade approved by partner notification
 */
async function notifyTradeApproved(db, requesterId, tradeId) {
  const user = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(requesterId);
  if (!user || !user.telegram_id) return false;

  const trade = db.prepare(`
    SELECT 
      u2.full_name as partner_name,
      s1.date, s1.shift_type
    FROM trade_requests tr
    JOIN users u2 ON tr.target_id = u2.id
    JOIN shifts s1 ON tr.target_shift_id = s1.id
    WHERE tr.id = ?
  `).get(tradeId);

  if (!trade) return false;

  const shiftDef = SHIFT_DEFS[trade.shift_type];
  const message = templates.tradeApproved(
    trade.partner_name,
    formatDate(trade.date),
    shiftDef.label
  );

  const sent = await sendNotification(user.telegram_id, message);
  if (sent) {
    logNotification(db, requesterId, 'trade_approved', message);
  }
  return sent;
}

/**
 * Send trade denied notification
 */
async function notifyTradeDenied(db, requesterId, partnerName, note) {
  const user = db.prepare('SELECT telegram_id FROM users WHERE id = ?').get(requesterId);
  if (!user || !user.telegram_id) return false;

  const message = templates.tradeDenied(partnerName, note, process.env.APP_URL || 'https://your-app.railway.app');

  const sent = await sendNotification(user.telegram_id, message);
  if (sent) {
    logNotification(db, requesterId, 'trade_denied', message);
  }
  return sent;
}

/**
 * Send trade finalized notification (to both parties)
 */
async function notifyTradeFinalized(db, tradeId, adminNote) {
  const trade = db.prepare(`
    SELECT 
      tr.requester_id, tr.target_id,
      u1.telegram_id as req_telegram,
      u2.telegram_id as tgt_telegram,
      s1.date as req_new_date, s1.shift_type as req_new_shift,
      s2.date as tgt_new_date, s2.shift_type as tgt_new_shift
    FROM trade_requests tr
    JOIN users u1 ON tr.requester_id = u1.id
    JOIN users u2 ON tr.target_id = u2.id
    JOIN shifts s1 ON tr.target_shift_id = s1.id
    JOIN shifts s2 ON tr.requester_shift_id = s2.id
    WHERE tr.id = ?
  `).get(tradeId);

  if (!trade) return false;

  let sent = 0;

  // Notify requester
  if (trade.req_telegram) {
    const reqShift = SHIFT_DEFS[trade.req_new_shift];
    const message = templates.tradeFinalized(
      formatDate(trade.req_new_date),
      reqShift.label,
      adminNote
    );
    if (await sendNotification(trade.req_telegram, message)) {
      logNotification(db, trade.requester_id, 'trade_finalized', message);
      sent++;
    }
  }

  // Notify target
  if (trade.tgt_telegram) {
    const tgtShift = SHIFT_DEFS[trade.tgt_new_shift];
    const message = templates.tradeFinalized(
      formatDate(trade.tgt_new_date),
      tgtShift.label,
      adminNote
    );
    if (await sendNotification(trade.tgt_telegram, message)) {
      logNotification(db, trade.target_id, 'trade_finalized', message);
      sent++;
    }
  }

  return sent > 0;
}

/**
 * Send time off approved notification
 */
async function notifyTimeOffApproved(db, requestId) {
  const request = db.prepare(`
    SELECT tor.requester_id, tor.request_type, tor.start_date, tor.end_date,
           s.date as shift_date,
           u.telegram_id
    FROM time_off_requests tor
    JOIN users u ON tor.requester_id = u.id
    LEFT JOIN shifts s ON tor.shift_id = s.id
    WHERE tor.id = ?
  `).get(requestId);

  if (!request || !request.telegram_id) return false;

  const startDate = request.request_type === 'assigned_shift' 
    ? formatDate(request.shift_date)
    : formatDate(request.start_date);
  const endDate = request.end_date ? formatDate(request.end_date) : startDate;

  const message = templates.timeOffApproved(
    startDate,
    endDate,
    request.request_type === 'assigned_shift' ? 'Assigned shift' : 'Vacation'
  );

  const sent = await sendNotification(request.telegram_id, message);
  if (sent) {
    logNotification(db, request.requester_id, 'timeoff_approved', message);
  }
  return sent;
}

/**
 * Send time off denied notification
 */
async function notifyTimeOffDenied(db, requestId, adminNote) {
  const request = db.prepare(`
    SELECT tor.requester_id, tor.start_date,
           u.telegram_id
    FROM time_off_requests tor
    JOIN users u ON tor.requester_id = u.id
    WHERE tor.id = ?
  `).get(requestId);

  if (!request || !request.telegram_id) return false;

  const message = templates.timeOffDenied(
    formatDate(request.start_date),
    adminNote
  );

  const sent = await sendNotification(request.telegram_id, message);
  if (sent) {
    logNotification(db, request.requester_id, 'timeoff_denied', message);
  }
  return sent;
}

/**
 * Send emergency absence alert to all admins
 */
async function notifyEmergencyAbsence(db, shiftId, staffName) {
  const shift = db.prepare('SELECT date, shift_type FROM shifts WHERE id = ?').get(shiftId);
  if (!shift) return false;

  const admins = db.prepare(`
    SELECT id, telegram_id 
    FROM users 
    WHERE (role = 'admin' OR job_title = 'Admin') AND telegram_id IS NOT NULL
  `).all();

  const shiftDef = SHIFT_DEFS[shift.shift_type];
  const message = templates.emergencyAbsence(
    staffName,
    formatDate(shift.date),
    shiftDef.label
  );

  let sent = 0;
  for (const admin of admins) {
    if (await sendNotification(admin.telegram_id, message)) {
      logNotification(db, admin.id, 'emergency_absence', message);
      sent++;
    }
  }

  return sent > 0;
}

module.exports = {
  logNotification,
  notifyShiftAssigned,
  notifyShiftRequestApproved,
  notifyShiftRequestDenied,
  notifyTradeRequestReceived,
  notifyTradeRequestSent,
  notifyAdminTradeRequest,
  notifyAdminShiftRequest,
  notifyTradeApproved,
  notifyTradeDenied,
  notifyTradeFinalized,
  notifyTimeOffApproved,
  notifyTimeOffDenied,
  notifyEmergencyAbsence
};
