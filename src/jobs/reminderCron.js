/**
 * Cron Jobs — แจ้งเตือนอัตโนมัติ
 *
 * ติดตั้ง: npm install node-cron
 * เรียกใช้จาก src/index.js:  require('./jobs/reminderCron');
 *
 * Schedule ที่ตั้งไว้:
 *   08:30 น. ทุกวันจันทร์-ศุกร์  — แจ้งเตือนเช็คอิน
 *   17:30 น. ทุกวันจันทร์-ศุกร์  — แจ้งเตือนเช็คเอาท์ (ถ้าลืม)
 *   09:00 น. ทุกวันจันทร์         — สรุปการลาสัปดาห์นี้ส่งหัวหน้า
 */

const cron = require('node-cron');
const db = require('../db');
const notifyService = require('../services/notificationService');
const dayjs = require('dayjs');

// ---- แจ้งเตือนเช็คอิน 08:30 จันทร์-ศุกร์ ----
cron.schedule('30 8 * * 1-5', async () => {
  console.log('[CRON] แจ้งเตือนเช็คอิน...');
  try {
    const today = dayjs().format('YYYY-MM-DD');

    // หาพนักงานที่ยังไม่เช็คอินวันนี้
    const { rows } = await db.query(`
      SELECT e.id, e.name, e.line_user_id, e.email
      FROM employees e
      WHERE e.is_active = TRUE
        AND e.id NOT IN (
          SELECT employee_id FROM attendance WHERE work_date = $1
        )
        AND e.id NOT IN (
          SELECT employee_id FROM leave_requests
          WHERE status = 'approved' AND $1 BETWEEN start_date AND end_date
        )
    `, [today]);

    console.log(`  → พบ ${rows.length} คนที่ยังไม่เช็คอิน`);

    for (const emp of rows) {
      await notifyService.checkInReminder(emp).catch(err =>
        console.error(`  ✗ ${emp.name}:`, err.message)
      );
    }
  } catch (err) {
    console.error('[CRON] เช็คอิน reminder error:', err.message);
  }
}, { timezone: 'Asia/Bangkok' });

// ---- แจ้งเตือนเช็คเอาท์ 17:30 จันทร์-ศุกร์ ----
cron.schedule('30 17 * * 1-5', async () => {
  console.log('[CRON] แจ้งเตือนเช็คเอาท์...');
  try {
    const today = dayjs().format('YYYY-MM-DD');

    // หาพนักงานที่เช็คอินแล้วแต่ยังไม่เช็คเอาท์
    const { rows } = await db.query(`
      SELECT e.id, e.name, e.line_user_id, e.email
      FROM employees e
      JOIN attendance a ON a.employee_id = e.id
      WHERE a.work_date = $1
        AND a.check_in IS NOT NULL
        AND a.check_out IS NULL
        AND e.is_active = TRUE
    `, [today]);

    console.log(`  → พบ ${rows.length} คนที่ยังไม่เช็คเอาท์`);

    const lineClient2 = new (require('@line/bot-sdk').messagingApi.MessagingApiClient)({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    });

    for (const emp of rows) {
      // LINE push
      if (emp.line_user_id) {
        await lineClient2.pushMessage({
          to: emp.line_user_id,
          messages: [{ type: 'text', text: `🚪 คุณ${emp.name} อย่าลืมเช็คเอาท์ก่อนกลับบ้านนะครับ! \n👉 เปิด LINE HR แล้วกดปุ่มเช็คเอาท์ได้เลยครับ` }],
        }).catch(() => {});
      }
      // Email
      if (emp.email) {
        await notifyService.sendEmail({
          to: emp.email,
          subject: '[HR] แจ้งเตือน: อย่าลืมเช็คเอาท์',
          html: `<p>เรียน <b>${emp.name}</b>, กรุณาเช็คเอาท์ผ่าน LINE HR ก่อนออกจากที่ทำงานนะครับ</p>`,
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[CRON] เช็คเอาท์ reminder error:', err.message);
  }
}, { timezone: 'Asia/Bangkok' });

// ---- สรุปการลาสัปดาห์ ส่งหัวหน้า 09:00 ทุกวันจันทร์ ----
cron.schedule('0 9 * * 1', async () => {
  console.log('[CRON] สรุปการลาประจำสัปดาห์...');
  try {
    const startOfWeek = dayjs().startOf('week').add(1, 'day').format('YYYY-MM-DD');
    const endOfWeek   = dayjs().startOf('week').add(5, 'day').format('YYYY-MM-DD');

    // ดึงรายชื่อหัวหน้าทั้งหมด
    const { rows: managers } = await db.query(`
      SELECT DISTINCT m.id, m.name, m.email, m.line_user_id
      FROM employees m
      WHERE m.role IN ('manager', 'hr', 'admin') AND m.is_active = TRUE
    `);

    for (const mgr of managers) {
      // ดึงรายการลาที่ approved ของทีมสัปดาห์นี้
      const { rows: leaves } = await db.query(`
        SELECT e.name AS employee_name, lt.name AS leave_type,
               lr.start_date, lr.end_date, lr.total_days
        FROM leave_requests lr
        JOIN employees e ON lr.employee_id = e.id
        JOIN leave_types lt ON lr.leave_type_id = lt.id
        WHERE (e.manager_id = $1 OR $2 = TRUE)
          AND lr.status = 'approved'
          AND lr.start_date BETWEEN $3 AND $4
        ORDER BY lr.start_date
      `, [mgr.id, mgr.role === 'hr', startOfWeek, endOfWeek]);

      if (leaves.length === 0) continue;

      const rows = leaves.map(l =>
        `<tr>
          <td style="padding:6px 12px;">${l.employee_name}</td>
          <td style="padding:6px 12px;">${l.leave_type}</td>
          <td style="padding:6px 12px;">${fmtDate(l.start_date)}–${fmtDate(l.end_date)}</td>
          <td style="padding:6px 12px;text-align:center;">${l.total_days}</td>
        </tr>`
      ).join('');

      const html = `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:#1357B0;padding:20px;border-radius:8px 8px 0 0;">
            <p style="margin:0;color:#fff;font-size:18px;font-weight:700;">สรุปการลาประจำสัปดาห์</p>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:12px;">${startOfWeek} ถึง ${endOfWeek}</p>
          </div>
          <div style="background:#fff;padding:20px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px;">
            <p>เรียน <b>${mgr.name}</b>,</p>
            <table width="100%" style="border-collapse:collapse;font-size:13px;">
              <thead style="background:#F8FAFC;">
                <tr>
                  <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #E2E8F0;">พนักงาน</th>
                  <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #E2E8F0;">ประเภท</th>
                  <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #E2E8F0;">วันที่</th>
                  <th style="padding:8px 12px;text-align:center;border-bottom:1px solid #E2E8F0;">วัน</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
            <p style="margin-top:16px;font-size:12px;color:#9CA3AF;">ระบบ HR อัตโนมัติ — ต่อกัน Insurance Broker</p>
          </div>
        </div>`;

      if (mgr.email) {
        await notifyService.sendEmail({
          to: mgr.email,
          subject: `[HR] สรุปการลาสัปดาห์ ${startOfWeek} – ${endOfWeek}`,
          html,
        }).catch(err => console.error(`  ✗ email ${mgr.name}:`, err.message));
      }
    }
  } catch (err) {
    console.error('[CRON] weekly summary error:', err.message);
  }
}, { timezone: 'Asia/Bangkok' });

// ---- แจ้งเตือนวันหยุดล่วงหน้า 1 วัน — 18:00 ทุกวัน ----
cron.schedule('0 18 * * *', async () => {
  console.log('[CRON] ตรวจวันหยุดพรุ่งนี้...');
  try {
    const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');

    // ตรวจว่าพรุ่งนี้เป็นวันหยุดนักขัตฤกษ์ไหม
    const { rows: holidays } = await db.query(
      `SELECT name FROM holidays WHERE date = $1 LIMIT 1`,
      [tomorrow]
    );
    if (!holidays.length) {
      console.log('  → พรุ่งนี้ไม่มีวันหยุด');
      return;
    }
    const holidayName = holidays[0].name;
    console.log(`  → พรุ่งนี้: ${holidayName}`);

    // ดึงพนักงานที่มี LINE ทั้งหมด
    const { rows: employees } = await db.query(
      `SELECT name, line_user_id FROM employees
       WHERE is_active = TRUE AND line_user_id IS NOT NULL AND line_user_id != ''`
    );

    const lineClient = new (require('@line/bot-sdk').messagingApi.MessagingApiClient)({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    });

    const tomorrowTH = dayjs(tomorrow).toDate().toLocaleDateString('th-TH', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Bangkok',
    });

    const msg = {
      type: 'flex',
      altText: `🎉 วันหยุด: ${holidayName}`,
      contents: {
        type: 'bubble',
        size: 'kilo',
        header: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#1357B0',
          paddingAll: '14px',
          contents: [
            { type: 'text', text: '🎉 วันหยุดพรุ่งนี้!', color: '#ffffff', weight: 'bold', size: 'md' },
          ],
        },
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          paddingAll: '14px',
          contents: [
            { type: 'text', text: holidayName, weight: 'bold', size: 'lg', color: '#1357B0', wrap: true },
            { type: 'text', text: tomorrowTH, size: 'sm', color: '#6b7280', wrap: true, margin: 'xs' },
            { type: 'separator', margin: 'md' },
            { type: 'text', text: '🏖️ พักผ่อนให้เต็มที่นะครับ!', size: 'sm', color: '#374151', margin: 'md' },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          paddingAll: '10px',
          backgroundColor: '#f8fafc',
          contents: [
            { type: 'text', text: 'ต่อกัน Insurance Broker HR', size: 'xs', color: '#9ca3af', align: 'center' },
          ],
        },
        styles: { footer: { separator: true } },
      },
    };

    let sent = 0;
    await Promise.all(
      employees.map(emp =>
        lineClient.pushMessage({ to: emp.line_user_id, messages: [msg] })
          .then(() => sent++)
          .catch(() => {})
      )
    );
    console.log(`  → ส่งแจ้งเตือนวันหยุด "${holidayName}" สำเร็จ ${sent}/${employees.length} คน`);
  } catch (err) {
    console.error('[CRON] holiday reminder error:', err.message);
  }
}, { timezone: 'Asia/Bangkok' });

// ---- ตรวจสาย / ขาดงาน — 19:00 ทุกวัน ----
cron.schedule('0 19 * * *', async () => {
  console.log('[CRON] ตรวจสาย/ขาดงาน...');
  try {
    const today = dayjs().format('YYYY-MM-DD');
    const lateAbsentService = require('../services/lateAbsentService');
    const result = await lateAbsentService.checkLateAbsent(today);
    if (!result.skipped) {
      console.log('  → late:' + result.late + ' absent:' + result.absent + ' ok:' + result.ok);
    }
  } catch (err) {
    console.error('[CRON] late/absent check error:', err.message);
  }
}, { timezone: 'Asia/Bangkok' });

// ── Probation Alert — 09:00 ทุกวัน ─────────────────────────────
cron.schedule('0 9 * * *', async () => {
  console.log('[CRON] ตรวจสอบทดลองงานใกล้ครบกำหนด...');
  try {
    const lineClient = new (require('@line/bot-sdk').messagingApi.MessagingApiClient)({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    });

    // ensure probation columns exist
    await db.query(`
      ALTER TABLE employees
        ADD COLUMN IF NOT EXISTS probation_end_date  DATE,
        ADD COLUMN IF NOT EXISTS probation_status    VARCHAR(20) DEFAULT 'on_probation'
    `).catch(() => {});

    const alertDate = dayjs().add(7, 'day').format('YYYY-MM-DD');
    const today     = dayjs().format('YYYY-MM-DD');

    // พนักงานที่ probation_end_date อยู่ในช่วง 7 วันข้างหน้า
    const { rows: expiring } = await db.query(
      `SELECT e.id, e.name, e.employee_code, e.probation_end_date, e.probation_status,
              d.name AS department_name
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE e.is_active = TRUE
         AND e.probation_status = 'on_probation'
         AND e.probation_end_date IS NOT NULL
         AND e.probation_end_date BETWEEN $1 AND $2`,
      [today, alertDate]
    );

    if (!expiring.length) {
      console.log('  → ไม่มีพนักงานทดลองงานใกล้ครบกำหนด');
      return;
    }

    // push ไปยัง admin ทุกคน
    const { rows: admins } = await db.query('SELECT line_user_id FROM admin_line_users');
    if (!admins.length) return;

    const lines = expiring.map(e =>
      `• ${e.name} (${e.employee_code}) — ${e.department_name || '-'}\n  ครบ: ${dayjs(e.probation_end_date).format('DD/MM/YYYY')}`
    ).join('\n');

    const msg = `⚠️ แจ้งเตือน: ทดลองงานใกล้ครบกำหนด\n\nพนักงาน ${expiring.length} ราย:\n${lines}\n\nกรุณาประเมินผลการทดลองงาน`;

    await Promise.all(admins.map(a =>
      lineClient.pushMessage({ to: a.line_user_id, messages: [{ type: 'text', text: msg }] }).catch(() => {})
    ));
    console.log(`  → แจ้ง admin ${admins.length} คน เรื่องทดลองงาน ${expiring.length} ราย`);
  } catch (err) {
    console.error('[CRON] probation alert error:', err.message);
  }
}, { timezone: 'Asia/Bangkok' });

function fmtDate(d) {
  return new Date(d).toLocaleDateString('th-TH', { month: 'short', day: 'numeric' });
}

console.log('✅ Cron jobs registered: check-in 08:30 | check-out 17:30 | holiday reminder 18:00 | late/absent 19:00 | weekly summary Mon 09:00 | probation alert 09:00');
