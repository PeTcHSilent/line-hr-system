/**
 * Migration Runner — รัน SQL files ที่ยังไม่ถูก apply ตามลำดับ version
 *
 * วิธีใช้:
 *   node database/migrate.js          ← รัน pending migrations
 *   node database/migrate.js --status ← ดูสถานะ migrations
 *
 * ไฟล์ SQL ที่รองรับ:
 *   database/migration_v*.sql
 *   sql/migration_v*.sql
 *   sql/migration_sales_v*.sql
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── directories ที่มี migration SQL ──────────────────────
const MIGRATION_DIRS = [
  path.join(__dirname, '../database'),
  path.join(__dirname, '../sql'),
];

// ── ดึงรายการ SQL files เรียงตาม version ──────────────────
function getMigrationFiles() {
  const files = [];

  for (const dir of MIGRATION_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir)
      .filter(f => /^migration_(v\d+|sales_v\d+)\.sql$/i.test(f))
      .map(f => ({ filename: f, fullPath: path.join(dir, f) }));
    files.push(...entries);
  }

  // เรียงตามเลข version: v1, v2, ..., v10, v11, sales_v1, ...
  files.sort((a, b) => {
    const numA = extractVersion(a.filename);
    const numB = extractVersion(b.filename);
    return numA - numB;
  });

  // ── ❗ ชื่อไฟล์ห้ามซ้ำข้าม folder ──────────────────────────
  // _migrations ติดตามด้วย "ชื่อไฟล์" ไม่ใช่ path เต็ม
  // ถ้า database/migration_v26.sql กับ sql/migration_v26.sql มีพร้อมกัน
  // ตัวหนึ่งจะถูกข้ามไปเงียบๆ ตลอดกาล — และถ้าอีกตัวเคยรันไปแล้ว
  // ตัวใหม่จะถูกมองว่า "apply แล้ว" ทั้งที่ยังไม่เคยรัน
  // → หยุดทันทีดีกว่าปล่อยให้ migration หายไปแบบไม่รู้ตัว
  const byName = new Map();
  for (const f of files) {
    if (!byName.has(f.filename)) byName.set(f.filename, []);
    byName.get(f.filename).push(f.fullPath);
  }
  const dupes = [...byName.entries()].filter(([, paths]) => paths.length > 1);
  if (dupes.length) {
    const detail = dupes
      .map(([name, paths]) => `  • ${name}\n${paths.map(p => `      ${p}`).join('\n')}`)
      .join('\n');
    throw new Error(
      `❌ พบชื่อไฟล์ migration ซ้ำกันข้าม folder — หยุดการทำงาน\n\n${detail}\n\n` +
      `แก้โดยเปลี่ยนชื่อไฟล์ใดไฟล์หนึ่งเป็นเลข version ใหม่ที่ยังว่าง หรือลบไฟล์ที่ไม่ใช้แล้วออก`
    );
  }

  return files;
}

function extractVersion(filename) {
  // migration_v27.sql → 27000  |  migration_sales_v3.sql → 1000003
  const salesMatch = filename.match(/migration_sales_v(\d+)\.sql/i);
  if (salesMatch) return 1_000_000 + parseInt(salesMatch[1]);
  const vMatch = filename.match(/migration_v(\d+)\.sql/i);
  return vMatch ? parseInt(vMatch[1]) : 0;
}

// ── ensure migrations tracking table มีอยู่ ───────────────
async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          SERIAL PRIMARY KEY,
      filename    VARCHAR(255) UNIQUE NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// ── ดึงรายชื่อ migrations ที่ apply แล้ว ──────────────────
async function getApplied(client) {
  const { rows } = await client.query('SELECT filename FROM _migrations ORDER BY applied_at');
  return new Set(rows.map(r => r.filename));
}

// ── รัน migration ไฟล์เดียว ───────────────────────────────
async function runMigration(client, { filename, fullPath }) {
  const sql = fs.readFileSync(fullPath, 'utf8');
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      'INSERT INTO _migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
      [filename]
    );
    await client.query('COMMIT');
    console.log(`  ✅ ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`❌ ${filename}: ${err.message}`);
  }
}

// ── main ──────────────────────────────────────────────────
async function migrate() {
  const isStatusOnly = process.argv.includes('--status');
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const applied  = await getApplied(client);
    const allFiles = getMigrationFiles();
    const pending  = allFiles.filter(f => !applied.has(f.filename));

    if (isStatusOnly) {
      console.log('\n📋 Migration Status');
      console.log('─'.repeat(50));
      for (const f of allFiles) {
        const status = applied.has(f.filename) ? '✅ applied' : '⏳ pending';
        console.log(`  ${status}  ${f.filename}`);
      }
      console.log(`\nรวม: ${allFiles.length} files | applied: ${applied.size} | pending: ${pending.length}`);
      return;
    }

    if (!pending.length) {
      console.log('✅ ไม่มี migration ที่รอ apply — database เป็น version ล่าสุด');
      return;
    }

    console.log(`\n🚀 กำลัง apply ${pending.length} migration(s)...\n`);
    for (const file of pending) {
      await runMigration(client, file);
    }
    console.log(`\n✅ apply สำเร็จ ${pending.length} migration(s)`);

  } catch (err) {
    console.error('\n' + err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
