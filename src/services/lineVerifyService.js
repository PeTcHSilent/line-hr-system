'use strict';
/**
 * lineVerifyService.js — ยืนยันตัวตนพนักงานที่เปิดหน้า LIFF
 *
 * ═══ ปัญหาเดิม ═══
 *   หน้า LIFF ส่ง line_user_id มาทาง query string / body แล้วเซิร์ฟเวอร์เชื่อทันที
 *   → ใครรู้ LINE User ID ของเพื่อนร่วมงาน ก็ยิง API ได้ว่าเป็นคนนั้น
 *     เช็คอินแทนกันได้ ดูสลิปเงินเดือนคนอื่นได้ ดูประวัติการลาคนอื่นได้
 *   LINE User ID ไม่ใช่ความลับระดับรหัสผ่าน — มันโผล่ใน log, ใน URL, ใน DevTools
 *
 * ═══ วิธีที่ถูก ═══
 *   ให้หน้า LIFF ส่ง "ID Token" (liff.getIDToken()) มาแทน
 *   เซิร์ฟเวอร์เอาไปให้ LINE ตรวจ แล้ว LINE คืน User ID ที่เชื่อถือได้
 *   token นี้ปลอมเองไม่ได้ เพราะ LINE เซ็น และผูกกับ LINE Login channel ของเรา
 *
 * ═══ env ที่ต้องตั้ง ═══
 *   LINE_LOGIN_CHANNEL_ID
 *     = Channel ID ของ LINE Login channel ที่ LIFF app ผูกอยู่
 *       (LINE Developers → LINE Login channel → Basic settings → Channel ID)
 *     ❗ ไม่ใช่ Channel ID ของ Messaging API — คนละตัวกัน
 *     ❗ LIFF app ต้องเปิด scope "openid" ด้วย ไม่งั้น getIDToken() คืน null
 *
 *   LIFF_REQUIRE_ID_TOKEN = 1
 *     เปิดโหมดบังคับ: request ที่ไม่มี ID Token จะถูกปฏิเสธ 401
 *
 * ═══ ทำไมต้องมีสวิตช์ LIFF_REQUIRE_ID_TOKEN ═══
 *   ถ้าบังคับทันทีตอน deploy จะล็อกพนักงานออกทั้งบริษัท เพราะ
 *     (1) env LINE_LOGIN_CHANNEL_ID อาจยังไม่ได้ตั้ง
 *     (2) LIFF app อาจยังไม่ได้เปิด scope openid
 *     (3) in-app browser ของ LINE cache หน้าเว็บเก่าไว้ ยังไม่ส่ง token
 *   จึงแบ่งเป็น 2 ขั้น:
 *     ขั้นที่ 1 (ค่าเริ่มต้น) — token ที่ "ส่งมาแล้วผิด" ปฏิเสธเสมอ
 *                              แต่ถ้า "ไม่ส่งมาเลย" ยอมใช้ line_user_id เดิมไปก่อน
 *                              พร้อมขึ้น warning ใน log ทุกครั้ง
 *     ขั้นที่ 2 (ตั้ง LIFF_REQUIRE_ID_TOKEN=1) — ไม่มี token = ปฏิเสธ ปิดช่องโหว่สนิท
 *   ให้ตั้งขั้นที่ 2 หลัง deploy แล้วเช็ค log ว่าไม่มี warning เหลือแล้ว
 */

const axios = require('axios');

const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';

// ── cache ผลที่ตรวจแล้ว ───────────────────────────────────────
// พนักงานเปิดหน้า LIFF หน้าเดียวยิง API 3-4 ครั้ง ไม่ควรไปถาม LINE ทุกครั้ง
const _cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheGet(token) {
  const hit = _cache.get(token);
  if (!hit) return null;
  if (Date.now() > hit.expireAt) { _cache.delete(token); return null; }
  return hit.userId;
}

function cacheSet(token, userId, tokenExpSec) {
  if (_cache.size > 500) _cache.clear();   // กันหน่วยความจำบวม
  const tokenExpireAt = tokenExpSec ? tokenExpSec * 1000 : Infinity;
  _cache.set(token, {
    userId,
    expireAt: Math.min(Date.now() + CACHE_TTL_MS, tokenExpireAt),
  });
}

const isStrict = () => process.env.LIFF_REQUIRE_ID_TOKEN === '1';

// ขึ้น warning แบบหน่วงเวลา — ไม่ให้ท่วม log ถ้ามีคนใช้เยอะ
let _lastWarnAt = 0;
function warnUnverified(req) {
  const now = Date.now();
  if (now - _lastWarnAt < 60_000) return;
  _lastWarnAt = now;
  console.warn(
    `[lineVerify] ⚠️  ${req.method} ${req.path} ไม่ได้ส่ง ID Token — ` +
    'ยังเชื่อ line_user_id ดิบอยู่ (โหมดผ่อนผัน) ' +
    'ตั้ง LIFF_REQUIRE_ID_TOKEN=1 เพื่อปิดช่องนี้'
  );
}

/**
 * ตรวจ ID Token กับ LINE แล้วคืน LINE User ID ที่เชื่อถือได้
 * @param {string} idToken  ค่าจาก liff.getIDToken()
 * @returns {Promise<{ userId: string, name?: string, picture?: string }>}
 */
async function verifyIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string' || idToken.length < 20) {
    const e = new Error('ไม่พบ ID Token'); e.status = 401; throw e;
  }

  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!channelId) {
    console.error('[lineVerify] ยังไม่ได้ตั้ง env LINE_LOGIN_CHANNEL_ID — ตรวจ token ไม่ได้');
    const e = new Error('ระบบยังตั้งค่าไม่ครบ กรุณาแจ้งฝ่ายบุคคล'); e.status = 503; throw e;
  }

  const cached = cacheGet(idToken);
  if (cached) return { userId: cached, cached: true };

  let data;
  try {
    const r = await axios.post(
      VERIFY_URL,
      new URLSearchParams({ id_token: idToken, client_id: channelId }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 }
    );
    data = r.data;
  } catch (err) {
    const detail = err.response?.data?.error_description || err.response?.data?.error || err.message;
    console.warn('[lineVerify] token ไม่ผ่าน:', detail);
    const e = new Error('ยืนยันตัวตนไม่สำเร็จ กรุณาปิดหน้านี้แล้วเปิดใหม่จากเมนูใน LINE');
    e.status = 401;
    throw e;
  }

  // LINE ตรวจลายเซ็น + วันหมดอายุ + client_id มาให้แล้ว — เช็ค aud ซ้ำกันพลาด
  if (data.aud !== channelId) {
    console.warn('[lineVerify] aud ไม่ตรงกับ channel ของเรา:', data.aud);
    const e = new Error('ยืนยันตัวตนไม่สำเร็จ'); e.status = 401; throw e;
  }
  if (!data.sub) {
    const e = new Error('ยืนยันตัวตนไม่สำเร็จ'); e.status = 401; throw e;
  }

  cacheSet(idToken, data.sub, data.exp);
  return { userId: data.sub, name: data.name, picture: data.picture };
}

function readToken(req) {
  return req.get?.('X-Line-Id-Token') || req.body?.id_token || req.query?.id_token || null;
}

/**
 * middleware สำหรับ endpoint ฝั่งพนักงาน (LIFF)
 *
 * สิ่งที่ทำ:
 *   - มี token → ตรวจกับ LINE แล้ว "ทับ" ค่า line_user_id ใน query/body
 *     ด้วย ID ที่ตรวจแล้ว → handler เดิมใช้ต่อได้เลยโดยไม่ต้องแก้
 *   - token ผิด → 401 ทุกกรณี (แม้โหมดผ่อนผัน)
 *   - ไม่มี token → strict: 401 | ผ่อนผัน: ใช้ค่าเดิม + warning
 */
async function resolveLineUser(req, res, next) {
  const token = readToken(req);

  if (!token) {
    if (isStrict()) {
      return res.status(401).json({
        error: 'กรุณาเปิดหน้านี้จากเมนูในแอป LINE เพื่อยืนยันตัวตน',
      });
    }
    warnUnverified(req);
    req.lineUserId = req.query?.line_user_id || req.body?.line_user_id || null;
    req.lineVerified = false;
    return next();
  }

  try {
    const { userId, name, picture } = await verifyIdToken(token);

    // ❗ จุดสำคัญ: ทับค่าที่ client ส่งมา ไม่ว่าจะส่งมาเป็นอะไร
    //    ถ้ามีคนแก้ line_user_id ใน DevTools ค่านั้นจะถูกโยนทิ้งที่นี่
    if (req.query && 'line_user_id' in req.query) req.query.line_user_id = userId;
    if (req.body  && typeof req.body === 'object')  req.body.line_user_id  = userId;

    req.lineUserId   = userId;
    req.lineProfile  = { name, picture };
    req.lineVerified = true;
    next();
  } catch (e) {
    res.status(e.status || 401).json({ error: e.message });
  }
}

/** เวอร์ชันบังคับเสมอ — ใช้กับ endpoint ที่อ่อนไหวเป็นพิเศษ เช่น สลิปเงินเดือน */
async function requireLineUser(req, res, next) {
  const token = readToken(req);
  if (!token) {
    if (!isStrict()) { warnUnverified(req); return resolveLineUser(req, res, next); }
    return res.status(401).json({ error: 'กรุณาเปิดหน้านี้จากเมนูในแอป LINE เพื่อยืนยันตัวตน' });
  }
  return resolveLineUser(req, res, next);
}

module.exports = { verifyIdToken, resolveLineUser, requireLineUser };
