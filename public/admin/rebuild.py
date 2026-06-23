#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rebuild admin/index.html from admin_check.js + full HTML structure"""
import os, re

JS_PATH  = '/tmp/admin_check.js'
OUT_PATH = '/sessions/kind-magical-hawking/mnt/IT_Department/line-hr-system/public/admin/index.html'

# ── read & fix JS ──────────────────────────────────────────────────────────────
raw = open(JS_PATH, 'r', encoding='utf-8', errors='replace').read()
# fix truncated last line
if raw.rstrip().endswith("e.mess"):
    raw = raw.rstrip()[:-len("e.mess")] + "e.message, 'error'); }\n}\n"

EXTRA_JS = r"""
// ==================== SETTINGS ====================
async function loadSettings() {
  try {
    const res = await apiFetch(`${API}/api/settings`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const map = {};
    (Array.isArray(data) ? data : []).forEach(s => { map[s.key] = s.value; });
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    set('s-work-start',  map.work_start_time   || '08:30');
    set('s-work-end',    map.work_end_time     || '17:30');
    set('s-late-warn',   map.late_warn_minutes || '15');
    set('s-pay-day',     map.pay_day           || '25');
    set('s-ot-rate',     map.ot_rate           || '1.5');
    set('s-ss-rate',     map.ss_rate           || '5');
    set('s-pf-rate',     map.pf_rate           || '5');
    // Company info
    set('s-company-name',          map.company_name);
    set('s-company-phone',         map.company_phone);
    set('s-company-email',         map.company_email);
    set('s-company-address',       map.company_address);
    set('s-company-business-type', map.company_business_type);
    set('s-company-founded-date',  map.company_founded_date);
    set('s-company-tax-id',        map.company_tax_id);
    set('s-company-ss-number',     map.company_ss_number);
    set('s-employer-tax-id',       map.employer_tax_id);
    set('s-employer-ss-id',        map.employer_ss_id);
    set('s-bank-name',             map.bank_name);
    set('s-bank-account-number',   map.bank_account_number);
    set('s-bank-account-name',     map.bank_account_name);
  } catch(err) { toast('โหลด settings ล้มเหลว: ' + err.message, 'error'); }
}

async function saveSettings() {
  const get = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const payload = {
    work_start_time:        get('s-work-start'),
    work_end_time:          get('s-work-end'),
    late_warn_minutes:      get('s-late-warn'),
    pay_day:                get('s-pay-day'),
    ot_rate:                get('s-ot-rate'),
    ss_rate:                get('s-ss-rate'),
    pf_rate:                get('s-pf-rate'),
    company_name:           get('s-company-name').trim(),
    company_phone:          get('s-company-phone').trim(),
    company_email:          get('s-company-email').trim(),
    company_address:        get('s-company-address').trim(),
    company_business_type:  get('s-company-business-type').trim(),
    company_founded_date:   get('s-company-founded-date'),
    company_tax_id:         get('s-company-tax-id').trim(),
    company_ss_number:      get('s-company-ss-number').trim(),
    employer_tax_id:        get('s-employer-tax-id').trim(),
    employer_ss_id:         get('s-employer-ss-id').trim(),
    bank_name:              get('s-bank-name'),
    bank_account_number:    get('s-bank-account-number').trim(),
    bank_account_name:      get('s-bank-account-name').trim(),
  };
  try {
    const res = await apiFetch(`${API}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'บันทึกไม่สำเร็จ');
    toast('✅ บันทึกการตั้งค่าสำเร็จ');
  } catch(err) { toast('❌ ' + err.message, 'error'); }
}

// ==================== PAYROLL ====================
let payrollData = [], payrollInited = false;

function initPayroll() {
  if (!payrollInited) {
    const cy = new Date().getFullYear();
    const ySel = document.getElementById('pwl-year');
    if (ySel) {
      for (let y = cy; y >= cy - 2; y--) {
        const opt = document.createElement('option');
        opt.value = y; opt.textContent = `พ.ศ. ${y+543} (${y})`;
        if (y === cy) opt.selected = true;
        ySel.appendChild(opt);
      }
    }
    const mSel = document.getElementById('pwl-month');
    if (mSel) mSel.value = String(new Date().getMonth() + 1);
    const dSel = document.getElementById('pwl-dept');
    if (dSel) allDepts.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id; opt.textContent = d.name;
      dSel.appendChild(opt);
    });
    payrollInited = true;
  }
  loadPayroll();
}

async function loadPayroll() {
  const year  = document.getElementById('pwl-year')?.value;
  const month = document.getElementById('pwl-month')?.value;
  const dept  = document.getElementById('pwl-dept')?.value;
  const tbody = document.getElementById('pwl-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="13" class="no-data">⏳ กำลังโหลด...</td></tr>';
  try {
    let url = `${API}/api/payroll/monthly?year=${year}&month=${month}`;
    if (dept) url += `&department_id=${dept}`;
    const res = await apiFetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    payrollData = Array.isArray(json) ? json : (json.rows || json.data || []);
    renderPayroll();
  } catch(err) {
    tbody.innerHTML = `<tr><td colspan="13" class="no-data" style="color:#ef4444;">${err.message}</td></tr>`;
  }
}

function renderPayroll() {
  const tbody = document.getElementById('pwl-tbody');
  if (!payrollData.length) {
    tbody.innerHTML = '<tr><td colspan="13" class="no-data">ไม่พบข้อมูล — กด "สร้าง Payroll" เพื่อคำนวณ</td></tr>';
    return;
  }
  const fmt = n => parseFloat(n||0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const statusBadge = s => {
    const map = { draft:['#f3f4f6','#374151','แบบร่าง'], confirmed:['#dbeafe','#1d4ed8','ยืนยันแล้ว'], paid:['#dcfce7','#166534','จ่ายแล้ว'] };
    const [bg,col,txt] = map[s] || map.draft;
    return `<span style="background:${bg};color:${col};padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;">${txt}</span>`;
  };
  tbody.innerHTML = payrollData.map(r => `<tr>
    <td style="font-size:11px;color:#6b7280;">${r.employee_code||'—'}</td>
    <td>${r.employee_name||'—'}</td>
    <td style="font-size:12px;">${r.department_name||'—'}</td>
    <td style="text-align:right;font-family:monospace;">${fmt(r.base_salary)}</td>
    <td style="text-align:right;font-family:monospace;color:#ef4444;">-${fmt(r.late_deduction)}</td>
    <td style="text-align:right;font-family:monospace;">-${fmt(r.ss_amount)}</td>
    <td style="text-align:right;font-family:monospace;">-${fmt(r.pf_amount)}</td>
    <td style="text-align:right;font-family:monospace;">-${fmt(r.income_tax)}</td>
    <td style="text-align:right;font-family:monospace;">
      <input type="number" value="${r.bonus||0}" min="0" step="100"
        style="width:80px;border:1px solid #d1d5db;border-radius:4px;padding:2px 6px;text-align:right;"
        onchange="updateBonus(${r.id}, this.value)">
    </td>
    <td style="text-align:right;font-family:monospace;font-weight:700;color:#059669;">${fmt(r.net_salary)}</td>
    <td>${statusBadge(r.status)}</td>
    <td style="font-size:11px;color:#6b7280;">${r.note||'—'}</td>
    <td></td>
  </tr>`).join('');
}

async function generatePayroll() {
  const year  = document.getElementById('pwl-year')?.value;
  const month = document.getElementById('pwl-month')?.value;
  const dept  = document.getElementById('pwl-dept')?.value;
  if (!confirm(`สร้าง Payroll สำหรับเดือน ${month}/${year}?`)) return;
  try {
    const body = { year: parseInt(year), month: parseInt(month) };
    if (dept) body.department_id = parseInt(dept);
    const res = await apiFetch(`${API}/api/payroll/generate`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'สร้างไม่สำเร็จ');
    toast(`✅ สร้าง Payroll สำเร็จ ${d.count||''} รายการ`);
    loadPayroll();
  } catch(err) { toast('❌ ' + err.message, 'error'); }
}

async function confirmAllPayroll() {
  const year  = document.getElementById('pwl-year')?.value;
  const month = document.getElementById('pwl-month')?.value;
  if (!payrollData.length) { toast('ไม่มีข้อมูล', 'error'); return; }
  if (!confirm('ยืนยัน Payroll ทั้งหมด?')) return;
  try {
    const res = await apiFetch(`${API}/api/payroll/bulk-status`, {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ year: parseInt(year), month: parseInt(month), status: 'confirmed' })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'เกิดข้อผิดพลาด');
    toast('✅ ยืนยันสำเร็จ'); loadPayroll();
  } catch(err) { toast('❌ ' + err.message, 'error'); }
}

async function markAllPaid() {
  const year  = document.getElementById('pwl-year')?.value;
  const month = document.getElementById('pwl-month')?.value;
  if (!payrollData.length) { toast('ไม่มีข้อมูล', 'error'); return; }
  if (!confirm('Mark as Paid ทั้งหมด? จะส่ง payslip ผ่าน LINE ด้วย')) return;
  try {
    const res = await apiFetch(`${API}/api/payroll/bulk-status`, {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ year: parseInt(year), month: parseInt(month), status: 'paid' })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'เกิดข้อผิดพลาด');
    toast('✅ Mark as Paid สำเร็จ'); loadPayroll();
  } catch(err) { toast('❌ ' + err.message, 'error'); }
}

async function updateBonus(id, value) {
  try {
    const res = await apiFetch(`${API}/api/payroll/${id}/bonus`, {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ bonus: parseFloat(value) || 0 })
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'เกิดข้อผิดพลาด');
    toast('✅ บันทึก Bonus สำเร็จ'); loadPayroll();
  } catch(err) { toast('❌ ' + err.message, 'error'); }
}

function exportPayrollExcel() {
  const year  = document.getElementById('pwl-year')?.value;
  const month = document.getElementById('pwl-month')?.value;
  window.location.href = `${API}/api/payroll/export?year=${year}&month=${month}`;
}

// ==================== WARNINGS ====================
let warnData = [], warnInited = false;

function initWarnings() {
  if (!warnInited) {
    const cy = new Date().getFullYear();
    const ySel = document.getElementById('warn-year');
    if (ySel) {
      for (let y = cy; y >= cy - 2; y--) {
        const opt = document.createElement('option');
        opt.value = y; opt.textContent = `พ.ศ. ${y+543} (${y})`;
        if (y === cy) opt.selected = true;
        ySel.appendChild(opt);
      }
    }
    const mSel = document.getElementById('warn-month');
    if (mSel) mSel.value = String(new Date().getMonth() + 1);
    warnInited = true;
  }
  loadWarnings();
}

async function loadWarnings() {
  const year  = document.getElementById('warn-year')?.value;
  const month = document.getElementById('warn-month')?.value;
  const tbody = document.getElementById('warn-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="no-data">⏳ กำลังโหลด...</td></tr>';
  try {
    const res = await apiFetch(`${API}/api/attendance/warnings?year=${year}&month=${month}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    warnData = Array.isArray(json) ? json : (json.warnings || json.data || []);
    renderWarnings();
    const lates  = warnData.filter(w => w.warning_type === 'late').length;
    const absents = warnData.filter(w => w.warning_type === 'absent').length;
    const el = id => document.getElementById(id);
    if (el('warn-total'))  el('warn-total').textContent  = warnData.length;
    if (el('warn-late'))   el('warn-late').textContent   = lates;
    if (el('warn-absent')) el('warn-absent').textContent = absents;
  } catch(err) {
    tbody.innerHTML = `<tr><td colspan="7" class="no-data" style="color:#ef4444;">${err.message}</td></tr>`;
  }
}

function renderWarnings() {
  const tbody = document.getElementById('warn-tbody');
  if (!warnData.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="no-data">ไม่พบรายการ</td></tr>'; return;
  }
  tbody.innerHTML = warnData.map(w => {
    const typeBadge = w.warning_type === 'late'
      ? '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:20px;font-size:11px;">⏰ สาย</span>'
      : '<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:20px;font-size:11px;">❌ ขาด</span>';
    return `<tr>
      <td style="font-size:11px;color:#6b7280;">${w.employee_code||'—'}</td>
      <td>${w.employee_name||'—'}</td>
      <td style="font-size:12px;">${w.department_name||'—'}</td>
      <td>${typeBadge}</td>
      <td>${w.work_date||'—'}</td>
      <td>${w.warning_type==='late' ? (w.late_minutes||0)+' นาที' : '—'}</td>
      <td style="font-size:11px;color:#6b7280;">${w.note||'—'}</td>
    </tr>`;
  }).join('');
}
"""

# Inject dashboard into showPage titles dict + handler (avoids duplicate function declaration)
raw = raw.replace(
    "employees:'Employee Management'",
    "dashboard:'Dashboard', employees:'Employee Management'"
)
raw = raw.replace(
    "if (name === 'warnings') initWarnings();",
    "if (name === 'dashboard') loadDashboard();\n  if (name === 'warnings') initWarnings();"
)
JS = raw + EXTRA_JS

# ── HTML ───────────────────────────────────────────────────────────────────────
CSS = """
*{margin:0;padding:0;box-sizing:border-box;}
:root{
  --primary:#2563eb;--primary-dark:#1d4ed8;
  --sidebar-bg:#0f172a;--sidebar-hover:#1e293b;--sidebar-active:#2563eb;
  --bg:#f1f5f9;--card:#fff;--border:#e2e8f0;
  --text:#0f172a;--muted:#64748b;
  --success:#22c55e;--error:#ef4444;--warning:#f59e0b;
}
body{font-family:'Segoe UI',sans-serif;background:var(--bg);color:var(--text);font-size:14px;}
.app{display:flex;height:100vh;overflow:hidden;}
/* sidebar */
.sidebar{width:240px;background:var(--sidebar-bg);color:#e2e8f0;display:flex;flex-direction:column;flex-shrink:0;overflow-y:auto;}
.sidebar-header{padding:20px 16px 12px;border-bottom:1px solid #1e293b;}
.sidebar-logo{font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:1px;text-transform:uppercase;}
.sidebar-brand{font-size:15px;font-weight:700;color:#f1f5f9;margin-top:4px;line-height:1.3;}
.nav-section{padding:12px 0 4px;font-size:10px;font-weight:700;color:#475569;letter-spacing:1px;text-transform:uppercase;padding-left:16px;}
.nav-item{display:flex;align-items:center;gap:10px;padding:9px 16px;color:#94a3b8;text-decoration:none;cursor:pointer;transition:all .15s;font-size:13px;border-left:3px solid transparent;}
.nav-item:hover{background:var(--sidebar-hover);color:#f1f5f9;}
.nav-item.active{background:#1e3a5f;color:#fff;border-left-color:var(--primary);}
.nav-item svg{flex-shrink:0;opacity:.8;}
.sidebar-footer{margin-top:auto;padding:12px 16px;border-top:1px solid #1e293b;}
/* main */
.main{flex:1;display:flex;flex-direction:column;overflow:hidden;}
.topbar{background:var(--card);border-bottom:1px solid var(--border);padding:0 24px;height:56px;display:flex;align-items:center;gap:16px;flex-shrink:0;}
.topbar-title{font-size:18px;font-weight:700;flex:1;}
.clock{font-size:12px;color:var(--muted);}
.main-content{flex:1;overflow-y:auto;padding:24px;}
/* page */
.page{display:none;}.page.active{display:block;}
/* card */
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;margin-bottom:16px;overflow:hidden;}
.card-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border);}
.card-title{font-size:15px;font-weight:700;}
/* kpi */
.kpi-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-bottom:16px;}
.kpi{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;text-align:center;}
.kpi-num{font-size:28px;font-weight:800;color:var(--primary);}
.kpi-label{font-size:12px;color:var(--muted);margin-top:4px;}
/* table */
.tbl-wrap{overflow-x:auto;}
table{width:100%;border-collapse:collapse;}
th{background:#f8fafc;font-size:12px;font-weight:600;color:var(--muted);padding:10px 12px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap;}
td{padding:10px 12px;border-bottom:1px solid var(--border);vertical-align:middle;}
tr:hover td{background:#f8fafc;}
.no-data{text-align:center;color:var(--muted);padding:24px;}
/* buttons */
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:600;transition:all .15s;}
.btn-primary{background:var(--primary);color:#fff;}.btn-primary:hover{background:var(--primary-dark);}
.btn-secondary{background:#f1f5f9;color:var(--text);border:1px solid var(--border);}.btn-secondary:hover{background:#e2e8f0;}
.btn-success{background:#059669;color:#fff;}.btn-success:hover{background:#047857;}
.btn-warning{background:#d97706;color:#fff;}.btn-warning:hover{background:#b45309;}
.btn-danger{background:var(--error);color:#fff;}.btn-danger:hover{background:#dc2626;}
.btn-sm{padding:5px 10px;font-size:12px;}
/* filter row */
.filter-row{display:flex;flex-wrap:wrap;gap:10px;padding:14px 20px;border-bottom:1px solid var(--border);align-items:flex-end;}
.filter-group{display:flex;flex-direction:column;gap:4px;}
.filter-label{font-size:11px;font-weight:600;color:var(--muted);}
/* form */
input[type=text],input[type=number],input[type=email],input[type=date],input[type=time],input[type=password],select,textarea{
  border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:13px;width:100%;outline:none;background:#fff;}
input:focus,select:focus,textarea:focus{border-color:var(--primary);box-shadow:0 0 0 3px #2563eb20;}
.form-group{display:flex;flex-direction:column;gap:6px;margin-bottom:14px;}
.form-label{font-size:13px;font-weight:600;}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.form-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;}
/* modal */
.modal{display:none;position:fixed;inset:0;background:#00000080;z-index:1000;align-items:center;justify-content:center;}
.modal.open{display:flex;}
.modal-box{background:var(--card);border-radius:16px;padding:28px;min-width:480px;max-width:95vw;max-height:90vh;overflow-y:auto;position:relative;}
.modal-title{font-size:17px;font-weight:700;margin-bottom:20px;}
.modal-footer{display:flex;gap:10px;justify-content:flex-end;margin-top:20px;border-top:1px solid var(--border);padding-top:16px;}
/* badges */
.badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;}
.badge-green{background:#dcfce7;color:#166534;}
.badge-red{background:#fee2e2;color:#991b1b;}
.badge-yellow{background:#fef3c7;color:#92400e;}
.badge-blue{background:#dbeafe;color:#1d4ed8;}
.badge-gray{background:#f3f4f6;color:#374151;}
/* toast */
#toast-container{position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;}
.toast{padding:12px 18px;border-radius:10px;color:#fff;font-size:13px;font-weight:600;animation:slideIn .3s ease;min-width:220px;max-width:360px;box-shadow:0 4px 12px #0003;}
.toast-success{background:#059669;}.toast-error{background:#dc2626;}.toast-info{background:#2563eb;}
@keyframes slideIn{from{transform:translateX(100%);opacity:0;}to{transform:none;opacity:1;}}
/* col-search inputs in table header */
.col-search{width:100%;padding:4px 6px;font-size:11px;border:1px solid var(--border);border-radius:4px;margin-top:4px;}
/* emp card */
.emp-name{font-weight:600;}
/* calendar */
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;}
.cal-header-day{text-align:center;font-size:11px;font-weight:700;color:var(--muted);padding:6px;}
.cal-day{border-radius:8px;padding:6px 8px;min-height:70px;background:#f8fafc;border:1px solid var(--border);font-size:12px;}
.cal-today{background:#eff6ff;border-color:var(--primary);}
.cal-holiday{background:#fff7ed;border-color:#f59e0b;}
.cal-day-num{font-weight:700;font-size:13px;}
.cal-holiday-name{font-size:10px;color:#d97706;margin-top:2px;}
.cal-leave-pill{font-size:10px;background:#dcfce7;color:#166534;border-radius:4px;padding:1px 4px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
/* dept detail */
#dept-detail{display:none;}
#dept-detail.open{display:block;}
/* divider */
.section-title{font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid var(--border);}
/* OT breakdown */
#ot-breakdown-overlay{position:fixed;inset:0;background:#00000080;z-index:900;display:none;align-items:center;justify-content:center;}
#ot-breakdown-overlay.open{display:flex;}
.otr-card{background:var(--card);border-radius:16px;padding:24px;width:780px;max-width:95vw;max-height:90vh;overflow-y:auto;}
.tab-bar{display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid var(--border);}
.tab-btn{padding:8px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px;}
.tab-btn.active{color:var(--primary);border-bottom-color:var(--primary);}
"""

NAV = """
    <nav class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-logo">HR SYSTEM</div>
        <div class="sidebar-brand">ต่อกัน อินชัวรันส์<br>โบรคเกอร์ จำกัด</div>
      </div>
      <div class="nav-section">ภาพรวม</div>
      <a class="nav-item active" onclick="showPage('dashboard')" href="#">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        Dashboard
      </a>
      <div class="nav-section">พนักงาน</div>
      <a class="nav-item" onclick="showPage('employees')" href="#">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Employee Management
      </a>
      <a class="nav-item" onclick="showPage('departments')" href="#">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
        Department Management
      </a>
      <div class="nav-section">การทำงาน</div>
      <a class="nav-item" onclick="showPage('attendance')" href="#">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Attendance
      </a>
      <a class="nav-item" onclick="showPage('attendance-report')" href="#">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
        รายงานการลงเวลา
      </a>
      <a class="nav-item" onclick="showPage('leave-records')" href="#">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        Leave Records
      </a>
      <a class="nav-item" onclick="showPage('leaves')" href="#">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        Leave Types
      </a>
      <a class="nav-item" onclick="showPage('holidays')" href="#">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Holiday Management
      </a>
      <a class="nav-item" onclick="showPage('ot')" href="#">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        OT Management
      </a>
      <div class="nav-section">รายงาน</div>
      <a class="nav-item" onclick="showPage('report')" href="#">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        Summary Report
      </a>
      <a class="nav-item" onclick="showPage('calendar')" href="#">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Calendar
      </a>
      <div class="nav-section">การเงิน & HR</div>
      <a class="nav-item" onclick="showPage('payroll')" href="#">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        Payroll & Payslip
      </a>
      <a class="nav-item" onclick="showPage('warnings')" href="#">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        สาย / ขาดงาน
      </a>
      <a class="nav-item" onclick="showPage('broadcast')" href="#">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.88 9.75 19.79 19.79 0 0 1 1.84 1.12 2 2 0 0 1 3.82 0h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 7.91A16 16 0 0 0 16 15.91l.97-.97a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        Broadcast
      </a>
      <div class="nav-section">ระบบ</div>
      <a class="nav-item" onclick="showPage('settings')" href="#">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        ตั้งค่าบริษัท
      </a>
      <div class="sidebar-footer">
        <a class="nav-item" onclick="logout()" href="#" style="color:#ef4444;">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          ออกจากระบบ
        </a>
      </div>
    </nav>
"""

PAGE_DASHBOARD = """
    <div id="page-dashboard" class="page active">
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-num" id="stat-emp">—</div><div class="kpi-label">พนักงานทั้งหมด</div></div>
        <div class="kpi"><div class="kpi-num" id="stat-dept">—</div><div class="kpi-label">แผนก</div></div>
        <div class="kpi"><div class="kpi-num" id="stat-checkin">—</div><div class="kpi-label">เช็คอินวันนี้</div></div>
        <div class="kpi"><div class="kpi-num" id="stat-leave">—</div><div class="kpi-label">ลาที่รออนุมัติ</div></div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">👥 พนักงานล่าสุด</div></div>
        <div class="tbl-wrap" style="padding:0 0 8px;">
          <table><thead><tr><th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>ตำแหน่ง</th><th>สถานะ</th></tr></thead>
          <tbody id="dash-emp-tbody"><tr><td colspan="5" class="no-data">กำลังโหลด...</td></tr></tbody></table>
        </div>
      </div>
    </div>
"""

PAGE_EMPLOYEES = """
    <div id="page-employees" class="page">
      <div class="card">
        <div class="card-header">
          <div class="card-title">👥 รายชื่อพนักงาน (<span id="emp-count">0</span>)</div>
          <button class="btn btn-primary btn-sm" onclick="openAddModal()">+ เพิ่มพนักงาน</button>
        </div>
        <div class="filter-row">
          <div class="filter-group"><div class="filter-label">ค้นหา</div>
            <input type="text" id="emp-search" placeholder="ชื่อ / รหัส / อีเมล" style="width:200px;" oninput="filterTable()"></div>
          <div class="filter-group"><div class="filter-label">แผนก</div>
            <select id="emp-dept-filter" style="width:160px;" onchange="filterTable()"><option value="">ทุกแผนก</option></select></div>
          <div class="filter-group"><div class="filter-label">สถานะ</div>
            <select id="emp-status-filter" style="width:120px;" onchange="filterTable()">
              <option value="">ทั้งหมด</option><option value="active">ใช้งาน</option><option value="inactive">ไม่ใช้งาน</option>
            </select></div>
        </div>
        <div class="tbl-wrap">
          <table><thead><tr><th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>ตำแหน่ง</th><th>เพศ</th><th>เงินเดือน</th><th>LINE</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
          <tbody id="emp-tbody"><tr><td colspan="9" class="no-data">กำลังโหลด...</td></tr></tbody></table>
        </div>
      </div>
    </div>
"""

PAGE_DEPARTMENTS = """
    <div id="page-departments" class="page">
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-num" id="dept-total">0</div><div class="kpi-label">แผนกทั้งหมด</div></div>
        <div class="kpi"><div class="kpi-num" id="dept-active">0</div><div class="kpi-label">ใช้งานอยู่</div></div>
        <div class="kpi"><div class="kpi-num" id="dept-emp-total">0</div><div class="kpi-label">พนักงานทั้งหมด</div></div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title">🏢 จัดการแผนก</div>
          <div style="display:flex;gap:8px;">
            <input type="text" id="dept-search" placeholder="ค้นหาแผนก..." style="width:180px;" oninput="filterDepartments()">
            <button class="btn btn-primary btn-sm" onclick="openDeptModal()">+ เพิ่มแผนก</button>
          </div>
        </div>
        <div class="tbl-wrap">
          <table><thead><tr><th>รหัส</th><th>ชื่อแผนก</th><th>คำอธิบาย</th><th>จำนวนพนักงาน</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
          <tbody id="dept-tbody"><tr><td colspan="6" class="no-data">กำลังโหลด...</td></tr></tbody></table>
        </div>
      </div>
      <div id="dept-detail" class="card">
        <div class="card-header">
          <div class="card-title" id="dept-detail-title">รายละเอียดแผนก</div>
          <button class="btn btn-secondary btn-sm" onclick="closeDeptDetail()">✕ ปิด</button>
        </div>
        <div style="padding:16px;" id="dept-detail-content"></div>
      </div>
    </div>
"""

PAGE_ATTENDANCE = """
    <div id="page-attendance" class="page">
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-num" id="att-total">0</div><div class="kpi-label">รายการทั้งหมด</div></div>
        <div class="kpi"><div class="kpi-num" id="att-in" style="color:#22c55e;">0</div><div class="kpi-label">เช็คอินแล้ว</div></div>
        <div class="kpi"><div class="kpi-num" id="att-out" style="color:#2563eb;">0</div><div class="kpi-label">เช็คเอาท์แล้ว</div></div>
        <div class="kpi"><div class="kpi-num" id="att-outside" style="color:#ef4444;">0</div><div class="kpi-label">นอกรัศมี</div></div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title">⏰ Attendance Records</div>
          <button class="btn btn-warning btn-sm" onclick="runLateAbsentCheck()">🔍 ตรวจสาย/ขาด</button>
        </div>
        <div class="filter-row">
          <div class="filter-group"><div class="filter-label">วันที่</div>
            <input type="date" id="att-date" style="width:150px;" onchange="loadAttendance()"></div>
          <div class="filter-group"><div class="filter-label">แผนก</div>
            <select id="att-dept" style="width:160px;" onchange="loadAttendance()"><option value="">ทุกแผนก</option></select></div>
          <div class="filter-group"><div class="filter-label">ค้นหา</div>
            <input type="text" id="att-search" placeholder="ชื่อ / รหัส" style="width:160px;" oninput="filterAttendance()"></div>
        </div>
        <div class="tbl-wrap">
          <table><thead><tr><th>ชื่อพนักงาน</th><th>แผนก</th><th>วันที่</th><th>เช็คอิน</th><th>เช็คเอาท์</th><th>ชั่วโมง</th><th>In GPS</th><th>Out GPS</th></tr></thead>
          <tbody id="att-tbody"><tr><td colspan="8" class="no-data">กำลังโหลด...</td></tr></tbody></table>
        </div>
      </div>
    </div>
"""

PAGE_ATT_REPORT = """
    <div id="page-attendance-report" class="page">
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-num" id="ar-total">0</div><div class="kpi-label">รายการทั้งหมด</div></div>
        <div class="kpi"><div class="kpi-num" id="ar-in" style="color:#22c55e;">0</div><div class="kpi-label">Clock In</div></div>
        <div class="kpi"><div class="kpi-num" id="ar-out" style="color:#2563eb;">0</div><div class="kpi-label">Clock Out</div></div>
        <div class="kpi"><div class="kpi-num" id="ar-outside" style="color:#ef4444;">0</div><div class="kpi-label">นอกรัศมี</div></div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title">📋 รายงานการลงเวลา <span id="ar-count" style="font-size:12px;font-weight:400;color:#6b7280;margin-left:8px;"></span></div>
          <button class="btn btn-success btn-sm" onclick="exportArExcel()">⬇️ Export Excel</button>
        </div>
        <div class="filter-row">
          <div class="filter-group"><div class="filter-label">วันที่เริ่ม</div>
            <input type="date" id="ar-start" style="width:150px;"></div>
          <div class="filter-group"><div class="filter-label">วันที่สิ้นสุด</div>
            <input type="date" id="ar-end" style="width:150px;"></div>
          <div class="filter-group"><div class="filter-label">แผนก</div>
            <select id="ar-dept" style="width:160px;"><option value="">ทุกแผนก</option></select></div>
          <div class="filter-group"><div class="filter-label">ประเภท</div>
            <select id="ar-type" style="width:140px;" onchange="filterArTable()">
              <option value="">ทั้งหมด</option>
              <option value="clock_in">Clock In เท่านั้น</option>
              <option value="clock_out">Clock Out เท่านั้น</option>
            </select></div>
          <button class="btn btn-primary btn-sm" style="margin-top:18px;" onclick="loadAttendanceReport()">🔍 ค้นหา</button>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>รหัสพนักงาน</th><th>ชื่อพนักงาน</th><th>แผนก</th><th>ตำแหน่ง</th>
                <th>ประเภทการลงเวลา</th><th>วันที่</th><th>เวลา</th>
                <th>ช่องทาง</th><th>ระยะทาง</th><th>สถานะ GPS</th><th>หมายเหตุ</th>
              </tr>
              <tr>
                <th><input class="col-search ar-col-search" placeholder="ค้นหา..." data-col="0"></th>
                <th><input class="col-search ar-col-search" placeholder="ค้นหา..." data-col="1"></th>
                <th><input class="col-search ar-col-search" placeholder="ค้นหา..." data-col="2"></th>
                <th><input class="col-search ar-col-search" placeholder="ค้นหา..." data-col="3"></th>
                <th><input class="col-search ar-col-search" placeholder="ค้นหา..." data-col="4"></th>
                <th><input class="col-search ar-col-search" placeholder="ค้นหา..." data-col="5"></th>
                <th><input class="col-search ar-col-search" placeholder="ค้นหา..." data-col="6"></th>
                <th></th><th></th><th></th><th></th>
              </tr>
            </thead>
            <tbody id="ar-tbody"><tr><td colspan="11" class="no-data">เลือกช่วงวันที่แล้วกด ค้นหา</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>
"""

PAGE_LEAVE_RECORDS = """
    <div id="page-leave-records" class="page">
      <div class="card">
        <div class="card-header"><div class="card-title">📋 ใบลางาน</div></div>
        <div class="filter-row">
          <div class="filter-group"><div class="filter-label">ปี</div>
            <select id="lr-year" style="width:130px;" onchange="loadLeaveRecords()"><option value="">ทุกปี</option></select></div>
          <div class="filter-group"><div class="filter-label">เดือน</div>
            <select id="lr-month" style="width:120px;" onchange="loadLeaveRecords()">
              <option value="">ทุกเดือน</option>
              <option value="1">มกราคม</option><option value="2">กุมภาพันธ์</option><option value="3">มีนาคม</option>
              <option value="4">เมษายน</option><option value="5">พฤษภาคม</option><option value="6">มิถุนายน</option>
              <option value="7">กรกฎาคม</option><option value="8">สิงหาคม</option><option value="9">กันยายน</option>
              <option value="10">ตุลาคม</option><option value="11">พฤศจิกายน</option><option value="12">ธันวาคม</option>
            </select></div>
          <div class="filter-group"><div class="filter-label">แผนก</div>
            <select id="lr-dept" style="width:160px;" onchange="loadLeaveRecords()"><option value="">ทุกแผนก</option></select></div>
          <div class="filter-group"><div class="filter-label">สถานะ</div>
            <select id="lr-status" style="width:120px;" onchange="loadLeaveRecords()">
              <option value="">ทั้งหมด</option><option value="pending">รอพิจารณา</option>
              <option value="approved">อนุมัติ</option><option value="rejected">ปฏิเสธ</option>
              <option value="cancelled">ยกเลิก</option>
            </select></div>
        </div>
        <div class="tbl-wrap">
          <table><thead><tr><th>พนักงาน</th><th>แผนก</th><th>ประเภทการลา</th><th>วันที่เริ่ม</th><th>วันที่สิ้นสุด</th><th>จำนวนวัน</th><th>สถานะ</th><th>หมายเหตุ</th><th>จัดการ</th></tr></thead>
          <tbody id="lr-tbody"><tr><td colspan="9" class="no-data">กำลังโหลด...</td></tr></tbody></table>
        </div>
      </div>
    </div>
"""

PAGE_LEAVES = """
    <div id="page-leaves" class="page">
      <div class="card">
        <div class="card-header">
          <div class="card-title">🏷️ ประเภทการลา</div>
          <button class="btn btn-primary btn-sm" onclick="openLeaveTypeModal()">+ เพิ่มประเภทการลา</button>
        </div>
        <div class="tbl-wrap">
          <table><thead><tr><th>ชื่อประเภทการลา</th><th>จำนวนวันสูงสุด/ปี</th><th>มีค่าจ้าง</th><th>จัดการ</th></tr></thead>
          <tbody id="lt-tbody"><tr><td colspan="4" class="no-data">กำลังโหลด...</td></tr></tbody></table>
        </div>
      </div>
    </div>
"""

PAGE_HOLIDAYS = """
    <div id="page-holidays" class="page">
      <div class="card">
        <div class="card-header">
          <div class="card-title">🎌 วันหยุดนักขัตฤกษ์</div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-secondary btn-sm" onclick="copyHolidays()">📋 Copy ปีถัดไป</button>
            <button class="btn btn-primary btn-sm" onclick="openHolidayModal()">+ เพิ่มวันหยุด</button>
          </div>
        </div>
        <div class="filter-row">
          <div class="filter-group"><div class="filter-label">ปี</div>
            <select id="h-year" style="width:140px;" onchange="loadHolidays()"><option value="">ทุกปี</option></select></div>
        </div>
        <div class="tbl-wrap">
          <table><thead><tr><th>วันที่</th><th>ชื่อวันหยุด</th><th>วันหยุดแทน</th><th>จัดการ</th></tr></thead>
          <tbody id="holiday-tbody"><tr><td colspan="4" class="no-data">กำลังโหลด...</td></tr></tbody></table>
        </div>
      </div>
    </div>
"""

PAGE_OT = """
    <div id="page-ot" class="page">
      <div class="card">
        <div class="card-header"><div class="card-title">⏰ คำขอ OT</div></div>
        <div class="filter-row">
          <div class="filter-group"><div class="filter-label">ปี</div>
            <select id="ot-year" style="width:130px;" onchange="loadOT()"></select></div>
          <div class="filter-group"><div class="filter-label">เดือน</div>
            <select id="ot-month" style="width:120px;" onchange="loadOT()">
              <option value="1">มกราคม</option><option value="2">กุมภาพันธ์</option><option value="3">มีนาคม</option>
              <option value="4">เมษายน</option><option value="5">พฤษภาคม</option><option value="6">มิถุนายน</option>
              <option value="7">กรกฎาคม</option><option value="8">สิงหาคม</option><option value="9">กันยายน</option>
              <option value="10">ตุลาคม</option><option value="11">พฤศจิกายน</option><option value="12">ธันวาคม</option>
            </select></div>
          <div class="filter-group"><div class="filter-label">แผนก</div>
            <select id="ot-dept" style="width:160px;" onchange="loadOT()"><option value="">ทุกแผนก</option></select></div>
          <div class="filter-group"><div class="filter-label">พนักงาน</div>
            <select id="ot-emp" style="width:160px;" onchange="loadOT()"><option value="">ทั้งหมด</option></select></div>
          <div class="filter-group"><div class="filter-label">สถานะ</div>
            <select id="ot-status" style="width:120px;" onchange="loadOT()">
              <option value="">ทั้งหมด</option><option value="pending">รอพิจารณา</option>
              <option value="approved">อนุมัติ</option><option value="rejected">ปฏิเสธ</option>
            </select></div>
        </div>
        <div class="tbl-wrap">
          <table><thead><tr><th>พนักงาน</th><th>แผนก</th><th>วันที่</th><th>เวลาเริ่ม</th><th>เวลาสิ้นสุด</th><th>ชั่วโมง</th><th>สาเหตุ</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
          <tbody id="ot-tbody"><tr><td colspan="9" class="no-data">กำลังโหลด...</td></tr></tbody></table>
        </div>
      </div>
      <!-- OT Report per employee -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">📊 OT Summary (รายพนักงาน)</div>
          <div style="display:flex;gap:8px;">
            <select id="otr-year" style="width:130px;" onchange="loadOTReport()"></select>
            <select id="otr-month" style="width:120px;" onchange="loadOTReport()">
              <option value="1">มกราคม</option><option value="2">กุมภาพันธ์</option><option value="3">มีนาคม</option>
              <option value="4">เมษายน</option><option value="5">พฤษภาคม</option><option value="6">มิถุนายน</option>
              <option value="7">กรกฎาคม</option><option value="8">สิงหาคม</option><option value="9">กันยายน</option>
              <option value="10">ตุลาคม</option><option value="11">พฤศจิกายน</option><option value="12">ธันวาคม</option>
            </select>
            <select id="otr-emp" style="width:160px;" onchange="loadOTReport()"><option value="">ทุกคน</option></select>
            <button class="btn btn-secondary btn-sm" onclick="exportOTReport()">⬇️ Export CSV</button>
          </div>
        </div>
        <div class="tbl-wrap">
          <table><thead><tr><th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>จำนวนครั้ง</th><th>รวมชั่วโมง</th><th>ค่า OT (฿)</th><th>รายละเอียด</th></tr></thead>
          <tbody id="otr-tbody"><tr><td colspan="7" class="no-data">กำลังโหลด...</td></tr></tbody></table>
        </div>
      </div>
      <!-- OT Breakdown overlay -->
      <div id="ot-breakdown-overlay">
        <div class="otr-card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
            <h3 id="otr-breakdown-title" style="font-size:16px;font-weight:700;"></h3>
            <button class="btn btn-secondary btn-sm" onclick="closeOTBreakdown()">✕ ปิด</button>
          </div>
          <div class="tab-bar">
            <button class="tab-btn active" onclick="switchOTBreakdownTab('monthly')">รายเดือน</button>
            <button class="tab-btn" onclick="switchOTBreakdownTab('daily')">รายวัน</button>
          </div>
          <div id="otr-breakdown-monthly"></div>
          <div id="otr-breakdown-daily" style="display:none;">
            <div style="display:flex;gap:8px;margin-bottom:12px;">
              <select id="otr-daily-year" style="width:130px;"></select>
              <select id="otr-daily-month" style="width:120px;">
                <option value="1">มกราคม</option><option value="2">กุมภาพันธ์</option><option value="3">มีนาคม</option>
                <option value="4">เมษายน</option><option value="5">พฤษภาคม</option><option value="6">มิถุนายน</option>
                <option value="7">กรกฎาคม</option><option value="8">สิงหาคม</option><option value="9">กันยายน</option>
                <option value="10">ตุลาคม</option><option value="11">พฤศจิกายน</option><option value="12">ธันวาคม</option>
              </select>
              <button class="btn btn-primary btn-sm" onclick="loadOTDailyTab()">ค้นหา</button>
              <button class="btn btn-secondary btn-sm" onclick="exportOTDailyCSV()">⬇️ CSV</button>
            </div>
            <div id="otr-breakdown-daily-content"></div>
          </div>
        </div>
      </div>
    </div>
"""

PAGE_REPORT = """
    <div id="page-report" class="page">
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-num" id="rpt-emp">0</div><div class="kpi-label">พนักงาน</div></div>
        <div class="kpi"><div class="kpi-num" id="rpt-work">0</div><div class="kpi-label">วันเข้างานรวม</div></div>
        <div class="kpi"><div class="kpi-num" id="rpt-leave">0</div><div class="kpi-label">วันลารวม</div></div>
        <div class="kpi"><div class="kpi-num" id="rpt-ot">0</div><div class="kpi-label">OT รวม (ชม.)</div></div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title">📈 รายงานรายเดือน</div>
          <div style="display:flex;gap:8px;">
            <select id="rpt-year" style="width:140px;" onchange="loadReport()"></select>
            <select id="rpt-month" style="width:120px;" onchange="loadReport()">
              <option value="1">มกราคม</option><option value="2">กุมภาพันธ์</option><option value="3">มีนาคม</option>
              <option value="4">เมษายน</option><option value="5">พฤษภาคม</option><option value="6">มิถุนายน</option>
              <option value="7">กรกฎาคม</option><option value="8">สิงหาคม</option><option value="9">กันยายน</option>
              <option value="10">ตุลาคม</option><option value="11">พฤศจิกายน</option><option value="12">ธันวาคม</option>
            </select>
            <select id="rpt-dept" style="width:160px;" onchange="loadReport()"><option value="">ทุกแผนก</option></select>
            <button class="btn btn-secondary btn-sm" onclick="exportReportCSV()">⬇️ Export CSV</button>
          </div>
        </div>
        <div class="tbl-wrap">
          <table><thead><tr><th>รหัส</th><th>ชื่อ</th><th>แผนก</th><th>วันเข้างาน</th><th>ชม.เฉลี่ย</th><th>ลา (อนุมัติ)</th><th>วันลา</th><th>OT (อนุมัติ)</th><th>OT ชม.</th><th>ค่า OT (฿)</th><th>นอกรัศมี</th></tr></thead>
          <tbody id="rpt-tbody"><tr><td colspan="11" class="no-data">กำลังโหลด...</td></tr></tbody></table>
        </div>
      </div>
    </div>
"""

PAGE_CALENDAR = """
    <div id="page-calendar" class="page">
      <div class="card">
        <div class="card-header">
          <div class="card-title">📅 ปฏิทิน</div>
          <div style="display:flex;gap:8px;">
            <select id="cal-year" style="width:140px;" onchange="loadCalendar()"></select>
            <select id="cal-month" style="width:120px;" onchange="loadCalendar()">
              <option value="1">มกราคม</option><option value="2">กุมภาพันธ์</option><option value="3">มีนาคม</option>
              <option value="4">เมษายน</option><option value="5">พฤษภาคม</option><option value="6">มิถุนายน</option>
              <option value="7">กรกฎาคม</option><option value="8">สิงหาคม</option><option value="9">กันยายน</option>
              <option value="10">ตุลาคม</option><option value="11">พฤศจิกายน</option><option value="12">ธันวาคม</option>
            </select>
          </div>
        </div>
        <div style="padding:16px;">
          <div class="cal-grid" style="margin-bottom:8px;">
            <div class="cal-header-day">อา</div><div class="cal-header-day">จ</div>
            <div class="cal-header-day">อ</div><div class="cal-header-day">พ</div>
            <div class="cal-header-day">พฤ</div><div class="cal-header-day">ศ</div><div class="cal-header-day">ส</div>
          </div>
          <div class="cal-grid" id="cal-body"></div>
        </div>
      </div>
    </div>
"""

PAGE_BROADCAST = """
    <div id="page-broadcast" class="page">
      <div class="card">
        <div class="card-header"><div class="card-title">📢 ส่งประกาศ</div></div>
        <div style="padding:20px;display:flex;flex-direction:column;gap:14px;max-width:600px;">
          <div class="form-group">
            <label class="form-label">หัวข้อ (ไม่บังคับ)</label>
            <input type="text" id="bc-title" placeholder="ประกาศจาก HR">
          </div>
          <div class="form-group">
            <label class="form-label">ข้อความ *</label>
            <textarea id="bc-msg" rows="4" placeholder="ข้อความประกาศ..."></textarea>
          </div>
          <button class="btn btn-primary" id="bc-btn" onclick="sendBroadcast()" style="width:fit-content;">📢 ส่งประกาศ</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">📜 ประวัติการส่ง</div></div>
        <div class="tbl-wrap">
          <table><thead><tr><th>วันที่ส่ง</th><th>หัวข้อ</th><th>ข้อความ</th><th>ส่งสำเร็จ</th><th>ล้มเหลว</th></tr></thead>
          <tbody id="bc-history-tbody"><tr><td colspan="5" class="no-data">กำลังโหลด...</td></tr></tbody></table>
        </div>
      </div>
    </div>
"""

PAGE_SETTINGS = """
    <div id="page-settings" class="page">
      <!-- Work Settings -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">⚙️ ตั้งค่าการทำงาน</div>
          <button class="btn btn-primary btn-sm" onclick="saveSettings()">💾 บันทึก</button>
        </div>
        <div style="padding:20px;display:grid;grid-template-columns:1fr 1fr;gap:20px;">
          <div class="form-group">
            <label class="form-label">เวลาเริ่มงาน</label>
            <input type="time" id="s-work-start">
          </div>
          <div class="form-group">
            <label class="form-label">เวลาเลิกงาน</label>
            <input type="time" id="s-work-end">
          </div>
          <div class="form-group">
            <label class="form-label">นาทีที่ถือว่า "สาย"</label>
            <input type="number" id="s-late-warn" min="0" max="60">
          </div>
          <div class="form-group">
            <label class="form-label">วันที่จ่ายเงินเดือน (วันที่)</label>
            <input type="number" id="s-pay-day" min="1" max="31">
          </div>
          <div class="form-group">
            <label class="form-label">อัตรา OT (x เท่า)</label>
            <input type="number" id="s-ot-rate" min="1" max="3" step="0.5">
          </div>
          <div class="form-group">
            <label class="form-label">ประกันสังคม (%)</label>
            <input type="number" id="s-ss-rate" min="0" max="10">
          </div>
          <div class="form-group">
            <label class="form-label">กองทุนสำรองเลี้ยงชีพ (%)</label>
            <input type="number" id="s-pf-rate" min="0" max="15">
          </div>
        </div>
      </div>
      <!-- Company Info -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">🏢 ข้อมูลบริษัท</div>
          <button class="btn btn-primary btn-sm" onclick="saveSettings()">💾 บันทึก</button>
        </div>
        <div style="padding:20px;display:flex;flex-direction:column;gap:22px;">
          <!-- Contact -->
          <div>
            <div class="section-title">📞 ข้อมูลการติดต่อ</div>
            <div class="form-row3">
              <div class="form-group">
                <label class="form-label">ชื่อบริษัท</label>
                <input type="text" id="s-company-name" placeholder="ต่อกัน อินชัวรันส์ โบรคเกอร์ จำกัด">
              </div>
              <div class="form-group">
                <label class="form-label">เบอร์โทรศัพท์</label>
                <input type="text" id="s-company-phone" placeholder="02-xxx-xxxx">
              </div>
              <div class="form-group">
                <label class="form-label">อีเมล</label>
                <input type="email" id="s-company-email" placeholder="hr@company.com">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">ที่อยู่บริษัท</label>
              <textarea id="s-company-address" rows="2" placeholder="เลขที่ ถนน แขวง เขต จังหวัด รหัสไปรษณีย์"></textarea>
            </div>
          </div>
          <!-- Legal -->
          <div>
            <div class="section-title">🏛️ ข้อมูลนิติบุคคล</div>
            <div class="form-row3">
              <div class="form-group">
                <label class="form-label">ประเภทธุรกิจ</label>
                <input type="text" id="s-company-business-type" placeholder="นายหน้าประกันภัย">
              </div>
              <div class="form-group">
                <label class="form-label">วันที่จดทะเบียน</label>
                <input type="date" id="s-company-founded-date">
              </div>
              <div class="form-group">
                <label class="form-label">เลขนิติบุคคล (13 หลัก)</label>
                <input type="text" id="s-company-tax-id" placeholder="0-0000-00000-00-0" maxlength="20">
              </div>
              <div class="form-group">
                <label class="form-label">เลขที่นายจ้าง (ประกันสังคม)</label>
                <input type="text" id="s-company-ss-number" placeholder="รหัสสาขา-เลขที่นายจ้าง">
              </div>
              <div class="form-group">
                <label class="form-label">เลขประจำตัวผู้เสียภาษี</label>
                <input type="text" id="s-employer-tax-id" placeholder="เลข 13 หลัก">
              </div>
              <div class="form-group">
                <label class="form-label">รหัสสำนักงานประกันสังคม</label>
                <input type="text" id="s-employer-ss-id" placeholder="รหัสสำนักงาน">
              </div>
            </div>
          </div>
          <!-- Bank -->
          <div>
            <div class="section-title">🏦 ข้อมูลบัญชีธนาคาร</div>
            <div class="form-row3">
              <div class="form-group">
                <label class="form-label">ธนาคาร</label>
                <select id="s-bank-name">
                  <option value="">-- เลือกธนาคาร --</option>
                  <option value="ธนาคารกรุงเทพ">ธนาคารกรุงเทพ (BBL)</option>
                  <option value="ธนาคารกสิกรไทย">ธนาคารกสิกรไทย (KBANK)</option>
                  <option value="ธนาคารไทยพาณิชย์">ธนาคารไทยพาณิชย์ (SCB)</option>
                  <option value="ธนาคารกรุงไทย">ธนาคารกรุงไทย (KTB)</option>
                  <option value="ธนาคารกรุงศรีอยุธยา">ธนาคารกรุงศรีอยุธยา (BAY)</option>
                  <option value="ธนาคารทหารไทยธนชาต">ธนาคารทหารไทยธนชาต (TTB)</option>
                  <option value="ธนาคารออมสิน">ธนาคารออมสิน (GSB)</option>
                  <option value="ธนาคารเพื่อการเกษตร">ธนาคารเพื่อการเกษตร (BAAC)</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">เลขบัญชี</label>
                <input type="text" id="s-bank-account-number" placeholder="xxx-x-xxxxx-x">
              </div>
              <div class="form-group">
                <label class="form-label">ชื่อบัญชี</label>
                <input type="text" id="s-bank-account-name" placeholder="ชื่อบัญชีภาษาอังกฤษ">
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
"""

PAGE_PAYROLL = """
    <div id="page-payroll" class="page">
      <div class="card">
        <div class="card-header">
          <div class="card-title">💰 Payroll & Payslip</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <select id="pwl-year" style="width:140px;" onchange="loadPayroll()"></select>
            <select id="pwl-month" style="width:120px;" onchange="loadPayroll()">
              <option value="1">มกราคม</option><option value="2">กุมภาพันธ์</option><option value="3">มีนาคม</option>
              <option value="4">เมษายน</option><option value="5">พฤษภาคม</option><option value="6">มิถุนายน</option>
              <option value="7">กรกฎาคม</option><option value="8">สิงหาคม</option><option value="9">กันยายน</option>
              <option value="10">ตุลาคม</option><option value="11">พฤศจิกายน</option><option value="12">ธันวาคม</option>
            </select>
            <select id="pwl-dept" style="width:160px;" onchange="loadPayroll()"><option value="">ทุกแผนก</option></select>
            <button class="btn btn-primary btn-sm" onclick="generatePayroll()">⚙️ สร้าง Payroll</button>
            <button class="btn btn-success btn-sm" onclick="confirmAllPayroll()">✅ Confirm All</button>
            <button class="btn btn-warning btn-sm" onclick="markAllPaid()">💸 Mark as Paid</button>
            <button class="btn btn-secondary btn-sm" onclick="exportPayrollExcel()">⬇️ Export Excel</button>
          </div>
        </div>
        <div class="tbl-wrap">
          <table><thead><tr>
            <th>รหัส</th><th>ชื่อพนักงาน</th><th>แผนก</th><th>เงินเดือน</th>
            <th>หักสาย (฿)</th><th>ประกันสังคม</th><th>กองทุนสำรอง</th><th>ภาษี</th>
            <th>โบนัส</th><th>เงินสุทธิ</th><th>สถานะ</th><th>หมายเหตุ</th><th></th>
          </tr></thead>
          <tbody id="pwl-tbody"><tr><td colspan="13" class="no-data">เลือกเดือนแล้วกด "สร้าง Payroll"</td></tr></tbody></table>
        </div>
      </div>
    </div>
"""

PAGE_WARNINGS = """
    <div id="page-warnings" class="page">
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-num" id="warn-total">0</div><div class="kpi-label">รายการทั้งหมด</div></div>
        <div class="kpi"><div class="kpi-num" id="warn-late" style="color:#f59e0b;">0</div><div class="kpi-label">สาย</div></div>
        <div class="kpi"><div class="kpi-num" id="warn-absent" style="color:#ef4444;">0</div><div class="kpi-label">ขาดงาน</div></div>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title">⚠️ สาย / ขาดงาน</div>
          <div style="display:flex;gap:8px;">
            <select id="warn-year" style="width:140px;" onchange="loadWarnings()"></select>
            <select id="warn-month" style="width:120px;" onchange="loadWarnings()">
              <option value="1">มกราคม</option><option value="2">กุมภาพันธ์</option><option value="3">มีนาคม</option>
              <option value="4">เมษายน</option><option value="5">พฤษภาคม</option><option value="6">มิถุนายน</option>
              <option value="7">กรกฎาคม</option><option value="8">สิงหาคม</option><option value="9">กันยายน</option>
              <option value="10">ตุลาคม</option><option value="11">พฤศจิกายน</option><option value="12">ธันวาคม</option>
            </select>
            <button class="btn btn-warning btn-sm" onclick="runLateAbsentCheck()">🔍 ตรวจสอบ</button>
          </div>
        </div>
        <div class="tbl-wrap">
          <table><thead><tr><th>รหัส</th><th>ชื่อพนักงาน</th><th>แผนก</th><th>ประเภท</th><th>วันที่</th><th>นาทีที่สาย</th><th>หมายเหตุ</th></tr></thead>
          <tbody id="warn-tbody"><tr><td colspan="7" class="no-data">กำลังโหลด...</td></tr></tbody></table>
        </div>
      </div>
    </div>
"""

MODALS = """
  <!-- Employee Modal -->
  <div class="modal" id="emp-modal">
    <div class="modal-box">
      <div class="modal-title" id="modal-title">เพิ่มพนักงาน</div>
      <input type="hidden" id="f-id">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">รหัสพนักงาน *</label>
          <input type="text" id="f-code" placeholder="TK001">
        </div>
        <div class="form-group">
          <label class="form-label">ชื่อ-นามสกุล *</label>
          <input type="text" id="f-name" placeholder="ชื่อ นามสกุล">
        </div>
        <div class="form-group">
          <label class="form-label">อีเมล</label>
          <input type="email" id="f-email" placeholder="email@example.com">
        </div>
        <div class="form-group">
          <label class="form-label">เบอร์โทร</label>
          <input type="text" id="f-phone" placeholder="08X-XXX-XXXX">
        </div>
        <div class="form-group">
          <label class="form-label">เพศ</label>
          <select id="f-sex"><option value="">ไม่ระบุ</option><option value="M">ชาย</option><option value="F">หญิง</option></select>
        </div>
        <div class="form-group">
          <label class="form-label">แผนก</label>
          <select id="f-dept"><option value="">ไม่ระบุ</option></select>
        </div>
        <div class="form-group">
          <label class="form-label">ตำแหน่ง</label>
          <input type="text" id="f-position" placeholder="ตำแหน่งงาน">
        </div>
        <div class="form-group">
          <label class="form-label">บทบาท</label>
          <select id="f-role"><option value="employee">พนักงาน</option><option value="manager">ผู้จัดการ</option><option value="admin">แอดมิน</option></select>
        </div>
        <div class="form-group">
          <label class="form-label">เงินเดือน (฿)</label>
          <input type="number" id="f-salary" placeholder="0">
        </div>
        <div class="form-group">
          <label class="form-label">หัวหน้า</label>
          <select id="f-manager"><option value="">ไม่มี</option></select>
        </div>
        <div class="form-group">
          <label class="form-label">วันเริ่มงาน</label>
          <input type="date" id="f-start-date">
        </div>
      </div>
      <div id="line-status-section" style="margin-bottom:12px;"></div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('emp-modal')">ยกเลิก</button>
        <button class="btn btn-primary" onclick="saveEmployee()">บันทึก</button>
      </div>
    </div>
  </div>

  <!-- Department Modal -->
  <div class="modal" id="dept-modal">
    <div class="modal-box">
      <div class="modal-title">จัดการแผนก</div>
      <input type="hidden" id="d-edit-id">
      <div class="form-group">
        <label class="form-label">ชื่อแผนก *</label>
        <input type="text" id="d-name" placeholder="ชื่อแผนก">
      </div>
      <div class="form-group">
        <label class="form-label">คำอธิบาย</label>
        <textarea id="d-description" rows="2" placeholder="คำอธิบายแผนก..."></textarea>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('dept-modal')">ยกเลิก</button>
        <button class="btn btn-primary" onclick="saveDepartment()">บันทึก</button>
      </div>
    </div>
  </div>

  <!-- Leave Type Modal -->
  <div class="modal" id="lt-modal">
    <div class="modal-box">
      <div class="modal-title">ประเภทการลา</div>
      <input type="hidden" id="lt-edit-id">
      <div class="form-group">
        <label class="form-label">ชื่อประเภทการลา *</label>
        <input type="text" id="lt-name" placeholder="ลาป่วย, ลาพักร้อน, ...">
      </div>
      <div class="form-group">
        <label class="form-label">วันสูงสุดต่อปี</label>
        <input type="number" id="lt-max-days" value="30" min="0">
      </div>
      <div class="form-group" style="flex-direction:row;align-items:center;gap:10px;">
        <input type="checkbox" id="lt-paid" style="width:auto;">
        <label class="form-label" style="margin:0;">มีค่าจ้าง</label>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('lt-modal')">ยกเลิก</button>
        <button class="btn btn-primary" onclick="saveLeaveType()">บันทึก</button>
      </div>
    </div>
  </div>

  <!-- Holiday Modal -->
  <div class="modal" id="h-modal">
    <div class="modal-box">
      <div class="modal-title">เพิ่มวันหยุด</div>
      <div class="form-group">
        <label class="form-label">วันที่ *</label>
        <input type="date" id="h-date">
      </div>
      <div class="form-group">
        <label class="form-label">ชื่อวันหยุด *</label>
        <input type="text" id="h-name" placeholder="ชื่อวันหยุด">
      </div>
      <div class="form-group" style="flex-direction:row;align-items:center;gap:10px;">
        <input type="checkbox" id="h-sub" style="width:auto;">
        <label class="form-label" style="margin:0;">วันหยุดแทน (Substitute)</label>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('h-modal')">ยกเลิก</button>
        <button class="btn btn-primary" onclick="saveHoliday()">บันทึก</button>
      </div>
    </div>
  </div>

  <div id="toast-container"></div>
"""

# ── Dashboard init supplement ──────────────────────────────────────────────────
# NOTE: Do NOT declare another function showPage() here — that causes infinite
# recursion via function-declaration hoisting.  Instead we patch raw JS to add
# the dashboard case directly into the existing showPage body.
DASH_INIT_JS = r"""
// ==================== DASHBOARD ====================
async function loadDashboard() {
  try {
    const [empRes, attRes, lvRes] = await Promise.all([
      apiFetch(`${API}/api/employee/`),
      apiFetch(`${API}/api/attendance/all?date=` + new Date().toISOString().slice(0,10)),
      apiFetch(`${API}/api/leave/all?status=pending`),
    ]);
    if (empRes.ok) {
      const emps = await empRes.json();
      const list = Array.isArray(emps) ? emps : (emps.employees || emps.data || []);
      const active = list.filter(e => e.is_active !== false);
      document.getElementById('stat-emp').textContent  = active.length;
      const depts = [...new Set(active.map(e => e.department_id).filter(Boolean))];
      document.getElementById('stat-dept').textContent = depts.length;
      const tbody = document.getElementById('dash-emp-tbody');
      if (tbody) {
        const recent = active.slice(0,8);
        tbody.innerHTML = recent.map(e => `<tr>
          <td style="font-size:11px;color:#6b7280;">${e.employee_code||'—'}</td>
          <td class="emp-name">${e.name||'—'}</td>
          <td style="font-size:12px;">${e.department_name||'—'}</td>
          <td style="font-size:12px;">${e.position||'—'}</td>
          <td><span class="badge ${e.is_active!==false?'badge-green':'badge-red'}">${e.is_active!==false?'ใช้งาน':'ไม่ใช้งาน'}</span></td>
        </tr>`).join('');
      }
    }
    if (attRes.ok) {
      const att = await attRes.json();
      const rows = Array.isArray(att) ? att : (att.data || []);
      document.getElementById('stat-checkin').textContent = rows.filter(r => r.check_in).length;
    }
    if (lvRes.ok) {
      const lv = await lvRes.json();
      const rows = Array.isArray(lv) ? lv : (lv.data || lv.requests || []);
      document.getElementById('stat-leave').textContent = rows.length;
    }
  } catch(e) { /* ignore */ }
}

// Call on initial page load (dashboard is the first page shown)
document.addEventListener('DOMContentLoaded', function() {
  loadDashboard();
});
"""

# ── Assemble full HTML ─────────────────────────────────────────────────────────
PAGES = (PAGE_DASHBOARD + PAGE_EMPLOYEES + PAGE_DEPARTMENTS + PAGE_ATTENDANCE
       + PAGE_ATT_REPORT + PAGE_LEAVE_RECORDS + PAGE_LEAVES + PAGE_HOLIDAYS
       + PAGE_OT + PAGE_REPORT + PAGE_CALENDAR + PAGE_BROADCAST
       + PAGE_SETTINGS + PAGE_PAYROLL + PAGE_WARNINGS)

HTML = f"""<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin | ต่อกัน อินชัวรันส์ โบรคเกอร์ จำกัด</title>
  <style>{CSS}</style>
</head>
<body>
  <div class="app">
{NAV}
    <main class="main">
      <div class="topbar">
        <div class="topbar-title" id="page-title">Dashboard</div>
        <span class="clock" id="current-time"></span>
      </div>
      <div class="main-content">
{PAGES}
      </div>
    </main>
  </div>
{MODALS}
  <script>
{JS}
{DASH_INIT_JS}
  </script>
</body>
</html>"""

with open(OUT_PATH, 'w', encoding='utf-8') as f:
    f.write(HTML)

print(f"Written {len(HTML)} bytes to {OUT_PATH}")

# quick syntax check on JS
import subprocess, tempfile
js_file = tempfile.mktemp(suffix='.js')
start = HTML.find('<script>') + len('<script>')
end   = HTML.rfind('</script>')
with open(js_file, 'w', encoding='utf-8') as f:
    f.write(HTML[start:end])
result = subprocess.run(['node', '--check', js_file], capture_output=True, text=True)
if result.returncode == 0:
    print("✅ JS syntax OK")
else:
    print("❌ JS syntax error:")
    print(result.stderr)
