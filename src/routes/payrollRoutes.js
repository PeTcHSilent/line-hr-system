const express = require('express');
const router  = express.Router();
const db             = require('../db');
const payrollService    = require('../services/payrollService');
const lateAbsentService = require('../services/lateAbsentService');
const employeeService   = require('../services/employeeService');
const audit             = require('../services/auditService');
const { requireAuth }   = require('../middleware/authMiddleware');

// GET /api/payroll?year=&month=  — ดึง payroll records ทั้งเดือน (admin)
router.get('/', requireAuth, async (req, res) => {
  try {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const data  = await payrollService.getPayroll(year, month);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/payroll/generate  — คำนวณ + บันทึก payroll ทั้งบริษัท (admin)
// ส่ง force=true เพื่อ recalculate แม้ record จะเป็น confirmed/paid แล้ว
router.post('/generate', requireAuth, async (req, res) => {
  try {
    const year  = parseInt(req.body.year)  || new Date().getFullYear();
    const month = parseInt(req.body.month) || new Date().getMonth() + 1;
    const force = req.body.force === true || req.body.force === 'true';
    const data  = await payrollService.generatePayroll(year, month, force);
    audit.log({
      actorName:   req.admin.display_name || req.admin.username,
      actorRole:   req.admin.role,
      action:      'generate_payroll',
      targetType:  'payroll',
      targetId:    null,
      description: 'สร้าง Payroll เดือน ' + month + '/' + year + ' จำนวน ' + data.length + ' คน',
      meta:        { year, month, force, count: data.length },
    });
    res.json({ success: true, count: data.length, payroll: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/payroll/settings  — ดึง payroll settings ปัจจุบัน
router.get('/settings', async (req, res) => {
  try {
    res.json(await payrollService.getPayrollSettings());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/payroll/payslip?employee_id=&year=&month=  — payslip รายคน (admin)
router.get('/payslip', requireAuth, async (req, res) => {
  try {
    const { employee_id, year, month } = req.query;
    if (!employee_id) return res.status(400).json({ error: 'ต้องระบุ employee_id' });
    const data = await payrollService.getPayslip(
      parseInt(employee_id),
      parseInt(year)  || new Date().getFullYear(),
      parseInt(month) || new Date().getMonth() + 1
    );
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/payroll/my-payslip?line_user_id=&year=&month=  — LIFF (ไม่ต้อง auth)
router.get('/my-payslip', async (req, res) => {
  try {
    const { line_user_id, year, month } = req.query;
    if (!line_user_id) return res.status(400).json({ error: 'ต้องระบุ line_user_id' });
    const emp = await employeeService.findByLineId(line_user_id);
    if (!emp) return res.status(404).json({ error: 'ไม่พบพนักงาน' });
    const data = await payrollService.getPayslip(
      emp.id,
      parseInt(year)  || new Date().getFullYear(),
      parseInt(month) || new Date().getMonth() + 1
    );
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/payroll/bulk-status  — อัปเดตสถานะทั้งเดือน (admin)
// body: { year, month, status: 'confirmed' | 'paid' }
// เมื่อ paid จะ push LINE Payslip ให้พนักงานทุกคนที่มี line_user_id ด้วย
router.patch('/bulk-status', requireAuth, async (req, res) => {
  try {
    const year   = parseInt(req.body.year)   || new Date().getFullYear();
    const month  = parseInt(req.body.month)  || new Date().getMonth() + 1;
    const status = req.body.status;

    const updated = await payrollService.bulkUpdatePayrollStatus(year, month, status);

    let lineResult = null;
    if (status === 'paid' && updated > 0) {
      try {
        lineResult = await payrollService.sendPayslipsViaLine(year, month);
      } catch (lineErr) {
        console.error('[bulk-status] sendPayslipsViaLine error:', lineErr.message);
        lineResult = { sent: 0, failed: 0, error: lineErr.message };
      }
    }

    audit.log({
      actorName:   req.admin.display_name || req.admin.username,
      actorRole:   req.admin.role,
      action:      'payroll_bulk_' + status,
      targetType:  'payroll',
      targetId:    null,
      description: 'เปลี่ยนสถานะ Payroll ' + month + '/' + year + ' เป็น ' + status + ' (' + updated + ' รายการ)',
      meta:        { year, month, status, updated },
    });
    res.json({ success: true, updated, status, lineResult });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PATCH /api/payroll/:id/status  — อัปเดตสถานะ (admin)
router.patch('/:id/status', requireAuth, async (req, res) => {
  try {
    const result = await payrollService.updatePayrollStatus(
      parseInt(req.params.id),
      req.body.status
    );
    res.json({ success: true, record: result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// PATCH /api/payroll/:id/bonus  — ตั้งโบนัสสำหรับ payroll record (admin, draft only)
router.patch('/:id/bonus', requireAuth, async (req, res) => {
  try {
    const id     = parseInt(req.params.id);
    const bonus  = parseFloat(req.body.bonus);
    if (isNaN(bonus) || bonus < 0) throw new Error('โบนัสต้องเป็นตัวเลขที่ไม่ติดลบ');
    const result = await db.query(
      `UPDATE payroll_records SET bonus = $1, updated_at = NOW()
       WHERE id = $2 AND status = 'draft' RETURNING id, bonus`,
      [bonus, id]
    );
    if (!result.rows[0]) throw new Error('ไม่พบ payroll record หรือ status ไม่ใช่ draft');
    res.json({ success: true, record: result.rows[0] });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// GET /api/payroll/warnings?year=&month=&type=  — รายการสาย/ขาด (admin)
router.get('/warnings', requireAuth, async (req, res) => {
  try {
    const { year, month, employee_id, type } = req.query;
    const data = await lateAbsentService.getWarnings({
      year:       year        ? parseInt(year)        : null,
      month:      month       ? parseInt(month)       : null,
      employeeId: employee_id ? parseInt(employee_id) : null,
      type:       type        || null,
    });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/payroll/check-late-absent  — trigger manual check (admin)
router.post('/check-late-absent', requireAuth, async (req, res) => {
  try {
    const date = req.body.date || new Date().toISOString().split('T')[0];
    const result = await lateAbsentService.checkLateAbsent(date);
    res.json({ success: true, date, result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/payroll/export?year=&month=  — ดาวน์โหลด Excel (admin)
router.get('/export', requireAuth, async (req, res) => {
  try {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const { workbook, periodTH } = await payrollService.exportPayrollExcel(year, month);

    const filename = encodeURIComponent(`Payroll_${year}_${String(month).padStart(2,'0')}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/payroll/send-payslips  — push Flex Message สลิปเงินเดือนให้พนักงานทุกคนผ่าน LINE
router.post('/send-payslips', requireAuth, async (req, res) => {
  try {
    const year  = parseInt(req.body.year)  || new Date().getFullYear();
    const month = parseInt(req.body.month) || new Date().getMonth() + 1;
    const result = await payrollService.sendPayslipsViaLine(year, month);
    audit.log({
      actorName:   req.admin.display_name || req.admin.username,
      actorRole:   req.admin.role,
      action:      'send_payslips',
      targetType:  'payroll',
      targetId:    null,
      description: 'ส่ง Payslip ผ่าน LINE เดือน ' + month + '/' + year + ' สำเร็จ ' + (result.sent || 0) + ' คน',
      meta:        { year, month, sent: result.sent, failed: result.failed },
    });
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/payroll/monthly?year=&month=&department_id=  — alias with dept filter
router.get('/monthly', requireAuth, async (req, res) => {
  try {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const deptId    = req.query.department_id ? parseInt(req.query.department_id) : null;
    const branchId  = req.query.branch_id     ? parseInt(req.query.branch_id)     : null;
    let data = await payrollService.getPayroll(year, month);
    if (deptId)   data = data.filter(r => r.department_id === deptId);
    if (branchId) data = data.filter(r => r.branch_id     === branchId);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// GET /api/payroll/export-wage-sheet?year=&month=  — บัญชีคำนวณค่าจ้าง ค่าล่วงเวลา
router.get('/export-wage-sheet', requireAuth, async (req, res) => {
  try {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const { workbook } = await payrollService.exportWageSheet(year, month);
    const filename = encodeURIComponent(`WageSheet_${year}_${String(month).padStart(2,'0')}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/payroll/:employeeId/special-allowance  — บันทึก เบี้ยพิเศษ + หมายเหตุ
router.patch('/:employeeId/special-allowance', requireAuth, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { year, month, special_allowance, special_allowance_note } = req.body;
    if (!year || !month) return res.status(400).json({ error: 'year and month required' });
    const db = require('../db');
    // UPDATE เฉพาะ record ที่มีอยู่แล้ว (payroll ต้อง generate ก่อน)
    // ถ้ายังไม่มี record ให้ return success เฉยๆ (ไม่ INSERT เพื่อหลีกเลี่ยง FK error)
    const { rowCount } = await db.query(
      `UPDATE payroll_records SET
         special_allowance=$4, special_allowance_note=$5, updated_at=NOW()
       WHERE employee_id=$1 AND year=$2 AND month=$3`,
      [employeeId, year, month, parseFloat(special_allowance||0), special_allowance_note||'']
    );
    res.json({ success: true, updated: rowCount > 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════
// GET /api/payroll/bank-transfer?year=&month=&format=kbank|scb|bbl
// ดาวน์โหลดไฟล์โอนเงินเดือนผ่านธนาคาร
// ══════════════════════════════════════════════════════════════════
router.get('/bank-transfer', requireAuth, async (req, res) => {
  try {
    const year   = parseInt(req.query.year)   || new Date().getFullYear();
    const month  = parseInt(req.query.month)  || new Date().getMonth() + 1;
    const format = (req.query.format || 'kbank').toLowerCase();

    // ดึง payroll + bank account ของพนักงาน
    const { rows } = await db.query(
      `SELECT pr.employee_id, pr.net_income,
              e.name, e.employee_code,
              e.bank_name, e.bank_account_no, e.bank_account_name, e.bank_branch,
              d.name AS department_name
       FROM payroll_records pr
       JOIN employees e ON e.id = pr.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE pr.year = $1 AND pr.month = $2
         AND pr.status IN ('confirmed','paid')
         AND pr.net_income > 0
         AND e.bank_account_no IS NOT NULL AND e.bank_account_no <> ''
       ORDER BY e.employee_code`,
      [year, month]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: 'ไม่พบข้อมูล payroll ที่ confirmed/paid หรือไม่มีพนักงานที่มีเลขบัญชี'
      });
    }

    // ดึง company info
    const compRows = await db.query(
      `SELECT key, value FROM company_settings WHERE key IN
         ('company_name','company_bank_account','company_bank_name')`
    );
    const compConf = {};
    compRows.rows.forEach(r => { compConf[r.key] = r.value || ''; });

    const companyName  = compConf['company_name']         || 'COMPANY';
    const companyAcct  = compConf['company_bank_account'] || '0000000000';
    const periodStr    = `${year}${String(month).padStart(2,'0')}`;
    const today        = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fmt2         = (n) => parseFloat(n || 0).toFixed(2);

    let content = '';

    if (format === 'kbank') {
      // KBank Smart BIZ format (simplified text)
      content += `H|${today}|${companyName}|${companyAcct}|${rows.length}\n`;
      rows.forEach((r, i) => {
        const bankCode = bankNameToCode(r.bank_name);
        content += `D|${String(i+1).padStart(6,'0')}|${r.bank_account_no.replace(/-/g,'')}|${bankCode}|${fmt2(r.net_income)}|${r.bank_account_name || r.name}|${r.employee_code}\n`;
      });
      const total = rows.reduce((s, r) => s + parseFloat(r.net_income || 0), 0);
      content += `T|${rows.length}|${fmt2(total)}\n`;

    } else if (format === 'scb') {
      // SCB Business Net format
      content += `001|${companyAcct}|${periodStr}|${rows.length}|${fmt2(rows.reduce((s,r) => s+parseFloat(r.net_income||0),0))}\n`;
      rows.forEach((r, i) => {
        const bankCode = bankNameToCode(r.bank_name);
        content += `002|${String(i+1).padStart(5,'0')}|${bankCode}|${r.bank_account_no.replace(/-/g,'')}|${r.bank_account_name || r.name}|${fmt2(r.net_income)}|${r.employee_code}\n`;
      });

    } else if (format === 'bbl') {
      // Bangkok Bank format
      content += `TH01|${companyAcct}|${periodStr}00:00:00\n`;
      rows.forEach((r) => {
        const bankCode = bankNameToCode(r.bank_name);
        content += `${r.bank_account_no.replace(/-/g,'').padEnd(12)}|${bankCode}|${(r.bank_account_name || r.name).padEnd(30)}|${fmt2(r.net_income).replace('.','')}|${r.employee_code}\n`;
      });

    } else {
      // Generic CSV format
      content += `ลำดับ,รหัสพนักงาน,ชื่อพนักงาน,ธนาคาร,เลขบัญชี,ชื่อบัญชี,ยอดโอน,แผนก\n`;
      rows.forEach((r, i) => {
        content += `${i+1},${r.employee_code},"${r.name}","${r.bank_name||''}","${r.bank_account_no||''}","${r.bank_account_name||r.name}",${fmt2(r.net_income)},"${r.department_name||''}"\n`;
      });
    }

    const ext = format === 'csv' ? 'csv' : 'txt';
    const filename = encodeURIComponent(`BankTransfer_${format.toUpperCase()}_${year}_${String(month).padStart(2,'0')}.${ext}`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(content);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// helper: แปลงชื่อธนาคารเป็น รหัสธนาคาร (BAHTNET/ITMX)
function bankNameToCode(name) {
  const MAP = {
    'kbank': '004', 'กสิกร': '004', 'kasikorn': '004',
    'scb': '014', 'ไทยพาณิชย์': '014',
    'bbl': '002', 'กรุงเทพ': '002', 'bangkok bank': '002',
    'ktb': '006', 'กรุงไทย': '006',
    'bay': '025', 'กรุงศรี': '025', 'krungsri': '025',
    'ttb': '011', 'ทหารไทย': '011', 'tmb': '011',
    'uob': '024',
    'cimb': '022',
    'lhbank': '073',
    'gsb': '030', 'ออมสิน': '030',
    'baac': '034', 'ธกส': '034',
    'ghb': '033', 'อาคาร': '033',
  };
  if (!name) return '999';
  const key = name.toLowerCase().trim();
  for (const [k, v] of Object.entries(MAP)) {
    if (key.includes(k)) return v;
  }
  return '999';
}

module.exports = router;
