require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const { handleEvent } = require('./handlers/messageHandler');

// ---- LINE SDK Config ----
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient(lineConfig);
const app = express();

// ---- Webhook Endpoint ----
app.post('/webhook', line.middleware(lineConfig), (req, res) => {
  // ตอบ LINE ทันที ก่อน process เพื่อไม่ให้ timeout
  res.status(200).json({ status: 'ok' });

  const events = req.body.events;
  Promise.all(events.map(event => handleEvent(client, event)))
    .catch(err => console.error('Webhook error:', err));
});

// ---- Static Files (LIFF) ----
app.use(express.static(require('path').join(__dirname, '../public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store');
  }
}));

// ---- LIFF Leave Form ----
app.get('/liff/leave', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../public/liff/leave.html'));
});

// ---- LIFF Leave History ----
app.get('/liff/history', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../public/liff/history.html'));
});

// ---- LIFF Clock In/Out ----
app.get('/liff/checkin', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../public/liff/checkin.html'));
});

// ---- LIFF OT Request ----
app.get('/liff/ot', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../public/liff/ot.html'));
});

// ---- LIFF OT History ----
app.get('/liff/ot-history', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../public/liff/ot-history.html'));
});

// ---- LIFF Profile ----
app.get('/liff/profile', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../public/liff/profile.html'));
});

// ---- Admin Login Page ----
app.get('/admin/login', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../public/admin/login.html'));
});

// ---- Admin Dashboard ----
app.get('/admin', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(require('path').join(__dirname, '../public/admin/index.html'));
});

// ---- Health Check ----
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ---- Public Config (office coords สำหรับ LIFF GPS check) ----
app.get('/api/config', (req, res) => {
  res.json({
    office_lat:       parseFloat(process.env.OFFICE_LAT    || '13.7563'),
    office_lng:       parseFloat(process.env.OFFICE_LNG    || '100.5018'),
    office_radius:    parseFloat(process.env.OFFICE_RADIUS_METERS || '300'),
    liff_id_checkin:  process.env.LIFF_ID_CHECKIN  || '',
    liff_id_history:  process.env.LIFF_ID_HISTORY  || '',
    liff_id_profile:  process.env.LIFF_ID_PROFILE  || '',
  });
});

// ---- API Routes (สำหรับ LIFF และ Admin) ----
app.use(express.json());
app.use('/api/auth',        require('./routes/authRoutes'));
app.use('/api/leave',       require('./routes/leaveRoutes'));
app.use('/api/attendance',  require('./routes/attendanceRoutes'));
app.use('/api/employee',    require('./routes/employeeRoutes'));
app.use('/api/holidays',    require('./routes/holidayRoutes'));
app.use('/api/department',  require('./routes/departmentRoutes'));
app.use('/api/ot',          require('./routes/otRoutes'));
app.use('/api/report',      require('./routes/reportRoutes'));
app.use('/api/broadcast',   require('./routes/broadcastRoutes'));
app.use('/api/settings',    require('./routes/settingsRoutes'));
app.use('/api/payroll',     require('./routes/payrollRoutes'));
app.use('/api/expense',     require('./routes/expenseRoutes'));
app.use('/api/admin-users', require('./routes/adminUserRoutes'));
app.use('/api/shift',          require('./routes/shiftRoutes'));
app.use('/api/leave-quota',    require('./routes/leaveQuotaRoutes'));
app.use('/api/probation-eval', require('./routes/probationEvalRoutes'));
app.use('/api/branch',         require('./routes/branchRoutes'));
app.use('/api/custom-roles',   require('./routes/customRoleRoutes'));

// ---- LIFF Payslip ----
app.get('/liff/payslip', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../public/liff/payslip.html'));
});

// ---- LIFF Expense Claim ----
app.get('/liff/expense', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../public/liff/expense.html'));
});

// ---- Cron Jobs ----
if (process.env.NODE_ENV !== 'test') {
  require('./jobs/reminderCron');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 LINE HR Server running on port ${PORT}`);
  console.log(`Webhook: http://localhost:${PORT}/webhook`);
});
