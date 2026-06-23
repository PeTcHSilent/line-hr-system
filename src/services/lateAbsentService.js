const db = require('../db');
const settingsService = require('./settingsService');

/**
 * ตรวจสอบการมาสาย / ขาดงานสำหรับวันที่ระบุ
 * สร้าง attendance_warnings และ push LINE แจ้งเตือน
 */
async function checkLateAbsent(dateStr) {
  // 1. ตรวจว่าวันนี้เป็นวันทำงานหรือไม่
  const otType = await settingsService.getOTType(dateStr);
  if (otType === 'holiday') {
    console.log('[LateAbsent] ' + dateStr + ' เป็นวันหยุด — ข้ามการตรวจ');
    return { skipped: true };
  }

  const schedule      = await settingsService.getWorkSchedule();
  const graceMinutes  = parseInt(await settingsService.get('late_grace_minutes') || '15');
  const notifyEnabled = (await settingsService.get('late_warning_enabled')) !== 'false';

  const [wh, wm]          = schedule.work_start.split(':').map(Number);
  const thresholdMinutes   = wh * 60 + wm + graceMinutes;  // e.g. 9*60+0+15 = 555

  // 2. ดึงพนักงานทั้งหมด
  const { rows: employees } = await db.query(
    'SELECT id, name, line_user_id FROM employees WHERE is_active = TRUE'
  );

  const lineClient = notifyEnabled
    ? new (require('@line/bot-sdk').messagingApi.MessagingApiClient)({
        channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
      })
    : null;

  const stats = { late: 0, absent: 0, ok: 0 };

  for (const emp of employees) {
    // ตรวจว่าลาหยุดวันนี้ไหม (approved leave)
    const onLeave = await db.query(
      "SELECT id FROM leave_requests WHERE employee_id=$1 AND status='approved'" +
      ' AND $2::date BETWEEN start_date AND end_date',
      [emp.id, dateStr]
    );
    if (onLeave.rows.length > 0) { stats.ok++; continue; }

    // ดึง attendance record
    const att = await db.query(
      'SELECT check_in FROM attendance WHERE employee_id=$1 AND work_date=$2',
      [emp.id, dateStr]
    );

    if (att.rows.length === 0) {
      // ขาดงาน
      await saveWarning(emp.id, dateStr, 'absent', 0);
      stats.absent++;
      if (lineClient && emp.line_user_id) {
        await pushAbsentWarning(lineClient, emp, dateStr).catch(() => {});
        await db.query(
          'UPDATE attendance_warnings SET notified_line=TRUE' +
          ' WHERE employee_id=$1 AND warning_date=$2 AND warning_type=$3',
          [emp.id, dateStr, 'absent']
        );
      }
    } else {
      const checkIn = att.rows[0].check_in;
      if (!checkIn) { stats.ok++; continue; }

      // check_in เป็น TIME string เช่น "09:45:00"
      const parts = String(checkIn).split(':').map(Number);
      const checkInMinutes = parts[0] * 60 + parts[1];

      if (checkInMinutes > thresholdMinutes) {
        const minutesLate = checkInMinutes - (wh * 60 + wm);
        await saveWarning(emp.id, dateStr, 'late', minutesLate);
        stats.late++;
        if (lineClient && emp.line_user_id) {
          await pushLateWarning(lineClient, emp, dateStr, minutesLate, schedule.work_start).catch(() => {});
          await db.query(
            'UPDATE attendance_warnings SET notified_line=TRUE' +
            ' WHERE employee_id=$1 AND warning_date=$2 AND warning_type=$3',
            [emp.id, dateStr, 'late']
          );
        }
      } else {
        stats.ok++;
      }
    }
  }

  console.log('[LateAbsent] ' + dateStr + ' — late:' + stats.late + ' absent:' + stats.absent + ' ok:' + stats.ok);
  return stats;
}

async function saveWarning(employeeId, dateStr, type, minutesLate) {
  await db.query(
    'INSERT INTO attendance_warnings (employee_id, warning_date, warning_type, minutes_late)' +
    ' VALUES ($1, $2, $3, $4) ON CONFLICT (employee_id, warning_date, warning_type) DO NOTHING',
    [employeeId, dateStr, type, minutesLate]
  );
}

async function pushLateWarning(client, emp, dateStr, minutesLate, workStart) {
  const hours   = Math.floor(minutesLate / 60);
  const mins    = minutesLate % 60;
  const lateStr = hours > 0 ? hours + ' ชม. ' + mins + ' นาที' : mins + ' นาที';
  await client.pushMessage({
    to: emp.line_user_id,
    messages: [{
      type: 'flex',
      altText: '⚠️ แจ้งเตือน: มาสาย ' + lateStr,
      contents: {
        type: 'bubble', size: 'kilo',
        header: {
          type: 'box', layout: 'vertical',
          backgroundColor: '#F47920', paddingAll: '14px',
          contents: [{ type: 'text', text: '⚠️ แจ้งเตือนการมาสาย', color: '#ffffff', weight: 'bold', size: 'md' }],
        },
        body: {
          type: 'box', layout: 'vertical', paddingAll: '14px', spacing: 'sm',
          contents: [
            { type: 'text', text: 'คุณ' + emp.name, weight: 'bold', size: 'md', color: '#111827' },
            { type: 'text', text: 'วันที่: ' + dateStr, size: 'sm', color: '#6b7280' },
            { type: 'text', text: 'เวลางาน: ' + workStart + ' น.', size: 'sm', color: '#6b7280' },
            { type: 'separator', margin: 'md' },
            { type: 'text', text: 'มาสาย ' + lateStr, weight: 'bold', color: '#dc2626', size: 'lg', margin: 'md' },
            { type: 'text', text: 'กรุณาตรงต่อเวลาในครั้งต่อไป', size: 'sm', color: '#374151', margin: 'sm', wrap: true },
          ],
        },
        footer: {
          type: 'box', layout: 'vertical', paddingAll: '10px', backgroundColor: '#fef9f0',
          contents: [{ type: 'text', text: 'ต่อกัน Insurance Broker HR', size: 'xs', color: '#9ca3af', align: 'center' }],
        },
      },
    }],
  });
}

async function pushAbsentWarning(client, emp, dateStr) {
  await client.pushMessage({
    to: emp.line_user_id,
    messages: [{
      type: 'flex',
      altText: '🚨 แจ้งเตือน: ไม่พบการเช็คอิน',
      contents: {
        type: 'bubble', size: 'kilo',
        header: {
          type: 'box', layout: 'vertical',
          backgroundColor: '#dc2626', paddingAll: '14px',
          contents: [{ type: 'text', text: '🚨 แจ้งเตือนการขาดงาน', color: '#ffffff', weight: 'bold', size: 'md' }],
        },
        body: {
          type: 'box', layout: 'vertical', paddingAll: '14px', spacing: 'sm',
          contents: [
            { type: 'text', text: 'คุณ' + emp.name, weight: 'bold', size: 'md', color: '#111827' },
            { type: 'text', text: 'วันที่: ' + dateStr, size: 'sm', color: '#6b7280' },
            { type: 'separator', margin: 'md' },
            { type: 'text', text: 'ไม่พบการเช็คอินในระบบ', weight: 'bold', color: '#dc2626', margin: 'md', wrap: true },
            { type: 'text', text: 'หากมาทำงานแล้วกรุณาเช็คอินผ่าน LINE HR\nหรือแจ้ง HR เพื่อบันทึกข้อมูล', size: 'sm', color: '#374151', margin: 'sm', wrap: true },
          ],
        },
        footer: {
          type: 'box', layout: 'vertical', paddingAll: '10px', backgroundColor: '#fef2f2',
          contents: [{ type: 'text', text: 'ต่อกัน Insurance Broker HR', size: 'xs', color: '#9ca3af', align: 'center' }],
        },
      },
    }],
  });
}

/**
 * ดึงรายการ warnings (admin)
 */
async function getWarnings({ year, month, employeeId, type } = {}) {
  const conditions = ['1=1'];
  const values = [];
  let idx = 1;
  if (year)       { conditions.push('EXTRACT(YEAR  FROM w.warning_date) = $' + idx++); values.push(year); }
  if (month)      { conditions.push('EXTRACT(MONTH FROM w.warning_date) = $' + idx++); values.push(month); }
  if (employeeId) { conditions.push('w.employee_id = $' + idx++); values.push(employeeId); }
  if (type)       { conditions.push('w.warning_type = $' + idx++); values.push(type); }

  const result = await db.query(
    'SELECT w.*, e.name AS employee_name, e.employee_code, d.name AS department_name' +
    ' FROM attendance_warnings w' +
    ' JOIN employees e ON e.id = w.employee_id' +
    ' LEFT JOIN departments d ON d.id = e.department_id' +
    ' WHERE ' + conditions.join(' AND ') +
    ' ORDER BY w.warning_date DESC, e.name',
    values
  );
  return result.rows;
}

module.exports = { checkLateAbsent, getWarnings };
