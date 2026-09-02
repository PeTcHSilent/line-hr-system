'use strict';
/**
 * salesBotService.js
 * AI Sales Bot สำหรับประกันรถยนต์ — ใช้ Claude API (Haiku) ผ่าน axios
 *
 * ENV required:
 *   ANTHROPIC_API_KEY   — Anthropic API key
 *   LINE_CHANNEL_ACCESS_TOKEN
 *
 * Functions:
 *   handleMessage(lineUserId, displayName, text)  -> replyText
 *   getLeads(filters)
 *   updateLead(id, fields)
 *   resetConversation(lineUserId)
 */

const axios = require('axios');
const db    = require('../db');
const line  = require('@line/bot-sdk');

const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL             = 'claude-haiku-4-5-20251001';
const MAX_HISTORY       = 12; // จำนวน message ที่เก็บ per user

// ─────────────────────────────────────────────────────────────────
//  SYSTEM PROMPT — ประกันรถยนต์
//  อัปเดต knowledge base ได้ที่นี่ หรือโหลดจาก DB/ENV
// ─────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `
คุณคือ "น้องต่อ" พนักงานขายประกันรถยนต์มืออาชีพของบริษัทต่อกัน ประกันภัย
มีประสบการณ์ขาย 5 ปี พูดภาษาไทยสุภาพ เป็นกันเอง กระชับ ตรงประเด็น
ใช้ emoji 1-2 ตัวต่อข้อความ ไม่มากเกิน

== กฎการตอบ (บังคับ) ==
- ตอบสั้น ไม่เกิน 3 ประโยคต่อครั้ง
- ถามทีละคำถาม ไม่ถามรวมกัน
- ไม่อธิบายยืดยาว ไม่ list bullet ยาวๆ
- ถ้าลูกค้าถามราคา → บอกว่าต้องรู้ข้อมูลรถก่อน แล้วถามทันที
- ถ้าลูกค้าแสดงความสนใจ → นำไปขอเบอร์โทรทันที ไม่รอ

== ข้อมูลประกัน (ใช้เฉพาะที่จำเป็น) ==
ชั้น 1: คุ้มครองทุกกรณี → เหมาะรถใหม่/ยังผ่อน
ชั้น 2+: ชนคู่กรณี + ไฟ + โจรกรรม → รถ 5-10 ปี
ชั้น 3+: ชนคู่กรณี + อุบัติเหตุ → รถเก่า/ประหยัด (นิยมสุด)
ชั้น 3: คุ้มครองคู่กรณีอย่างเดียว → ราคาถูกสุด
พ.ร.บ.: กฎหมายบังคับ ทุกคันต้องมี

ห้ามบอกเบี้ยที่แน่นอน — บอกว่า "ขึ้นกับข้อมูลรถ เดี๋ยวให้เจ้าหน้าที่เสนอราคาให้เลยครับ"

== Flow การขาย ==
ทักทาย → ถามว่างานใหม่หรือต่ออายุ → ถามรถ (ยี่ห้อ) → ถามรุ่น → ถามปี → แนะนำชั้นที่เหมาะ → ขอเบอร์โทร → ยืนยัน

ถ้าลูกค้าบอกว่าต่ออายุ/ต่อประกัน:
- ถามว่าประกันเดิมชั้นอะไร บริษัทไหน
- บอกว่าเราเปรียบเทียบราคาหลายบริษัทให้ได้ราคาดีที่สุด
- ขอเบอร์โทรให้เร็ว เพราะเจ้าหน้าที่ด้านต่ออายุจะติดต่อโดยตรง

== ตัวอย่างการสนทนาที่ดี ==

ลูกค้า: สวัสดีครับ อยากทำประกันรถ
น้องต่อ: สวัสดีครับ 😊 ยินดีช่วยเลยครับ รถยี่ห้ออะไรครับ?

ลูกค้า: Honda Civic ปี 2019
น้องต่อ: Honda Civic ปี 2019 รถยังไม่เก่าเลยครับ 👍 แนะนำชั้น 2+ หรือ 3+ ครับ คุ้มค่ากว่าชั้น 1 เยอะ สนใจแบบไหนครับ?

ลูกค้า: แบบ 3+ ดีกว่า ราคาประมาณเท่าไหร่ครับ
น้องต่อ: ราคาขึ้นกับประวัติเคลมและทุนประกันครับ 🎯 ขอชื่อและเบอร์โทรได้เลยครับ เดี๋ยวเจ้าหน้าที่โทรแจ้งราคาที่ดีที่สุดให้ภายในวันนี้

ลูกค้า: ชื่อสมชาย เบอร์ 081-234-5678
น้องต่อ: ขอบคุณครับคุณสมชาย ✅ เจ้าหน้าที่จะโทรกลับภายใน 2-3 ชั่วโมงนะครับ มีคำถามอะไรเพิ่มเติมไหมครับ?

ลูกค้า: แพงไปไหมครับ ที่อื่นถูกกว่า
น้องต่อ: เราเปรียบเทียบราคาหลายบริษัทให้เลยครับ ได้ราคาดีสุดแน่นอน 💪 ลองให้เจ้าหน้าที่เสนอก่อนได้เลยครับ ไม่มีค่าใช้จ่าย

ลูกค้า: ประกันหมดเมื่อไหร่ถึงต้องต่อ
น้องต่อ: ควรต่อก่อนหมด 30 วันครับ จะได้ไม่ขาดความคุ้มครอง 📅 ประกันคุณหมดเมื่อไหร่ครับ?

== การจัดการ objection ==
"แพงไป" → เปรียบเทียบหลายบริษัทให้ได้ราคาดีสุด
"คิดดูก่อน" → ถามว่าสนใจชั้นไหน แล้วให้เจ้าหน้าที่โทรอธิบาย ไม่มีผูกมัด
"ถามแทนคนอื่น" → ช่วยได้เลย ถามข้อมูลรถปกติ
"ไม่สะดวกรับโทรศัพท์" → ให้ LINE Official หรือแจ้งเวลาที่สะดวก

== ถ้าถามนอกเรื่องประกัน ==
ตอบสั้น 1 ประโยค แล้วพูดถึงประกันทันที
`.trim();

// ─────────────────────────────────────────────────────────────────
//  Regex helpers
// ─────────────────────────────────────────────────────────────────
function extractPhone(text) {
  const m = text.match(/0[689]\d{8}|0[2-9]\d{7}/);
  return m ? m[0].replace(/[-\s]/g, '') : null;
}

function looksLikeName(text) {
  return /^[ก-๙a-zA-Z\s.]{2,30}$/.test(text.trim()) && !/\d/.test(text);
}

/**
 * ตรวจจับว่าลูกค้าต้องการต่ออายุประกัน
 * คืน 'renewal' หรือ 'new'
 */
function detectLeadType(text) {
  const renewalPattern = /ต่ออายุ|ต่อประกัน|ต่อปีนี้|ต่อปีใหม่|หมดอายุ|ใกล้หมด|เบี้ยปีต่อ|ต่ออีกปี|renew|renewal/i;
  return renewalPattern.test(text) ? 'renewal' : 'new';
}

// ─────────────────────────────────────────────────────────────────
//  Admin LINE Notification — แจ้งเมื่อมี Lead ใหม่
// ─────────────────────────────────────────────────────────────────
async function notifyAdminNewLead(lead) {
  try {
    // กรองพนักงานตาม lead_type:
    //   lead_type = 'renewal' → ส่งถึง job_type IN ('renewal','both')
    //   lead_type = 'new'     → ส่งถึง job_type IN ('new_business','both')
    const lt = lead.lead_type || 'new';
    const jobFilter = lt === 'renewal'
      ? `job_type IN ('renewal', 'both')`
      : `job_type IN ('new_business', 'both')`;

    const adminRows = await db.query(
      `SELECT line_user_id, display_name, job_type
       FROM admin_line_users
       WHERE line_user_id IS NOT NULL AND ${jobFilter}`
    );
    if (!adminRows.rows.length) return;

    const insuranceLabel = {
      type1: 'ชั้น 1', type2: 'ชั้น 2', 'type2+': 'ชั้น 2+',
      type3: 'ชั้น 3', 'type3+': 'ชั้น 3+', compulsory: 'พ.ร.บ.',
    };

    const isRenewal   = lt === 'renewal';
    const headerColor = isRenewal ? '#7c3aed' : '#1a56db';
    const leadLabel   = isRenewal ? '🔄 ต่ออายุ' : '🆕 งานใหม่';
    const altText     = `🔔 ${leadLabel}! ${lead.customer_name || lead.line_display_name || 'ลูกค้าใหม่'}`;

    const flexMsg = {
      type: 'flex',
      altText,
      contents: {
        type: 'bubble',
        size: 'kilo',
        header: {
          type: 'box', layout: 'vertical',
          backgroundColor: headerColor, paddingAll: '14px',
          contents: [
            {
              type: 'text', text: `🔔 ${leadLabel} — Sales Bot`,
              color: '#ffffff', weight: 'bold', size: 'md',
            },
          ],
        },
        body: {
          type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
          contents: [
            {
              type: 'box', layout: 'baseline', spacing: 'sm',
              contents: [
                { type: 'text', text: 'ชื่อ', color: '#6b7280', size: 'sm', flex: 2 },
                { type: 'text', text: lead.customer_name || lead.line_display_name || '—', weight: 'bold', size: 'sm', flex: 5, wrap: true },
              ],
            },
            {
              type: 'box', layout: 'baseline', spacing: 'sm',
              contents: [
                { type: 'text', text: 'เบอร์', color: '#6b7280', size: 'sm', flex: 2 },
                { type: 'text', text: lead.phone || '—', weight: 'bold', size: 'sm', flex: 5, color: '#1a56db' },
              ],
            },
            lead.car_brand ? {
              type: 'box', layout: 'baseline', spacing: 'sm',
              contents: [
                { type: 'text', text: 'รถ', color: '#6b7280', size: 'sm', flex: 2 },
                { type: 'text', text: `${lead.car_brand} ${lead.car_model || ''} ${lead.car_year || ''}`.trim(), size: 'sm', flex: 5, wrap: true },
              ],
            } : null,
            lead.insurance_type ? {
              type: 'box', layout: 'baseline', spacing: 'sm',
              contents: [
                { type: 'text', text: 'ประกัน', color: '#6b7280', size: 'sm', flex: 2 },
                { type: 'text', text: insuranceLabel[lead.insurance_type] || lead.insurance_type, size: 'sm', flex: 5, color: '#059669', weight: 'bold' },
              ],
            } : null,
            {
              type: 'separator', margin: 'md',
            },
            {
              type: 'text',
              text: `ความสนใจ: ${lead.interest_level === 'hot' ? '🔥 ร้อนแรง' : lead.interest_level === 'warm' ? '✨ ปานกลาง' : '❄️ เย็น'}`,
              size: 'xs', color: '#374151', margin: 'sm',
            },
          ].filter(Boolean),
        },
        footer: {
          type: 'box', layout: 'vertical', paddingAll: '10px',
          contents: [{
            type: 'text',
            text: '→ ดูรายละเอียดใน Admin Panel',
            size: 'xs', color: '#9ca3af', align: 'center',
          }],
        },
      },
    };

    await Promise.all(
      adminRows.rows.map(r =>
        lineClient.pushMessage({ to: r.line_user_id, messages: [flexMsg] }).catch(e =>
          console.error('[salesBot] notifyAdmin error:', e.message)
        )
      )
    );
  } catch (e) {
    console.error('[salesBot] notifyAdminNewLead error:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────
//  Auto-extract lead fields จากบทสนทนาด้วย Claude
// ─────────────────────────────────────────────────────────────────
async function extractLeadFields(history) {
  if (!ANTHROPIC_API_KEY || history.length < 4) return null;
  try {
    const resp = await axios.post('https://api.anthropic.com/v1/messages', {
      model:      MODEL,
      max_tokens: 200,
      system: `วิเคราะห์บทสนทนาและตอบด้วย JSON เท่านั้น (ไม่มีข้อความอื่น):
{
  "customer_name": "ชื่อลูกค้า หรือ null",
  "car_brand": "ยี่ห้อรถ เช่น Toyota, Honda หรือ null",
  "car_model": "รุ่นรถ เช่น Camry, Civic หรือ null",
  "car_year": "ปีจดทะเบียน เช่น 2020 หรือ null",
  "insurance_type": "type1|type2|type2+|type3|type3+|compulsory หรือ null",
  "interest_level": "hot|warm|cold"
}
ตอบ null ถ้าข้อมูลยังไม่มีในบทสนทนา`,
      messages: [
        {
          role: 'user',
          content: 'บทสนทนา:\n' + history.map(m => `${m.role === 'user' ? 'ลูกค้า' : 'บอท'}: ${m.content}`).join('\n'),
        },
      ],
    }, {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 8000,
    });

    const raw = resp.data.content[0]?.text || '{}';
    const json = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}');
    // กรองเฉพาะ field ที่มีค่า
    const fields = {};
    for (const [k, v] of Object.entries(json)) {
      if (v && v !== 'null') fields[k] = v;
    }
    return Object.keys(fields).length ? fields : null;
  } catch (e) {
    console.error('[salesBot] extractLeadFields error:', e.message);
    return null;
  }
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

  // ── ตรวจ lead_type จากข้อความ ──
  const leadType = detectLeadType(text);

  // ── เพิ่ม user message ──
  history.push({ role: 'user', content: text });
  const trimmed = history.slice(-MAX_HISTORY);

  // ── Call Claude API ──
  let assistantText;
  try {
    const resp = await axios.post('https://api.anthropic.com/v1/messages', {
      model:      MODEL,
      max_tokens: 320,
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

  // ── Auto-detect phone number → save lead + notify admin ──
  let newLeadCaptured = leadCaptured;
  const phone = extractPhone(text);
  if (phone && !leadCaptured) {
    await upsertLead(lineUserId, displayName, { phone, status: 'new', interest_level: 'hot', lead_type: leadType });
    newLeadCaptured = true;
    console.log(`[salesBot] Lead captured: ${displayName} (${phone}) type=${leadType}`);

    // แจ้งพนักงานกลุ่มที่ตรงกับ lead_type ทันที (async — ไม่ block reply)
    notifyAdminNewLead({ line_display_name: displayName, phone, interest_level: 'hot', lead_type: leadType }).catch(() => {});
  }

  // ── Auto-extract lead fields ทุก 4 ข้อความ ──
  const msgCount = count + 1;
  if (msgCount % 4 === 0 || newLeadCaptured) {
    const extracted = await extractLeadFields(trimmed);
    if (extracted) {
      await upsertLead(lineUserId, displayName, extracted);
      console.log(`[salesBot] Lead fields extracted for ${displayName}:`, extracted);

      // ถ้า extract ได้ชื่อ/รถ → notify admin อีกครั้งพร้อมข้อมูลครบ
      if (newLeadCaptured && (extracted.car_brand || extracted.customer_name)) {
        notifyAdminNewLead({
          line_display_name: displayName,
          phone: phone || undefined,
          lead_type: leadType,
          ...extracted,
        }).catch(() => {});
      }
    }
  }

  // ── Save conversation ──
  await saveConversation(lineUserId, displayName, trimmed, newLeadCaptured);

  return assistantText;
}

// ─────────────────────────────────────────────────────────────────
//  Admin: getLeads / updateLeadStatus / resetConversation
// ─────────────────────────────────────────────────────────────────
async function getLeads({ status, lead_type, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params     = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (lead_type && ['new', 'renewal'].includes(lead_type)) {
    params.push(lead_type);
    conditions.push(`lead_type = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const r = await db.query(
    `SELECT * FROM sales_leads ${where} ORDER BY created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,
    params
  );
  const cntParams = params.slice(0, -2);   // ตัด limit/offset ออก
  const cnt = await db.query(
    `SELECT COUNT(*) FROM sales_leads ${where}`,
    cntParams
  );
  return { leads: r.rows, total: parseInt(cnt.rows[0].count) };
}

async function updateLead(id, fields) {
  const allowed = ['status','notes','customer_name','phone','car_brand','car_model','car_year','insurance_type','interest_level','assigned_to','lead_type'];
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
