const db = require('../db');
const dayjs = require('dayjs');

/**
 * ดึงวันหยุดทั้งหมดของปีที่ระบุ
 * @param {number} year - ปี ค.ศ. เช่น 2026
 */
async function getHolidaysByYear(year) {
  const result = await db.query(
    `SELECT id, date, name, year, is_substitute,
            (year + 543) AS be_year
     FROM holidays
     WHERE year = $1
     ORDER BY date`,
    [year]
  );
  return result.rows;
}

/**
 * ดึง Set ของวันที่เป็นวันหยุด (format: 'YYYY-MM-DD') ในช่วงที่กำหนด
 * ใช้ใน leaveService เพื่อคำนวณวันทำงาน
 */
async function getHolidayDatesInRange(startDate, endDate) {
  const result = await db.query(
    `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date_str
     FROM holidays
     WHERE date BETWEEN $1 AND $2`,
    [startDate, endDate]
  );
  return new Set(result.rows.map(r => r.date_str));
}

/**
 * เพิ่มวันหยุดใหม่
 */
async function addHoliday({ date, name, year, isSubstitute = false }) {
  // validate format
  if (!dayjs(date).isValid()) throw new Error('รูปแบบวันที่ไม่ถูกต้อง');
  if (!name || !name.trim()) throw new Error('กรุณาระบุชื่อวันหยุด');
  if (!year) throw new Error('กรุณาระบุปี');

  const result = await db.query(
    `INSERT INTO holidays (date, name, year, is_substitute)
     VALUES ($1, $2, $3, $4)
     RETURNING *, (year + 543) AS be_year`,
    [date, name.trim(), year, isSubstitute]
  );
  return result.rows[0];
}

/**
 * อัปเดตข้อมูลวันหยุด
 */
async function updateHoliday(id, { date, name, isSubstitute }) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (date !== undefined) { fields.push(`date = $${idx++}`); values.push(date); }
  if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name.trim()); }
  if (isSubstitute !== undefined) { fields.push(`is_substitute = $${idx++}`); values.push(isSubstitute); }
  fields.push(`updated_at = NOW()`);
  values.push(id);

  if (fields.length === 1) throw new Error('ไม่มีข้อมูลที่ต้องการอัปเดต');

  const result = await db.query(
    `UPDATE holidays SET ${fields.join(', ')}
     WHERE id = $${idx}
     RETURNING *, (year + 543) AS be_year`,
    values
  );
  if (!result.rows[0]) throw new Error('ไม่พบวันหยุดที่ต้องการแก้ไข');
  return result.rows[0];
}

/**
 * ลบวันหยุด
 */
async function deleteHoliday(id) {
  const result = await db.query(
    `DELETE FROM holidays WHERE id = $1 RETURNING *`,
    [id]
  );
  if (!result.rows[0]) throw new Error('ไม่พบวันหยุดที่ต้องการลบ');
  return result.rows[0];
}

/**
 * ดึงรายชื่อปีที่มีข้อมูลวันหยุด
 */
async function getAvailableYears() {
  const result = await db.query(
    `SELECT DISTINCT year, (year + 543) AS be_year,
            COUNT(*) AS total_days
     FROM holidays
     GROUP BY year
     ORDER BY year DESC`
  );
  return result.rows;
}

/**
 * คัดลอกวันหยุดจากปีหนึ่งไปยังอีกปี (เพื่อเป็นฐานแก้ไข)
 * วันหยุดที่อิงปฏิทินจันทรคติ ควรแก้ไขวันที่เองหลังคัดลอก
 */
async function copyHolidaysToYear(sourceYear, targetYear) {
  const existing = await getHolidaysByYear(targetYear);
  if (existing.length > 0) {
    throw new Error(`ปี ${targetYear} (พ.ศ. ${targetYear + 543}) มีข้อมูลวันหยุดอยู่แล้ว ${existing.length} วัน`);
  }

  const result = await db.query(
    `INSERT INTO holidays (date, name, year, is_substitute)
     SELECT
       (date + INTERVAL '1 year' * ($2 - year)),
       name,
       $2,
       is_substitute
     FROM holidays
     WHERE year = $1
     ON CONFLICT (date) DO NOTHING
     RETURNING *`,
    [sourceYear, targetYear]
  );
  return result.rows;
}

module.exports = {
  getHolidaysByYear,
  getHolidayDatesInRange,
  addHoliday,
  updateHoliday,
  deleteHoliday,
  getAvailableYears,
  copyHolidaysToYear,
};
