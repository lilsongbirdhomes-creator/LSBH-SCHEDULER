// ═══════════════════════════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════════════════════════
let currentUser = null;
let viewMode = 'week';
let viewDate = new Date('2026-02-16'); // Sunday
let allStaff = [];
let allShifts = [];
let showOnlyMyShifts = false; // Staff can toggle this

const SHIFT_DEFS = {
  morning:   { label: 'Morning',   time: '7:00 AM – 3:00 PM', hours: 8.0, icon: '🌅' },
  afternoon: { label: 'Afternoon', time: '3:00 PM – 7:00 PM', hours: 4.0, icon: '🌆' },
  overnight: { label: 'Overnight', time: '7:00 PM – 7:00 AM', hours: 12.0, icon: '🌙' }
};

// ═══════════════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════════════
async function apiCall(endpoint, options = {}) {
  try {
    const response = await fetch(`/api${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      credentials: 'include'
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Request failed');
    }
    
    return await response.json();
  } catch (err) {
    console.error('API Error:', err);
    throw err;
  }
}

function showLoading() { document.getElementById('loading').classList.add('show'); }
function hideLoading() { document.getElementById('loading').classList.remove('show'); }

// ═══════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════
async function handleLogin() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const errorDiv = document.getElementById('loginError');
  
  if (!username || !password) {
    errorDiv.textContent = 'Please enter username and password';
    errorDiv.classList.add('show');
    return;
  }
  
  try {
    showLoading();
    const result = await apiCall('/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    
    currentUser = result.user;
    
    if (currentUser.mustChangePassword) {
      document.getElementById('loginScreen').classList.add('hidden');
      document.getElementById('passwordModal').classList.add('show');
      return;
    }
    
    showApp();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.add('show');
  } finally {
    hideLoading();
  }
}

async function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('userName').textContent = currentUser.fullName;
  document.getElementById('roleBadge').textContent = currentUser.role === 'admin' ? 'Admin' : 'Staff';
  
  // Load shift templates from database
  loadTemplates();
  
  if (currentUser.role === 'admin') {
    document.getElementById('adminPanel').classList.remove('hidden');
    await loadStaff();
    loadPendingApprovals();
  } else {
    document.getElementById('staffDashboard').classList.remove('hidden');
    loadDashboard();
  }
  
  loadShifts();
}

async function handleLogout() {
  try {
    await apiCall('/logout', { method: 'POST' });
    location.reload();
  } catch (err) {
    console.error('Logout error:', err);
    location.reload();
  }
}

function closePasswordModal() {
  if (currentUser?.mustChangePassword) {
    handleLogout();
  } else {
    document.getElementById('passwordModal').classList.remove('show');
  }
}

async function savePassword() {
  const newPassword = document.getElementById('newPassword').value;
  
  if (newPassword.length < 6) {
    alert('Password must be at least 6 characters');
    return;
  }
  
  try {
    showLoading();
    await apiCall('/change-password', {
      method: 'POST',
      body: JSON.stringify({ newPassword })
    });
    
    currentUser.mustChangePassword = false;
    document.getElementById('passwordModal').classList.remove('show');
    showApp();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

// ═══════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════
function switchTab(tab) {
  document.querySelectorAll('.a-tab').forEach((t, i) => {
    t.classList.toggle('active', 
      (tab === 'schedule' && i === 0) || 
      (tab === 'staff' && i === 1) || 
      (tab === 'approvals' && i === 2)
    );
  });
  
  document.getElementById('scheduleTab').classList.toggle('active', tab === 'schedule');
  document.getElementById('staffTab').classList.toggle('active', tab === 'staff');
  document.getElementById('approvalsTab').classList.toggle('active', tab === 'approvals');
  
  if (tab === 'approvals') {
    loadPendingApprovals();
  }
}

// ═══════════════════════════════════════════════════════════
// STAFF MANAGEMENT
// ═══════════════════════════════════════════════════════════
async function loadStaff() {
  try {
    const result = await apiCall('/staff');
    allStaff = result.staff;
    renderStaffList();
    console.log("✅ Staff loaded:", allStaff.length, "members");
  } catch (err) {
    console.error('Load staff error:', err);
  }
}

function renderStaffList() {
  const list = document.getElementById("staffList");
  if (!list) return; // Staff tab not visible for non-admin
  list.innerHTML = "";
  
  allStaff.forEach(staff => {
    const isOpen = staff.username === '_open';
    const isActive = staff.is_active === 1 || staff.is_active === undefined;
    const item = document.createElement('div');
    item.className = 's-item' + (!isActive ? ' inactive' : '');
    item.innerHTML = `
      <div class="col-dot" style="background:${staff.tile_color || '#f5f5f5'};${!isActive ? 'opacity:0.5;' : ''}"></div>
      <div class="s-det">
        <div class="s-nm">
          ${staff.full_name}
          ${!isActive ? '<span class="inactive-badge">Inactive</span>' : ''}
        </div>
        <div class="s-me">${isOpen ? 'Placeholder for unassigned shifts' : `@${staff.username} • ${staff.job_title}`}</div>
      </div>
      <div class="s-act">
        <button class="bsm b-edit" onclick="openEditStaff(${staff.id})">Edit</button>
        ${!isOpen && staff.username !== 'admin' ? `
          <button class="bsm b-rpw" onclick="resetPassword(${staff.id})">Reset PW</button>
          <button class="bsm ${isActive ? 'b-deact' : 'b-act'}" onclick="toggleStaffActive(${staff.id}, ${!isActive})">
            ${isActive ? 'Deactivate' : 'Activate'}
          </button>
          <button class="bsm b-del" onclick="deleteStaff(${staff.id})">Delete</button>
        ` : ''}
      </div>
    `;
    list.appendChild(item);
  });
}

async function addStaff() {
  const username = document.getElementById('newUsername').value.trim();
  const fullName = document.getElementById('newFullName').value.trim();
  const role = "staff"; // All users are staff except admin
  const jobTitle = document.getElementById('newJobTitle').value;
  
  if (!username || !fullName) {
    alert('Please enter username and full name');
    return;
  }
  
  try {
    showLoading();
    const result = await apiCall('/staff', {
      method: 'POST',
      body: JSON.stringify({ username, fullName, role, jobTitle })
    });
    
    alert(`Staff added!\nUsername: ${username}\nTemp Password: ${result.tempPassword}\n\nThey must change password on first login.`);
    
    document.getElementById('newUsername').value = '';
    document.getElementById('newFullName').value = '';
    
    // Await loadStaff to ensure allStaff array is updated
    await loadStaff();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

const PASTEL_SWATCHES = [
  '#ffd6d6','#ffb3b3','#f9c4d2','#f7cac9',
  '#ffe4c4','#ffd5a8','#ffd6a5','#ffe0b2',
  '#fff9c4','#ffeaa7','#fde68a','#fef08a',
  '#d4f1d4','#c8f7c5','#d1fae5','#a7f3d0',
  '#d0eaff','#bde0fe','#dbeafe','#cfe2ff',
  '#e8d5ff','#ddd6fe','#e9d5ff','#f3e8ff',
  '#f5f5f5','#e9ecef','#f8f9fa','#e2e8f0',
  '#4a5568','#2d3748','#1a202c','#374151',
];

const DARK_SWATCHES = ['#4a5568','#2d3748','#1a202c','#374151'];

function buildSwatchGrid(currentColor) {
  const grid = document.getElementById('swatchGrid');
  if (!grid) return;
  grid.innerHTML = '';
  PASTEL_SWATCHES.forEach(color => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'swatch' + (color === currentColor ? ' swatch-selected' : '');
    swatch.style.background = color;
    swatch.title = color;
    swatch.onclick = () => selectSwatch(color);
    grid.appendChild(swatch);
  });
}

function selectSwatch(color) {
  document.getElementById('editTileColor').value = color;
  document.querySelectorAll('#swatchGrid .swatch').forEach(s => {
    s.classList.toggle('swatch-selected', s.title === color);
  });
  document.getElementById('editTextColor').value = DARK_SWATCHES.includes(color) ? 'white' : 'black';
}

function openEditStaff(staffId) {
  const staff = allStaff.find(s => s.id === staffId);
  if (!staff) return;

  document.getElementById('editStaffId').value = staffId;
  document.getElementById('editFullName').value = staff.full_name;
  document.getElementById('editJobTitle').value = staff.job_title;
  document.getElementById('editTileColor').value = staff.tile_color || '#f5f5f5';
  document.getElementById('editTextColor').value = staff.text_color || 'black';
  document.getElementById('editTelegramId').value = staff.telegram_id || '';

  buildSwatchGrid(staff.tile_color || '#f5f5f5');

  document.getElementById('editStaffModal').classList.add('show');
}

function closeEditStaffModal() {
  document.getElementById('editStaffModal').classList.remove('show');
}

async function saveStaffEdit() {
  const staffId = document.getElementById('editStaffId').value;
  const fullName = document.getElementById('editFullName').value.trim();
  const jobTitle = document.getElementById('editJobTitle').value;
  const tileColor = document.getElementById('editTileColor').value;
  const textColor = document.getElementById('editTextColor').value;
  const telegramId = document.getElementById('editTelegramId').value.trim();
  
  try {
    showLoading();
    await apiCall(`/staff/${staffId}`, {
      method: 'PUT',
      body: JSON.stringify({ 
        fullName, 
        jobTitle, 
        tileColor, 
        textColor,
        telegramId: telegramId || null
      })
    });
    
    closeEditStaffModal();
    await loadStaff();
    loadShifts(); // Refresh calendar with new colors
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

async function resetPassword(staffId) {
  if (!confirm('Reset password for this staff member?')) return;
  
  try {
    showLoading();
    const result = await apiCall(`/staff/${staffId}/reset-password`, {
      method: 'POST'
    });
    
    alert(`Password reset!\nNew temp password: ${result.tempPassword}\n\nUser must change on next login.`);
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

async function toggleStaffActive(staffId, makeActive) {
  const action = makeActive ? 'activate' : 'deactivate';
  const staff = allStaff.find(s => s.id === staffId);
  
  if (!confirm(`${makeActive ? 'Activate' : 'Deactivate'} ${staff.full_name}?\n\n${makeActive ? 'They will be able to login again.' : 'They will NOT be able to login.'}`)) return;
  
  try {
    showLoading();
    await apiCall(`/staff/${staffId}/toggle-active`, {
      method: 'POST',
      body: JSON.stringify({ isActive: makeActive })
    });
    
    showSuccess(`Staff ${makeActive ? 'activated' : 'deactivated'} successfully!`);
    await loadStaff();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

async function deleteStaff(staffId) {
  if (!confirm('Delete this staff member? This cannot be undone.')) return;
  
  try {
    showLoading();
    await apiCall(`/staff/${staffId}`, { method: 'DELETE' });
    await loadStaff();
    loadShifts();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

// ═══════════════════════════════════════════════════════════
// CALENDAR
// ═══════════════════════════════════════════════════════════
function navPrev() {
  if (viewMode === 'week') {
    viewDate.setDate(viewDate.getDate() - 7);
  } else {
    viewDate.setMonth(viewDate.getMonth() - 1);
  }
  loadShifts();
}

function navNext() {
  if (viewMode === 'week') {
    viewDate.setDate(viewDate.getDate() + 7);
  } else {
    viewDate.setMonth(viewDate.getMonth() + 1);
  }
  loadShifts();
}

function setView(mode) {
  viewMode = mode;
  document.getElementById('vWeek').classList.toggle('active', mode === 'week');
  document.getElementById('vMonth').classList.toggle('active', mode === 'month');
  loadShifts();
}

async function loadShifts() {
  let startDate, endDate;
  
  if (viewMode === 'month') {
    // Get first day of month
    startDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    // Get last day of month
    endDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
  } else {
    // Week view
    startDate = getWeekStart(viewDate);
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
  }
  
  try {
    showLoading();
    const [result] = await Promise.all([
      apiCall(`/shifts?startDate=${formatDate(startDate)}&endDate=${formatDate(endDate)}`),
      loadPendingShiftIds()
    ]);
    allShifts = result.shifts;
    renderCalendar();
    
    // Render pay period summary for staff
    if (currentUser && currentUser.role === 'staff') {
      renderPayPeriodSummary();
    }
  } catch (err) {
    console.error('Load shifts error:', err);
  } finally {
    hideLoading();
  }
}

function renderCalendar() {
  if (viewMode === 'month') {
    renderMonthView();
  } else {
    renderWeekView();
  }
}

function renderWeekView() {
  const root = document.getElementById('calendarRoot');
  root.innerHTML = '';
  
  const startDate = getWeekStart(viewDate);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  
  document.getElementById('calTitle').textContent = 
    `${formatDateLong(startDate)} – ${formatDateLong(endDate)}`;
  
  const grid = document.createElement('div');
  grid.className = 'week-grid';
  
  // Day headers
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const isWknd = i === 0 || i === 6;
    
    const hdr = document.createElement('div');
    hdr.className = 'day-hdr' + (isWknd ? ' wknd' : '');
    hdr.innerHTML = `<span class="dn">${dayNames[i]}</span><span class="dt">${d.getDate()}</span>`;
    grid.appendChild(hdr);
  }
  
  // Day columns
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const dateStr = formatDate(d);
    const isWknd = i === 0 || i === 6;
    
    const col = document.createElement('div');
    col.className = 'day-col' + (isWknd ? ' wknd' : '');
    
    const dayShifts = allShifts
      .filter(s => s.date === dateStr)
      .sort((a, b) => {
        const order = { morning: 1, afternoon: 2, overnight: 3 };
        return order[a.shift_type] - order[b.shift_type];
      });
    
    dayShifts.forEach(shift => {
      if (currentUser.role === 'staff' && showOnlyMyShifts && shift.assigned_to !== currentUser.id && !shift.is_open) {
        return; // Staff in "only my shifts" mode - hide others' shifts
      }
      
      const tile = createShiftTile(shift, 'week');
      col.appendChild(tile);
    });
    
    grid.appendChild(col);
  }
  
  root.appendChild(grid);
}

function computeMonthHours(shifts) {
  const shiftOrder = { morning: 1, afternoon: 2, overnight: 3 };
  const assigned = shifts
    .filter(s => s.assigned_to && !s.is_open)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return shiftOrder[a.shift_type] - shiftOrder[b.shift_type];
    });
  const accumulators = {};
  assigned.forEach(shift => {
    const d = new Date(shift.date + 'T12:00:00');
    const sunday = new Date(d);
    sunday.setDate(d.getDate() - d.getDay());
    const weekKey = `${shift.assigned_to}|${sunday.toISOString().split('T')[0]}`;
    if (!accumulators[weekKey]) accumulators[weekKey] = 0;
    let hours = SHIFT_DEFS[shift.shift_type]?.hours || 0;
    if (d.getDay() === 6 && shift.shift_type === 'overnight') hours = 5.0;
    accumulators[weekKey] += hours;
    shift.running_hours = accumulators[weekKey];
  });
}

function renderMonthView() {
  computeMonthHours(allShifts);
  const root = document.getElementById('calendarRoot');
  root.innerHTML = '';
  
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthName = viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  
  document.getElementById('calTitle').textContent = monthName;
  
  const grid = document.createElement('div');
  grid.className = 'month-grid';
  
  // Day headers
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  dayNames.forEach(day => {
    const hdr = document.createElement('div');
    hdr.className = 'month-day-hdr';
    hdr.textContent = day;
    grid.appendChild(hdr);
  });
  
  // Get first day of month and its day of week
  const firstDay = new Date(year, month, 1);
  const startDay = firstDay.getDay();
  
  // Get last day of month
  const lastDay = new Date(year, month + 1, 0).getDate();
  
  // Add empty cells for days before month starts
  for (let i = 0; i < startDay; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'month-day-cell empty';
    grid.appendChild(emptyCell);
  }
  
  // Add cells for each day of month
  for (let day = 1; day <= lastDay; day++) {
    const d = new Date(year, month, day);
    const dateStr = formatDate(d);
    const isToday = dateStr === formatDate(new Date());
    const isWknd = d.getDay() === 0 || d.getDay() === 6;
    
    const cell = document.createElement('div');
    cell.className = 'month-day-cell' + (isWknd ? ' wknd' : '') + (isToday ? ' today' : '');
    
    const dayNum = document.createElement('div');
    dayNum.className = 'month-day-num';
    dayNum.textContent = day;
    cell.appendChild(dayNum);
    
    const shiftsContainer = document.createElement('div');
    shiftsContainer.className = 'month-shifts';
    
    const dayShifts = allShifts
      .filter(s => s.date === dateStr)
      .sort((a, b) => {
        const order = { morning: 1, afternoon: 2, overnight: 3 };
        return order[a.shift_type] - order[b.shift_type];
      });
    
    dayShifts.forEach(shift => {
      if (currentUser.role === 'staff' && showOnlyMyShifts && shift.assigned_to !== currentUser.id && !shift.is_open) {
        return; // Staff in "only my shifts" mode - hide others' shifts
      }
      
      const tile = createShiftTile(shift, 'month');
      shiftsContainer.appendChild(tile);
    });
    
    cell.appendChild(shiftsContainer);
    grid.appendChild(cell);
  }
  
  root.appendChild(grid);
}

function createShiftTile(shift, viewType = 'week') {
  const def = SHIFT_DEFS[shift.shift_type];
  const tile = document.createElement('div');
  tile.className = viewType === 'month' ? 'month-shift-tile' : 'shift-tile';

  // Determine pending state
  const hasPendingShiftReq = pendingShiftIds.has(shift.id);
  const hasPendingTrade    = pendingTradeShiftIds.has(shift.id);
  const isPending          = hasPendingShiftReq || hasPendingTrade;

  // Pick-mode overrides normal click behaviour
  const inPickMode = !!requestMode;

  if (isPending) {
    tile.classList.add('tile-pending');
  }

  if (shift.is_open) {
    if (!isPending) {
      tile.style.background = '#f5f5f5';
      tile.style.color = 'black';
    }
    tile.style.cursor = 'pointer';

    tile.onclick = () => {
      if (inPickMode) { handleTilePick(shift); return; }
      if (currentUser.role === 'admin') showAssignOpenShiftModal(shift);
      else confirmRequestShift(shift.id);
    };

    const pendingBadge = isPending ? '<div class="pending-badge">⏳ Pending Change</div>' : '';
    if (viewType === 'month') {
      tile.innerHTML = `
        ${pendingBadge}
        <div class="month-shift-name">Open Shift</div>
        <div class="month-shift-time">${def.icon} ${def.time}</div>
        <div class="month-shift-hours" style="font-size:9px;opacity:0.7;">Tap to ${currentUser.role === 'admin' ? 'assign' : 'request'}</div>
      `;
    } else {
      tile.innerHTML = `
        ${pendingBadge}
        <div>
          <div class="t-name">Open Shift</div>
          <div class="t-time">${def.time}</div>
        </div>
        <div class="t-foot" style="font-size:10px;opacity:0.7;">
          Tap to ${currentUser.role === 'admin' ? 'assign' : 'request'}
        </div>
      `;
    }
  } else {
    const staff = allStaff.find(s => s.id === shift.assigned_to);
    const hours = shift.running_hours || 0;
    const hClass = hours >= 40 ? 'hrs-over' : hours >= 36 ? 'hrs-warn' : 'hrs-ok';

    if (!isPending) {
      tile.style.background = staff?.tile_color || '#f5f5f5';
      tile.style.color = staff?.text_color || 'black';
    }

    tile.style.cursor = 'pointer';
    tile.onclick = () => {
      if (inPickMode) { handleTilePick(shift); return; }
      if (currentUser.role === 'admin') showReassignModal(shift);
    };

    const pendingBadge = isPending ? '<div class="pending-badge">⏳ Pending Change</div>' : '';
    if (viewType === 'month') {
      tile.innerHTML = `
        ${pendingBadge}
        <div class="month-shift-name">${shift.full_name || staff?.full_name || 'Unknown'}</div>
        <div class="month-shift-time">${def.icon} ${def.time}</div>
        <div class="month-shift-hours ${hClass}">${hours.toFixed(1)}/40</div>
      `;
    } else {
      tile.innerHTML = `
        ${pendingBadge}
        <div>
          <div class="t-name">${shift.full_name || 'Unknown'}</div>
          <div class="t-time">${def.time}</div>
        </div>
        <div class="t-foot">
          <span class="t-hrs ${hClass}">${hours.toFixed(1)}/40.0</span>
        </div>
      `;
    }
  }

  return tile;
}

// Admin assign open shift modal
function showAssignOpenShiftModal(shift) {
  console.log("🔍 Opening assign modal - allStaff:", allStaff.length, "members");
  console.log("📋 All staff details:", allStaff.map(s => ({id: s.id, name: s.full_name, role: s.role, username: s.username})));
  const filtered = allStaff.filter(s => s.username !== '_open' && s.username !== 'admin');
  console.log("✅ Filtered staff for dropdown:", filtered.length, "members");
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };
  
  const def = SHIFT_DEFS[shift.shift_type];
  
  const content = document.createElement('div');
  content.className = 'modal-content';
  content.innerHTML = `
    <h3>Assign Open Shift</h3>
    <p><strong>Date:</strong> ${new Date(shift.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
    <p><strong>Type:</strong> ${def.icon} ${shift.shift_type.charAt(0).toUpperCase() + shift.shift_type.slice(1)} (${def.time})</p>
    <hr>
    <label>Assign to:</label>
    <select id="assignStaffSelect" class="inp">
      <option value="">-- Select Assignment --</option>
      <option value="OPEN">📭 Make Open Shift</option>
      ${allStaff.filter(s => s.username !== '_open' && s.username !== 'admin').map(s => 
        `<option value="${s.id}">${s.full_name} (${s.job_title})</option>`
      ).join('')}
    </select>
    <div id="assignHoursWarning" style="display:none;margin-top:8px;padding:8px;background:#fff3cd;border-radius:6px;font-size:13px;color:#856404;"></div>
    <div class="modal-actions">
      <button class="b-can" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
      <button class="b-pri" onclick="confirmAssignOpenShift(${shift.id})">Assign</button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  // Add change handler to check hours
  document.getElementById('assignStaffSelect').onchange = async function() {
    const value = this.value;
    if (!value || value === 'OPEN') {
      document.getElementById('assignHoursWarning').style.display = 'none';
      return;
    }
    
    const staffId = parseInt(value);
    try {
      const check = await apiCall(`/hours-check?staffId=${staffId}&date=${shift.date}&shiftType=${shift.shift_type}`);
      const warning = document.getElementById('assignHoursWarning');
      if (check.wouldExceed) {
        warning.textContent = `⚠️ Warning: This would give them ${check.newTotal.toFixed(1)} hours for the week (exceeds 40-hour limit)`;
        warning.style.display = 'block';
        warning.style.background = '#f8d7da';
        warning.style.color = '#721c24';
      } else if (check.newTotal >= 36) {
        warning.textContent = `⚠️ Notice: This would give them ${check.newTotal.toFixed(1)} hours for the week (approaching 40-hour limit)`;
        warning.style.display = 'block';
        warning.style.background = '#fff3cd';
        warning.style.color = '#856404';
      } else {
        warning.style.display = 'none';
      }
    } catch (err) {
      console.error('Hours check error:', err);
    }
  };
}
async function confirmAssignOpenShift(shiftId) {
  const select = document.getElementById('assignStaffSelect');
  const value = select.value;
  
  if (!value) {
    alert('Please select an assignment');
    return;
  }
  
  const isOpen = (value === 'OPEN');
  const staffId = isOpen ? null : parseInt(value);
  
  // Get old state before making the change
  const shift = allShifts.find(s => s.id === shiftId);
  const oldStaffId = shift ? shift.assigned_to : null;
  
  try {
    showLoading();
    await apiCall(`/shifts/${shiftId}`, {
      method: 'PUT',
      body: JSON.stringify({
        assignedTo: staffId,
        isOpen: isOpen
      })
    });
    
    // Track the change with old and new state
    if (shift) {
      trackChange('assign', shift, oldStaffId, staffId);
    }
    
    const modal = document.querySelector('.modal-overlay');
    if (modal) modal.remove();
    
    await loadShifts();
    showSuccess(isOpen ? 'Shift marked as open!' : 'Shift assigned successfully!');
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}


// Staff request open shift with confirmation
async function confirmRequestShift(shiftId) {
  const shift = allShifts.find(s => s.id === shiftId);
  const def = SHIFT_DEFS[shift.shift_type];
  const dateStr = new Date(shift.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  
  if (!confirm(`Request this open shift?\n\n${dateStr}\n${def.icon} ${def.label} (${def.time})\n${def.hours} hours\n\nRequires admin approval.`)) {
    return;
  }
  
  try {
    showLoading();
    await apiCall('/shift-requests', {
      method: 'POST',
      body: JSON.stringify({ shiftId })
    });
    
    showSuccess('Shift requested! You will be notified when approved.');
    loadShifts();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

// Modal for admin reassignment
function showReassignModal(shift) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };
  
  const def = SHIFT_DEFS[shift.shift_type];
  const currentStaff = allStaff.find(s => s.id === shift.assigned_to);
  
  const content = document.createElement('div');
  content.className = 'modal-content';
  content.innerHTML = `
    <h3>Reassign Shift</h3>
    <p><strong>Date:</strong> ${new Date(shift.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
    <p><strong>Type:</strong> ${def.icon} ${shift.shift_type.charAt(0).toUpperCase() + shift.shift_type.slice(1)} (${def.time})</p>
    <p><strong>Currently:</strong> ${currentStaff?.full_name || 'Unknown'}</p>
    <hr>
    <label>Reassign to:</label>
    <select id="reassignSelect" class="inp">
      <option value="">-- Select Staff --</option>
      <option value="OPEN">Make Open Shift</option>
      ${allStaff.filter(s => s.role === 'staff').map(s => 
        `<option value="${s.id}" ${s.id === shift.assigned_to ? 'selected' : ''}>${s.full_name}</option>`
      ).join('')}
    </select>
    <div class="modal-actions">
      <button class="b-can" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
      <button class="b-pri" onclick="saveReassignment(${shift.id})">Save</button>
    </div>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
  
  setTimeout(() => document.getElementById('reassignSelect').focus(), 100);
}

async function saveReassignment(shiftId) {
  const select = document.getElementById('reassignSelect');
  const newAssignee = select.value;
  
  if (!newAssignee) {
    alert('Please select a staff member');
    return;
  }
  
  // Get old state BEFORE making changes
  const shift = allShifts.find(s => s.id === shiftId);
  const oldStaffId = shift ? shift.assigned_to : null;
  
  // Remember current view mode before reload
  const savedViewMode = viewMode;
  
  try {
    showLoading();
    
    const isOpen = (newAssignee === 'OPEN');
    const newStaffId = isOpen ? null : parseInt(newAssignee);
    
    if (isOpen) {
      // Make it an open shift
      await apiCall(`/shifts/${shiftId}`, {
        method: 'PUT',
        body: JSON.stringify({ 
          assignedTo: null,
          isOpen: true
        })
      });
    } else {
      // Assign to specific staff
      await apiCall(`/shifts/${shiftId}`, {
        method: 'PUT',
        body: JSON.stringify({ 
          assignedTo: newStaffId,
          isOpen: false
        })
      });
    }
    
    // Track the change with old and new state
    if (shift) {
      trackChange('reassign', shift, oldStaffId, newStaffId);
    }
    
    // Close modal
    document.querySelector('.modal-overlay').remove();
    
    // Reload both staff (to get updated names) and shifts (to get updated assignments)
    await loadStaff();
    await loadShifts();
    
    // Restore view mode if it changed during reload
    if (viewMode !== savedViewMode) {
      setView(savedViewMode);
    }
    
    // Show success message
    showSuccess('Shift reassigned successfully!');
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

function showSuccess(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast-success';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

async function requestShift(shiftId) {
  if (!confirm('Request this open shift?')) return;
  
  try {
    showLoading();
    await apiCall('/shift-requests', {
      method: 'POST',
      body: JSON.stringify({ shiftId })
    });
    
    alert('Shift requested! You will be notified when approved.');
    loadShifts();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

// ═══════════════════════════════════════════════════════════
// APPROVALS (ADMIN ONLY)
// ═══════════════════════════════════════════════════════════
async function loadPendingApprovals() {
  try {
    const [shiftReqs, tradeReqs, timeOffReqs] = await Promise.all([
      apiCall('/shift-requests').catch(() => ({ requests: [] })),
      apiCall('/trade-requests').catch(() => ({ requests: [] })),
      apiCall('/time-off-requests').catch(() => ({ requests: [] }))
    ]);
    
    const pending = [
      ...shiftReqs.requests.filter(r => r.status === 'pending'),
      ...tradeReqs.requests.filter(r => r.status === 'pending' && r.requester_approved && r.target_approved),
      ...timeOffReqs.requests.filter(r => r.status === 'pending')
    ];
    
    // Update badge
    const badge = document.getElementById('approvalBadge');
    if (pending.length > 0) {
      badge.textContent = pending.length;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
    
    renderApprovalsList(shiftReqs.requests, tradeReqs.requests, timeOffReqs.requests);
  } catch (err) {
    console.error('Load approvals error:', err);
  }
}

function renderApprovalsList(shiftReqs, tradeReqs, timeOffReqs) {
  const list = document.getElementById('approvalsList');
  list.innerHTML = '';
  
  const pendingShift = shiftReqs.filter(r => r.status === 'pending');
  const pendingTrade = tradeReqs.filter(r => r.status === 'pending' && r.requester_approved && r.target_approved);
  const pendingTimeOff = timeOffReqs.filter(r => r.status === 'pending');
  
  const emptyMsg = document.getElementById("noApprovalsMsg");
  if (pendingShift.length === 0 && pendingTrade.length === 0 && pendingTimeOff.length === 0) {
    list.style.display = "none";
    if (emptyMsg) emptyMsg.style.display = "block";
    return;
  }
  list.style.display = "block";
  if (emptyMsg) emptyMsg.style.display = "none";
  
  // Shift requests
  pendingShift.forEach(req => {
    const item = document.createElement('div');
    item.className = 'approval-item';
    item.innerHTML = `
      <div class="approval-header">
        <div>
          <div class="approval-title">Shift Request</div>
          <div class="approval-meta">${req.requester_name} → ${req.date} ${SHIFT_DEFS[req.shift_type].label}</div>
        </div>
      </div>
      <div class="approval-actions">
        <button class="btn-approve" onclick="approveShiftRequest(${req.id})">Approve</button>
        <button class="btn-deny" onclick="denyShiftRequest(${req.id})">Deny</button>
      </div>
    `;
    list.appendChild(item);
  });
  
  // Trade requests
  pendingTrade.forEach(req => {
    const item = document.createElement('div');
    item.className = 'approval-item';
    item.innerHTML = `
      <div class="approval-header">
        <div>
          <div class="approval-title">Trade Request (Both Approved)</div>
          <div class="approval-meta">${req.requester_name} ↔ ${req.target_name}</div>
          <div class="approval-meta">${req.req_date} ↔ ${req.tgt_date}</div>
        </div>
      </div>
      <div class="approval-actions">
        <button class="btn-approve" onclick="finalizeTrade(${req.id})">Finalize Trade</button>
        <button class="btn-deny" onclick="denyTrade(${req.id})">Deny</button>
      </div>
    `;
    list.appendChild(item);
  });
  
  // Time off requests
  pendingTimeOff.forEach(req => {
    const item = document.createElement('div');
    item.className = 'approval-item';
    item.innerHTML = `
      <div class="approval-header">
        <div>
          <div class="approval-title">Time Off Request</div>
          <div class="approval-meta">${req.requester_name} → ${req.start_date || req.shift_date}</div>
          ${req.reason ? `<div class="approval-meta">Reason: ${req.reason}</div>` : ''}
        </div>
      </div>
      <div class="approval-actions">
        <button class="btn-approve" onclick="approveTimeOff(${req.id})">Approve</button>
        <button class="btn-deny" onclick="denyTimeOff(${req.id})">Deny</button>
      </div>
    `;
    list.appendChild(item);
  });
}

async function approveShiftRequest(requestId) {
  const note = prompt('Optional note for staff member:');
  try {
    showLoading();
    await apiCall(`/shift-requests/${requestId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ note })
    });
    alert('Shift request approved! Staff member notified via Telegram.');
    loadPendingApprovals();
    loadShifts();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

async function denyShiftRequest(requestId) {
  const note = prompt('Reason for denial (optional):');
  try {
    showLoading();
    await apiCall(`/shift-requests/${requestId}/deny`, {
      method: 'POST',
      body: JSON.stringify({ note })
    });
    alert('Shift request denied.');
    loadPendingApprovals();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

async function finalizeTrade(tradeId) {
  const note = prompt('Optional note:');
  try {
    showLoading();
    await apiCall(`/trade-requests/${tradeId}/finalize`, {
      method: 'POST',
      body: JSON.stringify({ note })
    });
    alert('Trade finalized! Both staff members notified.');
    loadPendingApprovals();
    loadShifts();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

async function denyTrade(tradeId) {
  const note = prompt('Reason for denial:');
  try {
    showLoading();
    await apiCall(`/trade-requests/${tradeId}/deny`, {
      method: 'POST',
      body: JSON.stringify({ note, status: 'denied' })
    });
    alert('Trade denied.');
    loadPendingApprovals();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

async function approveTimeOff(requestId) {
  const note = prompt('Optional note:');
  try {
    showLoading();
    await apiCall(`/time-off-requests/${requestId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ note })
    });
    alert('Time off approved!');
    loadPendingApprovals();
    loadShifts();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

async function denyTimeOff(requestId) {
  const note = prompt('Reason for denial:');
  try {
    showLoading();
    await apiCall(`/time-off-requests/${requestId}/deny`, {
      method: 'POST',
      body: JSON.stringify({ note })
    });
    alert('Time off denied.');
    loadPendingApprovals();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

// ═══════════════════════════════════════════════════════════
// DASHBOARD (STAFF)
// ═══════════════════════════════════════════════════════════
async function loadDashboard() {
  try {
    const result = await apiCall('/dashboard');
    renderDashboard(result);
  } catch (err) {
    console.error('Dashboard error:', err);
  }
}

function renderDashboard(data) {
  const content = document.getElementById('dashboardContent');
  
  const upcomingHtml = data.upcomingShifts.map(s => {
    const def = SHIFT_DEFS[s.shift_type];
    return `<div style="padding:8px;background:#f8f8f8;border-radius:6px;margin:4px 0;">
      <strong>${s.date}</strong> - ${def.label} (${def.time})
    </div>`;
  }).join('');
  
  content.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Hours This Week</div>
        <div class="stat-value">${data.weeklyHours.toFixed(1)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Pending Requests</div>
        <div class="stat-value">${data.pendingRequests}</div>
      </div>
    </div>
    <div style="margin-top:16px;">
      <strong>Upcoming Shifts:</strong>
      ${upcomingHtml || '<p style="color:#888;margin-top:8px;">No upcoming shifts</p>'}
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day;
  return new Date(d.setDate(diff));
}

function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLong(date) {
  return new Date(date).toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });
}

// ═══════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Enter key on login
  document.getElementById('username').addEventListener('keypress', e => {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('password').addEventListener('keypress', e => {
    if (e.key === 'Enter') handleLogin();
  });
  
  // Check if already logged in
  apiCall('/me').then(result => {
    currentUser = result.user;
    showApp();
  }).catch(() => {
    // Not logged in, show login screen
  });
});


// Toggle staff view filter
function toggleMyShiftsOnly() {
  showOnlyMyShifts = !showOnlyMyShifts;
  const btn = document.getElementById('toggleMyShiftsBtn');
  if (btn) {
    btn.textContent = showOnlyMyShifts ? 'Show All Shifts' : 'Show Only My Shifts';
    btn.style.background = showOnlyMyShifts ? '#667eea' : '#f8f9fa';
    btn.style.color = showOnlyMyShifts ? 'white' : '#495057';
  }
  renderCalendar();
}

// Pay period summary
function renderPayPeriodSummary() {
  const container = document.getElementById('payPeriodSummary');
  if (!container) return;
  
  const today = new Date();
  const currentPeriodStart = getPayPeriodStart(today);
  const currentPeriodEnd = new Date(currentPeriodStart);
  currentPeriodEnd.setDate(currentPeriodEnd.getDate() + 6);
  
  const nextPeriodStart = new Date(currentPeriodEnd);
  nextPeriodStart.setDate(nextPeriodStart.getDate() + 1);
  const nextPeriodEnd = new Date(nextPeriodStart);
  nextPeriodEnd.setDate(nextPeriodEnd.getDate() + 6);
  
  // Get shifts for current and next period
  const currentShifts = allShifts.filter(s => {
    const date = new Date(s.date);
    return s.assigned_to === currentUser.id && date >= currentPeriodStart && date <= currentPeriodEnd;
  });
  
  const nextShifts = allShifts.filter(s => {
    const date = new Date(s.date);
    return s.assigned_to === currentUser.id && date >= nextPeriodStart && date <= nextPeriodEnd;
  });
  
  const currentHours = currentShifts.reduce((sum, s) => sum + (SHIFT_DEFS[s.shift_type]?.hours || 0), 0);
  const nextHours = nextShifts.reduce((sum, s) => sum + (SHIFT_DEFS[s.shift_type]?.hours || 0), 0);
  
  const currentHoursClass = currentHours >= 40 ? 'hrs-over' : currentHours >= 36 ? 'hrs-warn' : 'hrs-ok';
  const nextHoursClass = nextHours >= 40 ? 'hrs-over' : nextHours >= 36 ? 'hrs-warn' : 'hrs-ok';
  
  container.innerHTML = `
    <div class="period-summary-card">
      <h4>Current Pay Period</h4>
      <div class="period-dates">${formatDateShort(currentPeriodStart)} – ${formatDateShort(currentPeriodEnd)}</div>
      <div class="period-shifts">${currentShifts.length} shift${currentShifts.length !== 1 ? 's' : ''}</div>
      <div class="period-hours ${currentHoursClass}">${currentHours.toFixed(1)} hours</div>
      ${currentShifts.length > 0 ? `
        <div class="period-list">
          ${currentShifts.slice(0, 3).map(s => {
            const def = SHIFT_DEFS[s.shift_type];
            return `<div class="period-shift-item">${formatDateShort(new Date(s.date))}: ${def.icon} ${def.label}</div>`;
          }).join('')}
          ${currentShifts.length > 3 ? `<div class="period-more">+${currentShifts.length - 3} more</div>` : ''}
        </div>
      ` : '<div class="period-empty">No shifts scheduled</div>'}
    </div>
    <div class="period-summary-card">
      <h4>Next Pay Period</h4>
      <div class="period-dates">${formatDateShort(nextPeriodStart)} – ${formatDateShort(nextPeriodEnd)}</div>
      <div class="period-shifts">${nextShifts.length} shift${nextShifts.length !== 1 ? 's' : ''}</div>
      <div class="period-hours ${nextHoursClass}">${nextHours.toFixed(1)} hours</div>
      ${nextShifts.length > 0 ? `
        <div class="period-list">
          ${nextShifts.slice(0, 3).map(s => {
            const def = SHIFT_DEFS[s.shift_type];
            return `<div class="period-shift-item">${formatDateShort(new Date(s.date))}: ${def.icon} ${def.label}</div>`;
          }).join('')}
          ${nextShifts.length > 3 ? `<div class="period-more">+${nextShifts.length - 3} more</div>` : ''}
        </div>
      ` : '<div class="period-empty">No shifts scheduled</div>'}
    </div>
  `;
}

function getPayPeriodStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day;
  return new Date(d.setDate(diff));
}

function formatDateShort(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
// ADD THIS TO app.js

// ═══════════════════════════════════════════════════════════
// SHIFT GENERATOR
// ═══════════════════════════════════════════════════════════

function openShiftGenerator() {
  // Load templates from localStorage
  loadTemplates();
  
  // Populate staff dropdowns
  populateStaffDropdowns();
  
  // Set default dates (today and 2 weeks ahead)
  const today = new Date();
  const twoWeeks = new Date(today);
  twoWeeks.setDate(twoWeeks.getDate() + 14);
  
  document.getElementById('genStartDate').value = formatDate(today);
  document.getElementById('genEndDate').value = formatDate(twoWeeks);
  document.getElementById('copySourceDate').value = formatDate(today);
  document.getElementById('copyTargetDate').value = formatDate(twoWeeks);
  
  // Show modal
  document.getElementById('shiftGeneratorModal').style.display = 'flex';
  
  // Default to create tab
  switchGenTab('create');
  updateGeneratorPreview();
}

function closeShiftGenerator() {
  document.getElementById('shiftGeneratorModal').style.display = 'none';
}

function switchGenTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.gen-tab').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
  
  // Update tab content
  document.querySelectorAll('.gen-tab-content').forEach(content => content.classList.remove('active'));
  document.getElementById('genTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1)).classList.add('active');
}

function populateStaffDropdowns() {
  const activeStaff = allStaff.filter(s => s.role === 'staff' && s.username !== '_open');
  
  // Specific staff dropdown
  const specificSelect = document.getElementById('genSpecificStaff');
  specificSelect.innerHTML = '<option value="">-- Select Staff --</option>';
  activeStaff.forEach(s => {
    specificSelect.innerHTML += `<option value="${s.id}">${s.full_name}</option>`;
  });
  
  // Rotation list
  const rotationList = document.getElementById('rotationList');
  rotationList.innerHTML = '';
  activeStaff.forEach(s => {
    const item = document.createElement('div');
    item.className = 'rotation-item';
    item.draggable = true;
    item.dataset.staffId = s.id;
    item.innerHTML = `
      <span class="drag-handle">⋮⋮</span>
      <label>
        <input type="checkbox" checked data-staff-id="${s.id}">
        ${s.full_name}
      </label>
    `;
    rotationList.appendChild(item);
  });
  
  // Add drag and drop handlers
  setupRotationDragDrop();
}

function setupRotationDragDrop() {
  const items = document.querySelectorAll('.rotation-item');
  let draggedItem = null;
  
  items.forEach(item => {
    item.addEventListener('dragstart', function() {
      draggedItem = this;
      this.style.opacity = '0.5';
    });
    
    item.addEventListener('dragend', function() {
      this.style.opacity = '1';
    });
    
    item.addEventListener('dragover', function(e) {
      e.preventDefault();
    });
    
    item.addEventListener('drop', function(e) {
      e.preventDefault();
      if (this !== draggedItem) {
        const allItems = [...this.parentNode.children];
        const draggedIndex = allItems.indexOf(draggedItem);
        const targetIndex = allItems.indexOf(this);
        
        if (draggedIndex < targetIndex) {
          this.parentNode.insertBefore(draggedItem, this.nextSibling);
        } else {
          this.parentNode.insertBefore(draggedItem, this);
        }
      }
    });
  });
}

function togglePatternOptions() {
  const pattern = document.getElementById('genPattern').value;
  
  document.getElementById('specificStaffOption').style.display = pattern === 'specific' ? 'block' : 'none';
  document.getElementById('rotateStaffOption').style.display = pattern === 'rotate' ? 'block' : 'none';
  
  updateGeneratorPreview();
}

function updateGeneratorPreview() {
  const startDate = new Date(document.getElementById('genStartDate').value);
  const endDate = new Date(document.getElementById('genEndDate').value);
  
  if (isNaN(startDate) || isNaN(endDate)) {
    document.getElementById('genPreviewText').textContent = 'Select dates';
    return;
  }
  
  // Count selected days
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const selectedDays = days.filter((_, i) => document.getElementById('day' + days[i]).checked);
  
  // Count selected shift types
  const shiftTypes = [];
  if (document.getElementById('shiftMorning').checked) shiftTypes.push('Morning');
  if (document.getElementById('shiftAfternoon').checked) shiftTypes.push('Afternoon');
  if (document.getElementById('shiftOvernight').checked) shiftTypes.push('Overnight');
  
  // Calculate days in range
  const dayCount = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
  const pattern = document.getElementById('genPattern').value;
  
  const estimatedShifts = selectedDays.length * shiftTypes.length * Math.ceil(dayCount / 7);
  
  let patternText = pattern === 'open' ? 'as open shifts' : 
                   pattern === 'specific' ? 'assigned to selected staff' : 
                   'rotating through staff';
  
  document.getElementById('genPreviewText').textContent = 
    `Will create ~${estimatedShifts} shifts (${selectedDays.length} days/week × ${shiftTypes.length} shift types × ${Math.ceil(dayCount/7)} weeks) ${patternText}`;
}

async function generateShifts() {
  const startDate = new Date(document.getElementById('genStartDate').value);
  const endDate = new Date(document.getElementById('genEndDate').value);
  const pattern = document.getElementById('genPattern').value;
  
  // Get selected days
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const selectedDays = days.map((day, i) => 
    document.getElementById('day' + day).checked ? i : -1
  ).filter(i => i !== -1);
  
  // Get selected shift types
  const shiftTypes = [];
  if (document.getElementById('shiftMorning').checked) shiftTypes.push('morning');
  if (document.getElementById('shiftAfternoon').checked) shiftTypes.push('afternoon');
  if (document.getElementById('shiftOvernight').checked) shiftTypes.push('overnight');
  
  if (shiftTypes.length === 0) {
    alert('Please select at least one shift type');
    return;
  }
  
  // Get assignment info
  let assignedTo = null;
  let rotationStaff = [];
  
  if (pattern === 'specific') {
    assignedTo = parseInt(document.getElementById('genSpecificStaff').value);
    if (!assignedTo) {
      alert('Please select a staff member');
      return;
    }
  } else if (pattern === 'rotate') {
    const checkboxes = document.querySelectorAll('#rotationList input[type="checkbox"]:checked');
    rotationStaff = [...checkboxes].map(cb => parseInt(cb.dataset.staffId));
    if (rotationStaff.length === 0) {
      alert('Please select at least one staff member for rotation');
      return;
    }
  }
  
  if (!confirm(`This will create shifts from ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}. Continue?`)) {
    return;
  }
  
  try {
    showLoading();
    
    const shifts = [];
    let rotationIndex = 0;
    
    // Generate shifts for each day in range
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      
      // Skip if this day not selected
      if (!selectedDays.includes(dayOfWeek)) continue;
      
      const dateStr = formatDate(d);
      
      // Create each shift type for this day
      for (const shiftType of shiftTypes) {
        const shift = {
          date: dateStr,
          shiftType: shiftType,
          isOpen: pattern === 'open',
          assignedTo: null
        };
        
        if (pattern === 'specific') {
          shift.assignedTo = assignedTo;
        } else if (pattern === 'rotate') {
          shift.assignedTo = rotationStaff[rotationIndex % rotationStaff.length];
          rotationIndex++;
        }
        
        shifts.push(shift);
      }
    }
    
    // Send to API
    const result = await apiCall('/shifts/bulk', {
      method: 'POST',
      body: JSON.stringify({ shifts })
    });
    
    closeShiftGenerator();
    showSuccess(`${result.created} shifts created successfully!`);
    loadShifts();
    
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

async function copyShifts() {
  const copyFrom = document.querySelector('input[name="copyFrom"]:checked').value;
  const sourceDate = new Date(document.getElementById('copySourceDate').value);
  const targetDate = new Date(document.getElementById('copyTargetDate').value);
  const keepAssignments = document.getElementById('copyKeepAssignments').checked;
  const skipExisting = document.getElementById('copySkipExisting').checked;
  
  if (isNaN(sourceDate) || isNaN(targetDate)) {
    alert('Please select both source and target dates');
    return;
  }
  
  if (!confirm(`Copy shifts from ${sourceDate.toLocaleDateString()} to ${targetDate.toLocaleDateString()}?`)) {
    return;
  }
  
  try {
    showLoading();
    
    const result = await apiCall('/shifts/copy', {
      method: 'POST',
      body: JSON.stringify({
        sourceDate: formatDate(sourceDate),
        targetDate: formatDate(targetDate),
        copyType: copyFrom,
        keepAssignments,
        skipExisting
      })
    });
    
    closeShiftGenerator();
    showSuccess(`${result.copied} shifts copied successfully!`);
    loadShifts();
    
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

// Template management
async function loadTemplates() {
  try {
    const templates = await apiCall('/shift-templates');
    
    document.getElementById('tmplMorningLabel').value = templates.morning?.label || 'Morning';
    document.getElementById('tmplMorningTime').value = templates.morning?.time || '7:00 AM – 3:00 PM';
    document.getElementById('tmplMorningHours').value = templates.morning?.hours || '8.0';
    
    document.getElementById('tmplAfternoonLabel').value = templates.afternoon?.label || 'Afternoon';
    document.getElementById('tmplAfternoonTime').value = templates.afternoon?.time || '3:00 PM – 7:00 PM';
    document.getElementById('tmplAfternoonHours').value = templates.afternoon?.hours || '4.0';
    
    document.getElementById('tmplOvernightLabel').value = templates.overnight?.label || 'Overnight';
    document.getElementById('tmplOvernightTime').value = templates.overnight?.time || '7:00 PM – 7:00 AM';
    document.getElementById('tmplOvernightHours').value = templates.overnight?.hours || '12.0';
    
    // Update SHIFT_DEFS with loaded values
    if (templates.morning) {
      SHIFT_DEFS.morning.label = templates.morning.label;
      SHIFT_DEFS.morning.time = templates.morning.time;
      SHIFT_DEFS.morning.hours = templates.morning.hours;
    }
    if (templates.afternoon) {
      SHIFT_DEFS.afternoon.label = templates.afternoon.label;
      SHIFT_DEFS.afternoon.time = templates.afternoon.time;
      SHIFT_DEFS.afternoon.hours = templates.afternoon.hours;
    }
    if (templates.overnight) {
      SHIFT_DEFS.overnight.label = templates.overnight.label;
      SHIFT_DEFS.overnight.time = templates.overnight.time;
      SHIFT_DEFS.overnight.hours = templates.overnight.hours;
    }
  } catch (err) {
    console.error('Load templates error:', err);
    // Use defaults if loading fails
  }
}

async function saveTemplates() {
  const templates = {
    morning: {
      label: document.getElementById('tmplMorningLabel').value,
      time: document.getElementById('tmplMorningTime').value,
      hours: parseFloat(document.getElementById('tmplMorningHours').value),
      icon: '🌅'
    },
    afternoon: {
      label: document.getElementById('tmplAfternoonLabel').value,
      time: document.getElementById('tmplAfternoonTime').value,
      hours: parseFloat(document.getElementById('tmplAfternoonHours').value),
      icon: '🌆'
    },
    overnight: {
      label: document.getElementById('tmplOvernightLabel').value,
      time: document.getElementById('tmplOvernightTime').value,
      hours: parseFloat(document.getElementById('tmplOvernightHours').value),
      icon: '🌙'
    }
  };
  
  try {
    showLoading();
    await apiCall('/shift-templates', {
      method: 'POST',
      body: JSON.stringify(templates)
    });
    
    // Update SHIFT_DEFS with new values
    SHIFT_DEFS.morning = templates.morning;
    SHIFT_DEFS.afternoon = templates.afternoon;
    SHIFT_DEFS.overnight = templates.overnight;
    
    showSuccess('Templates saved for all admins! Refresh to see changes in calendar.');
    closeShiftGenerator();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

// Add event listeners for preview updates
document.addEventListener('DOMContentLoaded', function() {
  const genInputs = ['genStartDate', 'genEndDate', 'daySun', 'dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat', 
                     'shiftMorning', 'shiftAfternoon', 'shiftOvernight', 'genPattern'];
  genInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', updateGeneratorPreview);
    }
  });
});
// ADD THIS TO public/app.js (at the end, before closing)

// ═══════════════════════════════════════════════════════════
// DATA EXPORT/IMPORT
// ═══════════════════════════════════════════════════════════

async function exportData() {
  if (!confirm('Export all staff and shifts to a backup file?\n\nThis creates a JSON file you can use to restore data after redeploys.')) {
    return;
  }
  
  try {
    showLoading();
    const data = await apiCall('/export-data');
    
    // Create downloadable JSON file
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scheduler-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showSuccess(`Exported ${data.staff.length} staff and ${data.shifts.length} shifts!`);
  } catch (err) {
    alert('Export failed: ' + err.message);
  } finally {
    hideLoading();
  }
}

function openImportDialog() {
  document.getElementById('importDataModal').style.display = 'flex';
}

function closeImportDialog() {
  document.getElementById('importDataModal').style.display = 'none';
  document.getElementById('importFileInput').value = '';
  document.getElementById('importPreview').innerHTML = '';
}

function handleImportFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      
      // Validate data structure
      if (!data.staff || !data.shifts) {
        alert('Invalid backup file format!');
        return;
      }
      
      // Show preview
      const preview = document.getElementById('importPreview');
      preview.innerHTML = `
        <div class="import-preview">
          <h4>✅ Valid Backup File</h4>
          <p><strong>Export Date:</strong> ${new Date(data.exportDate).toLocaleString()}</p>
          <p><strong>Staff Members:</strong> ${data.staff.length}</p>
          <p><strong>Shifts:</strong> ${data.shifts.length}</p>
          ${data.templates ? '<p><strong>Templates:</strong> Included</p>' : ''}
          <div class="import-warning">
            ⚠️ This will add missing staff and shifts. Existing data will not be deleted.
          </div>
        </div>
      `;
      
      // Store data for import
      window.importData = data;
      document.getElementById('importButton').disabled = false;
    } catch (err) {
      alert('Error reading file: ' + err.message);
    }
  };
  reader.readAsText(file);
}

async function confirmImport() {
  if (!window.importData) {
    alert('Please select a backup file first');
    return;
  }
  
  if (!confirm('Import data from backup file?\n\nThis will add any missing staff and shifts.')) {
    return;
  }
  
  try {
    showLoading();
    const result = await apiCall('/import-data', {
      method: 'POST',
      body: JSON.stringify(window.importData)
    });
    
    closeImportDialog();
    showSuccess(result.message);
    
    // Reload data
    await loadStaff();
    await loadShifts();
  } catch (err) {
    alert('Import failed: ' + err.message);
  } finally {
    hideLoading();
  }
}
// ADD THIS TO app.js - Change Tracking System

// Global change tracking
// CHANGE TRACKING SYSTEM - With Debug Logging

let scheduleChanges = {}; // Object for consolidation
let changeTimer = null;

function trackChange(changeType, shift, oldStaffId, newStaffId) {
  console.log('🔵 trackChange called:', { changeType, shift, oldStaffId, newStaffId });
  
  const shiftKey = `${shift.date}_${shift.shift_type}`;
  
  // If this shift already has a tracked change, update it
  if (scheduleChanges[shiftKey]) {
    console.log('🟡 Updating existing change for:', shiftKey);
    const existing = scheduleChanges[shiftKey];
    
    // Update to final state
    existing.newStaffId = newStaffId;
    existing.newStaffName = newStaffId ? (allStaff.find(s => s.id === newStaffId)?.full_name || 'Unknown') : null;
    existing.isOpen = !newStaffId;
    existing.timestamp = new Date().toISOString();
    
    // If final state equals original state, remove the change
    if (existing.originalStaffId === existing.newStaffId) {
      delete scheduleChanges[shiftKey];
      console.log('✅ Change cancelled out:', shiftKey);
    } else {
      console.log('✅ Change updated:', existing);
    }
  } else {
    console.log('🟢 Creating new change for:', shiftKey);
    // New change
    scheduleChanges[shiftKey] = {
      shiftId: shift.id,
      date: shift.date,
      shiftType: shift.shift_type,
      originalStaffId: oldStaffId,
      originalStaffName: oldStaffId ? (allStaff.find(s => s.id === oldStaffId)?.full_name || 'Unknown') : null,
      newStaffId: newStaffId,
      newStaffName: newStaffId ? (allStaff.find(s => s.id === newStaffId)?.full_name || 'Unknown') : null,
      isOpen: !newStaffId,
      timestamp: new Date().toISOString()
    };
    console.log('✅ Change tracked:', scheduleChanges[shiftKey]);
  }
  
  console.log('📊 Total changes:', Object.keys(scheduleChanges).length);
  updateNotificationButton();
  startReminderTimer();
}

function startReminderTimer() {
  if (changeTimer) {
    clearTimeout(changeTimer);
  }
  
  const changeCount = Object.keys(scheduleChanges).length;
  if (changeCount > 0) {
    changeTimer = setTimeout(() => {
      remindAdminToNotify();
    }, 30 * 60 * 1000); // 30 minutes
    console.log('⏰ Reminder timer set for 30 minutes');
  }
}

async function remindAdminToNotify() {
  const changeCount = Object.keys(scheduleChanges).length;
  if (changeCount === 0) return;
  
  try {
    await apiCall('/remind-admin-notifications', {
      method: 'POST',
      body: JSON.stringify({ changeCount })
    });
    
    showWarning(`⏰ Reminder: You have ${changeCount} unsent schedule change${changeCount > 1 ? 's' : ''}`);
  } catch (err) {
    console.error('Reminder error:', err);
  }
}

function updateNotificationButton() {
  const btn = document.getElementById('sendNotificationsBtn');
  if (!btn) {
    console.log('⚠️ Notification button not found');
    return;
  }
  
  const count = Object.keys(scheduleChanges).length;
  console.log('🔔 Updating button, change count:', count);
  
  if (count === 0) {
    btn.disabled = true;
    btn.textContent = '📧 Send Notifications';
    btn.style.opacity = '0.5';
  } else {
    btn.disabled = false;
    btn.textContent = `📧 Send Notifications (${count} ${count === 1 ? 'change' : 'changes'})`;
    btn.style.opacity = '1';
  }
}

async function sendScheduleNotifications() {
  const changes = Object.values(scheduleChanges);
  console.log('📤 Sending notifications for changes:', changes);
  
  if (changes.length === 0) {
    alert('No changes to notify about');
    return;
  }
  
  if (!confirm(`Send notifications for ${changes.length} schedule ${changes.length === 1 ? 'change' : 'changes'}?`)) {
    return;
  }
  
  try {
    showLoading();
    
    const result = await apiCall('/send-schedule-notifications', {
      method: 'POST',
      body: JSON.stringify({ changes })
    });
    
    console.log('✅ Notifications sent:', result);
    showSuccess(`Notifications sent to ${result.notified} staff member(s)!`);
    
    // Clear changes and timer
    scheduleChanges = {};
    if (changeTimer) {
      clearTimeout(changeTimer);
      changeTimer = null;
    }
    updateNotificationButton();
    
  } catch (err) {
    console.error('❌ Notification error:', err);
    alert('Error sending notifications: ' + err.message);
  } finally {
    hideLoading();
  }
}

function clearScheduleChanges() {
  const count = Object.keys(scheduleChanges).length;
  if (count === 0) return;
  
  if (confirm(`Clear ${count} tracked ${count === 1 ? 'change' : 'changes'} without sending notifications?`)) {
    scheduleChanges = {};
    if (changeTimer) {
      clearTimeout(changeTimer);
      changeTimer = null;
    }
    updateNotificationButton();
    showSuccess('Changes cleared');
  }
}

function showWarning(message) {
  const warning = document.createElement('div');
  warning.className = 'warning-banner';
  warning.textContent = message;
  warning.style.cssText = 'position:fixed;top:20px;right:20px;background:#ffc107;color:#000;padding:16px 20px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:9999;font-weight:600;';
  document.body.appendChild(warning);
  
  setTimeout(() => {
    warning.remove();
  }, 10000);
}

// ═══════════════════════════════════════════════════════════
// STAFF ACTION BUTTONS (Request Shift/Trade, Emergency, Contact, Settings)
// ═══════════════════════════════════════════════════════════

// ── REQUEST SHIFT / TRADE ──────────────────────────────────

let requestMode = null; // 'shift' or 'trade'
let selectedShiftForAction = null; // shift object user tapped in pick mode
let tradeMyShift = null; // first leg of trade

function openRequestDialog() {
  document.getElementById('requestDialog').classList.add('show');
}

function closeRequestDialog() {
  document.getElementById('requestDialog').classList.remove('show');
  exitPickMode();
}

function startShiftRequest() {
  closeRequestDialog();
  requestMode = 'shift';
  enterPickMode('Tap an OPEN SHIFT (grey tile) to request it');
}

function startTradeRequest() {
  closeRequestDialog();
  requestMode = 'trade_step1';
  tradeMyShift = null;
  enterPickMode('Step 1 of 2 — Tap YOUR shift that you want to give away');
}

function enterPickMode(hint) {
  document.getElementById('pickModeBar').classList.add('show');
  document.getElementById('pickModeHint').textContent = hint;
  document.getElementById('calendarRoot').classList.add('pick-mode');
}

function exitPickMode() {
  requestMode = null;
  tradeMyShift = null;
  document.getElementById('pickModeBar').classList.remove('show');
  document.getElementById('calendarRoot').classList.remove('pick-mode');
}

// Called from createShiftTile when in pick mode
function handleTilePick(shift) {
  if (!requestMode) return;

  if (requestMode === 'shift') {
    // Must be an open shift
    if (!shift.is_open) {
      showWarning('⚠️ Please tap an open (grey) shift to request it.');
      return;
    }
    exitPickMode();
    confirmRequestShiftFromPick(shift);

  } else if (requestMode === 'trade_step1') {
    // Must be the current user's own shift
    if (shift.assigned_to !== currentUser.id) {
      showWarning('⚠️ Please tap one of YOUR shifts — the one you want to trade away.');
      return;
    }
    tradeMyShift = shift;
    requestMode = 'trade_step2';
    document.getElementById('pickModeHint').textContent =
      `Step 2 of 2 — Now tap the shift you WANT to receive (currently assigned to someone else)`;

  } else if (requestMode === 'trade_step2') {
    if (!shift.assigned_to || shift.is_open) {
      showWarning('⚠️ Please tap an assigned shift belonging to another staff member.');
      return;
    }
    if (shift.assigned_to === currentUser.id) {
      showWarning('⚠️ You can\'t trade with yourself. Pick a shift belonging to someone else.');
      return;
    }
    exitPickMode();
    confirmTradeFromPick(tradeMyShift, shift);
  }
}

function confirmRequestShiftFromPick(shift) {
  const def = SHIFT_DEFS[shift.shift_type];
  const dateStr = new Date(shift.date + 'T12:00:00').toLocaleDateString('en-US',
    { weekday: 'short', month: 'short', day: 'numeric' });

  const modal = buildSimpleModal(`
    <h3>📋 Request Open Shift</h3>
    <div class="pick-confirm-box">
      <div class="pick-shift-preview">
        <div class="psv-icon">${def.icon}</div>
        <div>
          <div class="psv-date">${dateStr}</div>
          <div class="psv-type">${def.label} · ${def.time} · ${def.hours}h</div>
        </div>
      </div>
      <p class="pick-note">This request goes to admin for approval. You'll get a Telegram notification when it's decided.</p>
    </div>
    <div class="modal-actions">
      <button class="b-can" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
      <button class="b-pri" onclick="submitShiftRequest(${shift.id}, this)">Send Request</button>
    </div>
  `);
  document.body.appendChild(modal);
}

async function submitShiftRequest(shiftId, btn) {
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    await apiCall('/shift-requests', {
      method: 'POST',
      body: JSON.stringify({ shiftId })
    });
    btn.closest('.modal-overlay').remove();
    showSuccess('Shift request sent! Admin will be notified.');
    loadShifts();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Send Request';
    showWarning('Error: ' + err.message);
  }
}

function confirmTradeFromPick(myShift, theirShift) {
  const myDef = SHIFT_DEFS[myShift.shift_type];
  const theirDef = SHIFT_DEFS[theirShift.shift_type];
  const theirStaff = allStaff.find(s => s.id === theirShift.assigned_to);
  const myDate = new Date(myShift.date + 'T12:00:00').toLocaleDateString('en-US',
    { weekday: 'short', month: 'short', day: 'numeric' });
  const theirDate = new Date(theirShift.date + 'T12:00:00').toLocaleDateString('en-US',
    { weekday: 'short', month: 'short', day: 'numeric' });

  const modal = buildSimpleModal(`
    <h3>🔄 Request Shift Trade</h3>
    <div class="trade-preview-wrap">
      <div class="trade-leg give">
        <div class="tl-label">You GIVE</div>
        <div class="tl-date">${myDate}</div>
        <div class="tl-type">${myDef.icon} ${myDef.label}</div>
        <div class="tl-time">${myDef.time}</div>
      </div>
      <div class="trade-arrow">⇌</div>
      <div class="trade-leg get">
        <div class="tl-label">You GET</div>
        <div class="tl-date">${theirDate}</div>
        <div class="tl-type">${theirDef.icon} ${theirDef.label}</div>
        <div class="tl-time">${theirDef.time}</div>
        <div class="tl-staff">from ${theirStaff?.full_name || 'Unknown'}</div>
      </div>
    </div>
    <div class="pick-note" style="margin-top:12px;">
      ${theirStaff?.full_name || 'That staff member'} must approve first, then admin gives final sign-off.
    </div>
    <div class="fg" style="margin-top:12px;">
      <label style="font-size:13px;font-weight:600;color:#495057;">Optional note to ${theirStaff?.full_name || 'them'}:</label>
      <input type="text" id="tradeNoteInput" class="inp" placeholder="e.g. Family event, can you swap?" style="margin-top:4px;">
    </div>
    <div class="modal-actions">
      <button class="b-can" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
      <button class="b-pri" onclick="submitTradeRequest(${myShift.id}, ${theirShift.id}, this)">Send Trade Request</button>
    </div>
  `);
  document.body.appendChild(modal);
}

async function submitTradeRequest(myShiftId, theirShiftId, btn) {
  const note = document.getElementById('tradeNoteInput')?.value || '';
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    await apiCall('/trade-requests', {
      method: 'POST',
      body: JSON.stringify({ myShiftId, theirShiftId, note })
    });
    btn.closest('.modal-overlay').remove();
    showSuccess('Trade request sent! The other staff member will be notified.');
    loadShifts();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Send Trade Request';
    showWarning('Error: ' + err.message);
  }
}

// ── PENDING TILE HIGHLIGHT ─────────────────────────────────

let pendingShiftIds = new Set(); // shift IDs with pending requests
let pendingTradeShiftIds = new Set(); // shift IDs involved in pending trades

async function loadPendingShiftIds() {
  try {
    const [srData, trData] = await Promise.all([
      apiCall('/shift-requests').catch(() => ({ requests: [] })),
      apiCall('/trade-requests').catch(() => ({ requests: [] }))
    ]);
    pendingShiftIds = new Set(
      srData.requests
        .filter(r => r.status === 'pending')
        .map(r => r.shift_id)
    );
    // Collect shift IDs involved in any non-finalized trade
    pendingTradeShiftIds = new Set();
    trData.requests
      .filter(r => r.status === 'pending')
      .forEach(r => {
        if (r.requester_shift_id) pendingTradeShiftIds.add(r.requester_shift_id);
        if (r.target_shift_id) pendingTradeShiftIds.add(r.target_shift_id);
      });
  } catch (e) {
    // Non-critical — tiles just won't show pending state
  }
}

// ── EMERGENCY ABSENCE / ISSUE ──────────────────────────────

function openEmergencyDialog() {
  document.getElementById('emergencyDialog').classList.add('show');
}

function closeEmergencyDialog() {
  document.getElementById('emergencyDialog').classList.remove('show');
}

function showAbsenceForm() {
  document.getElementById('emergencyTypeSelect').classList.remove('show');
  document.getElementById('absenceForm').classList.add('show');

  // Populate shift selector with user's upcoming shifts (within 48h)
  const shiftSel = document.getElementById('absenceShiftSelect');
  shiftSel.innerHTML = '<option value="">-- Select your shift --</option>';
  const now = new Date();
  const cutoff = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  allShifts
    .filter(s => s.assigned_to === currentUser.id && new Date(s.date + 'T12:00:00') <= cutoff && new Date(s.date + 'T12:00:00') >= new Date(now.toDateString()))
    .forEach(s => {
      const def = SHIFT_DEFS[s.shift_type];
      const label = new Date(s.date + 'T12:00:00').toLocaleDateString('en-US',
        { weekday: 'short', month: 'short', day: 'numeric' }) + ' — ' + def.label;
      shiftSel.innerHTML += `<option value="${s.id}">${label}</option>`;
    });
}

function showIssueForm() {
  document.getElementById('emergencyTypeSelect').classList.remove('show');
  document.getElementById('issueForm').classList.add('show');
}

function backToEmergencyTypeSelect() {
  document.getElementById('absenceForm').classList.remove('show');
  document.getElementById('issueForm').classList.remove('show');
  document.getElementById('emergencyTypeSelect').classList.add('show');
}

async function submitAbsence() {
  const shiftId = document.getElementById('absenceShiftSelect').value;
  const reason = document.getElementById('absenceReason').value.trim();
  const reportedWhileOnDuty = document.getElementById('absenceOnDutyCheck').checked;

  if (!shiftId) { showWarning('Please select which shift you cannot make.'); return; }
  if (!reason) { showWarning('Please describe the reason.'); return; }

  const btn = document.getElementById('submitAbsenceBtn');
  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    await apiCall('/absences/enhanced', {
      method: 'POST',
      body: JSON.stringify({ shiftId, reason, reportedWhileOnDuty })
    });
    closeEmergencyDialog();
    document.getElementById('absenceForm').classList.remove('show');
    document.getElementById('emergencyTypeSelect').classList.add('show');
    document.getElementById('absenceReason').value = '';
    document.getElementById('absenceOnDutyCheck').checked = false;
    showSuccess('Absence reported. House Manager and Admin have been notified.');
  } catch (err) {
    showWarning('Error: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Submit Report';
  }
}

async function submitIssue() {
  const details = document.getElementById('issueDetails').value.trim();
  const notifyAdmin = document.getElementById('issueNotifyAdmin').checked;

  if (!details) { showWarning('Please describe the issue.'); return; }

  const btn = document.getElementById('submitIssueBtn');
  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    await apiCall('/report-issue', {
      method: 'POST',
      body: JSON.stringify({ details, notifyAdmin })
    });
    closeEmergencyDialog();
    document.getElementById('issueForm').classList.remove('show');
    document.getElementById('emergencyTypeSelect').classList.add('show');
    document.getElementById('issueDetails').value = '';
    document.getElementById('issueNotifyAdmin').checked = false;
    showSuccess('Issue reported. House Manager has been notified.');
  } catch (err) {
    showWarning('Error: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Submit Issue';
  }
}

// ── CONTACT ───────────────────────────────────────────────

async function openContactDialog() {
  // Pre-load next shift info and house manager before showing
  const dlg = document.getElementById('contactDialog');
  dlg.classList.add('show');
  await buildContactOptions();
}

function closeContactDialog() {
  document.getElementById('contactDialog').classList.remove('show');
}

async function buildContactOptions() {
  const container = document.getElementById('contactOptions');
  container.innerHTML = '<div style="text-align:center;padding:20px;color:#888;">Loading…</div>';

  try {
    // Get next shift after right now
    const now = new Date();
    const todayStr = formatDate(now);
    const allStaffData = allStaff.filter(s => s.role === 'staff' && s.username !== '_open');

    // Find next shift on the calendar (shift starting after now)
    const shiftOrder = { morning: 1, afternoon: 2, overnight: 3 };
    const currentHour = now.getHours();
    // Current shift: morning ends ~15:00, afternoon ends ~19:00, overnight ends ~07:00
    const currentShiftType = currentHour < 7 ? 'overnight' :
                             currentHour < 15 ? 'morning' :
                             currentHour < 19 ? 'afternoon' : 'overnight';
    const typeOrder = { morning: 1, afternoon: 2, overnight: 3 };

    // Find the next shift after current on calendar
    let nextShift = null;
    const sortedShifts = [...allShifts]
      .filter(s => s.assigned_to && !s.is_open)
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return typeOrder[a.shift_type] - typeOrder[b.shift_type];
      });

    for (const s of sortedShifts) {
      if (s.date > todayStr) { nextShift = s; break; }
      if (s.date === todayStr && typeOrder[s.shift_type] > typeOrder[currentShiftType]) {
        nextShift = s; break;
      }
    }

    const nextStaff = nextShift ? allStaff.find(s => s.id === nextShift.assigned_to) : null;
    const houseManager = allStaff.find(s => s.job_title === 'House Manager');

    let html = '';

    // Next shift contact
    if (nextShift && nextStaff) {
      const def = SHIFT_DEFS[nextShift.shift_type];
      const dateLabel = new Date(nextShift.date + 'T12:00:00').toLocaleDateString('en-US',
        { weekday: 'short', month: 'short', day: 'numeric' });
      html += `
        <div class="contact-card">
          <div class="contact-label">📅 Next Shift Staff</div>
          <div class="contact-name">${nextStaff.full_name}</div>
          <div class="contact-meta">${def.icon} ${def.label} · ${dateLabel}</div>
          <div class="contact-actions">
            ${nextStaff.phone ? `<a class="contact-btn phone-btn" href="tel:${nextStaff.phone}">📞 Call ${nextStaff.phone}</a>` : '<span class="contact-no-info">No phone on file</span>'}
            ${nextStaff.telegram_id ? `<button class="contact-btn tg-btn" onclick="sendTelegramContact(${nextStaff.id}, '${(nextStaff.full_name||'').replace(/'/g,"\\'")}')">✈️ Telegram Message</button>` : '<span class="contact-no-info">Not on Telegram</span>'}
          </div>
        </div>`;
    } else {
      html += `<div class="contact-card"><div class="contact-meta" style="color:#aaa;">No upcoming shifts found on calendar</div></div>`;
    }

    // House Manager contact
    if (houseManager) {
      html += `
        <div class="contact-card">
          <div class="contact-label">🏠 House Manager</div>
          <div class="contact-name">${houseManager.full_name}</div>
          <div class="contact-actions">
            ${houseManager.phone ? `<a class="contact-btn phone-btn" href="tel:${houseManager.phone}">📞 Call ${houseManager.phone}</a>` : '<span class="contact-no-info">No phone on file</span>'}
            ${houseManager.telegram_id ? `<button class="contact-btn tg-btn" onclick="sendTelegramContact(${houseManager.id}, '${(houseManager.full_name||'').replace(/'/g,"\\'")}')">✈️ Telegram Message</button>` : '<span class="contact-no-info">Not on Telegram</span>'}
          </div>
        </div>`;
    }

    // Staff directory
    html += `
      <div class="contact-card">
        <div class="contact-label">📋 Staff Directory</div>
        <div class="contact-dir-list">
          ${allStaffData.map(s => `
            <div class="contact-dir-item">
              <div class="contact-dir-dot" style="background:${s.tile_color||'#eee'}"></div>
              <div class="contact-dir-info">
                <div class="contact-dir-name">${s.full_name}</div>
                <div class="contact-dir-role">${s.job_title}</div>
              </div>
              <div class="contact-dir-btns">
                ${s.phone ? `<a class="contact-btn-sm phone-btn" href="tel:${s.phone}">📞</a>` : ''}
                ${s.telegram_id ? `<button class="contact-btn-sm tg-btn" onclick="sendTelegramContact(${s.id}, '${(s.full_name||'').replace(/'/g,"\\'")}')">✈️</button>` : ''}
                ${!s.phone && !s.telegram_id ? '<span style="font-size:11px;color:#aaa;">No contact</span>' : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="contact-meta" style="color:#dc3545;">Error loading contacts: ${err.message}</div>`;
  }
}

async function sendTelegramContact(staffId, staffName) {
  const msgInput = prompt(`Message to send to ${staffName} via Telegram:`);
  if (!msgInput || !msgInput.trim()) return;
  try {
    await apiCall('/contact-telegram', {
      method: 'POST',
      body: JSON.stringify({ targetStaffId: staffId, message: msgInput.trim() })
    });
    showSuccess(`Message sent to ${staffName} via Telegram!`);
  } catch (err) {
    showWarning('Failed to send: ' + err.message);
  }
}

// ── SETTINGS ──────────────────────────────────────────────

function openSettingsDialog() {
  document.getElementById('settingsDialog').classList.add('show');
  // Pre-fill current user info
  document.getElementById('settingsFullName').value = currentUser.fullName || '';
  document.getElementById('settingsPhone').value = currentUser.phone || '';
  document.getElementById('settingsTelegramId').value = currentUser.telegramId || '';
  document.getElementById('settingsNewPassword').value = '';
  document.getElementById('settingsConfirmPassword').value = '';
}

function closeSettingsDialog() {
  document.getElementById('settingsDialog').classList.remove('show');
}

async function saveSettings() {
  const fullName = document.getElementById('settingsFullName').value.trim();
  const phone = document.getElementById('settingsPhone').value.trim();
  const telegramId = document.getElementById('settingsTelegramId').value.trim();
  const newPw = document.getElementById('settingsNewPassword').value;
  const confirmPw = document.getElementById('settingsConfirmPassword').value;

  if (newPw && newPw.length < 6) {
    showWarning('New password must be at least 6 characters.'); return;
  }
  if (newPw && newPw !== confirmPw) {
    showWarning('Passwords do not match.'); return;
  }

  const btn = document.getElementById('saveSettingsBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await apiCall(`/staff/${currentUser.id}`, {
      method: 'PUT',
      body: JSON.stringify({ fullName, phone, email: currentUser.email })
    });

    if (newPw) {
      await apiCall('/change-password', {
        method: 'POST',
        body: JSON.stringify({ newPassword: newPw })
      });
    }

    // Refresh current user
    const me = await apiCall('/me');
    currentUser = me.user;
    document.getElementById('userName').textContent = currentUser.fullName;

    closeSettingsDialog();
    showSuccess('Settings saved!');
  } catch (err) {
    showWarning('Error: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Save Changes';
  }
}

// ── HELPER: build a modal dynamically ─────────────────────
function buildSimpleModal(innerHtml) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  const content = document.createElement('div');
  content.className = 'modal-content';
  content.innerHTML = innerHtml;
  overlay.appendChild(content);
  return overlay;
}

