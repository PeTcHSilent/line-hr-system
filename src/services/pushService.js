'use strict';
/**
 * pushService.js — ส่ง LINE push แบบ "รู้ว่าพลาดเพราะอะไร"
 *
 * ❗ ทำไมต้องมีไฟล์นี้
 *   เดิมทุกจุดที่ส่งแจ้งเตือนเขียนแบบนี้:
 *       client.pushMessage({...}).catch(() => {})
 *   ซึ่งกลืน error ทิ้งหมด พอแอดมินบอกว่า "กดลาแล้วไม่มีแจ้งเตือน"
 *   จึงไม่มีทางรู้เลยว่าเป็นเพราะ token ผิด / ไม่มีรายชื่อแอดมิน /
 *   แอดมินยังไม่ได้แอด OA เป็นเพื่อน / หรือ LINE ปฏิเสธด้วยเหตุอื่น
 *   ต้องไล่เดาทีละข้อ ซึ่งเสียเวลาและมักเดาผิด
 *
 *   ไฟล์นี้ยังไม่ทำให้ระบบพังเมื่อส่งไม่ได้ (เจตนาเดิมถูกแล้ว —
 *   ส่งแจ้งเตือนไม่ได้ ไม่ควรทำให้บันทึกใบลาล้มเหลว)
 *   แต่เปลี่ยนจาก "เงียบ" เป็น "เงียบต่อผู้ใช้ แต่ดังใน log"
 */

const line = require('@line/bot-sdk');

const TOKEN = () => process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

function client() {
  return new line.messagingApi.MessagingApiClient({ channelAccessToken: TOKEN() });
}

/**
 * แปลง error จาก LINE SDK เป็นข้อความที่คนอ่านแล้วรู้ว่าต้องไปแก้ตรงไหน
 *
 * ❗ ข้อความต้องบอก "วิธีแก้" ไม่ใช่แค่ "รหัสข้อผิดพลาด"
 *   403 ลอย ๆ ไม่ช่วยอะไร แต่ "แอดมินคนนี้ยังไม่ได้แอด OA เป็นเพื่อน"
 *   บอกได้ทันทีว่าต้องทำอะไรต่อ
 */
function explain(err) {
  const status = err?.status ?? err?.statusCode ?? err?.response?.status ?? null;
  const body   = err?.body ?? err?.response?.data ?? null;
  const detail = body?.message || body?.details?.[0]?.message || err?.message || 'ไม่ทราบสาเหตุ';

  let reason;
  switch (status) {
    case 400:
      reason = `ข้อความหรือ User ID ไม่ถูกต้อง — ${detail}`;
      break;
    case 401:
      reason = 'LINE_CHANNEL_ACCESS_TOKEN ไม่ถูกต้องหรือหมดอายุ — ต้องตั้งค่าใหม่ใน Railway';
      break;
    case 403:
      // เคสที่เจอบ่อยที่สุด และคนมักไม่นึกถึง
      reason = 'ส่งไม่ได้ — คนรับยังไม่ได้เพิ่ม LINE OA ของระบบ HR เป็นเพื่อน ' +
               'หรือ User ID นี้เป็นของ LINE OA คนละตัว (User ID ผูกกับ OA แต่ละตัว ใช้ข้ามกันไม่ได้)';
      break;
    case 404:
      reason = 'ไม่พบผู้ใช้รายนี้ใน LINE OA ตัวนี้ — User ID อาจมาจาก OA เดิมที่เลิกใช้แล้ว';
      break;
    case 429:
      reason = 'ส่งเกินโควตาของ LINE เดือนนี้ — ต้องรอรอบถัดไปหรืออัปเกรดแพ็กเกจ';
      break;
    default:
      reason = `LINE ตอบกลับผิดพลาด${status ? ' (' + status + ')' : ''} — ${detail}`;
  }
  return { status, reason, detail };
}

/**
 * ส่ง push ไปหลายคน
 *
 * @param targets  อาเรย์ของ LINE User ID
 * @param messages อาเรย์ข้อความ (รูปแบบ Messaging API)
 * @param context  คำอธิบายสั้น ๆ ว่าแจ้งเรื่องอะไร ใช้ตอนเขียน log
 * @returns {{sent:number, failed:Array<{to:string,status:number|null,reason:string}>}}
 */
async function pushTo(targets, messages, context = 'แจ้งเตือน') {
  const list = [...new Set((targets || []).filter(Boolean))];

  if (!TOKEN()) {
    console.error(`[push] ❌ ${context}: ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN — ไม่ได้ส่งให้ใครเลย`);
    return { sent: 0, failed: list.map(to => ({ to, status: null, reason: 'ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN' })) };
  }

  if (!list.length) {
    // ❗ ไม่ใช่ error แต่ต้องดัง เพราะนี่คือสาเหตุอันดับหนึ่งของ "ไม่มีแจ้งเตือน"
    console.warn(`[push] ⚠️ ${context}: ไม่มีผู้รับเลย — ตรวจว่ามีรายชื่อในหน้า "Admin LINE" หรือยัง`);
    return { sent: 0, failed: [] };
  }

  const c = client();
  const results = await Promise.all(list.map(async to => {
    try {
      await c.pushMessage({ to, messages });
      return { to, ok: true };
    } catch (e) {
      const { status, reason, detail } = explain(e);
      console.error(`[push] ❌ ${context} → ${to}: ${reason}` +
                    (detail && detail !== reason ? ` | ${detail}` : ''));
      return { to, ok: false, status, reason };
    }
  }));

  const sent   = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).map(({ to, status, reason }) => ({ to, status, reason }));

  if (sent) console.log(`[push] ✅ ${context}: ส่งสำเร็จ ${sent}/${list.length}`);
  return { sent, failed };
}

/**
 * ตรวจว่า token ใช้ได้ไหม + เป็น OA ตัวไหน
 * ❗ ใช้ตอบคำถาม "ระบบส่งแจ้งเตือนออกจาก LINE OA ตัวไหนกันแน่"
 *   ซึ่งสำคัญมากตอนบริษัทเปลี่ยน OA แล้วลืมอัปเดตฝั่ง HR
 */
async function botInfo() {
  if (!TOKEN()) return { ok: false, error: 'ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN' };
  try {
    const r = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: 'Bearer ' + TOKEN() },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      return {
        ok: false,
        error: r.status === 401
          ? 'Token ไม่ถูกต้องหรือหมดอายุ — ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN ใหม่ใน Railway'
          : `LINE ตอบ ${r.status}: ${d.message || ''}`,
      };
    }
    return {
      ok: true,
      basic_id: d.basicId || null,          // เช่น @123abcde
      display_name: d.displayName || null,
      picture_url: d.pictureUrl || null,
      premium_id: d.premiumId || null,
    };
  } catch (e) {
    return { ok: false, error: 'ติดต่อ LINE API ไม่ได้: ' + e.message };
  }
}

/**
 * โควตาข้อความของเดือนนี้ — เหลือเท่าไหร่
 *
 * ❗ ทำไมต้องมี: "ส่งแจ้งเตือนไม่ออก" กับ "โควตาหมด" แยกกันไม่ออกถ้าไม่ถาม LINE
 *   และเป็นสาเหตุที่คนมักนึกไม่ถึงเพราะบอทยัง "ตอบ" ในแชทได้ปกติ
 *
 * ❗ ความต่างที่ทำให้สับสนมากที่สุด:
 *   · Reply message (บอทตอบกลับข้อความที่ลูกค้าพิมพ์มา) — ฟรี ไม่จำกัด ไม่นับโควตา
 *   · Push message  (ระบบส่งหาเองโดยไม่มีใครทัก เช่นแจ้งเตือน OT/ลา) — นับโควตา
 *   โควตาหมดจึงเห็นอาการว่า "พิมพ์คุยกับบอทได้ แต่แจ้งเตือนไม่เข้า"
 *   ซึ่งดูเหมือนระบบพังทั้งที่ LINE แค่ไม่ให้ส่ง push แล้ว
 */
async function quota() {
  if (!TOKEN()) return { ok: false, error: 'ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN' };
  try {
    const h = { Authorization: 'Bearer ' + TOKEN() };
    const [qRes, cRes] = await Promise.all([
      fetch('https://api.line.me/v2/bot/message/quota', { headers: h }),
      fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers: h }),
    ]);

    if (!qRes.ok) {
      const d = await qRes.json().catch(() => ({}));
      return { ok: false, error: `อ่านโควตาไม่ได้ (${qRes.status}) ${d.message || ''}`.trim() };
    }

    const q = await qRes.json();
    const c = cRes.ok ? await cRes.json().catch(() => ({})) : {};
    const used = Number(c.totalUsage ?? 0);

    // type:'none' = แพ็กเกจไม่จำกัดจำนวน — ไม่ต้องห่วงเรื่องโควตา
    if (q.type === 'none') {
      return { ok: true, unlimited: true, used, limit: null, remaining: null };
    }

    const limit = Number(q.value ?? 0);
    const remaining = Math.max(0, limit - used);
    return {
      ok: true,
      unlimited: false,
      used, limit, remaining,
      exhausted: remaining <= 0,
      // ❗ เตือนล่วงหน้า ไม่ใช่รอจนหมดแล้วค่อยรู้ตอนแจ้งเตือนไม่เข้า
      low: limit > 0 && remaining / limit <= 0.1,
    };
  } catch (e) {
    return { ok: false, error: 'ติดต่อ LINE API ไม่ได้: ' + e.message };
  }
}

/**
 * ตรวจว่า User ID นี้ "รับข้อความจาก OA ตัวนี้ได้จริงไหม" โดยไม่ต้องส่งข้อความรบกวน
 *
 * ❗ ใช้ getProfile แทนการยิงข้อความทดสอบ
 *   เพราะการเช็คความถูกต้องไม่ควรทำให้แอดมินได้ข้อความขยะทุกครั้ง
 *   getProfile จะพังด้วย 404 ถ้าคนนั้นยังไม่ได้แอด OA เป็นเพื่อน
 *   ซึ่งตรงกับเงื่อนไขที่ทำให้ pushMessage ส่งไม่ได้พอดี
 */
async function canReceive(lineUserId) {
  if (!TOKEN()) return { ok: false, reason: 'ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN' };
  try {
    const r = await fetch('https://api.line.me/v2/bot/profile/' + encodeURIComponent(lineUserId), {
      headers: { Authorization: 'Bearer ' + TOKEN() },
    });
    if (r.ok) {
      const d = await r.json().catch(() => ({}));
      return { ok: true, display_name: d.displayName || null, picture_url: d.pictureUrl || null };
    }
    const d = await r.json().catch(() => ({}));
    return { ok: false, ...explain({ status: r.status, body: d }) };
  } catch (e) {
    return { ok: false, reason: 'ติดต่อ LINE API ไม่ได้: ' + e.message };
  }
}

module.exports = { pushTo, botInfo, quota, canReceive, explain, client };
