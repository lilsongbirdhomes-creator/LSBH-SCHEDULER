/**
 * Shift time definitions
 */
const SHIFT_DEFS = {
  morning: {
    label: 'Morning',
    time: '7:00 AM – 3:00 PM',
    startMin: 420,  // 7am
    endMin: 900,    // 3pm
    hours: 8.0
  },
  afternoon: {
    label: 'Afternoon',
    time: '3:00 PM – 7:00 PM',
    startMin: 900,   // 3pm
    endMin: 1140,    // 7pm
    hours: 4.0
  },
  overnight: {
    label: 'Overnight',
    time: '7:00 PM – 7:00 AM',
    startMin: 1140,  // 7pm
    endMin: 1620,    // 7am next day (420 + 1440)
    hours: 12.0
  }
};

const SAT_OVERNIGHT_THIS_PERIOD = 5.0;  // Sat 7pm -> midnight
const SAT_OVERNIGHT_NEXT_PERIOD = 7.0;  // midnight -> Sun 7am

/**
 * Get hours for a shift, accounting for Saturday overnight split
 * @param {string} dateStr - ISO date string 'YYYY-MM-DD'
 * @param {string} shiftType - 'morning', 'afternoon', or 'overnight'
 * @returns {number} Hours for this shift
 */
function getShiftHours(dateStr, shiftType) {
  const date = new Date(dateStr + 'T12:00:00');
  const dayOfWeek = date.getDay(); // 0=Sunday, 6=Saturday
  
  // Saturday overnight is split across pay periods
  if (dayOfWeek === 6 && shiftType === 'overnight') {
    return SAT_OVERNIGHT_THIS_PERIOD;
  }
  
  return SHIFT_DEFS[shiftType]?.hours || 0;
}

/**
 * Find the Sunday that starts the pay period for a given date
 * @param {string} dateStr - ISO date string
 * @returns {Date} Sunday of that week
 */
function getPayPeriodStart(dateStr) {
  const date = new Date(dateStr + 'T12:00:00');
  const dayOfWeek = date.getDay();
  const sunday = new Date(date);
  sunday.setDate(date.getDate() - dayOfWeek);
  sunday.setHours(0, 0, 0, 0);
  return sunday;
}

/**
 * Calculate total hours for a staff member in a pay period
 * @param {Object} db - Database instance
 * @param {number} userId - Staff user ID
 * @param {string} dateStr - Any date in the pay period
 * @param {number} [excludeShiftId] - Optional shift ID to exclude (e.g. shift being traded away)
 * @returns {number} Total hours
 */
function calculateWeeklyHours(db, userId, dateStr, excludeShiftId) {
  const sunday = getPayPeriodStart(dateStr);
  const dates = [];
  
  // Get all 7 days of the pay period
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }
  
  // Get all shifts for this user in this week, optionally excluding one shift
  const placeholders = dates.map(() => '?').join(',');
  const excludeClause = excludeShiftId ? ' AND id != ?' : '';
  const queryParams = excludeShiftId
    ? [userId, ...dates, excludeShiftId]
    : [userId, ...dates];

  const shifts = db.prepare(`
    SELECT date, shift_type
    FROM shifts
    WHERE assigned_to = ?
    AND date IN (${placeholders})
    ${excludeClause}
  `).all(...queryParams);
  
  // Sum up hours
  let total = 0;
  shifts.forEach(shift => {
    total += getShiftHours(shift.date, shift.shift_type);
  });
  
  return total;
}

/**
 * Calculate hours with running totals for a pay period
 * @param {Object} db - Database instance
 * @param {Date} sunday - Start of pay period
 * @returns {Object} Map of "date|userId|shiftType" -> running total
 */
function buildRunningTotals(db, sunday) {
  const runningTotals = {};
  const userAccumulators = {};
  
  // Process each day of the week in order
  for (let i = 0; i < 7; i++) {
    const date = new Date(sunday);
    date.setDate(sunday.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    
    // Get all shifts for this day, sorted by shift type (morning -> afternoon -> overnight)
    const shifts = db.prepare(`
      SELECT s.assigned_to, s.shift_type, u.full_name
      FROM shifts s
      LEFT JOIN users u ON s.assigned_to = u.id
      WHERE s.date = ?
      AND s.assigned_to IS NOT NULL
      ORDER BY 
        CASE s.shift_type
          WHEN 'morning' THEN 1
          WHEN 'afternoon' THEN 2
          WHEN 'overnight' THEN 3
        END
    `).all(dateStr);
    
    shifts.forEach(shift => {
      if (!shift.assigned_to) return;
      
      // Initialize accumulator for this user if needed
      if (!userAccumulators[shift.assigned_to]) {
        userAccumulators[shift.assigned_to] = 0;
      }
      
      // Add hours for this shift
      const hours = getShiftHours(dateStr, shift.shift_type);
      userAccumulators[shift.assigned_to] += hours;
      
      // Store running total
      const key = `${dateStr}|${shift.assigned_to}|${shift.shift_type}`;
      runningTotals[key] = userAccumulators[shift.assigned_to];
    });
  }
  
  return runningTotals;
}

/**
 * Check if assigning a shift would exceed 40-hour limit
 * @param {Object} db - Database instance
 * @param {number} userId - User to assign to
 * @param {string} dateStr - Date of new shift
 * @param {string} shiftType - Type of new shift
 * @param {number} [excludeShiftId] - Optional shift ID to exclude (e.g. shift being traded away)
 * @returns {Object} { wouldExceed: boolean, currentHours: number, projectedHours: number, isHouseManager: boolean }
 */
function checkHoursLimit(db, userId, dateStr, shiftType, excludeShiftId) {
  // Get user info
  const user = db.prepare('SELECT job_title FROM users WHERE id = ?').get(userId);
  const isHouseManager = user?.job_title === 'House Manager';
  
  // Calculate current hours, optionally excluding a shift being traded away
  const currentHours = calculateWeeklyHours(db, userId, dateStr, excludeShiftId);
  
  // Calculate hours for new shift
  const shiftHours = getShiftHours(dateStr, shiftType);
  const projectedHours = currentHours + shiftHours;
  
  return {
    wouldExceed: projectedHours > 40 && !isHouseManager,
    currentHours,
    projectedHours,
    shiftHours,
    isHouseManager
  };
}

/**
 * Format hours for display
 * @param {number} hours - Number of hours
 * @returns {string} Formatted string like "8.0/40.0"
 */
function formatHours(hours) {
  return `${hours.toFixed(1)}/40.0`;
}

/**
 * Get hour status class for UI
 * @param {number} hours - Current hours
 * @returns {string} 'ok', 'warn', or 'over'
 */
function getHoursStatus(hours) {
  if (hours >= 40) return 'over';
  if (hours >= 36) return 'warn';
  return 'ok';
}

/**
 * Format date for display
 * @param {string} dateStr - ISO date string
 * @returns {string} Formatted date like "Feb 15, 2026"
 */
function formatDate(dateStr) {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });
}

/**
 * Get day name from ISO date
 * @param {string} dateStr - ISO date string
 * @returns {string} Day name like "Monday"
 */
function getDayName(dateStr) {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

module.exports = {
  SHIFT_DEFS,
  SAT_OVERNIGHT_THIS_PERIOD,
  SAT_OVERNIGHT_NEXT_PERIOD,
  getShiftHours,
  getPayPeriodStart,
  calculateWeeklyHours,
  buildRunningTotals,
  checkHoursLimit,
  formatHours,
  getHoursStatus,
  formatDate,
  getDayName
};
