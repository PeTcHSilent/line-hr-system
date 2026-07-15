# คู่มือ Deploy LINE HR System ขึ้น Railway

## ภาพรวม
- **Platform**: [railway.app](https://railway.app)
- **Runtime**: Node.js (auto-detect จาก package.json)
- **Database**: PostgreSQL (Railway managed)
- **SSL DB**: รองรับแล้ว (`src/db.js` ตั้งค่าไว้เรียบร้อย)

---

## ขั้นตอนที่ 1 — เตรียม GitHub Repository

โค้ดต้องอยู่บน GitHub ก่อน (ต้อง push ครบทุก commit)

```powershell
cd D:\AI_FILE\IT_Department\line-hr-system
git status          # ตรวจว่า clean
git push origin main
```

---

## ขั้นตอนที่ 2 — สร้าง Project บน Railway

1. ไปที่ [railway.app](https://railway.app) → **Login with GitHub**
2. คลิก **New Project**
3. เลือก **Deploy from GitHub repo**
4. เลือก repo `line-hr-system`
5. Railway จะ detect Node.js อัตโนมัติ → คลิก **Deploy Now**

---

## ขั้นตอนที่ 3 — เพิ่ม PostgreSQL Database

1. ใน Project → คลิก **+ New** → **Database** → **PostgreSQL**
2. Railway จะสร้าง DB และ set `DATABASE_URL` ให้อัตโนมัติ
3. ไปที่ PostgreSQL service → แท็บ **Connect** → copy **DATABASE_URL** ไว้ใช้ตอนรัน migration

---

## ขั้นตอนที่ 4 — ตั้งค่า Environment Variables

ไปที่ Node.js service → แท็บ **Variables** → เพิ่มตัวแปรดังนี้:

### 🔴 จำเป็นต้องตั้ง (Required)

| Variable | ค่า | หมายเหตุ |
|----------|-----|----------|
| `NODE_ENV` | `production` | เปิด SSL DB |
| `LINE_CHANNEL_ACCESS_TOKEN` | `xxxx` | จาก LINE Developers Console |
| `LINE_CHANNEL_SECRET` | `xxxx` | จาก LINE Developers Console |
| `JWT_SECRET` | สุ่มค่าแรนดอม เช่น `togkun-hr-2026-xK9mPqR` | ใช้สำหรับ sign JWT token |
| `ADMIN_USER` | `admin` | username เข้า admin panel |
| `ADMIN_PASS` | รหัสผ่านที่ต้องการ | password เข้า admin panel |
| `OFFICE_LAT` | `13.7563` | ละติจูดออฟฟิศ |
| `OFFICE_LNG` | `100.5018` | ลองจิจูดออฟฟิศ |
| `OFFICE_RADIUS_METERS` | `300` | รัศมี GPS check-in (เมตร) |

> ⚠️ `DATABASE_URL` และ `PORT` — Railway ตั้งให้อัตโนมัติ ไม่ต้องใส่

### 🟡 LIFF IDs (จาก LINE Developers Console)

| Variable | endpoint |
|----------|----------|
| `LIFF_ID` | `/liff/leave` |
| `LIFF_ID_OT` | `/liff/ot` |
| `LIFF_ID_OT_HISTORY` | `/liff/ot-history` |
| `LIFF_ID_PAYSLIP` | `/liff/payslip` |
| `LIFF_ID_CHECKIN` | `/liff/checkin` |
| `LIFF_ID_HISTORY` | `/liff/history` |
| `LIFF_ID_PROFILE` | `/liff/profile` |

### 🟢 Email Notification (ถ้าต้องการแจ้งเตือนทางอีเมล)

| Variable | ค่า |
|----------|-----|
| `EMAIL_PROVIDER` | `gmail` |
| `EMAIL_FROM_NAME` | `ต่อกัน HR` |
| `EMAIL_USER` | `hr@togkun.com` |
| `EMAIL_APP_PASSWORD` | App Password จาก Google |

---

## ขั้นตอนที่ 5 — รัน Database Migrations

หลัง deploy สำเร็จ ต้องรัน SQL **ตามลำดับ** บน Railway DB (DB ใหม่ว่างเปล่า ต้องรันทั้งหมด)

> **ลำดับการรัน:** schema → v2 → v3 → v4 → v5 → v6 → ... → v23

### วิธีที่ 1: ผ่าน Railway CLI (แนะนำ)

```bash
# ติดตั้ง Railway CLI
npm install -g @railway/cli

# Login และ link project
railway login
railway link

# ── Base Schema (สร้างตารางหลักทั้งหมด) ──
railway run psql $DATABASE_URL -f database/schema.sql

# ── Migrations v2–v5 (อยู่ใน database/) ──
railway run psql $DATABASE_URL -f database/migration_v2.sql
railway run psql $DATABASE_URL -f database/migration_v3.sql
railway run psql $DATABASE_URL -f database/migration_v4.sql
railway run psql $DATABASE_URL -f database/migration_v5.sql

# ── Migrations v6–v23 (อยู่ใน sql/) ──
railway run psql $DATABASE_URL -f sql/migration_v6.sql
railway run psql $DATABASE_URL -f sql/migration_v7.sql
railway run psql $DATABASE_URL -f sql/migration_v8.sql
railway run psql $DATABASE_URL -f sql/migration_v9.sql
railway run psql $DATABASE_URL -f sql/migration_v10.sql
railway run psql $DATABASE_URL -f sql/migration_v11.sql
railway run psql $DATABASE_URL -f sql/migration_v12.sql
railway run psql $DATABASE_URL -f sql/migration_v13.sql
railway run psql $DATABASE_URL -f sql/migration_v14.sql
railway run psql $DATABASE_URL -f sql/migration_v15.sql
railway run psql $DATABASE_URL -f sql/migration_v16.sql
railway run psql $DATABASE_URL -f sql/migration_v17.sql
railway run psql $DATABASE_URL -f sql/migration_v18.sql
railway run psql $DATABASE_URL -f sql/migration_v19.sql
railway run psql $DATABASE_URL -f sql/migration_v20.sql
railway run psql $DATABASE_URL -f sql/migration_v21.sql
railway run psql $DATABASE_URL -f sql/migration_v22.sql
railway run psql $DATABASE_URL -f sql/migration_v23.sql
```

### วิธีที่ 2: ผ่าน pgAdmin (ถ้ามี psql ไม่ได้)

1. ไปที่ Railway → PostgreSQL service → แท็บ **Connect**
2. copy ค่า: `Host`, `Port`, `Database`, `Username`, `Password`
3. เปิด pgAdmin → เพิ่ม Server ใหม่ด้วยค่าเหล่านี้ (ติ๊ก SSL required)
4. เปิด Query Tool → รัน sql ไฟล์ตามลำดับ v6 → v23

---

## ขั้นตอนที่ 6 — รับ URL ของ App

หลัง deploy สำเร็จ:
1. ไปที่ Node.js service → แท็บ **Settings** → **Domains**
2. คลิก **Generate Domain** → จะได้ URL เช่น `line-hr-system-production.up.railway.app`
3. เก็บ URL นี้ไว้ใช้ขั้นตอนถัดไป

---

## ขั้นตอนที่ 7 — อัปเดต LINE Developers Console

### 7.1 Webhook URL
1. ไปที่ [LINE Developers Console](https://developers.line.biz)
2. เลือก Channel → **Messaging API** → **Webhook URL**
3. ใส่: `https://YOUR_RAILWAY_URL/webhook`
4. คลิก **Verify** → ต้องขึ้น Success

### 7.2 LIFF Endpoint URLs
1. ไปที่ Channel → **LIFF** → แก้ไขแต่ละ LIFF app
2. อัปเดต **Endpoint URL** ตามตาราง:

| LIFF App | Endpoint URL |
|----------|-------------|
| leave | `https://YOUR_RAILWAY_URL/liff/leave` |
| ot | `https://YOUR_RAILWAY_URL/liff/ot` |
| ot-history | `https://YOUR_RAILWAY_URL/liff/ot-history` |
| payslip | `https://YOUR_RAILWAY_URL/liff/payslip` |
| checkin | `https://YOUR_RAILWAY_URL/liff/checkin` |
| history | `https://YOUR_RAILWAY_URL/liff/history` |
| profile | `https://YOUR_RAILWAY_URL/liff/profile` |

---

## ขั้นตอนที่ 8 — ทดสอบหลัง Deploy

### ✅ Checklist

- [ ] เปิด `https://YOUR_RAILWAY_URL/health` → ต้องขึ้น `{"status":"ok"}`
- [ ] เปิด `https://YOUR_RAILWAY_URL/admin` → หน้า login ขึ้น
- [ ] Login ด้วย ADMIN_USER / ADMIN_PASS → เข้าได้
- [ ] ส่งข้อความทาง LINE → bot ตอบ
- [ ] เปิด LIFF leave → โหลดได้
- [ ] Check-in ผ่าน LIFF → บันทึกได้

---

## Troubleshooting ที่พบบ่อย

| ปัญหา | สาเหตุ | วิธีแก้ |
|-------|--------|---------|
| App crash ทันที | ขาด env var | ดู Logs → หา "Cannot read env" |
| DB connection fail | DATABASE_URL ผิด | ตรวจ Railway PostgreSQL Variables |
| Webhook verify fail | URL ผิดหรือ app ยังไม่ขึ้น | รอ deploy เสร็จ แล้ว verify ใหม่ |
| LIFF โหลดไม่ขึ้น | LIFF_ID ยังเป็นค่าเก่า | อัปเดต env var + LIFF endpoint URL |
| Admin login ไม่ได้ | JWT_SECRET ไม่ตรง | ตั้ง JWT_SECRET ใน Railway ให้ตรงกัน |

---

## ดู Logs

Railway → Node.js service → แท็บ **Logs** — ดู real-time logs ได้ทันที

หรือผ่าน CLI:
```bash
railway logs
```
