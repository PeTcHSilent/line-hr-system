'use strict';
/**
 * salesBotService.js
 * AI Sales Bot สำหรับประกันรถยนต์ — ใช้ Claude API (Haiku) ผ่าน axios
 *
 * ENV required:
 *   ANTHROPIC_API_KEY   — Anthropic API key
 *
 * Functions:
 *   handleMessage(lineUserId, displayName, text)  -> replyText
 *   getLeads(filters)
 *   updateLeadStatus(id, status, notes)
 */

const axios = require('axios');
const db    = require('../db');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL             = 'claude-haiku-4-5-20251001';
const MAX_HISTORY       = 12; // จำนวน message ที่เก็บ per user

// ─────────────────────────────────────────────────────────────────
//  SYSTEM PROMPT — ประกันรถยนต์
//  อัปเดต knowledge base ได้ที่นี่ หรือโหลดจาก DB/ENV
// ─────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `
คุณคือ "น้องต่อ" ผู้ช่วยฝ่ายขายประกันรถยนต์ของบริษัทต่อกัน ประกันภัย
พูดภาษาไทยด้วยน้ำเสียงสุภาพ เป็นมิตร กระชับ ช่วยเหลือ ไม่เยิ่นเย้อ
ใช้ emoji เล็กน้อยเพื่อให้บทสนทนาดูเป็นกันเอง

== ข้อมูลประกันรถยนต์ ==

ประเภทประกัน:
- ประกันภัยชั้น 1: คุ้มครองทุกกรณี ทั้งชนเอง ชนคนอื่น ไฟไหม้ ลักทรัพย์ น้ำท่วม เหมาะสำหรับรถใหม่หรือรถที่ยังผ่อนอยู่
- ประกันภัยชั้น 2+: คุ้มครองรถเราเมื่อชนกับคู่กรณี ไฟไหม้ ลักทรัพย์ ราคาเบี้ยถูกกว่าชั้น 1
- ประกันภัยชั้น 2: คุ้มครองเฉพาะไฟไหม้และลักทรัพย์ ราคาประหยัด
- ประกันภัยชั้น 3+: คุ้มครองเมื่อชนกับคู่กรณี + อุบัติเหตุ ราคาคุ้มค่า นิยมมาก
- ประกันภัยชั้น 3: คุ้มครองเฉพาะความเสียหายต่อทรัพย์สินและชีวิตของบุคคลภายนอก
- พ.ร.บ. (ประกันภาคบังคับ): กฎหมายกำหนดให้รถทุกคันต้องมี คุ้มครองบุคคลภายนอกจากการบาดเจ็บ

แนวทางเลือกชั้นประกัน:
- รถใหม่ / ราคาสูง / ยังผ่อน → แนะนำชั้น 1
- รถอายุ 5-10 ปี → แนะนำชั้น 2+ หรือ 3+
- รถเก่า / ใช้งานประจำ → แนะนำชั้น 3+ หรือ 3

ปัจจัยที่กำหนดเบี้ยประกัน:
- ยี่ห้อและรุ่นรถ, ปีที่จดทะเบียน
- ทุนประกัน (ราคารถ)
- ประวัติการเคลม, เพศและอายุผู้ขับ
- ประเภทการใช้งาน (ส่วนตัว/พาณิชย์)

ขั้นตอนการทำประกัน:
1. แจ้งข้อมูลรถ (ยี่ห้อ รุ่น ปี เลขทะเบียน)
2. รับใบเสนอราคาเปรียบเทียบหลายบริษัท
3. เลือกแผนที่เหมาะสม ชำระเบี้ย
4. รับกรมธรรม์ภายใน 1-3 วันทำการ

== วิธีการสนทนา ==

1. ทักทายลูกค้าและถามว่าต้องการข้อมูลประกันประเภทใด
2. ถามข้อมูลรถ: ยี่ห้อ รุ่น ปีจดทะเบียน (ทีละข้อ ไม่ถามพร้อมกัน)
3. แนะนำชั้นประกันที่เหมาะสมพร้อมอธิบายความคุ้มครอง
4. เมื่อลูกค้าสนใจ ขอชื่อและเบอร์โทรเพื่อให้เจ้าหน้าที่ติดต่อกลับ
5. ยืนยันข้อมูลและแจ้งว่าเจ้าหน้าที่จะโทรกลับภายใน 24 ชั่วโมง

== สำคัญ ==
- ห้ามบอกเบี้ยประกันที่แน่นอน เนื่องจากขึ้นกับข้อมูลรถและประวัติ
- บอกเป็น "ประมาณการ" หรือ "ติดต่อกลับเพื่อเสนอราคาที่แน่นอน"
- ถ้าถามนอกเรื่องประกันรถ ให้ตอบสั้นๆ แล้วนำกลับมาเรื่องประกัน
`.trim();

// ─────────────────────────────────────────────────────────────────
//  Regex helpers
// ─────────────────────────────────────────────────────────────────
function extractPhone(text) {
  const m = text.match(/0[689]\d{8}|0[2-9]\d{7}/);
  return m ? m[0].replace(/[-\s]/g, '') : null;
}

function looksLikeName(text) {
  // ชื่อภาษาไทย หรืออังกฤษ ความยาว 2-30 ตัว ไม่มีตัวเลข
  return /^[ก-๙a-zA-Z\s.]{2,30}$/.test(text.trim()) && !/\d/.test(text);
}

// ─────────────────────────────────────────────────────────────────
//  Conversation DB helpers
// ─────────────────────────────────────────────────────────────────
async function getConversation(lineUserId) {
  try {
    const r = await db.query(
      'SELECT history, message_count, lead_captured FROM sales_conversations WHERE line_user_id = $1',
      [lineUserId]
    );
    if (!r.rows[0]) return { history: [], count: 0, leadCaptured: false };
    return {
      history:       r.rows[0].history || [],
      count:         r.rows[0].message_count || 0,
      leadCaptured:  r.rows[0].lead_captured || false,
    };
  } catch { return { history: [], count: 0, leadCaptured: false }; }
}

async function saveConversation(lineUserId, displayName, history, leadCaptured) {
  try {
    await db.query(`
      INSERT INTO sales_conversations (line_user_id, display_name, history, message_count, lead_captured, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (line_user_id) DO UPDATE
        SET history = $3, display_name = $2, message_count = $4, lead_captured = $5, updated_at = NOW()
    `, [lineUserId, displayName, JSON.stringify(history), history.length, leadCaptured]);
  } catch (e) { console.error('[salesBot] saveConversation error:', e.message); }
}

async function upsertLead(lineUserId, displayName, fields) {
  try {
    const keys   = Object.keys(fields);
    const setClauses = keys.map((k, i) => `${k} = COALESCE($${i + 3}, sales_leads.${k})`).join(', ');
    const values = [lineUserId, displayName, ...keys.map(k => fields[k])];
    await db.query(`
      INSERT INTO sales_leads (line_user_id, line_display_name, ${keys.join(', ')}, updated_at)
      VALUES ($1, $2, ${keys.map((_,i) => '$'+(i+3)).join(', ')}, NOW())
      ON CONFLICT (line_user_id) DO UPDATE
        SET line_display_name = $2, ${setClauses}, updated_at = NOW()
    `, values);
    return true;
  } catch (e) {
    console.error('[salesBot] upsertLead error:', e.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
//  Main: handleMessage
// ─────────────────────────────────────────────────────────────────
async function handleMessage(lineUserId, displayName, text) {
  if (!ANTHROPIC_API_KEY) {
    return 'ขออภัย ระบบ AI ยังไม่พร้อมใช้งาน กรุณาติดต่อเจ้าหน้าที่โดยตรงครับ';
  }

  const { history, count, leadCaptured } = await getConversation(lineUserId);

  // ── เพิ่ม user message ──
  history.push({ role: 'user', content: text });
  const trimmed = history.slice(-MAX_HISTORY);

  // ── Call Claude API ──
  let assistantText;
  try {
    const resp = await axios.post('https://api.anthropic.com/v1/messages', {
      model:      MODEL,
      max_tokens: 600,
      system:     SYSTEM_PROMPT,
      messages:   trimmed,
    }, {
      headers: {
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      timeout: 15000,
    });
    assistantText = resp.data.content[0]?.text || 'ขออภัย ไม่สามารถตอบได้ในขณะนี้';
  } catch (e) {
    console.error('[salesBot] Claude API error:', e.response?.data || e.message);
    assistantText = 'ขออภัยค่ะ ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งหรือโทร 02-XXX-XXXX เพื่อติดต่อเจ้าหน้าที่';
  }

  trimmed.push({ role: 'assistant', content: assistantText });

  // ── Auto-detect phone number → save lead ──
  let newLeadCaptured = leadCaptured;
  const phone = extractPhone(text);
  if (phone && !leadCaptured) {
    await upsertLead(lineUserId, displayName, { phone, status: 'new', interest_level: 'hot' });
    newLeadCaptured = true;
    console.log(`[salesBot] Lead captured: ${displayName} (${phone})`);
  }

  // ── Save conversation ──
  await saveConversation(lineUserId, displayName, trimmed, newLeadCaptured);

  return assistantText;
}

// ─────────────────────────────────────────────────────────────────
//  Admin: getLeads / updateLeadStatus / resetConversation
// ─────────────────────────────────────────────────────────────────
async function getLeads({ status, limit = 50, offset = 0 } = {}) {
  let where = '';
  const params = [];
  if (status) { params.push(status); where = `WHERE status = $${params.length}`; }
  params.push(limit, offset);
  const r = await db.query(
    `SELECT * FROM sales_leads ${where} ORDER BY created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,
    params
  );
  const cnt = await db.query(
    `SELECT COUNT(*) FROM sales_leads ${where}`,
    status ? [status] : []
  );
  return { leads: r.rows, total: parseInt(cnt.rows[0].count) };
}

async function updateLead(id, fields) {
  const allowed = ['status','notes','customer_name','phone','car_brand','car_model','car_year','insurance_type','interest_level','assigned_to'];
  const keys = Object.keys(fields).filter(k => allowed.includes(k));
  if (!keys.length) return null;
  const sets   = keys.map((k,i) => `${k} = $${i+2}`).join(', ');
  const values = [id, ...keys.map(k => fields[k])];
  const r = await db.query(
    `UPDATE sales_leads SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    values
  );
  return r.rows[0];
}

async function resetConversation(lineUserId) {
  await db.query('DELETE FROM sales_conversations WHERE line_user_id = $1', [lineUserId]);
}

module.exports = { handleMessage, getLeads, updateLead, resetConversation };
