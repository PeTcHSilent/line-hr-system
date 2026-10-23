const { Pool, types } = require('pg');

// ══════════════════════════════════════════════════════════════
//  ❗ DATE (oid 1082) ต้องคืนเป็นสตริง 'YYYY-MM-DD' ไม่ใช่ Date object
//
//  ค่าเริ่มต้นของ pg แปลง DATE เป็น JS Date ที่เที่ยงคืน "เวลาท้องถิ่นของเซิร์ฟเวอร์"
//  Railway รันเป็น UTC → วันที่ 2026-10-19 จะกลายเป็น 2026-10-18T17:00:00Z
//  พอโค้ดไหนทำ .toISOString().slice(0,10) จะได้ 2026-10-18 — เพี้ยนไป 1 วัน
//
//  เคสที่เจอจริง: วันเริ่มทดลองงาน วันลา วันเบิกเงิน แสดงย้อนหลังไป 1 วัน
//  โดยไม่มี error ให้เห็นเลย ซึ่งหาสาเหตุยากมากเพราะในไทยบางเครื่องแสดงถูก
//
//  คืนเป็นสตริงดิบไปเลย = ไม่มีเขตเวลาเข้ามาเกี่ยวข้อง ไม่มีทางเพี้ยน
//  (ระบบ Sales ใช้วิธีเดียวกันนี้อยู่แล้ว)
// ══════════════════════════════════════════════════════════════
types.setTypeParser(1082, v => v);

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
