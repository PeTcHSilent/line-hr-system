# LINE HR System

ระบบ HR ของพนักงานผ่าน LINE OA — ลางาน, เช็คอิน/เช็คเอาท์, OT, ประกาศ

---

## 📁 โครงสร้างโปรเจค

```
line-hr-system/
├── src/
│   ├── index.js                  # Entry point, Express + Webhook
│   ├── db.js                     # PostgreSQL connection pool
│   ├── handlers/
│   │   └── messageHandler.js     # จัดการ LINE events ทั้งหมด
│   ├── services/
│   │   ├── employeeService.js    # ข้อมูลพนักงาน, วันลาคงเหลือ
│   │   ├── leaveService.js       # คำขอลา, อนุมัติ, ปฏิทิน
│   │   └── attendanceService.js  # เช็คอิน/เช็คเอาท์
│   ├── routes/
│   │   ├── leaveRoutes.js        # POST /api/leave
│   │   ├── attendanceRoutes.js   # POST /api/attendance/checkin|checkout
│   │   └── employeeRoutes.js     # POST /api/employee/register
│   └── utils/
│       └── flexMessages.js       # Flex Message Templates
├── database/
│   ├── schema.sql                # ตาราง PostgreSQL ทั้งหมด
│   └── migrate.js                # รัน migration
├── liff/                         # LIFF App (React) - TODO
├── .env.example
└── package.json
```

---

## 🚀 วิธีติดตั้งและรัน

### 1. ติดตั้ง Dependencies

```bash
cd line-hr-system
npm install
```

### 2. ตั้งค่า Environment Variables

```bash
cp .env.example .env
# แก้ไข .env ใส่ค่าจาก LINE Developers Console
```

### 3. สร้างฐานข้อมูล

```bash
# สร้าง database ใน PostgreSQL ก่อน
createdb hr_db

# รัน migration
npm run db:migrate
```

### 4. รัน Server

```bash
npm run dev   # Development (nodemon)
npm start     # Production
```

### 5. ตั้งค่า Webhook URL ใน LINE

เปิด [LINE Developers Console](https://developers.line.biz) แล้วตั้ง Webhook URL เป็น:
```
https://your-domain.com/webhook
```

> 💡 ระหว่าง development ใช้ [ngrok](https://ngrok.com) หรือ [localtunnel](https://localtunnel.me) เพื่อเปิด localhost ออก internet

```bash
ngrok http 3000
# จะได้ URL เช่น https://abc123.ngrok.io/webhook
```

---

## 📋 ฟีเจอร์ที่รองรับ

| ฟีเจอร์ | สถานะ |
|---------|-------|
| ลงทะเบียนผูก LINE กับรหัสพนักงาน | ✅ พร้อม |
| เช็คอิน / เช็คเอาท์ | ✅ พร้อม |
| ขอลางาน (ผ่าน LIFF) | 🔧 รอ LIFF |
| อนุมัติ/ปฏิเสธลา (หัวหน้า) | ✅ พร้อม |
| วันลาคงเหลือ | ✅ พร้อม |
| บันทึก OT | 🔧 TODO |
| ปฏิทินการลา | ✅ พร้อม (API) |
| Dashboard real-time | 🔧 TODO |
| ประกาศ HR | 🔧 TODO |

---

## 🔑 API Endpoints

| Method | Path | คำอธิบาย |
|--------|------|----------|
| POST | `/webhook` | LINE Webhook (LINE เรียก) |
| GET | `/health` | ตรวจสอบ server |
| POST | `/api/employee/register` | ผูก LINE กับรหัสพนักงาน |
| GET | `/api/employee/me` | ข้อมูลพนักงาน + วันลา |
| POST | `/api/leave` | สร้างคำขอลา |
| GET | `/api/leave/calendar` | ปฏิทินการลา |
| POST | `/api/attendance/checkin` | เช็คอิน |
| POST | `/api/attendance/checkout` | เช็คเอาท์ |
| GET | `/api/attendance/history` | ประวัติเช็คอิน |

---

## 🔜 ขั้นต่อไป

1. **สร้าง LIFF App** สำหรับแบบฟอร์มลางาน (React + Vite)
2. **สร้าง Rich Menu** ใน LINE OA
3. **เพิ่ม OT Module**
4. **สร้าง Admin Dashboard** สำหรับ HR

---

## 📞 สร้างโดย

IT Department — ใช้ร่วมกับ Claude (Cowork Mode)
