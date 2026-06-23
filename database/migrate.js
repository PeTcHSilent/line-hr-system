require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('✅ Migration สำเร็จ');
  } catch (err) {
    console.error('❌ Migration ล้มเหลว:', err.message);
  } finally {
    await pool.end();
  }
}

migrate();
