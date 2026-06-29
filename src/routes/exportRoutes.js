/**
 * exportRoutes.js
 * Excel export endpoints (ต้อง login admin)
 * GET /api/export/attendance?month=2026-06
 * GET /api/export/leave?month=2026-06&status=approved
 * GET /api/export/ot?month=2026-06&status=approved
 */
const express = require('express');
const router  = express.Router();
const ExcelJS = require('exceljs');
const db      = require('../db');
const { requireAuth } = require('../middleware/authMiddleware');

// ── helpers ─────────────────────────────────────────────────────────────────
const HEADER_BG   = 'FF1A2547';
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'TH SarabunPSK' };
const BODY_FONT   = { name: 'TH SarabunPSK', size: 11 };
const ALT_FILL    = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const BORDER_THIN = { style: 'thin', color: { argb: 'FFCBD5E1' } };

const thMo = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const fmtDate = d => {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  return `${dt.getDate()} ${thMo[dt.getMonth()]} ${dt.getFullYear() + 543}`;
};
const fmtTime = t => {
  if (!t) return '—';
  const dt = new Date(t);
  if (isNaN(dt)) return '—';
  return dt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
};
const monthLabel = (month) => {
  const [y, m] = month.split('-').map(Number);
  return `${thMo[m - 1]} พ.ศ. ${y + 543}`;
};
const lastDay = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).toISOString().split('T')[0];
};
const firstDay = (month) => {
  const [y, m] = month.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-01`;
};

function setupSheet(wb, sheetName, headers, colWidths, title) {
  const ws = wb.addWorksheet(sheetName);
  ws.properties.defaultRowHeight = 20;

  // Title row
  ws.mergeCells(1, 1, 1, headers.length);
  const titleCell = ws.getCell('A1');
  titleCell.value = title;
  titleCell.font  = { bold: true, size: 14, name: 'TH SarabunPSK', color: { argb: 'FF1A2547' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  // Header row
  const headerRow = ws.addRow(headers);
  headerRow.height = 24;
  headerRow.eachCell(cell => {
    cell.fill      = ALT_FILL(HEADER_BG);
    cell.font      = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border    = { bottom: BORDER_THIN, right: BORDER_THIN };
  });

  // Column widths
  colWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  return ws;
}

function addDataRow(ws, values, rowIndex, altArgb) {
  const row = ws.addRow(values);
  row.eachCell({ includeEmpty: true }, cell => {
    cell.font = BODY_FONT;
    if (rowIndex % 2 === 1) cell.fill = ALT_FILL(altArgb);
    cell.border = { bottom: BORDER_THIN, right: BORDER_THIN };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  return row;
}

function sendExcel(res, wb, filename) {
  res.setHeader('Content-Type',        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return wb.xlsx.write(res).then(() => res.end());
}

// ── GET /api/export/attendance ───────────────────────────────────────────────
router.get('/attendance', requireAuth, async (req, res) => {
  try {
    const { month, dept_id, branch_id } = req.query;
    if (!month) return res.status(400).json({ error: 'ต้องระบุ month (YYYY-MM)' });

    const params = [firstDay(month), lastDay(month)];
    let pi = 3;
    const conds = [];
    if (dept_id)   { conds.push(`e.department_id = $${pi++}`); params.push(dept_id); }
    if (branch_id) { conds.push(`e.branch_id = $${pi++}`);     params.push(branch_id); }
    const where = conds.length ? 'AND ' + conds.join(' AND ') : '';

    const { rows } = await db.query(`
      SELECT
        e.employee_code, e.name AS employee_name,
        d.name AS department_name, b.name AS branch_name,
        a.work_date, a.check_in, a.check_out,
        ROUND(EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600, 2) AS hours_worked,
        a.is_late,
        a.check_in_distance,  a.check_in_within_radius,
        a.check_out_distance, a.check_out_within_radius
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN branches    b ON b.id = e.branch_id
      WHERE a.work_date BETWEEN $1 AND $2 ${where}
      ORDER BY a.work_date, e.employee_code
    `, params);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'HR System';
    wb.created = new Date();

    const ws = setupSheet(
      wb, `Attendance`,
      ['รหัส','ชื่อพนักงาน','แผนก','สาขา','วันที่','เช็คอิน','เช็คเอาท์','ชั่วโมง','สถานะ','GPS เข้า (ม.)','GPS ออก (ม.)'],
      [8, 22, 15, 15, 14, 10, 10, 10, 10, 13, 13],
      `รายงานการเข้างาน — ${monthLabel(month)}`
    );

    let totalHours = 0;
    let lateCount  = 0;
    rows.forEach((r, i) => {
      totalHours += parseFloat(r.hours_worked || 0);
      if (r.is_late) lateCount++;

      const row = addDataRow(ws, [
        r.employee_code,
        r.employee_name,
        r.department_name || '—',
        r.branch_name     || '—',
        fmtDate(r.work_date),
        fmtTime(r.check_in),
        fmtTime(r.check_out),
        r.hours_worked ? parseFloat(r.hours_worked).toFixed(1) : '—',
        r.is_late ? 'มาสาย' : (r.check_in ? 'ปกติ' : 'ขาดงาน'),
        r.check_in_within_radius  === false ? `⚠️ ${r.check_in_distance  ?? ''}` : (r.check_in_distance  != null ? `✅ ${r.check_in_distance}`  : '—'),
        r.check_out_within_radius === false ? `⚠️ ${r.check_out_distance ?? ''}` : (r.check_out_distance != null ? `✅ ${r.check_out_distance}` : '—'),
      ], i, 'FFF0F4FF');

      const statusCell = row.getCell(9);
      if (r.is_late)       statusCell.font = { ...BODY_FONT, color: { argb: 'FFDC2626' }, bold: true };
      else if (!r.check_in) statusCell.font = { ...BODY_FONT, color: { argb: 'FFB45309' }, bold: true };
    });

    // Summary
    ws.addRow([]);
    const sr = ws.addRow([
      `รวม ${rows.length} รายการ | มาสาย ${lateCount} คน | รวมชั่วโมงทำงาน: ${totalHours.toFixed(1)} ชม.`
    ]);
    ws.mergeCells(sr.number, 1, sr.number, 11);
    sr.font = { bold: true, size: 11, name: 'TH SarabunPSK' };
    sr.getCell(1).alignment = { horizontal: 'center' };

    await sendExcel(res, wb, `attendance_${month}.xlsx`);
  } catch (e) {
    console.error('export/attendance error:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ── GET /api/export/leave ────────────────────────────────────────────────────
router.get('/leave', requireAuth, async (req, res) => {
  try {
    const { month, status } = req.query;
    if (!month) return res.status(400).json({ error: 'ต้องระบุ month (YYYY-MM)' });

    const params = [firstDay(month), lastDay(month)];
    const statusCond = status ? `AND lr.status = $3` : '';
    if (status) params.push(status);

    const { rows } = await db.query(`
      SELECT
        e.employee_code, e.name AS employee_name,
        d.name AS department_name, b.name AS branch_name,
        lt.name AS leave_type_name,
        lr.start_date, lr.end_date, lr.days_taken,
        lr.reason, lr.status, lr.created_at,
        ab.name AS approved_by_name
      FROM leave_requests lr
      JOIN employees e      ON e.id  = lr.employee_id
      LEFT JOIN departments d  ON d.id  = e.department_id
      LEFT JOIN branches    b  ON b.id  = e.branch_id
      LEFT JOIN leave_types lt ON lt.id = lr.leave_type_id
      LEFT JOIN employees   ab ON ab.id = lr.approved_by
      WHERE lr.start_date BETWEEN $1 AND $2 ${statusCond}
      ORDER BY lr.created_at DESC
    `, params);

    const statusMap = { approved: 'อนุมัติ', rejected: 'ไม่อนุมัติ', pending: 'รออนุมัติ' };
    const wb = new ExcelJS.Workbook();
    wb.creator = 'HR System';
    wb.created = new Date();

    const ws = setupSheet(
      wb, `Leave`,
      ['รหัส','ชื่อพนักงาน','แผนก','สาขา','ประเภทลา','วันที่เริ่ม','วันที่สิ้นสุด','จำนวนวัน','เหตุผล','สถานะ','อนุมัติโดย','วันที่ทำรายการ'],
      [8, 22, 14, 14, 15, 13, 13, 9, 22, 11, 18, 16],
      `รายงานการลา — ${monthLabel(month)}`
    );

    rows.forEach((r, i) => {
      const row = addDataRow(ws, [
        r.employee_code, r.employee_name,
        r.department_name || '—', r.branch_name || '—',
        r.leave_type_name || '—',
        fmtDate(r.start_date), fmtDate(r.end_date),
        r.days_taken || 1,
        r.reason     || '—',
        statusMap[r.status] || r.status,
        r.approved_by_name  || '—',
        fmtDate(r.created_at),
      ], i, 'FFF0FFF4');

      const statusCell = row.getCell(10);
      if      (r.status === 'approved') statusCell.font = { ...BODY_FONT, color: { argb: 'FF16A34A' }, bold: true };
      else if (r.status === 'rejected') statusCell.font = { ...BODY_FONT, color: { argb: 'FFDC2626' }, bold: true };
      else                              statusCell.font = { ...BODY_FONT, color: { argb: 'FFB45309' }, bold: true };
    });

    ws.addRow([]);
    const sr = ws.addRow([`รวม ${rows.length} รายการ | อนุมัติ ${rows.filter(r=>r.status==='approved').length} | ไม่อนุมัติ ${rows.filter(r=>r.status==='rejected').length} | รออนุมัติ ${rows.filter(r=>r.status==='pending').length}`]);
    ws.mergeCells(sr.number, 1, sr.number, 12);
    sr.font = { bold: true, size: 11, name: 'TH SarabunPSK' };
    sr.getCell(1).alignment = { horizontal: 'center' };

    await sendExcel(res, wb, `leave_${month}.xlsx`);
  } catch (e) {
    console.error('export/leave error:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ── GET /api/export/ot ───────────────────────────────────────────────────────
router.get('/ot', requireAuth, async (req, res) => {
  try {
    const { month, status } = req.query;
    if (!month) return res.status(400).json({ error: 'ต้องระบุ month (YYYY-MM)' });

    const params = [firstDay(month), lastDay(month)];
    const statusCond = status ? `AND o.status = $3` : '';
    if (status) params.push(status);

    const { rows } = await db.query(`
      SELECT
        e.employee_code, e.name AS employee_name,
        d.name AS department_name, b.name AS branch_name,
        o.ot_date, o.start_time, o.end_time, o.total_hours,
        o.reason, o.status, o.created_at,
        ab.name AS approved_by_name
      FROM ot_records o
      JOIN employees e      ON e.id  = o.employee_id
      LEFT JOIN departments d  ON d.id  = e.department_id
      LEFT JOIN branches    b  ON b.id  = e.branch_id
      LEFT JOIN employees   ab ON ab.id = o.approved_by
      WHERE o.ot_date BETWEEN $1 AND $2 ${statusCond}
      ORDER BY o.ot_date DESC
    `, params);

    const statusMap = { approved: 'อนุมัติ', rejected: 'ไม่อนุมัติ', pending: 'รออนุมัติ' };
    const wb = new ExcelJS.Workbook();
    wb.creator = 'HR System';
    wb.created = new Date();

    const ws = setupSheet(
      wb, `OT`,
      ['รหัส','ชื่อพนักงาน','แผนก','สาขา','วันที่ OT','เวลาเริ่ม','เวลาสิ้นสุด','ชั่วโมง OT','เหตุผล','สถานะ','อนุมัติโดย','วันที่ทำรายการ'],
      [8, 22, 14, 14, 13, 10, 10, 10, 22, 11, 18, 16],
      `รายงาน OT — ${monthLabel(month)}`
    );

    let totalHours = 0;
    rows.forEach((r, i) => {
      totalHours += parseFloat(r.total_hours || 0);
      const row = addDataRow(ws, [
        r.employee_code, r.employee_name,
        r.department_name || '—', r.branch_name || '—',
        fmtDate(r.ot_date),
        r.start_time || '—', r.end_time || '—',
        parseFloat(r.total_hours || 0).toFixed(1),
        r.reason     || '—',
        statusMap[r.status] || r.status,
        r.approved_by_name  || '—',
        fmtDate(r.created_at),
      ], i, 'FFFFF8F0');

      const statusCell = row.getCell(10);
      if      (r.status === 'approved') statusCell.font = { ...BODY_FONT, color: { argb: 'FF16A34A' }, bold: true };
      else if (r.status === 'rejected') statusCell.font = { ...BODY_FONT, color: { argb: 'FFDC2626' }, bold: true };
      else                              statusCell.font = { ...BODY_FONT, color: { argb: 'FFB45309' }, bold: true };
    });

    ws.addRow([]);
    const sr = ws.addRow([`รวม ${rows.length} รายการ | รวม OT ${totalHours.toFixed(1)} ชม. | อนุมัติ ${rows.filter(r=>r.status==='approved').length} รายการ`]);
    ws.mergeCells(sr.number, 1, sr.number, 12);
    sr.font = { bold: true, size: 11, name: 'TH SarabunPSK' };
    sr.getCell(1).alignment = { horizontal: 'center' };

    await sendExcel(res, wb, `ot_${month}.xlsx`);
  } catch (e) {
    console.error('export/ot error:', e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

module.exports = router;
