const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // เดิมไม่ได้ตั้งค่า → ใช้ default ของ pg ที่ max=10
  // ตั้งชัดเจนเผื่อช่วงปิด payroll / export Excel ที่ query หนักพร้อมกันหลายคน
  max: parseInt(process.env.DB_POOL_MAX) || 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
