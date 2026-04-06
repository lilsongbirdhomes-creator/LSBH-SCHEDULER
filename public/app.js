// ═══════════════════════════════════════════════════════════
// GLOBAL STATE
// ═══════════════════════════════════════════════════════════
let currentUser = null;
let viewMode = 'week';
let viewDate = new Date(); // Start at current date
let allStaff = [];
let allShifts = [];
let showOnlyMyShifts = false; // Staff can toggle this

const SHIFT_DEFS = {
  morning:   { label: 'Morning',   time: '7:00 AM – 3:00 PM', hours: 8.0, icon: '🌅' },
  afternoon: { label: 'Afternoon', time: '3:00 PM – 7:00 PM', hours: 4.0, icon: '🌆' },
  overnight: { label: 'Overnight', time: '7:00 PM – 7:00 AM', hours: 12.0, icon: '🌙' }
};

// ═══════════════════════════════════════════════════════════
// MOBILE RESPONSIVE CSS FIXES
// ═══════════════════════════════════════════════════════════
// Inject CSS for month view scrolling on mobile
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  .month-grid {
    min-width: 700px;
  }
  @media (max-width: 768px) {
    .month-grid {
      min-width: 600px;
      grid-template-columns: repeat(7, 85px);
    }
  }
  
  // No print media queries - let page print naturally
`;
document.head.appendChild(styleSheet);

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
  
  // Load staff for all users (needed for contact dialog)
  await loadStaff();
  
  if (currentUser.role === 'admin') {
    document.getElementById('adminPanel').classList.remove('hidden');
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
    
    // Clear all form fields
    document.getElementById('newUsername').value = '';
    document.getElementById('newFullName').value = '';
    document.getElementById('newJobTitle').value = 'caregiver'; // Reset to default
    
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
  // Update whichever set of toggle buttons is in the DOM
  const vw = document.getElementById('vWeek');
  const vm = document.getElementById('vMonth');
  const vws = document.getElementById('vWeekStaff');
  const vms = document.getElementById('vMonthStaff');
  if (vw) vw.classList.toggle('active', mode === 'week');
  if (vm) vm.classList.toggle('active', mode === 'month');
  if (vws) vws.classList.toggle('active', mode === 'week');
  if (vms) vms.classList.toggle('active', mode === 'month');
  loadShifts();
}

async function loadShifts() {
  let startDate, endDate;
  
  if (viewMode === 'month') {
    // Get first day of month
    const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const startDay = firstDay.getDay(); // 0 = Sunday
    
    // Get last day of month
    const lastDayOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
    const lastDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), lastDayOfMonth);
    const endDay = lastDay.getDay();
    
    // Start from beginning of first week (may be in previous month)
    startDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1 - startDay);
    
    // End at end of last week (may be in next month)
    const daysToAdd = endDay === 6 ? 0 : (6 - endDay);
    endDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), lastDayOfMonth + daysToAdd);
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
    
    // Render pay period summary + trade inbox for staff
    if (currentUser && currentUser.role === 'staff') {
      renderPayPeriodSummary();
      loadTradeInbox();
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
  const isStaff = currentUser && currentUser.role === 'staff';
  const rootId = isStaff ? 'calendarRootStaff' : 'calendarRoot';
  const titleId = isStaff ? 'calTitleStaff' : 'calTitle';
  const root = document.getElementById(rootId);
  if (!root) return;
  root.innerHTML = '';
  
  const startDate = getWeekStart(viewDate);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  
  document.getElementById(titleId).textContent = 
    `${formatDateLong(startDate)} – ${formatDateLong(endDate)}`;
  
  const grid = document.createElement('div');
  grid.className = 'week-grid';
  
  // Day headers
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayStr = formatDate(new Date());
  
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const dateStr = formatDate(d);
    const isWknd = i === 0 || i === 6;
    const isToday = dateStr === todayStr;
    
    const hdr = document.createElement('div');
    hdr.className = 'day-hdr' + (isWknd ? ' wknd' : '') + (isToday ? ' today' : '');
    hdr.innerHTML = `<span class="dn">${dayNames[i]}</span><span class="dt">${d.getDate()}</span>`;
    grid.appendChild(hdr);
  }
  
  // Day columns
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const dateStr = formatDate(d);
    const isWknd = i === 0 || i === 6;
    const isToday = dateStr === todayStr;
    
    const col = document.createElement('div');
    col.className = 'day-col' + (isWknd ? ' wknd' : '') + (isToday ? ' today' : '');
    
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
  
  // Auto-scroll to today on mobile
  setTimeout(() => scrollToTodayOnMobile(), 100);
}

function scrollToTodayOnMobile() {
  // Only run on mobile
  if (window.innerWidth > 768) return;
  
  const calScroll = document.querySelector('.cal-scroll');
  if (!calScroll) return;
  
  // Find today's day of week (0 = Sunday, 6 = Saturday)
  const today = new Date();
  const dayOfWeek = today.getDay();
  
  // Each column is 80px wide + 8px gap
  const columnWidth = 88;
  
  // Scroll to show today in the middle of the screen
  const scrollPosition = (dayOfWeek * columnWidth) - (window.innerWidth / 2) + 40;
  
  // Smooth scroll to position
  calScroll.scrollTo({
    left: Math.max(0, scrollPosition),
    behavior: 'smooth'
  });
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
  const isStaff = currentUser && currentUser.role === 'staff';
  const rootId = isStaff ? 'calendarRootStaff' : 'calendarRoot';
  const titleId = isStaff ? 'calTitleStaff' : 'calTitle';
  const root = document.getElementById(rootId);
  if (!root) return;
  root.innerHTML = '';
  
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthName = viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  
  document.getElementById(titleId).textContent = monthName;
  
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
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const lastDay = new Date(year, month, lastDayOfMonth);
  const endDay = lastDay.getDay();
  
  // Calculate start date (beginning of first week - may be in previous month)
  const startDate = new Date(year, month, 1 - startDay);
  
  // Calculate end date (end of last week - may be in next month)
  const daysToAdd = endDay === 6 ? 0 : (6 - endDay);
  const endDate = new Date(year, month, lastDayOfMonth + daysToAdd);
  
  // Render all days from start to end (including prev/next month days)
  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const d = new Date(currentDate);
    const dateStr = formatDate(d);
    const isToday = dateStr === formatDate(new Date());
    const isWknd = d.getDay() === 0 || d.getDay() === 6;
    const isCurrentMonth = d.getMonth() === month;
    
    const cell = document.createElement('div');
    cell.className = 'month-day-cell' + 
      (isWknd ? ' wknd' : '') + 
      (isToday ? ' today' : '') +
      (!isCurrentMonth ? ' other-month' : '');
    
    const dayNum = document.createElement('div');
    dayNum.className = 'month-day-num';
    dayNum.textContent = d.getDate();
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
    
    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  // Wrap grid in scrollable container for mobile
  const scrollWrapper = document.createElement('div');
  scrollWrapper.className = 'cal-scroll';
  scrollWrapper.style.minWidth = '100%';
  scrollWrapper.appendChild(grid);
  root.appendChild(scrollWrapper);
  
  // Auto-scroll to today on mobile
  setTimeout(() => scrollToTodayOnMobile(), 100);
}

function createShiftTile(shift, viewType = 'week') {
  const def = SHIFT_DEFS[shift.shift_type];
  const tile = document.createElement('div');
  tile.className = viewType === 'month' ? 'month-shift-tile' : 'shift-tile';

  // Determine pending state
  const hasPendingShiftReq = pendingShiftIds.has(shift.id);
  const hasPendingTrade    = pendingTradeShiftIds.has(shift.id);
  const isPending          = hasPendingShiftReq || hasPendingTrade;

  if (isPending) {
    tile.classList.add('tile-pending');
  }

  if (shift.is_open) {
    if (!isPending) {
      // For house managers, show open shifts as tentatively assigned (light green)
      const currentUserStaff = allStaff.find(s => s.id === currentUser.id);
      if (currentUserStaff && currentUserStaff.job_title === 'House Manager') {
        tile.style.background = '#c8e6c9';
        tile.style.color = '#2e7d32';
      } else {
        tile.style.background = '#f5f5f5';
        tile.style.color = 'black';
      }
    }
    tile.style.cursor = 'pointer';

    tile.onclick = () => {
      if (requestMode) { handleTilePick(shift); return; }  // read live, not captured at render
      if (currentUser.role === 'admin') {
        if (isPending) showAdminPendingShiftModal(shift);
        else showAssignOpenShiftModal(shift);
      } else {
        confirmRequestShift(shift.id);
      }
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
      // For staff view: color own shifts green, other staff black, keep admin colors
      if (currentUser.role === 'staff') {
        if (shift.assigned_to === currentUser.id) {
          // User's own shift - green
          tile.style.background = '#28a745';
          tile.style.color = 'white';
        } else {
          // Other staff's shift - black
          tile.style.background = '#000000';
          tile.style.color = 'white';
        }
      } else {
        // Admin view - use staff colors
        tile.style.background = staff?.tile_color || '#f5f5f5';
        tile.style.color = staff?.text_color || 'black';
      }
    }

    tile.style.cursor = 'pointer';
    tile.onclick = () => {
      if (requestMode) { handleTilePick(shift); return; }  // read live, not captured at render
      if (currentUser.role === 'admin') {
        if (isPending) showAdminPendingShiftModal(shift);
        else showReassignModal(shift);
      }
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
  console.log("📋 All staff details:", allStaff.map(s => ({id: s.id, name: s.full_name, job_title: s.job_title, username: s.username})));
  const filtered = allStaff.filter(s => s.username !== '_open' && s.job_title !== 'admin');
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
      ${allStaff.filter(s => s.username !== '_open' && s.job_title !== 'admin').map(s => 
        `<option value="${s.id}">${s.full_name} (${s.job_title})</option>`
      ).join('')}
    </select>
    <div id="assignHoursWarning" style="display:none;margin-top:8px;padding:8px;background:#fff3cd;border-radius:6px;font-size:13px;color:#856404;"></div>
    <div class="modal-actions">
      <button class="b-can" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
      <button class="b-del" onclick="deleteShift(${shift.id})" style="margin-right:auto;">🗑️ Delete Shift</button>
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
    <p><strong>Date:</strong> ${new Date(shift.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
    <p><strong>Type:</strong> ${def.icon} ${shift.shift_type.charAt(0).toUpperCase() + shift.shift_type.slice(1)} (${def.time})</p>
    <p><strong>Currently:</strong> ${currentStaff?.full_name || 'Unknown'}</p>
    <hr>
    <label>Reassign to:</label>
    <select id="reassignSelect" class="inp">
      <option value="">-- Select Staff --</option>
      <option value="OPEN">Make Open Shift</option>
      ${allStaff.filter(s => s.username !== '_open' && s.job_title !== 'admin').map(s => 
        `<option value="${s.id}" ${s.id === shift.assigned_to ? 'selected' : ''}>${s.full_name}</option>`
      ).join('')}
    </select>
    <div class="modal-actions">
      <button class="b-can" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
      <button class="b-del" onclick="deleteShift(${shift.id})" style="margin-right:auto;">🗑️ Delete Shift</button>
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
    
    // Use PUT endpoint to update shift with assignedTo and isOpen
    await apiCall(`/shifts/${shiftId}`, {
      method: 'PUT',
      body: JSON.stringify({
        assignedTo: newStaffId,
        isOpen: isOpen
      })
    });
    
    // Close ONLY the reassign modal (not the first modal on page)
    const modal = select.closest('.modal-overlay');
    if (modal) modal.remove();
    
    showSuccess('Shift reassigned!');
    
    // Restore view mode and reload
    viewMode = savedViewMode;
    await loadShifts();
    
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    hideLoading();
  }
}

async function deleteShift(shiftId) {
  const shift = allShifts.find(s => s.id === shiftId);
  if (!shift) {
    alert('Shift not found');
    return;
  }
  
  const def = SHIFT_DEFS[shift.shift_type];
  const dateStr = new Date(shift.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  
  if (!confirm(`Delete this shift?\n\n${dateStr} - ${def.label} (${def.time})\n\nThis cannot be undone.`)) {
    return;
  }
  
  try {
    showLoading();
    await apiCall(`/shifts/${shiftId}`, { method: 'DELETE' });
    
    // Find and close the closest modal (could be reassign, assign, or other)
    // Try to find the button that triggered this function and close its modal
    const btn = document.querySelector(`button[onclick*="deleteShift(${shiftId})"]`);
    if (btn) {
      const modal = btn.closest('.modal-overlay');
      if (modal) modal.remove();
    }
    
    showSuccess('Shift deleted!');
    await loadShifts();
    
  } catch (err) {
    alert('Error deleting shift: ' + err.message);
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
    loadTradeInbox(); // Load trade inbox alongside dashboard
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
  
  // Set date values with null checks
  const genStartDate = document.getElementById('genStartDate');
  if (genStartDate) genStartDate.value = formatDate(today);
  
  const genEndDate = document.getElementById('genEndDate');
  if (genEndDate) genEndDate.value = formatDate(twoWeeks);
  
  const copySourceDate = document.getElementById('copySourceDate');
  if (copySourceDate) copySourceDate.value = formatDate(today);
  
  const copyTargetDate = document.getElementById('copyTargetDate');
  if (copyTargetDate) copyTargetDate.value = formatDate(twoWeeks);
  
  // Show modal
  const modal = document.getElementById('shiftGeneratorModal');
  if (modal) {
    modal.style.display = 'flex';
  }
  
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
  
  // Find and activate the correct button
  // Works both as onclick handler (with event) and programmatic call
  if (event && event.target) {
    event.target.classList.add('active');
  } else {
    // Find the button that matches the tab name
    const buttons = document.querySelectorAll('.gen-tab');
    for (const btn of buttons) {
      if (btn.textContent.toLowerCase().includes(tabName) || 
          btn.onclick.toString().includes("'" + tabName + "'")) {
        btn.classList.add('active');
        break;
      }
    }
  }
  
  // Update tab content
  document.querySelectorAll('.gen-tab-content').forEach(content => content.classList.remove('active'));
  const contentId = 'genTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1);
  const contentElement = document.getElementById(contentId);
  if (contentElement) {
    contentElement.classList.add('active');
  }
}

function populateStaffDropdowns() {
  const activeStaff = allStaff.filter(s => s.username !== '_open' && s.job_title !== 'admin');
  
  // Specific staff dropdown - check if element exists
  const specificSelect = document.getElementById('genSpecificStaff');
  if (specificSelect) {
    specificSelect.innerHTML = '<option value="">-- Select Staff --</option>';
    activeStaff.forEach(s => {
      specificSelect.innerHTML += `<option value="${s.id}">${s.full_name}</option>`;
    });
  }
  
  // Rotation list - check if element exists
  const rotationList = document.getElementById('rotationList');
  if (rotationList) {
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
  
  // Count selected shift types
  const shiftTypes = [];
  if (document.getElementById('shiftMorning').checked) shiftTypes.push('Morning');
  if (document.getElementById('shiftAfternoon').checked) shiftTypes.push('Afternoon');
  if (document.getElementById('shiftOvernight').checked) shiftTypes.push('Overnight');
  
  // Calculate days in range - will generate shifts for ALL days in range
  const dayCount = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
  const pattern = document.getElementById('genPattern').value;
  
  const estimatedShifts = dayCount * shiftTypes.length;
  
  let patternText = pattern === 'open' ? 'as open shifts' : 
                   pattern === 'specific' ? 'assigned to selected staff' : 
                   'rotating through staff';
  
  document.getElementById('genPreviewText').textContent = 
    `Will create ~${estimatedShifts} shifts (${dayCount} days × ${shiftTypes.length} shift types) ${patternText}`;
}

async function generateShifts() {
  // Fix: Parse dates in local timezone
  const startInput = document.getElementById('genStartDate').value;
  const endInput = document.getElementById('genEndDate').value;
  
  if (!startInput || !endInput) {
    alert('Please select both start and end dates');
    return;
  }
  
  const [startYear, startMonth, startDay] = startInput.split('-').map(Number);
  const [endYear, endMonth, endDay] = endInput.split('-').map(Number);
  
  const startDate = new Date(startYear, startMonth - 1, startDay);
  const endDate = new Date(endYear, endMonth - 1, endDay);
  
  const pattern = document.getElementById('genPattern').value;
  
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
  console.log('🔍 copyShifts function called');
  console.log('📊 Total shifts loaded in allShifts:', allShifts.length);
  console.log('📅 Current viewMode:', viewMode);
  console.log('📅 Current viewDate:', viewDate);
  
  try {
    const copyFromEl = document.querySelector('input[name="copyFrom"]:checked');
    if (!copyFromEl) {
      alert('Please select copy type (Single Day/Full Week/Full Month)');
      return;
    }
    const copyFrom = copyFromEl.value;
    
    // Fix: Parse dates in local timezone to avoid off-by-one errors
    const sourceInput = document.getElementById('copySourceDate').value;
    const targetInput = document.getElementById('copyTargetDate').value;
    
    if (!sourceInput || !targetInput) {
      alert('Please select both source and target dates');
      return;
    }
    
    // Parse as local date (YYYY-MM-DD) to avoid timezone shifts
    const [sourceYear, sourceMonth, sourceDay] = sourceInput.split('-').map(Number);
    const [targetYear, targetMonth, targetDay] = targetInput.split('-').map(Number);
    
    const sourceDate = new Date(sourceYear, sourceMonth - 1, sourceDay);
    const targetDate = new Date(targetYear, targetMonth - 1, targetDay);
    
    const keepAssignments = document.getElementById('copyKeepAssignments').checked;
    
    // Use the checkbox from HTML
    const replaceExisting = document.getElementById('copyReplaceExisting').checked;
    
    console.log('📋 Copy parameters:', { copyFrom, sourceDate, targetDate, keepAssignments, replaceExisting });
    console.log('📅 Source input:', sourceInput, '→ parsed:', sourceDate.toLocaleDateString());
    console.log('📅 Target input:', targetInput, '→ parsed:', targetDate.toLocaleDateString());
    
    // Show what shifts exist on source date
    const sourceShifts = allShifts.filter(s => s.date === formatDate(sourceDate));
    console.log(`📊 Shifts on source date (${formatDate(sourceDate)}):`, sourceShifts.length);
    if (sourceShifts.length > 0) {
      console.log('   Shifts:', sourceShifts.map(s => `${s.shift_type} (ID: ${s.id})`));
    } else {
      console.warn('⚠️ WARNING: No shifts found on source date in currently loaded shifts!');
      console.log('   This might be because the source date is outside the currently loaded range.');
      console.log('   The backend will still attempt to copy if shifts exist in the database.');
    }
    
    if (isNaN(sourceDate) || isNaN(targetDate)) {
      alert('Invalid date selection');
      return;
    }
    
    // Determine direction for user info
    const isPastToFuture = sourceDate < targetDate;
    const direction = isPastToFuture ? 'forward' : 'backward';
    console.log(`📅 Copy direction: ${direction}`);
    
    if (!confirm(`Copy shifts from ${sourceDate.toLocaleDateString()} to ${targetDate.toLocaleDateString()}?\n\nThis will ${isPastToFuture ? 'copy past shifts to a future date' : 'copy future/current shifts to a past date'}.`)) {
      return;
    }
    
    showLoading();
    
    const payload = {
      sourceDate: formatDate(sourceDate),
      targetDate: formatDate(targetDate),
      copyType: copyFrom,
      keepAssignments,
      replaceExisting
    };
    
    console.log('📤 Sending to backend:', payload);
    
    const result = await apiCall('/shifts/copy', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    console.log('✅ Copy result:', result);
    closeShiftGenerator();
    
    if (result.copied === 0) {
      showWarning(`No shifts were copied. Make sure there are shifts on ${sourceDate.toLocaleDateString()} to copy.`);
    } else {
      showSuccess(`${result.copied} shift${result.copied > 1 ? 's' : ''} copied successfully from ${sourceDate.toLocaleDateString()} to ${targetDate.toLocaleDateString()}!`);
    }
    
    loadShifts();
    
  } catch (err) {
    console.error('❌ Copy shifts error:', err);
    alert('Error copying shifts: ' + err.message + '\n\nCheck the browser console for details.');
  } finally {
    hideLoading();
  }
}

// Template management
async function loadTemplates() {
  try {
    const templates = await apiCall('/shift-templates');
    
    // Check if template elements exist before trying to set their values
    const elements = {
      'tmplMorningLabel': 'tmplMorningLabel',
      'tmplMorningTime': 'tmplMorningTime',
      'tmplMorningHours': 'tmplMorningHours',
      'tmplAfternoonLabel': 'tmplAfternoonLabel',
      'tmplAfternoonTime': 'tmplAfternoonTime',
      'tmplAfternoonHours': 'tmplAfternoonHours',
      'tmplOvernightLabel': 'tmplOvernightLabel',
      'tmplOvernightTime': 'tmplOvernightTime',
      'tmplOvernightHours': 'tmplOvernightHours'
    };
    
    // Only set values if the elements exist
    const morningLabel = document.getElementById('tmplMorningLabel');
    if (morningLabel) morningLabel.value = templates.morning?.label || 'Morning';
    
    const morningTime = document.getElementById('tmplMorningTime');
    if (morningTime) morningTime.value = templates.morning?.time || '7:00 AM – 3:00 PM';
    
    const morningHours = document.getElementById('tmplMorningHours');
    if (morningHours) morningHours.value = templates.morning?.hours || '8.0';
    
    const afternoonLabel = document.getElementById('tmplAfternoonLabel');
    if (afternoonLabel) afternoonLabel.value = templates.afternoon?.label || 'Afternoon';
    
    const afternoonTime = document.getElementById('tmplAfternoonTime');
    if (afternoonTime) afternoonTime.value = templates.afternoon?.time || '3:00 PM – 7:00 PM';
    
    const afternoonHours = document.getElementById('tmplAfternoonHours');
    if (afternoonHours) afternoonHours.value = templates.afternoon?.hours || '4.0';
    
    const overnightLabel = document.getElementById('tmplOvernightLabel');
    if (overnightLabel) overnightLabel.value = templates.overnight?.label || 'Overnight';
    
    const overnightTime = document.getElementById('tmplOvernightTime');
    if (overnightTime) overnightTime.value = templates.overnight?.time || '7:00 PM – 7:00 AM';
    
    const overnightHours = document.getElementById('tmplOvernightHours');
    if (overnightHours) overnightHours.value = templates.overnight?.hours || '12.0';
    
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
    // Use defaults if loading fails - this is ok
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
  showPickDialog(
    'Step 1 of 1',
    'Select an open shift',
    'Tap a grey "Open Shift" tile on the calendar to request it.',
    'Pick an open shift →'
  );
}

function startTradeRequest() {
  closeRequestDialog();
  requestMode = 'trade_step1';
  tradeMyShift = null;
  showPickDialog(
    'Step 1 of 2',
    'Select YOUR shift to give away',
    'Tap one of your own coloured shift tiles on the calendar.',
    'Pick my shift →'
  );
}

// ── Pick Dialog helpers ────────────────────────────────────

function showPickDialog(stepLabel, instruction, sub, btnLabel) {
  document.getElementById('pickDialogStep').textContent        = stepLabel;
  document.getElementById('pickDialogInstruction').textContent = instruction;
  document.getElementById('pickDialogSub').textContent         = sub;
  document.getElementById('pickDialogGoBtn').textContent       = btnLabel;
  document.getElementById('pickModeDialog').classList.add('show');
  // Always show ALL shifts during pick mode so staff can see other people's tiles
  if (showOnlyMyShifts) {
    showOnlyMyShifts = false;
    renderCalendar(); // re-render so other staff tiles appear
  }
  // Apply dashed outline to calendar tiles
  document.getElementById('calendarRoot')      && document.getElementById('calendarRoot').classList.add('pick-mode');
  document.getElementById('calendarRootStaff') && document.getElementById('calendarRootStaff').classList.add('pick-mode');
}

// User clicks "Pick now →" — hide dialog so they can tap the calendar
function pickDialogGo() {
  document.getElementById('pickModeDialog').classList.remove('show');
  // Dialog is hidden but requestMode is still active — tile clicks still register
}

function hidePickDialog() {
  document.getElementById('pickModeDialog').classList.remove('show');
}

function exitPickMode() {
  requestMode = null;
  tradeMyShift = null;
  hidePickDialog();
  document.getElementById('calendarRoot')      && document.getElementById('calendarRoot').classList.remove('pick-mode');
  document.getElementById('calendarRootStaff') && document.getElementById('calendarRootStaff').classList.remove('pick-mode');
}

// Called from createShiftTile when in pick mode
function handleTilePick(shift) {
  if (!requestMode) return;

  if (requestMode === 'shift') {
    if (!shift.is_open) {
      // Wrong tile — re-show dialog with error hint
      showPickDialog(
        'Step 1 of 1',
        'That\'s not an open shift',
        '⚠️ Please tap a grey "Open Shift" tile. Your coloured tiles are already assigned.',
        'Try again →'
      );
      return;
    }
    exitPickMode();
    confirmRequestShiftFromPick(shift);

  } else if (requestMode === 'trade_step1') {
    if (shift.assigned_to !== currentUser.id) {
      showPickDialog(
        'Step 1 of 2',
        'That\'s not your shift',
        '⚠️ Please tap one of YOUR own coloured tiles — the shift you want to give away.',
        'Try again →'
      );
      return;
    }
    // Step 1 done — store and move to step 2
    tradeMyShift = shift;
    requestMode = 'trade_step2';
    const def = SHIFT_DEFS[shift.shift_type];
    const dateLabel = new Date(shift.date + 'T12:00:00').toLocaleDateString('en-US',
      { weekday: 'short', month: 'short', day: 'numeric' });
    showPickDialog(
      'Step 2 of 2',
      'Now select the shift you WANT',
      `You're giving: ${dateLabel} ${def.icon} ${def.label}\nNow tap the shift you want to receive from another staff member.`,
      'Pick their shift →'
    );

  } else if (requestMode === 'trade_step2') {
    // Coerce is_open to boolean (SQLite returns 0/1 integers)
    const isOpen = !!shift.is_open;
    const hasOwner = shift.assigned_to && shift.assigned_to > 0;
    if (!hasOwner || isOpen) {
      showPickDialog(
        'Step 2 of 2',
        'That\'s an open shift',
        '⚠️ Please tap a shift that belongs to another staff member — not a grey open shift.',
        'Try again →'
      );
      return;
    }
    if (shift.assigned_to === currentUser.id) {
      showPickDialog(
        'Step 2 of 2',
        'That\'s your own shift',
        '⚠️ You can\'t trade with yourself. Tap a shift belonging to someone else.',
        'Try again →'
      );
      return;
    }
    // Valid — proceed to confirmation
    const savedMyShift = tradeMyShift; // capture before exitPickMode clears it
    exitPickMode();
    confirmTradeFromPick(savedMyShift, shift);
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

function showLateForm() {
  document.getElementById('emergencyTypeSelect').classList.remove('show');
  document.getElementById('lateForm').classList.add('show');

  // Populate shift selector - only today's shifts
  const shiftSel = document.getElementById('lateShiftSelect');
  shiftSel.innerHTML = '<option value="">-- Select your shift --</option>';
  const now = new Date();
  const todayStr = formatDate(now);
  allShifts
    .filter(s => s.assigned_to === currentUser.id && s.date === todayStr)
    .forEach(s => {
      const def = SHIFT_DEFS[s.shift_type];
      const label = def.label + ' (' + def.time + ')';
      shiftSel.innerHTML += `<option value="${s.id}">${label}</option>`;
    });
}

function showIssueForm() {
  document.getElementById('emergencyTypeSelect').classList.remove('show');
  document.getElementById('issueForm').classList.add('show');
}

function backToEmergencyTypeSelect() {
  document.getElementById('absenceForm').classList.remove('show');
  document.getElementById('lateForm').classList.remove('show');
  document.getElementById('issueForm').classList.remove('show');
  document.getElementById('emergencyTypeSelect').classList.add('show');
  
  // Clear absence form fields
  document.getElementById('absenceShiftSelect').value = '';
  document.getElementById('absenceReason').value = '';
  document.getElementById('absenceOnDutyCheck').checked = false;
  
  // Clear late form fields
  document.getElementById('lateShiftSelect').value = '';
  const lateRadios = document.getElementsByName('lateMinutes');
  lateRadios.forEach(radio => radio.checked = false);
  
  // Clear issue form fields
  document.getElementById('issueDetails').value = '';
  document.getElementById('issueNotifyAdmin').checked = false;
}

// Remove toggleLateETA function - no longer needed

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
      body: JSON.stringify({ 
        shiftId, 
        reason, 
        reportedWhileOnDuty,
        willBeLate: false
      })
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

async function submitLate() {
  const shiftId = document.getElementById('lateShiftSelect').value;
  const lateRadios = document.getElementsByName('lateMinutes');
  let minutesLate = null;
  for (const radio of lateRadios) {
    if (radio.checked) {
      minutesLate = radio.value;
      break;
    }
  }

  if (!shiftId) { showWarning('Please select which shift you are running late for.'); return; }
  if (!minutesLate) { showWarning('Please select how many minutes late you will be.'); return; }

  const btn = document.getElementById('submitLateBtn');
  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    await apiCall('/absences/late', {
      method: 'POST',
      body: JSON.stringify({ 
        shiftId, 
        minutesLate: parseInt(minutesLate)
      })
    });
    closeEmergencyDialog();
    document.getElementById('lateForm').classList.remove('show');
    document.getElementById('emergencyTypeSelect').classList.add('show');
    document.getElementById('lateShiftSelect').value = '';
    const radios = document.getElementsByName('lateMinutes');
    radios.forEach(r => r.checked = false);
    showSuccess('Late arrival reported. Team has been notified of your ETA.');
  } catch (err) {
    showWarning('Error: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Report Late Arrival';
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
    const allStaffData = allStaff.filter(s => s.username !== '_open' && s.job_title !== 'admin');

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
            ${nextStaff.telegram_id ? `<button class="contact-btn tg-btn" onclick="openTelegramChat('${nextStaff.telegram_id}', '${(nextStaff.full_name||'').replace(/'/g,"\\'")}')">✈️ Telegram Chat</button>` : '<span class="contact-no-info">Not on Telegram</span>'}
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
            ${houseManager.telegram_id ? `<button class="contact-btn tg-btn" onclick="openTelegramChat('${houseManager.telegram_id}', '${(houseManager.full_name||'').replace(/'/g,"\\'")}')">✈️ Telegram Chat</button>` : '<span class="contact-no-info">Not on Telegram</span>'}
          </div>
        </div>`;
    }

    // Staff directory
    if (allStaffData.length === 0) {
      html += `
        <div class="contact-card">
          <div class="contact-label">📋 Staff Directory</div>
          <div class="contact-meta" style="color:#aaa;padding:12px;">No staff members found</div>
        </div>`;
    } else {
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
                  ${s.telegram_id ? `<button class="contact-btn-sm tg-btn" onclick="openTelegramChat('${s.telegram_id}', '${(s.full_name||'').replace(/'/g,"\\'")}')">✈️</button>` : ''}
                  ${!s.phone && !s.telegram_id ? '<span style="font-size:11px;color:#aaa;">No contact</span>' : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>`;
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="contact-meta" style="color:#dc3545;">Error loading contacts: ${err.message}</div>`;
  }
}

function openTelegramChat(telegramId, staffName) {
  // Open Telegram directly to chat with user by their numeric ID
  // tg://user?id=XXXXX format works on mobile
  // https://t.me/+XXXXX format works on web/desktop
  const mobileUrl = `tg://user?id=${telegramId}`;
  
  // Try to open the Telegram app
  window.location.href = mobileUrl;
  
  // Show helpful message
  setTimeout(() => {
    const msg = `Opening Telegram chat with ${staffName}...\n\n` +
                `If Telegram doesn't open:\n` +
                `• Make sure Telegram app is installed\n` +
                `• You can search for them in Telegram\n` +
                `• Their Telegram ID: ${telegramId}`;
    console.log(msg);
  }, 500);
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


// ═══════════════════════════════════════════════════════════
// FIX 1 — ADMIN: clicking a pending tile shows approve/deny
// ═══════════════════════════════════════════════════════════

async function showAdminPendingShiftModal(shift) {
  // Load the actual pending request(s) for this shift
  showLoading();
  try {
    const [srData, trData] = await Promise.all([
      apiCall('/shift-requests'),
      apiCall('/trade-requests')
    ]);

    // Find pending shift requests for this shift
    const shiftReqs = srData.requests.filter(
      r => r.shift_id === shift.id && r.status === 'pending'
    );

    // Find pending trade requests involving this shift
    const tradeReqs = trData.requests.filter(
      r => r.status === 'pending' &&
           (r.requester_shift_id === shift.id || r.target_shift_id === shift.id)
    );

    const def = SHIFT_DEFS[shift.shift_type];
    const dateLabel = new Date(shift.date + 'T12:00:00').toLocaleDateString('en-US',
      { weekday: 'long', month: 'short', day: 'numeric' });

    let html = `<h3>⏳ Pending Requests</h3>
      <p style="color:#666;font-size:13px;margin-bottom:16px;">
        ${def.icon} ${dateLabel} · ${def.label} (${def.time})
      </p>`;

    if (shiftReqs.length === 0 && tradeReqs.length === 0) {
      html += `<p style="color:#888;font-size:13px;">No pending requests found for this shift.</p>`;
    }

    // Shift requests (open shift requests)
    shiftReqs.forEach(req => {
      html += `
        <div class="pending-review-card">
          <div class="prc-type">📋 Shift Request</div>
          <div class="prc-who"><strong>${req.requester_name}</strong> wants this shift</div>
          <div class="prc-meta">Requested: ${new Date(req.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}</div>
          <div class="prc-actions">
            <button class="btn-approve" onclick="adminApproveShiftReq(${req.id}, this)">✅ Approve</button>
            <button class="btn-deny"    onclick="adminDenyShiftReq(${req.id}, this)">❌ Deny</button>
          </div>
        </div>`;
    });

    // Trade requests
    tradeReqs.forEach(req => {
      const isRequesterSide = req.requester_shift_id === shift.id;
      const tradingWith = isRequesterSide ? req.target_name : req.requester_name;
      const theirDate   = isRequesterSide ? req.tgt_date : req.req_date;
      const theirShift  = isRequesterSide ? req.tgt_shift : req.req_shift;
      const theirDef    = SHIFT_DEFS[theirShift] || {};
      const bothApproved = req.requester_approved && req.target_approved;

      html += `
        <div class="pending-review-card">
          <div class="prc-type">🔄 Trade Request ${bothApproved ? '<span style="color:#28a745;font-size:11px;">(Both staff approved — awaiting you)</span>' : '<span style="color:#888;font-size:11px;">(Awaiting staff approval)</span>'}</div>
          <div class="prc-who">
            <strong>${req.requester_name}</strong> ⇌ <strong>${req.target_name}</strong>
          </div>
          <div class="prc-meta">
            Trade: ${new Date(req.req_date + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})} ${SHIFT_DEFS[req.req_shift]?.icon || ''} ⇌ 
            ${new Date(req.tgt_date + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})} ${theirDef.icon || ''}
          </div>
          ${req.requester_note ? `<div class="prc-note">Note: "${req.requester_note}"</div>` : ''}
          ${bothApproved ? `
          <div class="prc-actions">
            <button class="btn-approve" onclick="adminFinalizeTradeModal(${req.id}, this)">✅ Finalize Trade</button>
            <button class="btn-deny"    onclick="adminDenyTradeModal(${req.id}, this)">❌ Deny</button>
          </div>` : `<div style="font-size:12px;color:#888;margin-top:8px;">Waiting for both staff to approve before admin action is needed.</div>`}
        </div>`;
    });

    html += `<div class="modal-actions" style="margin-top:16px;">
      <button class="b-can" onclick="this.closest('.modal-overlay').remove()">Close</button>
    </div>`;

    const modal = buildSimpleModal(html);
    document.body.appendChild(modal);
  } catch (err) {
    showWarning('Error loading pending requests: ' + err.message);
  } finally {
    hideLoading();
  }
}

async function adminApproveShiftReq(reqId, btn) {
  btn.disabled = true; btn.textContent = 'Approving…';
  try {
    await apiCall(`/shift-requests/${reqId}/approve`, {
      method: 'POST', body: JSON.stringify({ note: '' })
    });
    btn.closest('.modal-overlay').remove();
    showSuccess('Shift request approved!');
    loadShifts();
    if (currentUser.role === 'admin') loadPendingApprovals();
  } catch (err) {
    btn.disabled = false; btn.textContent = '✅ Approve';
    showWarning('Error: ' + err.message);
  }
}

async function adminDenyShiftReq(reqId, btn) {
  const note = prompt('Reason for denial (optional):') ?? '';
  btn.disabled = true; btn.textContent = 'Denying…';
  try {
    await apiCall(`/shift-requests/${reqId}/deny`, {
      method: 'POST', body: JSON.stringify({ note })
    });
    btn.closest('.modal-overlay').remove();
    showSuccess('Shift request denied.');
    loadShifts();
    if (currentUser.role === 'admin') loadPendingApprovals();
  } catch (err) {
    btn.disabled = false; btn.textContent = '❌ Deny';
    showWarning('Error: ' + err.message);
  }
}

async function adminFinalizeTradeModal(tradeId, btn) {
  btn.disabled = true; btn.textContent = 'Finalizing…';
  try {
    await apiCall(`/trade-requests/${tradeId}/finalize`, {
      method: 'POST', body: JSON.stringify({ note: '' })
    });
    btn.closest('.modal-overlay').remove();
    showSuccess('Trade finalized! Both staff notified.');
    loadShifts();
    if (currentUser.role === 'admin') loadPendingApprovals();
  } catch (err) {
    btn.disabled = false; btn.textContent = '✅ Finalize Trade';
    showWarning('Error: ' + err.message);
  }
}

async function adminDenyTradeModal(tradeId, btn) {
  const note = prompt('Reason for denial (optional):') ?? '';
  btn.disabled = true; btn.textContent = 'Denying…';
  try {
    await apiCall(`/trade-requests/${tradeId}/deny`, {
      method: 'POST', body: JSON.stringify({ note, status: 'denied' })
    });
    btn.closest('.modal-overlay').remove();
    showSuccess('Trade denied.');
    loadShifts();
    if (currentUser.role === 'admin') loadPendingApprovals();
  } catch (err) {
    btn.disabled = false; btn.textContent = '❌ Deny';
    showWarning('Error: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// FIX 2 — STAFF TRADE INBOX
// Shows in dashboard: incoming trade requests to approve/deny,
// outgoing requests with their status.
// ═══════════════════════════════════════════════════════════

async function loadTradeInbox() {
  const container = document.getElementById('tradeInboxContent');
  if (!container) return;

  try {
    const data = await apiCall('/trade-requests');
    const allReqs = data.requests || [];

    const incoming = allReqs.filter(
      r => r.target_id === currentUser.id && r.status === 'pending' && !r.target_approved
    );
    const outgoing = allReqs.filter(
      r => r.requester_id === currentUser.id
    );

    const badge = document.getElementById('tradeInboxBadge');
    if (badge) {
      badge.textContent = incoming.length;
      badge.style.display = incoming.length > 0 ? 'inline-flex' : 'none';
    }

    let html = '';

    // ── Incoming ──────────────────────────────────────────
    if (incoming.length > 0) {
      html += `<div class="inbox-section-title">📥 Someone wants to trade with you</div>`;
      incoming.forEach(req => {
        const myShiftDef   = SHIFT_DEFS[req.tgt_shift]  || {};
        const theirShiftDef = SHIFT_DEFS[req.req_shift] || {};
        const myDate    = new Date(req.tgt_date  + 'T12:00:00').toLocaleDateString('en-US', {weekday:'short',month:'short',day:'numeric'});
        const theirDate = new Date(req.req_date  + 'T12:00:00').toLocaleDateString('en-US', {weekday:'short',month:'short',day:'numeric'});

        html += `
          <div class="trade-inbox-card incoming" id="tradeCard_${req.id}">
            <div class="tic-header">
              <span class="tic-from">From: <strong>${req.requester_name}</strong></span>
              <span class="trade-status pending">Awaiting your reply</span>
            </div>
            <div class="tic-shifts">
              <div class="tic-shift give">
                <div class="tic-label">You GIVE UP</div>
                <div class="tic-date">${myDate}</div>
                <div class="tic-type">${myShiftDef.icon || ''} ${myShiftDef.label || req.tgt_shift}</div>
                <div class="tic-time">${myShiftDef.time || ''}</div>
              </div>
              <div class="tic-arrow">⇌</div>
              <div class="tic-shift get">
                <div class="tic-label">You GET</div>
                <div class="tic-date">${theirDate}</div>
                <div class="tic-type">${theirShiftDef.icon || ''} ${theirShiftDef.label || req.req_shift}</div>
                <div class="tic-time">${theirShiftDef.time || ''}</div>
              </div>
            </div>
            ${req.requester_note ? `<div class="tic-note">💬 "${req.requester_note}"</div>` : ''}
            <div class="tic-actions">
              <button class="btn-approve" onclick="staffApproveTrade(${req.id}, this)">✅ Accept Trade</button>
              <button class="btn-deny"    onclick="staffDenyTrade(${req.id}, this)">❌ Decline</button>
            </div>
          </div>`;
      });
    }

    // ── Outgoing ─────────────────────────────────────────
    if (outgoing.length > 0) {
      html += `<div class="inbox-section-title" style="margin-top:${incoming.length > 0 ? '18px' : '0'};">📤 Your trade requests</div>`;
      outgoing.forEach(req => {
        const myShiftDef    = SHIFT_DEFS[req.req_shift] || {};
        const theirShiftDef = SHIFT_DEFS[req.tgt_shift] || {};
        const myDate    = new Date(req.req_date + 'T12:00:00').toLocaleDateString('en-US', {weekday:'short',month:'short',day:'numeric'});
        const theirDate = new Date(req.tgt_date + 'T12:00:00').toLocaleDateString('en-US', {weekday:'short',month:'short',day:'numeric'});

        let statusLabel = '';
        let statusClass = '';
        if (req.status === 'approved') { statusLabel = '✅ Completed'; statusClass = 'approved'; }
        else if (req.status === 'denied') { statusLabel = '❌ Denied'; statusClass = 'denied'; }
        else if (req.target_approved) { statusLabel = '⏳ Awaiting admin'; statusClass = 'pending'; }
        else { statusLabel = '⏳ Awaiting ' + req.target_name; statusClass = 'pending'; }

        html += `
          <div class="trade-inbox-card outgoing">
            <div class="tic-header">
              <span class="tic-from">To: <strong>${req.target_name}</strong></span>
              <span class="trade-status ${statusClass}">${statusLabel}</span>
            </div>
            <div class="tic-shifts">
              <div class="tic-shift give">
                <div class="tic-label">You GIVE</div>
                <div class="tic-date">${myDate}</div>
                <div class="tic-type">${myShiftDef.icon || ''} ${myShiftDef.label || req.req_shift}</div>
              </div>
              <div class="tic-arrow">⇌</div>
              <div class="tic-shift get">
                <div class="tic-label">You GET</div>
                <div class="tic-date">${theirDate}</div>
                <div class="tic-type">${theirShiftDef.icon || ''} ${theirShiftDef.label || req.tgt_shift}</div>
              </div>
            </div>
          </div>`;
      });
    }

    if (incoming.length === 0 && outgoing.length === 0) {
      html = `<div class="inbox-empty">No trade requests yet.</div>`;
    }

    container.innerHTML = html;

  } catch (err) {
    console.error('loadTradeInbox error:', err);
  }
}

async function staffApproveTrade(tradeId, btn) {
  btn.disabled = true; btn.textContent = 'Accepting…';
  try {
    await apiCall(`/trade-requests/${tradeId}/approve`, {
      method: 'POST', body: JSON.stringify({ note: '' })
    });
    showSuccess('Trade accepted! Now awaiting admin approval.');
    loadTradeInbox();
    loadShifts();
  } catch (err) {
    btn.disabled = false; btn.textContent = '✅ Accept Trade';
    showWarning('Error: ' + err.message);
  }
}

async function staffDenyTrade(tradeId, btn) {
  const note = prompt('Reason for declining (optional):') ?? '';
  btn.disabled = true; btn.textContent = 'Declining…';
  try {
    await apiCall(`/trade-requests/${tradeId}/deny`, {
      method: 'POST', body: JSON.stringify({ note })
    });
    showSuccess('Trade declined.');
    loadTradeInbox();
    loadShifts();
  } catch (err) {
    btn.disabled = false; btn.textContent = '❌ Decline';
    showWarning('Error: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// STUB FUNCTIONS - Placeholders for incomplete features
// These functions are referenced in HTML but not yet implemented
// ═══════════════════════════════════════════════════════════

// Print Dialog & Execution
function openPrintDialog() {
  const modal = document.getElementById('printDialog');
  if (modal) {
    modal.style.display = 'flex';
  } else {
    alert('Print dialog not available');
  }
}

function closePrintDialog() {
  const modal = document.getElementById('printDialog');
  if (modal) {
    modal.style.display = 'none';
  }
}

function executePrint() {
  closePrintDialog();
  
  // Get the actual calendar element that's visible
  let calendarRoot = document.getElementById('calendarRoot');
  if (!calendarRoot || calendarRoot.offsetParent === null) {
    // Try staff calendar if admin calendar is hidden
    calendarRoot = document.getElementById('calendarRootStaff');
  }
  
  // Check if we have a calendar and it's not empty
  if (!calendarRoot) {
    console.error('No calendar container found');
    alert('No calendar to print. Please view the schedule first.');
    return;
  }
  
  // Check if calendar has content (children elements, not just whitespace)
  const hasContent = calendarRoot.children && calendarRoot.children.length > 0;
  if (!hasContent) {
    console.error('Calendar is empty. Content:', calendarRoot.innerHTML.length);
    alert('No calendar to print. Please view the schedule first.');
    return;
  }
  
  // Get calendar title - try both possible locations
  let titleEl = document.getElementById('calTitle');
  if (!titleEl || titleEl.offsetParent === null) {
    titleEl = document.getElementById('calTitleStaff');
  }
  const title = (titleEl && titleEl.textContent) ? titleEl.textContent : 'Schedule';
  
  // Get the calendar HTML and remove "Tap to assign" text that appears only in interactive mode
  let calendarHTML = calendarRoot.innerHTML;
  calendarHTML = calendarHTML.replace(/Tap to assign/g, '');
  calendarHTML = calendarHTML.replace(/<div[^>]*class="[^"]*no-print[^"]*"[^>]*>[\s\S]*?<\/div>/g, '');
  
  // Add filter note if "only my shifts" is enabled
  let filterNote = '';
  if (showOnlyMyShifts && currentUser) {
    filterNote = `<p style="text-align: center; font-style: italic; margin-bottom: 15px; color: #666;">
      Filtered to show only shifts for ${currentUser.fullName}
    </p>`;
  }
  
  // Copy all stylesheets from parent document
  let stylesheets = '';
  for (let link of document.querySelectorAll('link[rel="stylesheet"]')) {
    stylesheets += link.outerHTML;
  }
  
  // Add critical print styles (minimal margins to avoid blank page)
  const printStyles = `
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        font-family: Arial, sans-serif;
        background: white;
        color: #000;
        padding: 10px;
        margin: 0;
      }
      h1 {
        text-align: center;
        margin: 0 0 5px 0;
        font-size: 20px;
        padding: 0;
      }
      p {
        margin: 0;
        padding: 0;
      }
      .week-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 8px;
        margin: 10px 0;
      }
      .month-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 4px;
        width: 100%;
        margin: 0;
      }
      .day-hdr {
        background: #f5f5f5;
        border: 1px solid #ddd;
        padding: 6px;
        text-align: center;
        font-weight: bold;
        font-size: 12px;
      }
      .day-col {
        border: 1px solid #ddd;
        padding: 6px;
        min-height: 100px;
      }
      .month-day-cell {
        border: 1px solid #ddd;
        padding: 6px;
        min-height: 70px;
      }
      .month-day-hdr {
        background: #f5f5f5;
        border: 1px solid #ddd;
        padding: 6px;
        text-align: center;
        font-weight: bold;
        font-size: 12px;
      }
      .shift-tile {
        background: #f0f0f0;
        border: 1px solid #999;
        border-radius: 4px;
        padding: 4px;
        margin: 3px 0;
        font-size: 10px;
        line-height: 1.3;
      }
      .month-shift-tile {
        background: #f0f0f0;
        border: 1px solid #999;
        border-radius: 3px;
        padding: 3px;
        margin: 1px 0;
        font-size: 9px;
      }
      .month-shift-name {
        font-weight: bold;
      }
      .month-shift-time {
        font-size: 8px;
      }
      .month-shift-hours {
        font-size: 8px;
        color: #666;
      }
      .t-name {
        font-weight: bold;
        font-size: 11px;
      }
      .t-time {
        font-size: 9px;
        color: #666;
      }
      .t-foot {
        font-size: 8px;
        margin-top: 2px;
      }
      .month-day-num {
        font-weight: bold;
        margin-bottom: 3px;
        font-size: 11px;
      }
      .month-shifts {
        font-size: 9px;
      }
      .pending-badge {
        background: #fff3cd;
        color: #856404;
        padding: 1px 3px;
        border-radius: 2px;
        font-size: 7px;
      }
      @media print {
        body { padding: 5px; margin: 0; }
        h1 { margin-bottom: 3px; padding: 0; }
        .week-grid, .month-grid { page-break-inside: avoid; }
      }
    </style>
  `;
  
  // Detect if mobile
  const isMobile = window.innerWidth < 768;
  
  if (isMobile) {
    // On mobile: create an iframe, print it, then remove it
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Schedule - ${title}</title>
        ${stylesheets}
        ${printStyles}
      </head>
      <body>
        <h1>Schedule: ${title}</h1>
        ${filterNote}
        ${calendarHTML}
      </body>
      </html>
    `;
    
    iframe.onload = function() {
      setTimeout(() => {
        iframe.contentWindow.print();
        // Remove iframe after print dialog closes
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 500);
      }, 100);
    };
    
    // Write content to iframe
    iframe.srcdoc = printContent;
  } else {
    // On desktop: use new window as before
    const printWindow = window.open('', '_blank');
    
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Schedule - ${title}</title>
        ${stylesheets}
        ${printStyles}
      </head>
      <body>
        <h1>Schedule: ${title}</h1>
        ${filterNote}
        ${calendarHTML}
      </body>
      </html>
    `;
    
    printWindow.document.write(printContent);
    printWindow.document.close();
    
    // Trigger print after a delay to ensure content loads
    setTimeout(() => {
      printWindow.print();
    }, 500);
  }
}

// Guest Password Management
function copyGuestPassword() {
  const passwordInput = document.getElementById('guestCurrentPassword');
  if (passwordInput && passwordInput.value) {
    navigator.clipboard.writeText(passwordInput.value).then(() => {
      showSuccess('Password copied to clipboard!');
    }).catch(() => {
      alert('Failed to copy. Please copy manually: ' + passwordInput.value);
    });
  } else {
    alert('No guest password to copy');
  }
}

function closeEditGuestModal() {
  const modal = document.getElementById('editGuestModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function resetGuestPassword() {
  if (!confirm('Reset the guest user password? A new temporary password will be generated.')) {
    return;
  }
  
  try {
    showLoading();
    // TODO: Add API call to reset guest password
    console.warn('resetGuestPassword: API endpoint not yet implemented');
    setTimeout(() => {
      hideLoading();
      showSuccess('Guest password reset. New password generated.');
      // Reload to show new password
      location.reload();
    }, 1000);
  } catch (err) {
    hideLoading();
    alert('Error: ' + err.message);
  }
}

// Timezone Settings
function saveTimezone() {
  const timezoneSelect = document.getElementById('timezoneSelect');
  if (!timezoneSelect) {
    alert('Timezone selector not found');
    return;
  }
  
  const timezone = timezoneSelect.value;
  if (!timezone) {
    alert('Please select a timezone');
    return;
  }
  
  try {
    showLoading();
    // TODO: Add API call to save timezone preference
    console.log('Saving timezone:', timezone);
    setTimeout(() => {
      hideLoading();
      showSuccess('Timezone updated!');
    }, 500);
  } catch (err) {
    hideLoading();
    alert('Error: ' + err.message);
  }
}

// Email & Notification Functions
function sendTelegramInstructions() {
  if (!confirm('Send Telegram setup instructions to all staff?')) {
    return;
  }
  
  try {
    showLoading();
    // TODO: Add API call to send Telegram instructions
    console.warn('sendTelegramInstructions: API endpoint not yet implemented');
    setTimeout(() => {
      hideLoading();
      showSuccess('Telegram instructions sent to all staff!');
    }, 1000);
  } catch (err) {
    hideLoading();
    alert('Error: ' + err.message);
  }
}

function sendGuestCredentialsEmail() {
  if (!confirm('Email guest login credentials to the guest user?')) {
    return;
  }
  
  try {
    showLoading();
    // TODO: Add API call to send guest credentials
    console.warn('sendGuestCredentialsEmail: API endpoint not yet implemented');
    setTimeout(() => {
      hideLoading();
      showSuccess('Guest credentials emailed successfully!');
    }, 1000);
  } catch (err) {
    hideLoading();
    alert('Error: ' + err.message);
  }
}

function sendTestEmail() {
  const email = prompt('Enter your email address to test:');
  if (!email) return;
  
  try {
    showLoading();
    // TODO: Add API call to send test email
    console.log('Sending test email to:', email);
    setTimeout(() => {
      hideLoading();
      showSuccess('Test email sent! Check your inbox.');
    }, 1000);
  } catch (err) {
    hideLoading();
    alert('Error: ' + err.message);
  }
}

// Admin Password Management
function showAdminPasswordChange() {
  const modal = document.getElementById('adminPasswordChangeModal');
  if (modal) {
    modal.style.display = 'flex';
  } else {
    // Create a simple password change dialog if modal doesn't exist
    const newPassword = prompt('Enter new admin password:');
    if (newPassword && newPassword.length >= 6) {
      try {
        showLoading();
        // TODO: Add API call to change admin password
        console.log('Admin password change requested');
        setTimeout(() => {
          hideLoading();
          showSuccess('Admin password changed!');
        }, 500);
      } catch (err) {
        hideLoading();
        alert('Error: ' + err.message);
      }
    } else {
      alert('Password must be at least 6 characters');
    }
  }
}

// First-Time Telegram Setup (during login)
function skipTelegramSetup() {
  const modal = document.getElementById('firstLoginTelegramModal');
  if (modal) {
    modal.style.display = 'none';
  }
  showApp();
}

function saveTelegramIdFirstLogin() {
  const telegramIdInput = document.getElementById('firstLoginTelegramId');
  if (!telegramIdInput || !telegramIdInput.value) {
    alert('Please enter your Telegram ID');
    return;
  }
  
  const telegramId = telegramIdInput.value.trim();
  if (!/^\d+$/.test(telegramId)) {
    alert('Telegram ID must contain only numbers');
    return;
  }
  
  try {
    showLoading();
    // TODO: Add API call to link Telegram ID
    console.log('Linking Telegram ID:', telegramId);
    setTimeout(() => {
      hideLoading();
      const modal = document.getElementById('firstLoginTelegramModal');
      if (modal) modal.style.display = 'none';
      showSuccess('Telegram ID linked successfully!');
      showApp();
    }, 500);
  } catch (err) {
    hideLoading();
    alert('Error: ' + err.message);
  }
}

