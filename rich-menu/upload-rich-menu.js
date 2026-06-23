/**
 * Script สำหรับ Upload Rich Menu ขึ้น LINE
 * วิธีใช้:
 *   1. export รูป rich-menu-preview.html เป็น PNG ขนาด 2500x1686 px
 *      (ใช้ browser screenshot หรือ tool เช่น puppeteer)
 *   2. บันทึกไว้เป็น rich-menu/rich-menu.png
 *   3. รัน: node rich-menu/upload-rich-menu.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CONFIG = require('./rich-menu-config.json');

// ลบ _comment และ _reference ออกก่อนส่ง
const cleanConfig = { ...CONFIG };
delete cleanConfig._comment;
delete cleanConfig._reference;
cleanConfig.areas = cleanConfig.areas.map(a => {
  const clean = { ...a };
  delete clean._label;
  return clean;
});

async function uploadRichMenu() {
  console.log('1️⃣  สร้าง Rich Menu...');
  const { data } = await axios.post(
    'https://api.line.me/v2/bot/richmenu',
    cleanConfig,
    { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }
  );
  const richMenuId = data.richMenuId;
  console.log('   Rich Menu ID:', richMenuId);

  console.log('2️⃣  Upload รูปภาพ...');
  const imgPath = path.join(__dirname, 'rich-menu.png');
  if (!fs.existsSync(imgPath)) {
    console.error('❌ ไม่พบไฟล์ rich-menu.png — export รูปก่อนนะครับ');
    process.exit(1);
  }
  const imgBuffer = fs.readFileSync(imgPath);
  await axios.post(
    `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
    imgBuffer,
    { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'image/png' } }
  );
  console.log('   Upload รูปสำเร็จ');

  console.log('3️⃣  ตั้งเป็น Default Rich Menu...');
  await axios.post(
    `https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`,
    {},
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );

  console.log(`\n✅ Rich Menu พร้อมใช้งานแล้ว! ID: ${richMenuId}`);
}

uploadRichMenu().catch(console.error);
