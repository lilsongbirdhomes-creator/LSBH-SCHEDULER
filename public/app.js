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

function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('userName').textContent = currentUser.fullName;
  document.getElementById('roleBadge').textContent = currentUser.role === 'admin' ? 'Admin' : 'Staff';
  
  if (currentUser.role === 'admin') {
    document.getElementById('adminPanel').classList.remove('hidden');
    loadStaff();
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
  } catch (err) {
    console.error('Load staff error:', err);
  }
}

function renderStaffList() {
  const list = document.getElementById('staffList');
  list.innerHTML = '';
  
  allStaff.forEach(staff => {
    const isOpen = staff.username === '_open';
    const isActive = staff.is_active === 1 || staff.is_active === undefined;
    const item = document.createElement('div');
    item.className = 's-item' + (!isActive ? ' inactive' : '');
    item.innerHTML = `
      <div class="col-dot" style="background:${staff.tile_color};color:${staff.text_color};${!isActive ? 'opacity:0.5;' : ''}">
        ${staff.text_color === 'white' ? 'W' : 'A'}
      </div>
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
  const role = document.getElementById('newRole').value;
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
    
    loadStaff();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

function openEditStaff(staffId) {
  const staff = allStaff.find(s => s.id === staffId);
  if (!staff) return;
  
  document.getElementById('editStaffId').value = staffId;
  document.getElementById('editFullName').value = staff.full_name;
  document.getElementById('editJobTitle').value = staff.job_title;
  document.getElementById('editTileColor').value = staff.tile_color;
  document.getElementById('editTextColor').value = staff.text_color;
  document.getElementById('editTelegramId').value = staff.telegram_id || '';
  
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
    loadStaff();
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
    loadStaff();
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
    loadStaff();
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
    const result = await apiCall(`/shifts?startDate=${formatDate(startDate)}&endDate=${formatDate(endDate)}`);
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

function renderMonthView() {
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
  
  if (shift.is_open) {
    tile.style.background = '#f5f5f5';
    tile.style.color = 'black';
    tile.style.cursor = 'pointer';
    
    // Admin can assign, staff can request
    if (currentUser.role === 'admin') {
      tile.onclick = () => showAssignOpenShiftModal(shift);
    } else {
      tile.onclick = () => confirmRequestShift(shift.id);
    }
    
    if (viewType === 'month') {
      tile.innerHTML = `
        <div class="month-shift-name">Open Shift</div>
        <div class="month-shift-time">${def.icon} ${def.time}</div>
        <div class="month-shift-hours" style="font-size:9px;opacity:0.7;">Click to ${currentUser.role === 'admin' ? 'assign' : 'request'}</div>
      `;
    } else {
      tile.innerHTML = `
        <div>
          <div class="t-name">Open Shift</div>
          <div class="t-time">${def.time}</div>
        </div>
        <div class="t-foot" style="font-size:10px;opacity:0.7;">
          Click to ${currentUser.role === 'admin' ? 'assign' : 'request'}
        </div>
      `;
    }
  } else {
    const staff = allStaff.find(s => s.id === shift.assigned_to);
    const bg = staff?.tile_color || '#f5f5f5';
    const tc = staff?.text_color || 'black';
    const hours = shift.running_hours || 0;
    const hClass = hours >= 40 ? 'hrs-over' : hours >= 36 ? 'hrs-warn' : 'hrs-ok';
    
    tile.style.background = bg;
    tile.style.color = tc;
    
    // Admin can reassign
    if (currentUser.role === 'admin') {
      tile.style.cursor = 'pointer';
      tile.onclick = () => showReassignModal(shift);
    }
    
    if (viewType === 'month') {
      tile.innerHTML = `
        <div class="month-shift-name">${shift.full_name || staff?.full_name || 'Unknown'}</div>
        <div class="month-shift-time">${def.icon} ${def.time}</div>
        <div class="month-shift-hours ${hClass}">${hours.toFixed(1)}/40</div>
      `;
    } else {
      tile.innerHTML = `
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
      <option value="">-- Select Staff --</option>
      ${allStaff.filter(s => s.role === 'staff' && s.username !== '_open').map(s => 
        `<option value="${s.id}">${s.full_name}</option>`
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
    const staffId = parseInt(this.value);
    if (!staffId) return;
    
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
  const staffId = parseInt(select.value);
  
  if (!staffId) {
    alert('Please select a staff member');
    return;
  }
  
  try {
    showLoading();
    await apiCall(`/shifts/${shiftId}`, {
      method: 'PUT',
      body: JSON.stringify({
        assignedTo: staffId,
        isOpen: false
      })
    });
    
    document.querySelector('.modal-overlay').remove();
    await loadStaff();
    await loadShifts();
    showSuccess('Shift assigned successfully!');
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
  
  // Remember current view mode before reload
  const savedViewMode = viewMode;
  
  try {
    showLoading();
    
    if (newAssignee === 'OPEN') {
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
          assignedTo: parseInt(newAssignee),
          isOpen: false
        })
      });
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
  
  if (pendingShift.length === 0 && pendingTrade.length === 0 && pendingTimeOff.length === 0) {
    list.innerHTML = '<p style="text-align:center;color:#888;padding:20px;">No pending approvals</p>';
    return;
  }
  
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
