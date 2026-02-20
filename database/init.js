const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'scheduler.db');

// Check if database already exists and has data
if (fs.existsSync(dbPath)) {
  console.log('📦 Database file exists, checking if initialized...');
  const db = new Database(dbPath);
  
  try {
    const adminExists = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('admin');
    if (adminExists && adminExists.count > 0) {
      console.log('✅ Database already initialized with admin user');
      console.log('   Skipping initialization to preserve existing data');
      db.close();
      process.exit(0);
    }
  } catch (err) {
    console.log('⚠️  Database exists but appears empty or corrupted, reinitializing...');
    db.close();
    fs.unlinkSync(dbPath);
  }
}

const db = new Database(dbPath);
console.log('📦 Creating new database...');

// Read and execute schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);
console.log('✅ Schema created');

// Helper function to hash passwords
const hashPassword = (password) => bcrypt.hashSync(password, 10);

// Insert admin user
db.prepare(`
  INSERT INTO users (username, password, full_name, role, job_title, tile_color, text_color, must_change_password, is_approved)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  'admin',
  hashPassword('password123'),
  'Admin User',
  'admin',
  'Administrator',
  '#dce8ff',
  'black',
  0,
  1
);
console.log('✅ Admin user created (username: admin, password: password123)');

// Insert Open Shift placeholder
db.prepare(`
  INSERT INTO users (username, password, full_name, role, job_title, tile_color, text_color, must_change_password, is_approved, is_active)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  '_open',
  hashPassword(Math.random().toString()),
  'Open Shift',
  'system',
  'Open Shift',
  '#f5f5f5',
  'black',
  0,
  1,
  0
);

// Insert sample staff members
const staff = [
  { username: 'sarah', name: 'Sarah Johnson', job: 'Caregiver', color: '#ffd6d6', textColor: 'black' },
  { username: 'mike', name: 'Mike Chen', job: 'Nurse', color: '#d0eaff', textColor: 'black' },
  { username: 'emma', name: 'Emma Wilson', job: 'Caregiver', color: '#d4f1d4', textColor: 'black' },
  { username: 'john', name: 'John Davis', job: 'Caregiver', color: '#ffe4c4', textColor: 'black' },
  { username: 'lisa', name: 'Lisa Brown', job: 'Nurse', color: '#e8d5ff', textColor: 'black' },
  { username: 'tom', name: 'Tom Martinez', job: 'Caregiver', color: '#ffd6f0', textColor: 'black' },
  { username: 'grace', name: 'Grace Okafor', job: 'House Manager', color: '#000000', textColor: 'white' }
];

staff.forEach(s => {
  db.prepare(`
    INSERT INTO users (username, password, full_name, job_title, tile_color, text_color)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    s.username,
    hashPassword('temp123'),
    s.name,
    s.job,
    s.color,
    s.textColor
  );
});
console.log(`✅ ${staff.length} staff members created (password: temp123)`);

// Get admin ID for created_by field
const adminId = db.prepare('SELECT id FROM users WHERE username = ?').get('admin').id;

// Create shifts for 4 weeks (2 weeks before, current week, 1 week after)
const baseDate = new Date('2026-02-15'); // Sunday Feb 15, 2026
baseDate.setHours(0, 0, 0, 0);

// Shift assignments pattern (rotates through staff)
const shiftPattern = [
  { day: 0, shifts: ['mike', 'emma', 'sarah'] },      // Sunday
  { day: 1, shifts: ['sarah', 'mike', 'lisa'] },      // Monday
  { day: 2, shifts: ['emma', 'john', 'tom'] },        // Tuesday
  { day: 3, shifts: ['lisa', 'tom', 'sarah'] },       // Wednesday
  { day: 4, shifts: ['sarah', 'mike', 'emma'] },      // Thursday
  { day: 5, shifts: ['emma', 'john', 'lisa'] },       // Friday
  { day: 6, shifts: ['tom', 'john', 'mike'] }         // Saturday
];

const shiftTypes = ['morning', 'afternoon', 'overnight'];

// Create shifts for 4 weeks
for (let week = -2; week <= 1; week++) {
  shiftPattern.forEach(dayPattern => {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + (week * 7) + dayPattern.day);
    const dateStr = date.toISOString().split('T')[0];

    shiftTypes.forEach((shiftType, idx) => {
      const username = dayPattern.shifts[idx];
      const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      
      if (user) {
        // Some shifts are open (10% chance)
        const isOpen = Math.random() < 0.1;
        
        db.prepare(`
          INSERT INTO shifts (date, shift_type, assigned_to, is_open, created_by)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          dateStr,
          shiftType,
          isOpen ? null : user.id,
          isOpen ? 1 : 0,
          adminId
        );
      }
    });
  });
}

const shiftCount = db.prepare('SELECT COUNT(*) as count FROM shifts').get().count;
console.log(`✅ ${shiftCount} shifts created (4 weeks of data)`);

// Create a few sample shift requests
const openShifts = db.prepare('SELECT id FROM shifts WHERE is_open = 1 LIMIT 3').all();
const sarahId = db.prepare('SELECT id FROM users WHERE username = ?').get('sarah').id;
const emmaId = db.prepare('SELECT id FROM users WHERE username = ?').get('emma').id;

if (openShifts.length > 0) {
  db.prepare(`
    INSERT INTO shift_requests (shift_id, requester_id, status)
    VALUES (?, ?, ?)
  `).run(openShifts[0].id, sarahId, 'pending');
  
  if (openShifts.length > 1) {
    db.prepare(`
      INSERT INTO shift_requests (shift_id, requester_id, status)
      VALUES (?, ?, ?)
    `).run(openShifts[1].id, emmaId, 'pending');
  }
  console.log('✅ Sample shift requests created');
}

console.log('\n🎉 Database initialization complete!\n');
console.log('📝 Summary:');
console.log('   - Admin: admin / password123');
console.log('   - Staff: sarah, mike, emma, john, lisa, tom, grace / temp123');
console.log('   - Open Shift placeholder created');
console.log(`   - ${shiftCount} shifts (4 weeks)`);
console.log('   - Some open shifts and sample requests');
console.log('\n🚀 Ready to start! Run: npm start\n');

db.close();
