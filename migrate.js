const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    console.log('📋 Starting database migration...');
    const schema = fs.readFileSync('./schema-postgres.sql', 'utf8');
    console.log('🔄 Creating tables...');
    await pool.query(schema);
    console.log('✅ Migration complete!');
    
    const result = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' ORDER BY table_name;
    `);
    
    console.log('\n📊 Tables created:');
    result.rows.forEach(row => console.log('  ✓', row.table_name));
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    await pool.end();
    process.exit(1);
  }
}

migrate();
