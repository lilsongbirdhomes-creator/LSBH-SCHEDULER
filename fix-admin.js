const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function fixAdmin() {
  try {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    
    await pool.query(
      'UPDATE users SET password = $1 WHERE username = $2',
      [hashedPassword, 'admin']
    );
    
    console.log('✅ Admin password reset to: admin123');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

fixAdmin();
