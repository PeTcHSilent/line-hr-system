/**
 * NotificationService
 * รองรับการแจ้งเตือนพร้อมกัน 2 ช่องทาง:
 *   1. LINE Push Message (Messaging API)
 *   2. Email (Nodemailer — ใช้ได้กับ Gmail, Outlook, SMTP ทั่วไป)
 *
 * ใช้งาน:
 *   const notify = require('./notificationService');
 *   await notify.leaveSubmitted(leave, employee, manager);
 */

const nodemailer = require('nodemailer');
const line = require('@line/bot-sdk');
const flexMessages = require('../utils/flexMessages');

// ---- LINE Client ----
const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

// ---- Email Transporter ----
// รองรับ 3 ผู้ให้บริการ — ตั้งใน .env ว่าใช้อะไร
function createTransporter() {
  const provider = process.env.EMAIL_PROVIDER || 'smtp';

  if (provider === 'gmail') {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD,  // Google App Password (ไม่ใช่รหัส Gmail)
      },
    });
  }

  if (provider === 'outlook') {
    return nodemailer.createTransport({
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
  }

  // SMTP ทั่วไป (default)
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
}

// ============================================================
// ฟังก์ชัน Notification หลัก
// ============================================================

/**
 * แจ้งหัวหน้าเมื่อพนักงานส่งคำขอลา
 */
async function leaveSubmitted(leave, employee, manager) {
  const subject = `[HR] ${employee.name} ขอลางาน ${leave.total_days} วัน`;
  const html = leaveEmailHtml('pending', leave, employee);

  await Promise.allSettled([
    // LINE (ถ้าหัวหน้ามี LINE)
    manager.line_user_id
      ? lineClient.pushMessage({
          to: manager.line_user_id,
          messages: [flexMessages.leaveApprovalRequest(leave, employee)],
        })
      : Promise.resolve(),

    // Email (ถ้าหัวหน้ามี email)
    manager.email
      ? sendEmail({ to: manager.email, subject, html })
      : Promise.resolve(),
  ]);
}

/**
 * แจ้งพนักงานเมื่อการลาได้รับการอนุมัติ/ปฏิเสธ
 */
async function leaveDecision(leave, employee, status) {
  const isApproved = status === 'approved';
  const subject = isApproved
    ? `[HR] ✅ การลาของคุณได้รับการอนุมัติแล้ว`
    : `[HR] ❌ การลาของคุณถูกปฏิเสธ`;
  const html = leaveEmailHtml(status, leave, employee);

  await Promise.allSettled([
    employee.line_user_id
      ? lineClient.pushMessage({
          to: employee.line_user_id,
          messages: [{
            type: 'text',
            text: isApproved
              ? `✅ การลาของคุณได้รับการอนุมัติแล้ว\n📅 ${leave.start_date} ถึง ${leave.end_date}\n(${leave.total_days} วัน)`
              : `❌ การลาของคุณถูกปฏิเสธ\nเหตุผล: ${leave.reject_reason || '-'}`,
          }],
        })
      : Promise.resolve(),

    employee.email
      ? sendEmail({ to: employee.email, subject, html })
      : Promise.resolve(),
  ]);
}

/**
 * แจ้งเตือนเช็คอิน/เช็คเอาท์ (ถ้าลืม)
 * ใช้กับ cron job เช้า/เย็น
 */
async function checkInReminder(employee) {
  const msg = '⏰ อย่าลืมเช็คอินวันนี้นะครับ!';

  await Promise.allSettled([
    employee.line_user_id
      ? lineClient.pushMessage({
          to: employee.line_user_id,
          messages: [{ type: 'text', text: msg }],
        })
      : Promise.resolve(),

    employee.email
      ? sendEmail({
          to: employee.email,
          subject: '[HR] แจ้งเตือน: อย่าลืมเช็คอิน',
          html: reminderEmailHtml(employee.name, msg),
        })
      : Promise.resolve(),
  ]);
}

/**
 * ส่ง Broadcast ประกาศ HR ให้พนักงานทุกคน
 * @param {Array} employees - รายการพนักงาน [{line_user_id, email, name}]
 * @param {Object} announcement - {title, body}
 */
async function broadcastAnnouncement(employees, announcement) {
  const subject = `[ประกาศ HR] ${announcement.title}`;
  const html = announcementEmailHtml(announcement);

  // ส่ง LINE แบบ Multicast (สูงสุด 500 คนต่อครั้ง)
  const lineRecipients = employees
    .filter(e => e.line_user_id)
    .map(e => e.line_user_id);

  const emailRecipients = employees.filter(e => e.email);

  const tasks = [];

  // LINE Multicast (batch 500)
  for (let i = 0; i < lineRecipients.length; i += 500) {
    const batch = lineRecipients.slice(i, i + 500);
    tasks.push(
      lineClient.multicast({
        to: batch,
        messages: [{
          type: 'flex',
          altText: announcement.title,
          contents: announcementFlex(announcement),
        }],
      })
    );
  }

  // Email (ส่งทีละคน เพื่อ personalize ชื่อ)
  for (const emp of emailRecipients) {
    tasks.push(
      sendEmail({
        to: emp.email,
        subject,
        html: announcementEmailHtml(announcement, emp.name),
      })
    );
  }

  const results = await Promise.allSettled(tasks);
  const failed = results.filter(r => r.status === 'rejected').length;
  console.log(`Broadcast: ${results.length - failed} สำเร็จ, ${failed} ล้มเหลว`);
  return { total: results.length, failed };
}

// ============================================================
// Email Sender
// ============================================================
async function sendEmail({ to, subject, html }) {
  const transporter = createTransporter();
  return transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || 'ต่อกัน HR'}" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });
}

// ============================================================
// Email HTML Templates
// ============================================================
function leaveEmailHtml(status, leave, employee) {
  const statusLabel = {
    pending:  { text: '⏳ รอการอนุมัติ', color: '#F59E0B', bg: '#FFFBEB' },
    approved: { text: '✅ อนุมัติแล้ว',   color: '#10B981', bg: '#ECFDF5' },
    rejected: { text: '❌ ปฏิเสธ',        color: '#EF4444', bg: '#FEF2F2' },
  }[status] || { text: status, color: '#6B7280', bg: '#F9FAFB' };

  return `
<!DOCTYPE html>
<html lang="th">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Sarabun,'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr><td style="background:#1357B0;padding:24px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <p style="margin:0;color:#fff;font-size:20px;font-weight:700;">ต่อกัน Insurance Broker</p>
                <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:12px;letter-spacing:2px;">HR NOTIFICATION</p>
              </td>
              <td align="right">
                <span style="background:${statusLabel.bg};color:${statusLabel.color};padding:6px 14px;border-radius:20px;font-size:13px;font-weight:600;">${statusLabel.text}</span>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 20px;font-size:15px;color:#374151;">เรียน <strong>${status === 'pending' ? 'หัวหน้า' : employee.name}</strong>,</p>
          ${status === 'pending'
            ? `<p style="margin:0 0 20px;color:#6B7280;">มีคำขอลาใหม่จาก <strong>${employee.name}</strong> รอการอนุมัติ</p>`
            : `<p style="margin:0 0 20px;color:#6B7280;">คำขอลาของคุณ${statusLabel.text}แล้ว${leave.reject_reason ? `<br>เหตุผล: ${leave.reject_reason}` : ''}</p>`
          }

          <!-- Leave Details Box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border-radius:8px;border:1px solid #E2E8F0;">
            <tr><td style="padding:20px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${row('พนักงาน', employee.name)}
                ${row('ประเภทการลา', leave.leave_type_name || '-')}
                ${row('วันที่ลา', `${fmtDate(leave.start_date)} – ${fmtDate(leave.end_date)}`)}
                ${row('จำนวนวัน', `${leave.total_days} วัน`)}
                ${leave.reason ? row('เหตุผล', leave.reason) : ''}
              </table>
            </td></tr>
          </table>

          ${status === 'pending' ? `
          <p style="margin:24px 0 8px;color:#6B7280;font-size:13px;">กรุณาอนุมัติหรือปฏิเสธผ่านแอป LINE ของคุณ หรือเข้าสู่ระบบ Admin Dashboard</p>
          ` : ''}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#F8FAFC;padding:16px 32px;border-top:1px solid #E2E8F0;">
          <p style="margin:0;font-size:12px;color:#9CA3AF;text-align:center;">ส่งโดยระบบ HR อัตโนมัติ — ต่อกัน Insurance Broker</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function reminderEmailHtml(name, message) {
  return `
<!DOCTYPE html><html lang="th"><body style="font-family:sans-serif;background:#F3F4F6;padding:32px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
    <div style="background:#1357B0;padding:20px 24px;">
      <p style="margin:0;color:#fff;font-size:18px;font-weight:700;">ต่อกัน HR</p>
    </div>
    <div style="padding:24px;">
      <p>เรียน <strong>${name}</strong>,</p>
      <p style="color:#374151;">${message}</p>
    </div>
    <div style="background:#F8FAFC;padding:12px 24px;border-top:1px solid #E2E8F0;">
      <p style="margin:0;font-size:12px;color:#9CA3AF;text-align:center;">ระบบ HR อัตโนมัติ — ต่อกัน Insurance Broker</p>
    </div>
  </div>
</body></html>`;
}

function announcementEmailHtml(announcement, recipientName = '') {
  return `
<!DOCTYPE html><html lang="th"><body style="font-family:sans-serif;background:#F3F4F6;padding:32px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
    <div style="background:#1357B0;padding:20px 28px;">
      <p style="margin:0;color:rgba(255,255,255,0.7);font-size:12px;letter-spacing:2px;">ประกาศ HR</p>
      <p style="margin:4px 0 0;color:#fff;font-size:20px;font-weight:700;">${announcement.title}</p>
    </div>
    <div style="padding:24px 28px;">
      ${recipientName ? `<p>เรียน <strong>${recipientName}</strong>,</p>` : ''}
      <div style="color:#374151;line-height:1.7;">${announcement.body.replace(/\n/g, '<br>')}</div>
    </div>
    <div style="background:#F8FAFC;padding:12px 28px;border-top:1px solid #E2E8F0;">
      <p style="margin:0;font-size:12px;color:#9CA3AF;text-align:center;">ประกาศโดย HR — ต่อกัน Insurance Broker</p>
    </div>
  </div>
</body></html>`;
}

function announcementFlex(announcement) {
  return {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: '#1357B0',
      contents: [
        { type: 'text', text: '📢 ประกาศ HR', color: '#ffffff', size: 'sm' },
        { type: 'text', text: announcement.title, color: '#ffffff', size: 'lg', weight: 'bold', wrap: true },
      ],
    },
    body: {
      type: 'box', layout: 'vertical',
      contents: [{ type: 'text', text: announcement.body, wrap: true, size: 'sm', color: '#555555' }],
    },
  };
}

function row(label, value) {
  return `<tr>
    <td style="padding:5px 0;color:#6B7280;font-size:13px;width:120px;">${label}</td>
    <td style="padding:5px 0;color:#111827;font-size:13px;font-weight:500;">${value}</td>
  </tr>`;
}

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
}

module.exports = {
  leaveSubmitted,
  leaveDecision,
  checkInReminder,
  broadcastAnnouncement,
  sendEmail,
};
