/**
 * taxRoutes.js — API สำหรับรายงานภาษีหัก ณ ที่จ่าย
 *
 * GET  /api/tax/years               — ปีที่มีข้อมูล payroll
 * GET  /api/tax/pnd1?year=&month=   — ภ.ง.ด.1 รายเดือน (JSON)
 * GET  /api/tax/pnd1k?year=         — ภ.ง.ด.1ก รายปี (JSON)
 * GET  /api/tax/ytd?year=           — YTD Summary (JSON)
 * GET  /api/tax/pnd1/csv?year=&month= — export ภ.ง.ด.1 เป็น CSV
 * GET  /api/tax/pnd1k/csv?year=       — export ภ.ง.ด.1ก เป็น CSV
 * GET  /api/tax/ytd/csv?year=         — export YTD เป็น CSV
 */

'use strict';
const express = require('express');
const router  = express.Router();
const taxService = require('../services/taxService');

// ─── helper: build CSV ────────────────────────────────────────────────────
function toCSV(headers, rows) {
  const escape = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [
    headers.map(escape).join(','),
    ...rows.map(r => r.map(escape).join(',')),
  ];
  return '﻿' + lines.join('\r\n'); // BOM สำหรับ Excel ภาษาไทย
}

function fmt(n) { return (parseFloat(n) || 0).toFixed(2); }

// ─── GET /api/tax/years ───────────────────────────────────────────────────
router.get('/years', async (req, res) => {
  try {
    const years = await taxService.getAvailableYears();
    res.json(years);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/tax/pnd1 ───────────────────────────────────────────────────
router.get('/pnd1', async (req, res) => {
  const year  = parseInt(req.query.year)  || new Date().getFullYear();
  const month = parseInt(req.query.month) || new Date().getMonth() + 1;
  try {
    const data = await taxService.getPND1(year, month);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/tax/pnd1k ──────────────────────────────────────────────────
router.get('/pnd1k', async (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  try {
    const data = await taxService.getPND1K(year);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/tax/ytd ────────────────────────────────────────────────────
router.get('/ytd', async (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  try {
    const data = await taxService.getYTDSummary(year);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/tax/pnd1/csv ───────────────────────────────────────────────
router.get('/pnd1/csv', async (req, res) => {
  const year  = parseInt(req.query.year)  || new Date().getFullYear();
  const month = parseInt(req.query.month) || new Date().getMonth() + 1;
  try {
    const data = await taxService.getPND1(year, month);
    const headers = [
      'ลำดับ', 'เลขบัตรประชาชน/ผู้เสียภาษี', 'คำนำหน้า', 'ชื่อ-สกุล',
      'รหัสพนักงาน', 'แผนก', 'สาขา',
      'เงินเดือน', 'OT', 'โบนัส', 'เบี้ยเลี้ยง', 'รายได้รวม',
      'ประกันสังคม', 'กองทุนสำรองเลี้ยงชีพ', 'ภาษีหัก ณ ที่จ่าย',
      'รายได้สุทธิ',
    ];
    const rows = data.rows.map(r => [
      r.seq, r.tax_id, r.name_prefix, r.employee_name,
      r.employee_code, r.department_name || '', r.branch_name || '',
      fmt(r.base_salary), fmt(r.ot_pay), fmt(r.bonus), fmt(r.special_allowance),
      fmt(r.gross_income),
      fmt(r.social_security), fmt(r.provident_fund), fmt(r.tax_withholding),
      fmt(r.net_income),
    ]);
    // รวม
    rows.push([
      'รวม', '', '', '', '', '', '',
      '', '', '', '',
      fmt(data.totals.gross_income),
      fmt(data.totals.social_security), fmt(data.totals.provident_fund),
      fmt(data.totals.tax_withholding),
      fmt(data.totals.net_income),
    ]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="PND1_${year}_${String(month).padStart(2,'0')}.csv"`);
    res.send(toCSV(headers, rows));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/tax/pnd1k/csv ──────────────────────────────────────────────
router.get('/pnd1k/csv', async (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  try {
    const data = await taxService.getPND1K(year);
    const headers = [
      'ลำดับ', 'เลขบัตรประชาชน/ผู้เสียภาษี', 'คำนำหน้า', 'ชื่อ-สกุล',
      'รหัสพนักงาน', 'แผนก', 'สาขา', 'จำนวนเดือน',
      'รายได้รวมทั้งปี', 'เงินเดือนรวม', 'OT รวม', 'โบนัสรวม',
      'ประกันสังคมรวม', 'กองทุนสำรองเลี้ยงชีพรวม',
      'ภาษีหัก ณ ที่จ่ายรวม', 'รายได้สุทธิรวม',
    ];
    const rows = data.rows.map(r => [
      r.seq, r.tax_id, r.name_prefix, r.employee_name,
      r.employee_code, r.department_name || '', r.branch_name || '',
      r.months_paid,
      fmt(r.ytd_gross), fmt(r.ytd_salary), fmt(r.ytd_ot_pay), fmt(r.ytd_bonus),
      fmt(r.ytd_ss), fmt(r.ytd_pf),
      fmt(r.ytd_tax), fmt(r.ytd_net),
    ]);
    rows.push([
      'รวม', '', '', '', '', '', '', '',
      fmt(data.totals.ytd_gross), '', '', '',
      fmt(data.totals.ytd_ss), fmt(data.totals.ytd_pf),
      fmt(data.totals.ytd_tax), fmt(data.totals.ytd_net),
    ]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="PND1K_${year}.csv"`);
    res.send(toCSV(headers, rows));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET /api/tax/ytd/csv ────────────────────────────────────────────────
router.get('/ytd/csv', async (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  try {
    const data = await taxService.getYTDSummary(year);
    const headers = [
      'เดือน', 'พนักงาน (คน)', 'เงินเดือนรวม', 'OT รวม', 'โบนัสรวม',
      'รายได้รวม', 'ประกันสังคมรวม', 'กองทุนสำรองเลี้ยงชีพรวม',
      'ภาษีหัก ณ ที่จ่ายรวม', 'รายได้สุทธิรวม',
      'YTD รายได้สะสม', 'YTD ภาษีสะสม', 'YTD สุทธิสะสม',
    ];
    const rows = data.monthly.map(r => [
      r.month_name, r.head_count,
      fmt(r.total_salary), fmt(r.total_ot), fmt(r.total_bonus),
      fmt(r.gross),
      fmt(r.total_ss), fmt(r.total_pf), fmt(r.total_tax), fmt(r.total_net),
      fmt(r.ytd_gross), fmt(r.ytd_tax), fmt(r.ytd_net),
    ]);
    rows.push([
      'รวมทั้งปี', '', '', fmt(data.totals.total_ot), fmt(data.totals.total_bonus),
      fmt(data.totals.gross),
      fmt(data.totals.total_ss), fmt(data.totals.total_pf),
      fmt(data.totals.total_tax), fmt(data.totals.total_net),
      '', '', '',
    ]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="YTD_${year}.csv"`);
    res.send(toCSV(headers, rows));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
