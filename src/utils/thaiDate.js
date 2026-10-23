'use strict';
/**
 * thaiDate.js — วันที่ตามเวลาไทย
 *
 * ❗ ทำไมต้องมี
 *   โค้ดเดิมหลายจุดใช้ new Date().toISOString().slice(0,10) เพื่อหา "วันนี้"
 *   ซึ่งคืนวันที่ตาม UTC ไม่ใช่เวลาไทย
 *
 *   Railway รันเป็น UTC → ตั้งแต่ 00:00 ถึง 07:00 เวลาไทย
 *   ฟังก์ชันนั้นจะคืน "เมื่อวาน" ทุกวัน วันละ 7 ชั่วโมง
 *
 *   ผลคือ วันที่เบิกเงิน / วันที่ประเมินทดลองงาน / วันเริ่มใช้กะ
 *   ถูกบันทึกผิดไป 1 วัน โดยไม่มี error ให้เห็นเลย
 *   และเจอยากมากเพราะตอนทดสอบในไทยตอนกลางวันจะถูกเสมอ
 */

/** วันนี้ตามเวลาไทย รูปแบบ YYYY-MM-DD */
function todayTH() {
  // ❗ en-CA ให้รูปแบบ YYYY-MM-DD พอดี ไม่ต้องมาต่อสตริงเอง
  //   ส่วน timeZone บังคับให้คิดตามเวลาไทยไม่ว่าเซิร์ฟเวอร์จะตั้งเป็นอะไร
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

/** แปลงค่าวันที่ใด ๆ เป็น YYYY-MM-DD ตามเวลาไทย */
function toTHDate(v) {
  if (!v) return null;
  // สตริง YYYY-MM-DD อยู่แล้ว → คืนตามเดิม ไม่ต้องแปลงให้เสี่ยงเพี้ยน
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

/** วันสุดท้ายของเดือน (ปี ค.ศ.) รูปแบบ YYYY-MM-DD */
function lastDayOfMonth(year, month) {
  const last = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

module.exports = { todayTH, toTHDate, lastDayOfMonth };
