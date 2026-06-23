/**
 * setupRichMenu.js
 * สร้าง Rich Menu ผ่าน LINE Messaging API และ set เป็น default
 *
 * วิธีใช้:
 *   npm run richmenu
 *   หรือ
 *   node src/utils/setupRichMenu.js
 *
 * Rich Menu Layout (2500 x 1250 px, 6 ปุ่ม 2 แถว 3 คอลัมน์):
 * ┌───────────────┬───────────────┬───────────────┐
 * │   📋 ลางาน    │ 📜 ประวัติลา  │  ⏰ เข้า-ออกงาน │
 * ├───────────────┼───────────────┼───────────────┤
 * │   🕐 ขอ OT   │ 📊 เช็คยอดลา  │   🏠 เมนูหลัก  │
 * └───────────────┴───────────────┴───────────────┘
 */

require('dotenv').config();
const https = require('https');
const http = require('http');
const { URL } = require('url');

const ACCESS_TOKEN    = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LIFF_ID         = process.env.LIFF_ID          || '';
const LIFF_ID_OT      = process.env.LIFF_ID_OT       || '';
const LIFF_ID_CHECKIN = process.env.LIFF_ID_CHECKIN  || '';
const LIFF_ID_HISTORY = process.env.LIFF_ID_HISTORY  || '';
const LIFF_ID_PROFILE = process.env.LIFF_ID_PROFILE  || '';
const NGROK_URL       = (process.env.NGROK_URL || 'https://manila-carefully-chowtime.ngrok-free.dev').replace(/\/$/, '');

// ─── Image dimensions ─────────────────────────────────────────────────────
const W = 2500, H = 1250;
const COLS = 3, ROWS = 2;
const CW = Math.floor(W / COLS);  // 833
const CH = Math.floor(H / ROWS);  // 625

// ─── Buttons ─────────────────────────────────────────────────────────────
const BUTTONS = [
  {
    col: 0, row: 0, label: 'ลางาน',
    bg: [19, 87, 176],   // #1357B0
    action: { type: 'uri', label: 'ลางาน', uri: `https://liff.line.me/${LIFF_ID}` },
  },
  {
    col: 1, row: 0, label: 'ประวัติการลา',
    bg: [22, 100, 196],  // #1664C4
    action: { type: 'uri', label: 'ประวัติการลา', uri: `https://liff.line.me/${LIFF_ID_HISTORY}` },
  },
  {
    col: 2, row: 0, label: 'เข้า-ออกงาน',
    bg: [13, 63, 130],   // #0D3F82
    action: { type: 'uri', label: 'เข้า-ออกงาน', uri: `https://liff.line.me/${LIFF_ID_CHECKIN}` },
  },
  {
    col: 0, row: 1, label: 'ขอ OT',
    bg: [244, 121, 32],  // #F47920
    action: { type: 'uri', label: 'ขอ OT', uri: `https://liff.line.me/${LIFF_ID_OT}` },
  },
  {
    col: 1, row: 1, label: 'เช็คยอดวันลา',
    bg: [220, 100, 20],  // darker orange
    action: { type: 'message', label: 'เช็คยอดวันลา', text: 'ยอดวันลา' },
  },
  {
    col: 2, row: 1, label: 'โปรไฟล์',
    bg: [10, 48, 100],   // darkest blue
    action: { type: 'uri', label: 'โปรไฟล์', uri: `https://liff.line.me/${LIFF_ID_PROFILE}` },
  },
];

// ─── Minimal JPEG generator (pure Node.js, no external deps) ─────────────
// Creates a solid-color JPEG for each button cell using the raw JPEG format.
// This produces a simple but valid Rich Menu image.
function buildSimpleJPEG() {
  // Try canvas first (best quality)
  try {
    const { createCanvas } = require('canvas');
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0d3f82';
    ctx.fillRect(0, 0, W, H);
    BUTTONS.forEach(btn => {
      const x = btn.col * CW;
      const y = btn.row * CH;
      ctx.fillStyle = `rgb(${btn.bg[0]},${btn.bg[1]},${btn.bg[2]})`;
      ctx.fillRect(x + 2, y + 2, CW - 4, CH - 4);
      // Divider lines
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 4;
      ctx.strokeRect(x + 2, y + 2, CW - 4, CH - 4);
      // Label
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.floor(CH * 0.13)}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(btn.label, x + CW / 2, y + CH / 2);
    });
    console.log('   🎨 Using canvas for image (best quality)');
    return canvas.toBuffer('image/jpeg', { quality: 0.92 });
  } catch (_) {}

  // Fallback: pure JS PPM-like approach using raw BMP (no deps required)
  // We create a raw 24-bit uncompressed BMP and convert to a minimal valid format
  // Since LINE requires JPEG/PNG, we use a BMP→JPEG shim or just build raw JPEG SOF
  // Actually: use the simplest valid JPEG we can build manually
  return buildMinimalJPEG(W, H);
}

/**
 * Build a minimal valid JPEG with colored rectangles.
 * Uses only Node.js Buffer — no external dependencies.
 */
function buildMinimalJPEG(w, h) {
  // Create RGB pixel data
  const pixels = Buffer.alloc(w * h * 3);

  BUTTONS.forEach(btn => {
    const x0 = btn.col * CW;
    const y0 = btn.row * CH;
    const x1 = x0 + CW;
    const y1 = y0 + CH;
    const [r, g, b] = btn.bg;
    // Fill the button area
    for (let y = y0; y < Math.min(y1, h); y++) {
      for (let x = x0; x < Math.min(x1, w); x++) {
        // Add slight divider (4px white border)
        const inBorder = x < x0 + 4 || x >= x1 - 4 || y < y0 + 4 || y >= y1 - 4;
        const idx = (y * w + x) * 3;
        if (inBorder) {
          pixels[idx] = 40; pixels[idx + 1] = 40; pixels[idx + 2] = 60;
        } else {
          pixels[idx] = r; pixels[idx + 1] = g; pixels[idx + 2] = b;
        }
      }
    }
  });

  // Encode as JPEG using a basic implementation
  // Since we can't use third-party libs, write a PPM file and note limitation
  // Instead: write a valid PNG using pngjs-style raw encoding
  return encodePNG(w, h, pixels);
}

/**
 * Encode raw RGB pixels as a valid PNG.
 * Implements the minimal PNG spec: IHDR + IDAT (deflated) + IEND.
 * Uses Node's built-in zlib for deflate.
 */
function encodePNG(w, h, rgbPixels) {
  const zlib = require('zlib');

  // Build raw scanlines (filter byte 0 = None + RGB data)
  const scanlineLen = 1 + w * 3;
  const raw = Buffer.alloc(h * scanlineLen);
  for (let y = 0; y < h; y++) {
    const rowStart = y * scanlineLen;
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 3;
      const dst = rowStart + 1 + x * 3;
      raw[dst]     = rgbPixels[src];
      raw[dst + 1] = rgbPixels[src + 1];
      raw[dst + 2] = rgbPixels[src + 2];
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });

  function crc32(buf) {
    const table = (() => {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c;
      }
      return t;
    })();
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function chunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crcBuf = Buffer.concat([typeBytes, data]);
    const crcVal = Buffer.alloc(4); crcVal.writeUInt32BE(crc32(crcBuf));
    return Buffer.concat([len, typeBytes, data, crcVal]);
  }

  // IHDR: width, height, bitdepth=8, colortype=2 (RGB), compression=0, filter=0, interlace=0
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const pngSig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const iendData = Buffer.alloc(0);

  return Buffer.concat([
    pngSig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', iendData),
  ]);
}

// ─── HTTP helper (no axios needed in this file) ───────────────────────────
function lineRequest(method, path, body, contentType, binaryBody) {
  return new Promise((resolve, reject) => {
    const fullPath = `/v2/bot${path}`;
    const isData = path.includes('/content');
    const hostname = isData ? 'api-data.line.me' : 'api.line.me';
    const payload = binaryBody || (body ? Buffer.from(JSON.stringify(body)) : Buffer.alloc(0));

    const options = {
      hostname,
      path: fullPath,
      method,
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': contentType || 'application/json',
        'Content-Length': payload.length,
      },
    };

    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${text}`));
        } else {
          try { resolve(JSON.parse(text)); } catch { resolve(text); }
        }
      });
    });
    req.on('error', reject);
    if (payload.length) req.write(payload);
    req.end();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 LINE Rich Menu Setup\n');

  if (!ACCESS_TOKEN) {
    console.error('❌ LINE_CHANNEL_ACCESS_TOKEN ไม่พบใน .env');
    process.exit(1);
  }
  const missingLiff = [
    ['LIFF_ID (ลางาน)', LIFF_ID],
    ['LIFF_ID_OT (ขอ OT)', LIFF_ID_OT],
    ['LIFF_ID_CHECKIN (เข้า-ออกงาน)', LIFF_ID_CHECKIN],
    ['LIFF_ID_HISTORY (ประวัติการลา)', LIFF_ID_HISTORY],
    ['LIFF_ID_PROFILE (โปรไฟล์)', LIFF_ID_PROFILE],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missingLiff.length) {
    console.warn('⚠️  LIFF ID ที่ยังไม่ได้ตั้งค่า:', missingLiff.join(', '));
  }

  // 1. ลบ menu เก่าทั้งหมด
  console.log('1️⃣  ลบ Rich Menu เก่า...');
  try {
    const list = await lineRequest('GET', '/richmenu/list');
    const menus = list.richmenus || [];
    for (const m of menus) {
      await lineRequest('DELETE', `/richmenu/${m.richMenuId}`);
      console.log(`   🗑  Deleted: ${m.richMenuId} (${m.name})`);
    }
    if (!menus.length) console.log('   (ไม่มีเมนูเก่า)');
  } catch (e) {
    console.warn(`   ⚠️  ${e.message}`);
  }

  // 2. สร้าง Rich Menu
  console.log('\n2️⃣  สร้าง Rich Menu...');
  const menuBody = {
    size: { width: W, height: H },
    selected: true,
    name: 'ต่อกัน HR Menu',
    chatBarText: '📋 เมนู HR',
    areas: BUTTONS.map(btn => ({
      bounds: {
        x: btn.col * CW,
        y: btn.row * CH,
        width: CW,
        height: CH,
      },
      action: btn.action,
    })),
  };

  const created = await lineRequest('POST', '/richmenu', menuBody);
  const richMenuId = created.richMenuId;
  console.log(`   ✅ สร้างสำเร็จ: ${richMenuId}`);

  // 3. โหลดหรือสร้างรูปภาพ Rich Menu
  console.log('\n3️⃣  เตรียมรูป Rich Menu...');
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '../../');

  // ค้นหารูปที่ผู้ใช้วางไว้ (รองรับหลายชื่อ/นามสกุล)
  // หมายเหตุ: richmenu_compressed.jpg ถูกวางไว้ก่อน เพราะ LINE จำกัดขนาด 1 MB
  const candidates = [
    path.join(ROOT, 'richmenu_compressed.jpg'),
    path.join(ROOT, 'richmenu.jpg'),
    path.join(ROOT, 'richmenu.jpeg'),
    path.join(ROOT, 'rich-menu.jpg'),
    path.join(ROOT, 'richmenu.png'),
    path.join(ROOT, 'rich-menu.png'),
    process.env.RICH_MENU_IMAGE,  // override ผ่าน .env
  ].filter(Boolean);

  let imageBuffer;
  let imgType;
  const found = candidates.find(p => fs.existsSync(p));

  if (found) {
    imageBuffer = fs.readFileSync(found);
    imgType = found.endsWith('.png') ? 'image/png' : 'image/jpeg';
    console.log(`   🖼  ใช้รูปจากไฟล์: ${path.basename(found)} (${(imageBuffer.length / 1024).toFixed(0)} KB)`);

    // LINE limit = 1 MB — ถ้าใหญ่เกิน ให้บีบอัดเป็น JPEG อัตโนมัติ
    if (imageBuffer.length > 900_000) {
      console.log('   📦 ไฟล์ใหญ่กว่า 900 KB — บีบอัดเป็น JPEG อัตโนมัติ...');
      try {
        const { execSync } = require('child_process');
        const tmpOut = path.join(ROOT, '_richmenu_tmp.jpg');
        // ใช้ sharp (ถ้ามี) หรือ fallback ไป python
        try {
          const sharp = require('sharp');
          await sharp(imageBuffer)
            .resize(2500, 1250, { fit: 'fill' })
            .jpeg({ quality: 82, mozjpeg: false })
            .toFile(tmpOut);
        } catch (_) {
          // fallback: python PIL
          execSync(
            `python3 -c "from PIL import Image; img=Image.open('${found}').convert('RGB').resize((2500,1250)); img.save('${tmpOut}','JPEG',quality=82,optimize=True)"`,
            { stdio: 'inherit' }
          );
        }
        imageBuffer = fs.readFileSync(tmpOut);
        fs.unlinkSync(tmpOut);
        imgType = 'image/jpeg';
        console.log(`   ✅ บีบอัดสำเร็จ → ${(imageBuffer.length / 1024).toFixed(0)} KB`);
      } catch (compErr) {
        throw new Error(`บีบอัดรูปล้มเหลว: ${compErr.message}\nกรุณาบีบอัดรูปให้ต่ำกว่า 1 MB ก่อนรัน script`);
      }
    }
  } else {
    console.log('   ⚠️  ไม่พบไฟล์รูป (richmenu.png/jpg) — สร้างรูปอัตโนมัติแทน');
    imageBuffer = buildSimpleJPEG();
    const p = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50;
    imgType = p ? 'image/png' : 'image/jpeg';
    console.log(`   🎨 Auto-generated: ${imgType}, ${(imageBuffer.length / 1024).toFixed(0)} KB`);
  }

  console.log('   📤 อัปโหลดรูป...');
  await lineRequest('POST', `/richmenu/${richMenuId}/content`, null, imgType, imageBuffer);
  console.log('   ✅ อัปโหลดสำเร็จ');

  // 4. ตั้งเป็น default
  console.log('\n4️⃣  ตั้ง Rich Menu เป็น default สำหรับทุก user...');
  await lineRequest('POST', `/user/all/richmenu/${richMenuId}`);
  console.log('   ✅ ตั้งค่า default สำเร็จ');

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Rich Menu พร้อมใช้งาน!`);
  console.log(`   Rich Menu ID : ${richMenuId}`);
  console.log(`   ขนาด         : ${W} x ${H} px`);
  console.log(`   จำนวนปุ่ม    : ${BUTTONS.length} ปุ่ม`);
  console.log('\n📌 Layout:');
  console.log('   [ลางาน]      [ประวัติการลา] [เข้า-ออกงาน]');
  console.log('   [ขอ OT]      [เช็คยอดวันลา] [โปรไฟล์]    ');
  console.log('\n⚠️  หมายเหตุ: Rich Menu จะแสดงเมื่อผู้ใช้เปิดแชทกับ Bot');
  console.log('   ถ้า LIFF ยัง developing → ต้องเพิ่ม Tester ใน LINE Console ก่อน');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch(err => {
  const detail = err.message || String(err);
  console.error(`\n❌ Error: ${detail}`);
  if (detail.includes('401')) console.error('   → Token ผิด หรือหมดอายุ — เช็ค LINE_CHANNEL_ACCESS_TOKEN ใน .env');
  if (detail.includes('400')) console.error('   → ข้อมูล Rich Menu ไม่ถูกต้อง — เช็ค LIFF_ID และ LIFF_ID_OT');
  process.exit(1);
});
