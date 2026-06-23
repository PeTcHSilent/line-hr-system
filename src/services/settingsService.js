const db = require('../db');

/** ดึงทุก key */
async function getAll() {
  const result = await db.query(
    'SELECT key, value, description FROM company_settings ORDER BY key'
  );
  return result.rows;
}

/** ดึง value ของ key เดียว */
async function get(key) {
  const result = await db.query(
    'SELECT value FROM company_settings WHERE key = $1', [key]
  );
  return result.rows[0]?.value ?? null;
}

/** บันทึก/อัปเดต key */
async function set(key, value) {
  await db.query(
    `INSERT INTO company_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, String(value)]
  );
}

/** ดึง work schedule เป็น object */
async function getWorkSchedule() {
  const rows = await getAll();
  const map = {};
  rows.forEach(r => { map[r.key] = r.value; });
  return {
    work_days:   (map.work_days   || '1,2,3,4,5,6').split(',').map(Number),
    work_start:  map.work_start   || '09:00',
    work_end:    map.work_end     || '18:00',
    lunch_start: map.lunch_start  || '12:00',
    lunch_end:   map.lunch_end    || '13:00',
    company_name: map.company_name || 'บริษัท',
  };
}

/**
 * ตรวจสอบว่า date เป็น 'holiday' หรือ 'weekday'
 *  1. ถ้าอยู่ใน holidays table → holiday (×3)
 *  2. ถ้าไม่ใช่วันทำงาน (work_days setting) → holiday (×3)
 *  3. อื่นๆ → weekday (×1.5)
 */
async function getOTType(dateStr) {
  // 1. ตรวจ holidays table
  const holResult = await db.query(
    'SELECT id FROM holidays WHERE date = $1', [dateStr]
  );
  if (holResult.rows.length > 0) return 'holiday';

  // 2. ตรวจ work_days setting
  const schedule = await getWorkSchedule();
  const [y, m, d] = dateStr.split('-').map(Number);
  const dayOfWeek = new Date(y, m - 1, d).getDay(); // 0=อาทิตย์, 6=เสาร์
  if (!schedule.work_days.includes(dayOfWeek)) return 'holiday';

  return 'weekday';
}

module.exports = { getAll, get, set, getWorkSchedule, getOTType };
