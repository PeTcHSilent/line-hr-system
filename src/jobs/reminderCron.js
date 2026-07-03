/**
 * Cron Jobs — แจ้งเตือนอัตโนมัติ
 *
 * ติดตั้ง: npm install node-cron
 * เรียกใช้จาก src/index.js:  require('./jobs/reminderCron');
 *
 * Schedule คำนวณจาก company_settings (work_start / work_end) + offset:
 *   เช็คอิน  : work_start - reminder_checkin_offset  นาที  (default: 10 นาที)
 *   เช็คเอาท์: work_end   - reminder_checkout_offset นาที  (default: 5  นาที)
 *   สรุปการลา: 09:00 น. ทุกวันจันทร์
 */

const cron = require('node-cron');
const db = require('../db');
const notifyService = require('../services/notificationService');
const settingsService = require('../services/settingsService');
const dayjs = require('dayjs');

// ── helper: แปลง "HH:MM" ลบ N นาที → { h, m } ──────────
function subtractMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m - minutes;
  return { h: Math.floor(((total % 1440) + 1440) % 1440 / 60),
           m: ((total % 1440) + 1440) % 60 };
}

// ── helper: work_days (1-7) → cron day-of-week (0=Sun) ──
function workDaysToCron(workDays) {
  // work_days ใช้ 1=จันทร์ … 7=อาทิตย์  (ISO weekday)
  // cron DOW: 0=Sun, 1=Mon … 6=Sat
  const isoToCron = { 1:1, 2:2, 3:3, 4:4, 5:5, 6:6, 7:0 };
  return workDays.map(d => isoToCron[d] ?? d).sort().join(',');
}

// ── ลงทะเบียน dynamic cron จาก settings ────────────────
async function registerAttendanceCrons() {
  try {
    const schedule = await settingsService.getWorkSchedule();
    const checkinOffset  = parseInt(await settingsService.get('reminder_checkin_offset')  || '10');
    const checkoutOffset = parseInt(await settingsService.get('reminder_checkout_offset') || '5');

    const cinTime  = subtractMinutes(schedule.work_start, checkinOffset);   // เช็คอิน
    const coutTime = subtractMinutes(schedule.work_end,   checkoutOffset);  // เช็คเอาท์
    const dowStr   = workDaysToCron(schedule.work_days);

    const cinCron  = `${cinTime.m}  ${cinTime.h}  * * ${dowStr}`;
    const coutCron = `${coutTime.m} ${coutTime.h} * * ${dowStr}`;

    const cinLabel  = `${String(cinTime.h).padStart(2,'0')}:${String(cinTime.m).padStart(2,'0')}`;
    const coutLabel = `${String(coutTime.h).padStart(2,'0')}:${String(coutTime.m).padStart(2,'0')}`;

    console.log(`[CRON] เช็คอิน  : ${cinLabel} น. (${checkinOffset} นาทีก่อน ${schedule.work_start})`);
    console.log(`[CRON] เช็คเอาท์: ${coutLabel} น. (${checkoutOffset} นาทีก่อน ${schedule.work_end})`);

    // ── แจ้งเตือนเช็คอิน ──────────────────────────────
    cron.schedule(cinCron, async () => {
      console.log('[CRON] แจ้งเตือนเช็คอิน...');
      try {
        const today = dayjs().format('YYYY-MM-DD');
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

    // ── แจ้งเตือนเช็คเอาท์ ────────────────────────────
    cron.schedule(coutCron, async () => {
      console.log('[CRON] แจ้งเตือนเช็คเอาท์...');
      try {
        const today = dayjs().format('YYYY-MM-DD');
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
          if (emp.line_user_id) {
            await lineClient2.pushMessage({
              to: emp.line_user_id,
              messages: [{ type: 'text', text: `🚪 คุณ${emp.name} อย่าลืมเช็คเอาท์ก่อนกลับบ้านนะครับ!\n👉 เปิด LINE HR แล้วกดปุ่มเช็คเอาท์ได้เลยครับ` }],
            }).catch(() => {});
          }
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

  } catch (err) {
    console.error('[CRON] registerAttendanceCrons error:', err.message);
    // fallback: ใช้ค่า default ถ้า DB ยังไม่พร้อม
    console.warn('[CRON] fallback → เช็คอิน 08:50 / เช็คเอาท์ 17:55');
    registerFallbackCrons();
  }
}

// ── fallback hardcode (ถ้า DB ยังไม่พร้อมตอน startup) ──
function registerFallbackCrons() {
  // 08:50 = 10 นาทีก่อน 09:00 | 17:55 = 5 นาทีก่อน 18:00
  cron.schedule('50 8 * * 1-6', async () => {
    console.log('[CRON-fallback] เช็คอิน reminder...');
    try {
      const today = dayjs().format('YYYY-MM-DD');
      const { rows } = await db.query(`
        SELECT e.id, e.name, e.line_user_id, e.email FROM employees e
        WHERE e.is_active = TRUE
          AND e.id NOT IN (SELECT employee_id FROM attendance WHERE work_date = $1)
          AND e.id NOT IN (SELECT employee_id FROM leave_requests WHERE status='approved' AND $1 BETWEEN start_date AND end_date)
      `, [today]);
      for (const emp of rows) {
        await notifyService.checkInReminder(emp).catch(() => {});
      }
    } catch (err) { console.error('[CRON-fallback] เช็คอิน:', err.message); }
  }, { timezone: 'Asia/Bangkok' });

  cron.schedule('55 17 * * 1-6', async () => {
    console.log('[CRON-fallback] เช็คเอาท์ reminder...');
    try {
      const today = dayjs().format('YYYY-MM-DD');
      const { rows } = await db.query(`
        SELECT e.id, e.name, e.line_user_id FROM employees e
        JOIN attendance a ON a.employee_id = e.id
        WHERE a.work_date = $1 AND a.check_in IS NOT NULL AND a.check_out IS NULL AND e.is_active = TRUE
      `, [today]);
      const lc = new (require('@line/bot-sdk').messagingApi.MessagingApiClient)({
        channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
      });
      for (const emp of rows) {
        if (emp.line_user_id) {
          await lc.pushMessage({ to: emp.line_user_id, messages: [{ type:'text', text:`🚪 คุณ${emp.name} อย่าลืมเช็คเอาท์ก่อนกลับบ้านนะครับ!` }] }).catch(() => {});
        }
      }
    } catch (err) { console.error('[CRON-fallback] เช็คเอาท์:', err.message); }
  }, { timezone: 'Asia/Bangkok' });
}

// เรียก register ทันที (async — ใช้ DB settings)
registerAttendanceCrons();

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

// ── สรุปการมาทำงานประจำวัน → admin LINE 19:30 ────────────────
cron.schedule('30 19 * * *', async () => {
  console.log('[CRON] สรุปการมาทำงานประจำวัน...');
  try {
    await sendDailyAttendanceSummary();
  } catch (err) {
    console.error('[CRON] attendance summary error:', err.message);
  }
}, { timezone: 'Asia/Bangkok' });

async function sendDailyAttendanceSummary(dateStr) {
  const today = dateStr || dayjs().format('YYYY-MM-DD');

  // ตรวจว่าวันนี้เป็นวันทำงานหรือไม่
  const schedule = await settingsService.getWorkSchedule();
  const todayIso = dayjs(today).day(); // 0=Sun
  const isoDay   = todayIso === 0 ? 7 : todayIso; // convert to ISO 1=Mon..7=Sun
  if (!schedule.work_days.includes(isoDay)) {
    console.log(`  → วันที่ ${today} ไม่ใช่วันทำงาน ข้ามการส่งสรุป`);
    return;
  }

  const { rows: holidays } = await db.query(
    `SELECT name FROM holidays WHERE date = $1 LIMIT 1`, [today]
  );
  if (holidays.length) {
    console.log(`  → วันหยุด (${holidays[0].name}) ข้ามการส่งสรุป`);
    return;
  }

  // ดึง admin LINE users
  const { rows: admins } = await db.query('SELECT line_user_id FROM admin_line_users');
  if (!admins.length) { console.log('  → ไม่มี admin_line_users'); return; }

  // work_start สำหรับคำนวณสาย
  const graceMinutes = parseInt(await settingsService.get('late_grace_minutes') || '15');
  const [wh, wm]     = schedule.work_start.split(':').map(Number);
  const thresholdMin = wh * 60 + wm + graceMinutes;

  // รายชื่อพนักงานทั้งหมด
  const { rows: allEmp } = await db.query(
    `SELECT id, name FROM employees WHERE is_active = TRUE ORDER BY name`
  );
  const total = allEmp.length;

  // attendance วันนี้
  const { rows: attRows } = await db.query(
    `SELECT a.employee_id, e.name, a.check_in, a.check_out
     FROM attendance a
     JOIN employees e ON a.employee_id = e.id
     WHERE a.work_date = $1 AND e.is_active = TRUE
     ORDER BY a.check_in`, [today]
  );

  // พนักงานที่ลาวันนี้
  const { rows: leaveRows } = await db.query(
    `SELECT e.name, lt.name AS leave_type
     FROM leave_requests lr
     JOIN employees e  ON lr.employee_id   = e.id
     JOIN leave_types lt ON lr.leave_type_id = lt.id
     WHERE lr.status = 'approved'
       AND $1::date BETWEEN lr.start_date AND lr.end_date
       AND e.is_active = TRUE
     ORDER BY e.name`, [today]
  );
  const leaveSet = new Set(leaveRows.map(r => r.name));
  const checkedSet = new Set(attRows.map(r => r.name));

  // แยกกลุ่ม
  const onTime = [], late = [], noCheckout = [];
  for (const att of attRows) {
    if (!att.check_in) continue;
    const parts = String(att.check_in).split(':').map(Number);
    const cinMin = parts[0] * 60 + parts[1];
    const lateMin = cinMin - (wh * 60 + wm);
    if (cinMin > thresholdMin) {
      const lh = Math.floor(lateMin / 60), lm = lateMin % 60;
      const lateStr = lh > 0 ? `${lh}ชม.${lm}น.` : `${lm}น.`;
      late.push(`• ${att.name}  สาย ${lateStr} (เข้า ${parts[0].toString().padStart(2,'0')}:${parts[1].toString().padStart(2,'0')})`);
    } else {
      onTime.push(`• ${att.name}  ${parts[0].toString().padStart(2,'0')}:${parts[1].toString().padStart(2,'0')}`);
    }
    if (!att.check_out) noCheckout.push(att.name);
  }

  // ขาดงาน (ไม่เช็คอิน ไม่ได้ลา)
  const absent = allEmp
    .filter(e => !checkedSet.has(e.name) && !leaveSet.has(e.name))
    .map(e => `• ${e.name}`);

  const checkedCount  = attRows.length;
  const onTimeCount   = onTime.length;
  const lateCount     = late.length;
  const leaveCount    = leaveRows.length;
  const absentCount   = absent.length;

  // วันที่ภาษาไทย
  const todayTH = new Date(today + 'T00:00:00+07:00').toLocaleDateString('th-TH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  // ── สร้าง Flex Message ──────────────────────────────
  const makeSection = (title, items) =>
    items.length === 0 ? [] : [
      { type: 'separator', margin: 'md' },
      { type: 'text', text: title, weight: 'bold', size: 'sm', color: '#374151', margin: 'md' },
      { type: 'text', text: items.join('\n'), size: 'xs', color: '#6b7280', wrap: true, margin: 'xs' },
    ];

  const flexMsg = {
    type: 'flex',
    altText: `📊 สรุปการมาทำงาน ${todayTH} — มา ${checkedCount}/${total} คน | สาย ${lateCount} | ขาด ${absentCount}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#1357B0', paddingAll: '16px',
        contents: [
          { type: 'text', text: '📊 สรุปการมาทำงานประจำวัน', color: '#ffffff', weight: 'bold', size: 'md' },
          { type: 'text', text: todayTH, color: '#ffffffCC', size: 'xs', margin: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'none',
        contents: [
          // KPI row
          {
            type: 'box', layout: 'horizontal', spacing: 'sm',
            contents: [
              kpiBox('✅ มาทำงาน', `${checkedCount}/${total}`, '#dcfce7', '#166534'),
              kpiBox('⏰ สาย',     String(lateCount),         '#fef3c7', '#92400e'),
              kpiBox('🏖️ ลา',      String(leaveCount),        '#dbeafe', '#1d4ed8'),
              kpiBox('❌ ขาดงาน',  String(absentCount),       '#fee2e2', '#991b1b'),
            ],
          },
          ...makeSection('✅ มาทำงาน (ตรงเวลา)', onTime),
          ...makeSection('⏰ มาสาย', late),
          ...makeSection('🏖️ ลา', leaveRows.map(r => `• ${r.name} — ${r.leave_type}`)),
          ...makeSection('❌ ขาดงาน', absent),
          ...(noCheckout.length > 0 ? [
            { type: 'separator', margin: 'md' },
            { type: 'text', text: `⚠️ ยังไม่เช็คเอาท์ ${noCheckout.length} คน`, size: 'xs', color: '#f59e0b', margin: 'md', wrap: true },
          ] : []),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '10px', backgroundColor: '#f8fafc',
        contents: [
          { type: 'text', text: 'ต่อกัน Insurance Broker HR', size: 'xs', color: '#9ca3af', align: 'center' },
        ],
      },
      styles: { footer: { separator: true } },
    },
  };

  const lineClient = new (require('@line/bot-sdk').messagingApi.MessagingApiClient)({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  });

  await Promise.all(
    admins.map(a =>
      lineClient.pushMessage({ to: a.line_user_id, messages: [flexMsg] }).catch(err =>
        console.error(`  ✗ push admin ${a.line_user_id}:`, err.message)
      )
    )
  );
  console.log(`  → ส่งสรุปการมาทำงาน: มา ${checkedCount}/${total} | สาย ${lateCount} | ลา ${leaveCount} | ขาด ${absentCount}`);
}

function kpiBox(label, value, bg, color) {
  return {
    type: 'box', layout: 'vertical', flex: 1,
    backgroundColor: bg, cornerRadius: '8px', paddingAll: '8px',
    contents: [
      { type: 'text', text: value, size: 'lg', weight: 'bold', color, align: 'center' },
      { type: 'text', text: label,  size: 'xxs', color, align: 'center', wrap: true },
    ],
  };
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('th-TH', { month: 'short', day: 'numeric' });
}

module.exports = { sendDailyAttendanceSummary };

console.log('✅ Cron jobs registered: check-in/out (dynamic from settings) | holiday reminder 18:00 | late/absent 19:00 | attendance summary 19:30 | weekly summary Mon 09:00 | probation alert 09:00');
