const employeeService = require('../services/employeeService');
const salesBotService  = require('../services/salesBotService');
const attendanceService = require('../services/attendanceService');
const flexMessages = require('../utils/flexMessages');

// Helper: ส่ง reply ด้วย SDK v9 format
function reply(client, replyToken, messages) {
  const msgArray = Array.isArray(messages) ? messages : [messages];
  return client.replyMessage({ replyToken, messages: msgArray });
}

async function handleEvent(client, event) {
  const lineUserId = event.source.userId;

  // ตรวจสอบ "ผูก XXXXXX" ก่อนทุก handler (admin อาจเป็น employee ด้วย)
  if (event.type === 'message' && event.message?.type === 'text') {
    const rawText = event.message.text?.trim();
    if (rawText && /^ผูก\s+(\d{6})$/.test(rawText)) {
      return handleAdminLink(client, event, lineUserId, rawText);
    }
  }

  const employee = await employeeService.findByLineId(lineUserId);
  if (!employee) return handleUnregistered(client, event, lineUserId);

  switch (event.type) {
    case 'message':  return handleMessage(client, event, employee);
    case 'postback': return handlePostback(client, event, employee);
    case 'follow':   return handleFollow(client, event);
    default: return null;
  }
}

async function handleMessage(client, event, employee) {
  const text = event.message?.text?.trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  // ---- keyword matching (case-insensitive) ----
  if (lower === 'ลางาน' || lower === 'ลา')
    return reply(client, event.replyToken, flexMessages.leaveRequestForm(employee));

  if (lower === 'ot' || lower === 'ขอ ot' || lower === 'ขอot' || lower.includes('overtime') || lower === 'โอที')
    return reply(client, event.replyToken, flexMessages.otRequestForm(employee));

  if (lower === 'เช็คอิน' || lower === 'check in' || lower === 'checkin')
    return handleCheckIn(client, event, employee);

  if (lower === 'เช็คเอาท์' || lower === 'เช็คเอาต์' || lower === 'check out' || lower === 'checkout')
    return handleCheckOut(client, event, employee);

  if (lower === 'วันลาคงเหลือ' || lower === 'ยอดวันลา' || lower === 'เช็ควันลา') {
    const balance = await employeeService.getLeaveBalance(employee.id, employee.sex);
    return reply(client, event.replyToken, flexMessages.leaveBalance(employee, balance));
  }

  if (lower === 'ประวัติ ot' || lower === 'ประวัติot' || lower === 'ot history' || lower.includes('ประวัติโอที')) {
    const liffUrl = `https://liff.line.me/${process.env.LIFF_ID_OT_HISTORY || process.env.LIFF_ID_OT}`;
    return reply(client, event.replyToken, {
      type: 'text',
      text: `📋 ประวัติ OT ของคุณ${employee.name}\nกดลิงก์นี้เพื่อดู:\n${liffUrl}`
    });
  }

  if (lower === 'ประวัติการลา' || lower === 'ประวัติลา') {
    const liffUrl = `https://liff.line.me/${process.env.LIFF_ID_HISTORY}`;
    return reply(client, event.replyToken, {
      type: 'text',
      text: `📜 ประวัติการลาของคุณ${employee.name}\nกดลิงก์นี้เพื่อดู:\n${liffUrl}`
    });
  }

  if (lower === 'โปรไฟล์' || lower === 'profile' || lower === 'ข้อมูลฉัน' || lower === 'ของฉัน') {
    const liffUrl = `https://liff.line.me/${process.env.LIFF_ID_PROFILE}`;
    return reply(client, event.replyToken, {
      type: 'text',
      text: `👤 โปรไฟล์ของคุณ${employee.name}\nดูข้อมูล วันลา และ OT:\n${liffUrl}`
    });
  }

  // ── สลิปเงินเดือน ────────────────────────────────────────────
  // หน้า payslip.html มีอยู่แล้วแต่ไม่มีทางเข้าเลย — ไม่มีปุ่มใน Rich Menu
  // (เมนูเต็ม 6 ช่องแล้ว) และไม่มี keyword พนักงานจึงเปิดไม่ได้มาตลอด
  if (lower === 'สลิป' || lower === 'สลิปเงินเดือน' || lower === 'payslip' ||
      lower === 'เงินเดือน' || lower === 'ดูสลิป') {
    const id = process.env.LIFF_ID_PAYSLIP;
    if (!id) return reply(client, event.replyToken, {
      type: 'text', text: '⚠️ ระบบสลิปเงินเดือนยังไม่พร้อมใช้งาน กรุณาแจ้งฝ่ายบุคคล'
    });
    return reply(client, event.replyToken, {
      type: 'text',
      text: `💰 สลิปเงินเดือนของคุณ${employee.name}\nกดลิงก์นี้เพื่อดู:\nhttps://liff.line.me/${id}`
    });
  }

  // ── เบิกค่าใช้จ่าย ───────────────────────────────────────────
  if (lower === 'เบิก' || lower === 'เบิกเงิน' || lower === 'เบิกค่าใช้จ่าย' ||
      lower === 'expense' || lower === 'ขอเบิก' || lower === 'เคลม') {
    const id = process.env.LIFF_ID_EXPENSE;
    if (!id) return reply(client, event.replyToken, {
      type: 'text', text: '⚠️ ระบบเบิกค่าใช้จ่ายยังไม่พร้อมใช้งาน กรุณาแจ้งฝ่ายบุคคล'
    });
    return reply(client, event.replyToken, {
      type: 'text',
      text: `🧾 เบิกค่าใช้จ่าย — คุณ${employee.name}\nกดลิงก์นี้เพื่อยื่นเรื่องและดูสถานะ:\nhttps://liff.line.me/${id}`
    });
  }

  // default — ไม่ตรงกับ keyword ใดเลย
  // บอกคำสั่งที่ไม่มีปุ่มใน Rich Menu ด้วย (เมนูเต็ม 6 ช่องแล้ว ใส่เพิ่มไม่ได้)
  const extra = [];
  if (process.env.LIFF_ID_PAYSLIP) extra.push('• สลิปเงินเดือน');
  if (process.env.LIFF_ID_EXPENSE) extra.push('• เบิกค่าใช้จ่าย');

  return reply(client, event.replyToken, {
    type: 'text',
    text:
      `สวัสดีคุณ${employee.name} 👋\nใช้เมนูด้านล่างเพื่อเลือกบริการได้เลยครับ` +
      (extra.length ? `\n\nหรือพิมพ์คำสั่งเหล่านี้ (ไม่มีปุ่มในเมนู):\n${extra.join('\n')}` : '')
  });
}

// ════════════════════════════════════════════════════════════════
//  ข้อความยืนยันผลอนุมัติ (ส่งกลับให้ "หัวหน้า" ที่กดปุ่ม)
//
//  ❗ ต้องบอกว่าอนุมัติของใคร — หัวหน้ามักกดอนุมัติหลายรายการติดกัน
//     ถ้าขึ้นแค่ "อนุมัติเรียบร้อยแล้ว" เหมือนกันหมด จะแยกไม่ออกว่า
//     กดของใครไปแล้วบ้าง และถ้ากดพลาดก็ไม่รู้ตัว
// ════════════════════════════════════════════════════════════════

/** วันที่แบบไทยสั้นๆ เช่น 9 ต.ค. 69 */
function thaiDate(d) {
  if (!d) return '';
  const dt = new Date(String(d).slice(0, 10) + 'T12:00:00+07:00');
  if (isNaN(dt)) return '';
  return dt.toLocaleDateString('th-TH', {
    day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok',
  });
}

/** ตัดวินาทีออกจากเวลา 18:00:00 → 18:00 */
const hhmm = t => (t ? String(t).slice(0, 5) : '');

function otResultText(ot, approved) {
  const head = approved ? '✅ อนุมัติ OT แล้ว' : '❌ ปฏิเสธ OT แล้ว';
  if (!ot) return head;

  const when  = thaiDate(ot.ot_date);
  const time  = ot.start_time && ot.end_time ? ` ${hhmm(ot.start_time)}–${hhmm(ot.end_time)} น.` : '';
  const hours = ot.total_hours ? ` (${Number(ot.total_hours)} ชม.)` : '';

  return [
    head,
    `👤 ${ot.employee_name || 'ไม่ทราบชื่อ'}`,
    when ? `📅 ${when}${time}${hours}` : null,
  ].filter(Boolean).join('\n');
}

function leaveResultText(leave, approved) {
  const head = approved ? '✅ อนุมัติการลาแล้ว' : '❌ ปฏิเสธการลาแล้ว';
  if (!leave) return head;

  const from = thaiDate(leave.start_date);
  const to   = thaiDate(leave.end_date);
  const span = from && to ? (from === to ? from : `${from} – ${to}`) : '';
  const days = leave.total_days ? ` (${Number(leave.total_days)} วัน)` : '';
  const type = leave.leave_type_name ? `📄 ${leave.leave_type_name}` : null;

  return [
    head,
    `👤 ${leave.employee_name || 'ไม่ทราบชื่อ'}`,
    span ? `📅 ${span}${days}` : null,
    type,
  ].filter(Boolean).join('\n');
}

/** ข้อความแจ้ง "พนักงานผู้ขอ" — บอกวันที่ที่ลา ไม่ใช่เลข ID ที่ไม่สื่ออะไร */
function leaveNoticeToEmployee(leave, approved) {
  const head = approved ? '✅ คำขอลาของคุณได้รับการอนุมัติแล้ว' : '❌ คำขอลาของคุณไม่ได้รับการอนุมัติ';
  if (!leave) return head;

  const from = thaiDate(leave.start_date);
  const to   = thaiDate(leave.end_date);
  const span = from && to ? (from === to ? from : `${from} – ${to}`) : '';
  const days = leave.total_days ? ` (${Number(leave.total_days)} วัน)` : '';

  return [
    head,
    leave.leave_type_name ? `📄 ${leave.leave_type_name}` : null,
    span ? `📅 ${span}${days}` : null,
    !approved && leave.reject_reason ? `หมายเหตุ: ${leave.reject_reason}` : null,
  ].filter(Boolean).join('\n');
}

async function handlePostback(client, event, employee) {
  const data = new URLSearchParams(event.postback.data);
  const action = data.get('action');

  switch (action) {
    case 'check_in':
    case 'check_out': {
      // redirect to LIFF เพื่อให้ระบบรับ GPS ได้ถูกต้อง
      const liffCheckin = process.env.LIFF_ID_CHECKIN;
      if (!liffCheckin) {
        // fallback: ถ้าไม่มี LIFF_ID_CHECKIN ให้ checkIn แบบไม่มี GPS
        const fn = action === 'check_in' ? attendanceService.checkIn : attendanceService.checkOut;
        const result = await fn(employee.id);
        return reply(client, event.replyToken, {
          type: 'text',
          text: result.success
            ? `✅ ${action === 'check_in' ? 'เช็คอิน' : 'เช็คเอาท์'}สำเร็จ\nเวลา: ${new Date().toLocaleTimeString('th-TH')}\n⚠️ ไม่มีข้อมูล GPS (กรุณาตั้งค่า LIFF_ID_CHECKIN)`
            : `⚠️ ${result.message}`
        });
      }
      const label = action === 'check_in' ? '📍 เช็คอินพร้อม GPS' : '📍 เช็คเอาท์พร้อม GPS';
      const liffUrl = `https://liff.line.me/${liffCheckin}`;
      return reply(client, event.replyToken, {
        type: 'flex',
        altText: label,
        contents: {
          type: 'bubble', size: 'kilo',
          body: {
            type: 'box', layout: 'vertical', spacing: 'md',
            contents: [
              { type: 'text', text: '📍 ลงเวลาพร้อม GPS', weight: 'bold', size: 'md', color: '#1e293b' },
              { type: 'text', text: `${employee.name} กรุณากดปุ่มด้านล่างเพื่อ${action === 'check_in' ? 'เช็คอิน' : 'เช็คเอาท์'} — ระบบจะบันทึกตำแหน่ง GPS โดยอัตโนมัติ`, wrap: true, size: 'sm', color: '#64748b' }
            ]
          },
          footer: {
            type: 'box', layout: 'vertical',
            contents: [{
              type: 'button', style: 'primary',
              color: action === 'check_in' ? '#22c55e' : '#f59e0b',
              action: { type: 'uri', label, uri: liffUrl }
            }]
          }
        }
      });
    }

    case 'open_ot_form':
      return reply(client, event.replyToken, flexMessages.otRequestForm(employee));

    case 'approve_ot': {
      const otId = data.get('ot_id');
      const otService = require('../services/otService');
      try {
        const ot = await otService.updateOTStatus(parseInt(otId), 'approved', employee.id);
        if (ot?.employee_line_id) {
          await client.pushMessage({
            to: ot.employee_line_id,
            messages: [flexMessages.otStatusUpdate(ot, 'approved')]
          }).catch(() => {});
        }
        return reply(client, event.replyToken, { type: 'text', text: otResultText(ot, true) });
      } catch (err) {
        return reply(client, event.replyToken, { type: 'text', text: `⚠️ ${err.message}` });
      }
    }

    case 'reject_ot': {
      const otId = data.get('ot_id');
      const otService = require('../services/otService');
      try {
        const ot = await otService.updateOTStatus(parseInt(otId), 'rejected', employee.id);
        if (ot?.employee_line_id) {
          await client.pushMessage({
            to: ot.employee_line_id,
            messages: [flexMessages.otStatusUpdate(ot, 'rejected')]
          }).catch(() => {});
        }
        return reply(client, event.replyToken, { type: 'text', text: otResultText(ot, false) });
      } catch (err) {
        return reply(client, event.replyToken, { type: 'text', text: `⚠️ ${err.message}` });
      }
    }

    case 'approve_leave': {
      const leaveId = data.get('leave_id');
      const leaveService = require('../services/leaveService');
      try {
        const leave = await leaveService.updateLeaveStatus(leaveId, 'approved', employee.id);
        if (leave?.employee_line_id) {
          await client.pushMessage({
            to: leave.employee_line_id,
            messages: [{ type: 'text', text: leaveNoticeToEmployee(leave, true) }]
          }).catch(() => {});
        }
        return reply(client, event.replyToken, { type: 'text', text: leaveResultText(leave, true) });
      } catch (err) {
        return reply(client, event.replyToken, { type: 'text', text: `⚠️ ${err.message}` });
      }
    }

    case 'reject_leave': {
      const leaveId = data.get('leave_id');
      const leaveService = require('../services/leaveService');
      try {
        const leave = await leaveService.updateLeaveStatus(leaveId, 'rejected', employee.id, 'ไม่อนุมัติ');
        if (leave?.employee_line_id) {
          await client.pushMessage({
            to: leave.employee_line_id,
            messages: [{ type: 'text', text: leaveNoticeToEmployee(leave, false) }]
          }).catch(() => {});
        }
        return reply(client, event.replyToken, { type: 'text', text: leaveResultText(leave, false) });
      } catch (err) {
        return reply(client, event.replyToken, { type: 'text', text: `⚠️ ${err.message}` });
      }
    }

    default: return null;
  }
}

async function handleAdminLink(client, event, lineUserId, text) {
  const code = text.match(/^ผูก\s+(\d{6})$/)[1];
  try {
    const settingsService = require('../services/settingsService');
    const stored = await settingsService.get('admin_link_code');
    if (!stored) {
      return reply(client, event.replyToken, { type:'text', text:'❌ ไม่พบรหัสเชื่อมต่อ กรุณาสร้างรหัสใหม่ในหน้า Admin Profile' });
    }
    const { code: savedCode, expiry } = JSON.parse(stored);
    if (Date.now() > expiry) {
      return reply(client, event.replyToken, { type:'text', text:'⏰ รหัสหมดอายุแล้ว กรุณาสร้างรหัสใหม่ในหน้า Admin Profile' });
    }
    if (code !== savedCode) {
      return reply(client, event.replyToken, { type:'text', text:'❌ รหัสไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง' });
    }
    let displayName = 'Admin';
    try { const profile = await client.getProfile(lineUserId); displayName = profile.displayName || 'Admin'; } catch {}
    const db = require('../db');
    // สร้าง table ถ้ายังไม่มี (auto-migrate)
    await db.query(`
      CREATE TABLE IF NOT EXISTS admin_line_users (
        id            SERIAL PRIMARY KEY,
        line_user_id  VARCHAR(100) NOT NULL UNIQUE,
        display_name  VARCHAR(200) NOT NULL DEFAULT 'Admin',
        linked_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    // บันทึกลง admin_line_users (รองรับหลายคน)
    await db.query(
      `INSERT INTO admin_line_users (line_user_id, display_name, linked_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (line_user_id) DO UPDATE SET display_name=$2, linked_at=NOW()`,
      [lineUserId, displayName]
    );
    await db.query("DELETE FROM company_settings WHERE key='admin_link_code'");
    return reply(client, event.replyToken, {
      type:'text',
      text:`✅ เชื่อมต่อ LINE Admin สำเร็จ!
👤 ${displayName}

ท่านจะได้รับการแจ้งเตือนจากระบบ HR โดยตรงแล้วครับ 🎉`
    });
  } catch (err) {
    return reply(client, event.replyToken, { type:'text', text:`❌ เกิดข้อผิดพลาด: ${err.message}` });
  }
}

async function handleUnregistered(client, event, lineUserId) {
  if (event.type !== 'message') return null;
  const text = event.message?.text?.trim();

  // รองรับรหัส TK001
  if (text && /^TK\d+$/i.test(text)) {
    try {
      const result = await employeeService.linkLineAccount(text.toUpperCase(), lineUserId);

      // ไม่พบรหัสพนักงาน
      if (!result) {
        return reply(client, event.replyToken, {
          type: 'text',
          text: `❌ ไม่พบรหัสพนักงาน "${text.toUpperCase()}"\nกรุณาตรวจสอบรหัสและลองใหม่อีกครั้ง`
        });
      }

      // LINE account นี้ผูกอยู่กับรหัสเดิมแล้ว (re-register ซ้ำ)
      if (result.alreadyLinked && result.sameEmployee) {
        return reply(client, event.replyToken, {
          type: 'text',
          text: `✅ คุณได้ลงทะเบียนรหัส ${text.toUpperCase()} ไว้แล้ว\nยินดีต้อนรับ คุณ${result.employee.name} 👋`
        });
      }

      // LINE account นี้ถูกผูกกับพนักงานคนอื่นอยู่
      if (result.alreadyLinked && !result.sameEmployee) {
        return reply(client, event.replyToken, {
          type: 'text',
          text: `⚠️ LINE นี้ถูกผูกกับรหัสพนักงานอื่นอยู่แล้ว\nหากมีปัญหากรุณาติดต่อ HR เพื่อแก้ไข`
        });
      }

      // รหัสพนักงานนี้ถูก link กับ LINE อื่นอยู่แล้ว
      if (result.codeAlreadyLinked) {
        return reply(client, event.replyToken, {
          type: 'text',
          text: `⚠️ รหัสพนักงาน "${text.toUpperCase()}" ถูกผูกกับ LINE อื่นไปแล้ว\nหากเป็นของคุณกรุณาติดต่อ HR เพื่อให้ยกเลิกการเชื่อมและลงทะเบียนใหม่`
        });
      }

      // ผูกสำเร็จ
      return reply(client, event.replyToken, {
        type: 'text',
        text: `✅ ลงทะเบียนสำเร็จ!\nยินดีต้อนรับ คุณ${result.employee.name} 🎉\n\nพิมพ์ข้อความหรือใช้เมนูด้านล่างได้เลยครับ`
      });
    } catch (err) {
      return reply(client, event.replyToken, {
        type: 'text',
        text: `❌ เกิดข้อผิดพลาด: ${err.message}`
      });
    }
  }


  // ── ไม่ใช่พนักงาน → Sales Bot ──
  if (event.type === 'message' && event.message?.type === 'text' && text) {
    try {
      let displayName = 'ลูกค้า';
      try { const p = await client.getProfile(lineUserId); displayName = p.displayName || 'ลูกค้า'; } catch {}
      const botReply = await salesBotService.handleMessage(lineUserId, displayName, text);
      return reply(client, event.replyToken, { type: 'text', text: botReply });
    } catch (err) {
      console.error('[salesBot] error:', err.message);
      return reply(client, event.replyToken, { type: 'text', text: 'ขออภัยค่ะ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง' });
    }
  }
  return null;
}

async function handleFollow(client, event) {
  const lineUserId = event.source?.userId;

  // ── หา employee จาก line_user_id ที่ผูกไว้แล้ว ──────────────────
  // ❗ จุดที่เคยพลาด: findByLineId จะเจอก็ต่อเมื่อ "ผูกบัญชีแล้ว"
  //    โค้ดเดิมจึงกลับด้านกัน —
  //      คนที่ผูกแล้ว  → ได้ข้อความ "กรุณาพิมพ์รหัสพนักงาน" (ทำไปแล้ว ไม่ต้องทำซ้ำ)
  //      พนักงานใหม่   → ตกไปได้ข้อความต้อนรับของ Sales Bot ฝั่งลูกค้า
  //                      ไม่มีใครบอกเลยว่าต้องพิมพ์ TK001
  let employee = null;
  try {
    employee = lineUserId ? await employeeService.findByLineId(lineUserId) : null;
  } catch {}

  if (employee) {
    // ผูกบัญชีไว้แล้ว — ต้อนรับกลับ ไม่ต้องให้พิมพ์รหัสอีก
    return reply(client, event.replyToken, {
      type: 'text',
      text:
        `🎉 ยินดีต้อนรับกลับ คุณ${employee.name}\n\n` +
        'บัญชีของคุณผูกกับระบบ HR เรียบร้อยแล้ว\n' +
        'ใช้เมนูด้านล่างจอได้เลย — ลางาน ขอ OT เช็คอิน ดูวันลาคงเหลือ\n\n' +
        'ถ้าเมนูไม่ขึ้น ให้ปิดแชทแล้วเปิดใหม่',
    });
  }

  // ── ยังไม่ผูกบัญชี — แยกไม่ออกว่าเป็นลูกค้าหรือพนักงานใหม่ ──────
  // ส่วนใหญ่คือลูกค้า จึงใช้ข้อความ Sales Bot เป็นหลัก
  // แต่ต่อท้ายด้วยคำแนะนำสำหรับพนักงานใหม่ ไม่งั้นจะไม่มีทางรู้ว่าต้องพิมพ์รหัส
  const staffHint = {
    type: 'text',
    text:
      '👔 ถ้าคุณเป็นพนักงานต่อกัน\n' +
      'พิมพ์รหัสพนักงานของคุณเพื่อเริ่มใช้งานระบบ HR\n' +
      'ตัวอย่าง: TK001\n\n' +
      '(พิมพ์เฉพาะรหัส ไม่ต้องพิมพ์คำอื่น — ถ้าไม่ทราบรหัส สอบถามฝ่ายบุคคล)',
  };

  // ข้อความต้อนรับลูกค้า (Sales Bot)
  let displayName = 'ลูกค้า';
  try { const p = await client.getProfile(lineUserId); displayName = p.displayName || 'ลูกค้า'; } catch {}

  const welcomeMsg = {
    type: 'flex',
    altText: '👋 ยินดีต้อนรับสู่ต่อกัน ประกันภัย!',
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: '#1a56db', paddingAll: '16px',
        contents: [
          { type: 'text', text: '🚗 ต่อกัน ประกันภัย', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: 'ประกันรถยนต์ครบทุกประเภท', color: '#bfdbfe', size: 'sm', margin: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: [
          { type: 'text', text: `สวัสดีคุณ${displayName} 👋`, weight: 'bold', size: 'md' },
          { type: 'text', text: 'น้องต่อพร้อมให้คำปรึกษาประกันรถยนต์แบบ 1:1 ทันที!', wrap: true, size: 'sm', color: '#374151' },
          { type: 'separator', margin: 'md' },
          {
            type: 'box', layout: 'vertical', spacing: 'sm', margin: 'md',
            contents: [
              { type: 'text', text: '✅ ประกันชั้น 1, 2+, 3+', size: 'sm', color: '#374151' },
              { type: 'text', text: '✅ เปรียบเทียบราคาหลายบริษัท', size: 'sm', color: '#374151' },
              { type: 'text', text: '✅ ต่ออายุ / ซื้อใหม่ รวดเร็ว', size: 'sm', color: '#374151' },
              { type: 'text', text: '✅ มีทีมงานดูแลตลอด 24 ชม.', size: 'sm', color: '#374151' },
            ],
          },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: [
          {
            type: 'button',
            style: 'primary', color: '#1a56db',
            action: { type: 'message', label: '💬 ขอคำแนะนำประกัน', text: 'ต้องการคำแนะนำประกันรถยนต์' },
          },
          {
            type: 'button',
            style: 'secondary',
            action: { type: 'message', label: '💰 เช็คราคาเบี้ย', text: 'ต้องการเช็คราคาเบี้ยประกัน' },
          },
        ],
      },
    },
  };

  return reply(client, event.replyToken, [welcomeMsg, staffHint]);
}

async function handleCheckIn(client, event, employee) {
  const liffCheckin = process.env.LIFF_ID_CHECKIN;
  if (!liffCheckin) {
    // fallback ไม่มี LIFF_ID_CHECKIN
    const result = await attendanceService.checkIn(employee.id);
    const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    return reply(client, event.replyToken, {
      type: 'text',
      text: result.success
        ? `✅ เช็คอินสำเร็จ!\n👤 ${employee.name}\n🕐 ${now}\n⚠️ ไม่มีข้อมูล GPS`
        : `⚠️ ${result.message}`
    });
  }
  return reply(client, event.replyToken, {
    type: 'flex', altText: '📍 เช็คอินพร้อม GPS',
    contents: {
      type: 'bubble', size: 'kilo',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: '📍 เช็คอินพร้อม GPS', weight: 'bold', size: 'md', color: '#1e293b' },
          { type: 'text', text: `${employee.name} กรุณากดปุ่มด้านล่างเพื่อเช็คอิน — ระบบจะบันทึกตำแหน่ง GPS โดยอัตโนมัติ`, wrap: true, size: 'sm', color: '#64748b' }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'primary', color: '#22c55e',
          action: { type: 'uri', label: '📍 เช็คอินพร้อม GPS', uri: `https://liff.line.me/${liffCheckin}` }
        }]
      }
    }
  });
}

async function handleCheckOut(client, event, employee) {
  const liffCheckin = process.env.LIFF_ID_CHECKIN;
  if (!liffCheckin) {
    const result = await attendanceService.checkOut(employee.id);
    const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    return reply(client, event.replyToken, {
      type: 'text',
      text: result.success
        ? `✅ เช็คเอาท์สำเร็จ!\n👤 ${employee.name}\n🕐 ${now}\n⚠️ ไม่มีข้อมูล GPS`
        : `⚠️ ${result.message}`
    });
  }
  return reply(client, event.replyToken, {
    type: 'flex', altText: '📍 เช็คเอาท์พร้อม GPS',
    contents: {
      type: 'bubble', size: 'kilo',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: '📍 เช็คเอาท์พร้อม GPS', weight: 'bold', size: 'md', color: '#1e293b' },
          { type: 'text', text: `${employee.name} กรุณากดปุ่มด้านล่างเพื่อเช็คเอาท์ — ระบบจะบันทึกตำแหน่ง GPS โดยอัตโนมัติ`, wrap: true, size: 'sm', color: '#64748b' }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'primary', color: '#f59e0b',
          action: { type: 'uri', label: '📍 เช็คเอาท์พร้อม GPS', uri: `https://liff.line.me/${liffCheckin}` }
        }]
      }
    }
  });
}

module.exports = { handleEvent };
