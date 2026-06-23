const express = require('express');
const router  = express.Router();
const line    = require('@line/bot-sdk');
const db      = require('../db');

const client  = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

/**
 * POST /api/broadcast
 * Body: { message, type }
 *   type: 'text' | 'flex'  (default 'text')
 *   message: string (for text) | flex message object (for flex)
 *
 * ส่ง push message หาพนักงานทุกคนที่ผูก LINE แล้ว (line_user_id IS NOT NULL)
 */
router.post('/', async (req, res) => {
  try {
    const { message, type = 'text', title = 'ประกาศจาก HR' } = req.body;
    if (!message) return res.status(400).json({ error: 'ต้องระบุ message' });

    // ดึง line_user_id ที่ active ทั้งหมด
    const result = await db.query(
      `SELECT id, name, line_user_id
       FROM employees
       WHERE is_active = TRUE AND line_user_id IS NOT NULL AND line_user_id != ''`
    );
    const targets = result.rows;
    if (!targets.length) return res.json({ success: true, sent: 0, message: 'ไม่มีพนักงานที่เชื่อม LINE' });

    // สร้าง message object
    let msgObj;
    if (type === 'flex' && typeof message === 'object') {
      msgObj = message;
    } else {
      // Flex card สวย ๆ สำหรับข้อความประกาศ
      msgObj = {
        type: 'flex',
        altText: `📢 ${title}`,
        contents: {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#1357B0',
            paddingAll: '16px',
            contents: [
              {
                type: 'text',
                text: '📢 ' + title,
                color: '#ffffff',
                weight: 'bold',
                size: 'lg',
                wrap: true,
              },
            ],
          },
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'md',
            paddingAll: '16px',
            contents: [
              {
                type: 'text',
                text: String(message),
                wrap: true,
                size: 'sm',
                color: '#374151',
              },
              {
                type: 'separator',
                margin: 'md',
              },
              {
                type: 'text',
                text: `📅 ${new Date().toLocaleDateString('th-TH', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  timeZone: 'Asia/Bangkok',
                })}`,
                size: 'xs',
                color: '#9ca3af',
                margin: 'md',
              },
            ],
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            paddingAll: '12px',
            backgroundColor: '#f8fafc',
            contents: [
              {
                type: 'text',
                text: 'ต่อกัน Insurance Broker HR',
                size: 'xs',
                color: '#9ca3af',
                align: 'center',
              },
            ],
          },
          styles: {
            header: { separator: false },
            footer: { separator: true },
          },
        },
      };
    }

    // ส่งทีละ batch 500 (LINE limit)
    const BATCH = 500;
    let sent = 0;
    let failed = 0;
    const errors = [];

    for (let i = 0; i < targets.length; i += BATCH) {
      const batch = targets.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(emp =>
          client.pushMessage({ to: emp.line_user_id, messages: [msgObj] })
        )
      );
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
          sent++;
        } else {
          failed++;
          errors.push({ name: batch[idx].name, error: r.reason?.message });
        }
      });
    }

    // บันทึก log
    await db.query(
      `INSERT INTO broadcast_log (title, message, total_sent, total_failed, sent_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT DO NOTHING`,
      [title, String(message).slice(0, 1000), sent, failed]
    ).catch(() => {}); // ไม่ error ถ้าตารางยังไม่มี

    res.json({
      success: true,
      sent,
      failed,
      total: targets.length,
      errors: errors.slice(0, 10),
      message: `ส่งสำเร็จ ${sent}/${targets.length} คน${failed ? ` (ล้มเหลว ${failed} คน)` : ''}`,
    });
  } catch (err) {
    console.error('broadcast error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/broadcast/history
 * ดูประวัติการ broadcast ล่าสุด
 */
router.get('/history', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM broadcast_log ORDER BY sent_at DESC LIMIT 20`
    );
    res.json(result.rows);
  } catch {
    res.json([]); // ถ้าตารางยังไม่มี return []
  }
});

module.exports = router;
