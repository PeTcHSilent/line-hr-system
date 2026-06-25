const db = require('../db');
const settingsService = require('./settingsService');
const line = require('@line/bot-sdk');

const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

const MONTHS_TH = ['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

/**
 * คำนวณภาษีเงินได้บุคคลธรรมดา แบบอัตราก้าวหน้าตามกฎหมายภาษีไทย
 * วิธี: อนุโลมรายได้ต่อปี → หักค่าใช้จ่าย+ลดหย่อน → คำนวณ annual tax → หาร 12
 * @param {number} monthlyGross รายได้รวมต่อเดือน (บาท)
 * @returns {number} ภาษีหัก ณ ที่จ่ายต่อเดือน (บาท)
 */
function calcProgressiveTax(monthlyGross) {
  if (!monthlyGross || monthlyGross <= 0) return 0;
  const annualGross = monthlyGross * 12;

  // ค่าใช้จ่าย 50% ไม่เกิน 100,000 (ม.40(1) เงินเดือน)
  const expenseDeduct  = Math.min(annualGross * 0.5, 100000);
  // ลดหย่อนส่วนตัว 60,000
  const personalExempt = 60000;

  const taxableIncome = Math.max(0, annualGross - expenseDeduct - personalExempt);

  // อัตราก้าวหน้า (ปรับปรุง 2560 เป็นต้นมา)
  const BRACKETS = [
    { limit:   150000, rate: 0.00 },
    { limit:   300000, rate: 0.05 },
    { limit:   500000, rate: 0.10 },
    { limit:   750000, rate: 0.15 },
    { limit:  1000000, rate: 0.20 },
    { limit:  2000000, rate: 0.25 },
    { limit:  5000000, rate: 0.30 },
    { limit: Infinity, rate: 0.35 },
  ];

  let annualTax = 0;
  let prev = 0;
  for (const { limit, rate } of BRACKETS) {
    if (taxableIncome <= prev) break;
    annualTax += (Math.min(taxableIncome, limit) - prev) * rate;
    prev = limit;
  }

  return Math.round((annualTax / 12) * 100) / 100;
}

/**
 * ดึง payroll settings (tax, SS, PF)
 */
async function getPayrollSettings() {
  const taxRate    = parseFloat(await settingsService.get('tax_rate')             || '5')  / 100;
  const ssRate     = parseFloat(await settingsService.get('social_security_rate') || '5')  / 100;
  const ssMax      = parseFloat(await settingsService.get('social_security_max')  || '750');
  const pfEnabled  = (await settingsService.get('provident_fund_enabled'))        === 'true';
  const pfRate     = parseFloat(await settingsService.get('provident_fund_rate')  || '5')  / 100;
  const otRates    = await settingsService.getOTRates();
  return { taxRate, ssRate, ssMax, pfEnabled, pfRate, otRates };
}

/**
 * คำนวณ payslip ของพนักงาน 1 คน สำหรับเดือนที่ระบุ
 * ไม่บันทึกลงฐานข้อมูล — ใช้สำหรับ preview
 */
async function calculatePayslip(employeeId, year, month) {
  const empResult = await db.query(
    'SELECT id, name, employee_code, salary, COALESCE(deduct_absent, TRUE) AS deduct_absent FROM employees WHERE id = $1 AND is_active = TRUE',
    [employeeId]
  );
  const emp = empResult.rows[0];
  if (!emp) throw new Error('ไม่พบพนักงาน');

  const salary       = parseFloat(emp.salary || 0);
  const deductAbsent = emp.deduct_absent !== false; // TRUE = หักเงินรายวันเมื่อขาดงาน

  // อัตราตัวคูณ OT จาก settings
  const otRatesCfg = await settingsService.getOTRates();
  const rateWD = otRatesCfg.weekday;
  const rateWE = otRatesCfg.weekend;
  const rateHL = otRatesCfg.holiday;

  // OT pay ของเดือนนี้ (เฉพาะที่ approved) — ใช้อัตราจาก settings
  const otResult = await db.query(
    'SELECT' +
    '  COALESCE(SUM(' +
    '    (e.salary / 30.0 / 8.0) *' +
    "    CASE COALESCE(o.ot_type,'weekday')" +
    '      WHEN \'holiday\' THEN $4::numeric' +
    '      WHEN \'weekend\' THEN $5::numeric' +
    '      ELSE $6::numeric' +
    '    END *' +
    '    o.total_hours' +
    '  ), 0) AS ot_pay,' +
    '  COALESCE(SUM(o.total_hours), 0) AS ot_hours,' +
    "  COALESCE(SUM(o.total_hours) FILTER (WHERE COALESCE(o.ot_type,'weekday')='weekday'), 0) AS weekday_ot_hours," +
    "  COALESCE(SUM(o.total_hours) FILTER (WHERE o.ot_type='weekend'), 0) AS weekend_ot_hours," +
    "  COALESCE(SUM(o.total_hours) FILTER (WHERE o.ot_type='holiday'), 0) AS holiday_ot_hours" +
    ' FROM ot_records o' +
    ' JOIN employees e ON e.id = o.employee_id' +
    " WHERE o.employee_id = $1 AND o.status = 'approved'" +
    ' AND EXTRACT(YEAR  FROM o.ot_date) = $2' +
    ' AND EXTRACT(MONTH FROM o.ot_date) = $3',
    [employeeId, year, month, rateHL, rateWE, rateWD]
  );
  const otPay           = parseFloat(otResult.rows[0].ot_pay           || 0);
  const otHours         = parseFloat(otResult.rows[0].ot_hours         || 0);
  const weekdayOtHours  = parseFloat(otResult.rows[0].weekday_ot_hours  || 0);
  const weekendOtHours  = parseFloat(otResult.rows[0].weekend_ot_hours  || 0);
  const holidayOtHours  = parseFloat(otResult.rows[0].holiday_ot_hours  || 0);

  // จำนวนสาย / ขาด จาก attendance_warnings
  const warnResult = await db.query(
    'SELECT warning_type, COUNT(*) AS cnt' +
    ' FROM attendance_warnings' +
    ' WHERE employee_id = $1' +
    ' AND EXTRACT(YEAR  FROM warning_date) = $2' +
    ' AND EXTRACT(MONTH FROM warning_date) = $3' +
    ' GROUP BY warning_type',
    [employeeId, year, month]
  );
  let lateDays = 0, absentDays = 0;
  warnResult.rows.forEach(r => {
    if (r.warning_type === 'late')   lateDays   = parseInt(r.cnt);
    if (r.warning_type === 'absent') absentDays = parseInt(r.cnt);
  });

  // ดึง bonus ที่ Admin บันทึกไว้ล่วงหน้า (ถ้ามี record)
  const bonusRes = await db.query(
    'SELECT bonus, special_allowance, special_allowance_note FROM payroll_records WHERE employee_id=$1 AND year=$2 AND month=$3',
    [employeeId, year, month]
  );
  const bonus                = parseFloat(bonusRes.rows[0]?.bonus             || 0);
  const specialAllowance     = parseFloat(bonusRes.rows[0]?.special_allowance || 0);
  const specialAllowanceNote = bonusRes.rows[0]?.special_allowance_note || '';

  // คำนวณ
  const cfg = await getPayrollSettings();
  const grossIncome    = salary + otPay + bonus + specialAllowance;
  // ประกันสังคม: เพดานแบบ 2 ระดับ
  // รายได้ ≤ 15,000 → สูงสุด 750 บาท | รายได้ ≥ 15,001 → สูงสุด 875 บาท
  const ssMax = salary <= 15000 ? 750 : 875;
  const socialSecurity = Math.min(salary * cfg.ssRate, ssMax);
  const providentFund  = cfg.pfEnabled ? salary * cfg.pfRate : 0;
  // ภาษีก้าวหน้าตาม กม. ไทย (ไม่ใช้ flat rate อีกต่อไป)
  const taxWithholding = calcProgressiveTax(salary + otPay); // ไม่รวม bonus ในฐานภาษี (ปรับได้)
  // หักสาย = จำนวนวันสาย × (เงินเดือน / 30)
  const lateDeduction   = Math.round(lateDays   * (salary / 30) * 100) / 100;
  // หักขาด = จำนวนวันขาด × (เงินเดือน / 30) — เฉพาะพนักงานที่ deductAbsent = TRUE
  const absentDeduction = deductAbsent
    ? Math.round(absentDays * (salary / 30) * 100) / 100
    : 0;
  const totalDeduction = socialSecurity + providentFund + taxWithholding + lateDeduction + absentDeduction;
  const netIncome      = grossIncome - totalDeduction;

  const round = n => Math.round(n * 100) / 100;

  return {
    employee_id:    emp.id,
    employee_name:  emp.name,
    employee_code:  emp.employee_code,
    year, month,
    salary:          round(salary),
    ot_pay:          round(otPay),
    ot_hours:              round(otHours),
    weekday_ot_hours:      round(weekdayOtHours),
    weekend_ot_hours:      round(weekendOtHours),
    holiday_ot_hours:      round(holidayOtHours),
    bonus:                 round(bonus),
    special_allowance:     round(specialAllowance),
    special_allowance_note: specialAllowanceNote,
    gross_income:          round(grossIncome),
    social_security: round(socialSecurity),
    provident_fund:  round(providentFund),
    tax_withholding: round(taxWithholding),
    late_deduction:   round(lateDeduction),
    absent_deduction: round(absentDeduction),
    total_deduction:  round(totalDeduction),
    net_income:       round(netIncome),
    late_days:        lateDays,
    absent_days:      absentDays,
    deduct_absent:    deductAbsent,
    // อัตราที่ใช้ (แสดงบน payslip)
    ss_rate:    cfg.ssRate  * 100,
    pf_rate:    cfg.pfRate  * 100,
    pf_enabled: cfg.pfEnabled,
    tax_rate:   cfg.taxRate * 100,
    ss_max:     cfg.ssMax,
    ot_rate_weekday: otRatesCfg.weekday,
    ot_rate_weekend: otRatesCfg.weekend,
    ot_rate_holiday: otRatesCfg.holiday,
  };
}

/**
 * Generate payroll — คำนวณ + บันทึก payroll_records ทั้งบริษัท
 */
async function generatePayroll(year, month, force = false) {
  // รวม employees ที่ active ทั้งหมด (ไม่ว่าจะมี salary หรือไม่)
  const empResult = await db.query(
    'SELECT id FROM employees WHERE is_active = TRUE'
  );
  const results = [];

  for (const emp of empResult.rows) {
    const p = await calculatePayslip(emp.id, year, month);

    if (force) {
      // force=true: เขียนทับทุก status (ใช้เมื่อ Admin ต้องการ recalculate)
      await db.query(
        'INSERT INTO payroll_records' +
        ' (employee_id, year, month, salary, ot_pay, ot_hours, bonus, gross_income,' +
        '  social_security, provident_fund, tax_withholding, late_deduction, absent_deduction, total_deduction, net_income,' +
        '  late_days, absent_days, weekday_ot_hours, weekend_ot_hours, holiday_ot_hours, status, updated_at)' +
        ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())' +
        ' ON CONFLICT (employee_id, year, month) DO UPDATE SET' +
        '  salary=$4, ot_pay=$5, ot_hours=$6, bonus=$7, gross_income=$8,' +
        '  social_security=$9, provident_fund=$10, tax_withholding=$11,' +
        '  late_deduction=$12, absent_deduction=$13, total_deduction=$14, net_income=$15,' +
        '  late_days=$16, absent_days=$17, weekday_ot_hours=$18, weekend_ot_hours=$19, holiday_ot_hours=$20, status=\'draft\', updated_at=NOW()',
        [
          p.employee_id, year, month,
          p.salary, p.ot_pay, p.ot_hours, p.bonus, p.gross_income,
          p.social_security, p.provident_fund, p.tax_withholding,
          p.late_deduction, p.absent_deduction, p.total_deduction, p.net_income,
          p.late_days, p.absent_days, p.weekday_ot_hours, p.weekend_ot_hours, p.holiday_ot_hours, 'draft',
        ]
      );
    } else {
      // ปกติ: ข้ามถ้า record เป็น confirmed/paid แล้ว
    await db.query(
      'INSERT INTO payroll_records' +
      ' (employee_id, year, month, salary, ot_pay, ot_hours, bonus, gross_income,' +
      '  social_security, provident_fund, tax_withholding, late_deduction, absent_deduction, total_deduction, net_income,' +
      '  late_days, absent_days, weekday_ot_hours, weekend_ot_hours, holiday_ot_hours, status, updated_at)' +
      ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())' +
      ' ON CONFLICT (employee_id, year, month) DO UPDATE SET' +
      '  salary=$4, ot_pay=$5, ot_hours=$6, bonus=$7, gross_income=$8,' +
      '  social_security=$9, provident_fund=$10, tax_withholding=$11,' +
      '  late_deduction=$12, absent_deduction=$13, total_deduction=$14, net_income=$15,' +
      '  late_days=$16, absent_days=$17, weekday_ot_hours=$18, weekend_ot_hours=$19, holiday_ot_hours=$20, updated_at=NOW()' +
      ' WHERE payroll_records.status = \'draft\'',
      [
        p.employee_id, year, month,
        p.salary, p.ot_pay, p.ot_hours, p.bonus, p.gross_income,
        p.social_security, p.provident_fund, p.tax_withholding,
        p.late_deduction, p.absent_deduction, p.total_deduction, p.net_income,
        p.late_days, p.absent_days, p.weekday_ot_hours, p.weekend_ot_hours, p.holiday_ot_hours, 'draft',
      ]
    );
    } // end else
    results.push(p);
  }
  return results;
}

/**
 * ดึง payroll records สำหรับเดือน (admin view)
 */
async function getPayroll(year, month) {
  const result = await db.query(
    'SELECT pr.*,' +
    '  e.name AS employee_name, e.employee_code, e.salary AS current_salary,' +
    '  e.branch_id,' +
    '  d.name AS department_name,' +
    '  b.name AS branch_name,' +
    '  e.deduct_absent' +
    ' FROM payroll_records pr' +
    ' JOIN employees e ON e.id = pr.employee_id' +
    ' LEFT JOIN departments d ON d.id = e.department_id' +
    ' LEFT JOIN branches b ON b.id = e.branch_id' +
    ' WHERE pr.year = $1 AND pr.month = $2' +
    ' ORDER BY d.name, e.name',
    [year, month]
  );
  return result.rows;
}

/**
 * ดึง payslip ของพนักงาน 1 คน (LIFF + Admin)
 * ถ้ามี record บันทึกไว้แล้วใช้ record นั้น ถ้าไม่มีคำนวณ on-the-fly
 */
async function getPayslip(employeeId, year, month) {
  const saved = await db.query(
    'SELECT pr.*,' +
    '  e.name AS employee_name, e.employee_code,' +
    '  d.name AS department_name' +
    ' FROM payroll_records pr' +
    ' JOIN employees e ON e.id = pr.employee_id' +
    ' LEFT JOIN departments d ON d.id = e.department_id' +
    ' WHERE pr.employee_id = $1 AND pr.year = $2 AND pr.month = $3',
    [employeeId, year, month]
  );

  // YTD สะสม (ม.ค. – เดือนปัจจุบัน)
  const ytdResult = await db.query(
    `SELECT
       COALESCE(SUM(gross_income),     0) AS ytd_gross,
       COALESCE(SUM(social_security),  0) AS ytd_ss,
       COALESCE(SUM(tax_withholding),  0) AS ytd_tax,
       COALESCE(SUM(provident_fund),   0) AS ytd_pf
     FROM payroll_records
     WHERE employee_id = $1 AND year = $2 AND month <= $3`,
    [employeeId, year, month]
  );
  const ytd = ytdResult.rows[0];

  if (saved.rows[0]) {
    const r = saved.rows[0];
    const cfg = await getPayrollSettings();
    return Object.assign(r, {
      ss_rate:         cfg.ssRate  * 100,
      ss_max:          cfg.ssMax,
      pf_rate:         cfg.pfRate  * 100,
      pf_enabled:      cfg.pfEnabled,
      tax_rate:        cfg.taxRate * 100,
      ot_rate_weekday: cfg.otRates.weekday,
      ot_rate_weekend: cfg.otRates.weekend,
      ot_rate_holiday: cfg.otRates.holiday,
      ytd_gross:       parseFloat(ytd.ytd_gross  || 0),
      ytd_ss:          parseFloat(ytd.ytd_ss     || 0),
      ytd_tax:         parseFloat(ytd.ytd_tax    || 0),
      ytd_pf:          parseFloat(ytd.ytd_pf     || 0),
    });
  }
  const slip = await calculatePayslip(employeeId, year, month);
  return Object.assign(slip, {
    ytd_gross: parseFloat(ytd.ytd_gross || 0),
    ytd_ss:    parseFloat(ytd.ytd_ss    || 0),
    ytd_tax:   parseFloat(ytd.ytd_tax   || 0),
    ytd_pf:    parseFloat(ytd.ytd_pf    || 0),
  });
}

/**
 * อัปเดตสถานะ payroll record
 */
async function updatePayrollStatus(id, status) {
  const allowed = ['draft', 'confirmed', 'paid'];
  if (!allowed.includes(status)) throw new Error('สถานะไม่ถูกต้อง');
  const paidAt = status === 'paid' ? 'NOW()' : 'NULL';
  const result = await db.query(
    'UPDATE payroll_records SET status=$1, paid_at=' + paidAt + ', updated_at=NOW()' +
    ' WHERE id=$2 RETURNING *',
    [status, id]
  );
  if (!result.rows[0]) throw new Error('ไม่พบ payroll record');
  return result.rows[0];
}

/**
 * ส่ง Flex Message สลิปเงินเดือนผ่าน LINE ให้พนักงานทุกคน
 */
async function sendPayslipsViaLine(year, month) {
  const liffId = process.env.LIFF_ID_PAYSLIP;
  if (!liffId) throw new Error('LIFF_ID_PAYSLIP ยังไม่ได้ตั้งค่าใน .env');

  const liffUrl = `https://liff.line.me/${liffId}`;
  const monthTH = MONTHS_TH[month] || String(month);
  const yearTH  = year + 543;
  const fmt     = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ดึง payroll records ที่มี line_user_id
  const { rows } = await db.query(
    `SELECT pr.net_income, pr.gross_income, pr.total_deduction, pr.status,
            e.name AS employee_name, e.line_user_id
     FROM payroll_records pr
     JOIN employees e ON e.id = pr.employee_id
     WHERE pr.year = $1 AND pr.month = $2
       AND e.line_user_id IS NOT NULL AND e.line_user_id != ''
       AND e.is_active = TRUE`,
    [year, month]
  );

  if (!rows.length) {
    return { sent: 0, failed: 0, skipped: 0,
             message: 'ไม่พบพนักงานที่มี LINE หรือยังไม่ได้คำนวณ Payroll เดือนนี้' };
  }

  let sent = 0, failed = 0;
  const errors = [];

  for (const r of rows) {
    const flexMsg = {
      type: 'flex',
      altText: `💰 สลิปเงินเดือน ${monthTH} ${yearTH} — เงินสุทธิ ฿${fmt(r.net_income)}`,
      contents: {
        type: 'bubble',
        header: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#1357B0',
          paddingAll: '16px',
          contents: [
            { type: 'text', text: 'ต่อกัน Insurance Broker',
              color: '#ffffff', weight: 'bold', size: 'sm' },
            { type: 'text', text: 'สลิปเงินเดือน / Pay Slip',
              color: '#b3c9e8', size: 'xs', margin: 'xs' },
            { type: 'text', text: `${monthTH} ${yearTH}`,
              color: '#ffffff', weight: 'bold', size: 'xl', margin: 'sm' },
          ],
        },
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          paddingAll: '16px',
          contents: [
            {
              type: 'box', layout: 'horizontal',
              contents: [
                { type: 'text', text: 'รวมเงินได้', size: 'sm', color: '#6b7280', flex: 1 },
                { type: 'text', text: `฿${fmt(r.gross_income)}`,
                  size: 'sm', color: '#111827', weight: 'bold', align: 'end' },
              ],
            },
            {
              type: 'box', layout: 'horizontal',
              contents: [
                { type: 'text', text: 'รวมรายหัก', size: 'sm', color: '#6b7280', flex: 1 },
                { type: 'text', text: `- ฿${fmt(r.total_deduction)}`,
                  size: 'sm', color: '#dc2626', weight: 'bold', align: 'end' },
              ],
            },
            { type: 'separator', margin: 'sm' },
            {
              type: 'box', layout: 'horizontal', margin: 'sm',
              contents: [
                { type: 'text', text: 'เงินได้สุทธิ',
                  size: 'md', color: '#1357B0', weight: 'bold', flex: 1 },
                { type: 'text', text: `฿${fmt(r.net_income)}`,
                  size: 'lg', color: '#1357B0', weight: 'bold', align: 'end' },
              ],
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          paddingAll: '12px',
          contents: [
            {
              type: 'button',
              action: { type: 'uri', label: 'ดูสลิปเงินเดือนฉบับเต็ม', uri: liffUrl },
              style: 'primary',
              color: '#1357B0',
              height: 'sm',
            },
          ],
        },
        styles: { footer: { separator: true } },
      },
    };

    try {
      await lineClient.pushMessage({ to: r.line_user_id, messages: [flexMsg] });
      sent++;
    } catch (err) {
      const errMsg = err?.response?.data?.message || err.message || String(err);
      console.error(`[payroll] ส่ง LINE ไม่สำเร็จ ${r.employee_name} (${r.line_user_id}): ${errMsg}`);
      errors.push({ name: r.employee_name, error: errMsg });
      failed++;
    }
  }

  console.log(`[payroll] ส่ง Payslip LINE ${year}/${month}: sent=${sent} failed=${failed}`);
  return { sent, failed, total: rows.length, errors };
}

/**
 * Export Payroll เป็น Excel — 3 sheets:
 * 1. สรุปเงินเดือน  2. ภ.ง.ด.1  3. สปส. 1-10
 */
async function exportPayrollExcel(year, month) {
  const ExcelJS = require('exceljs');
  const monthTH  = MONTHS_TH[month] || String(month);
  const yearTH   = year + 543;
  const periodTH = `${monthTH} ${yearTH}`;

  // ดึงข้อมูล payroll records
  const { rows } = await db.query(
    `SELECT pr.*,
            e.name AS employee_name, e.employee_code,
            d.name AS department_name
     FROM payroll_records pr
     JOIN employees e ON e.id = pr.employee_id
     LEFT JOIN departments d ON d.id = e.department_id
     WHERE pr.year = $1 AND pr.month = $2
     ORDER BY d.name, e.name`,
    [year, month]
  );

  const cfg = await getPayrollSettings();

  // ดึงข้อมูล OT แยก weekday / holiday ต่อพนักงาน
  const { rows: otRows } = await db.query(
    `SELECT employee_id,
       ROUND(COALESCE(SUM(total_hours) FILTER (WHERE ot_type = 'weekday'), 0)::numeric, 2) AS weekday_hours,
       ROUND(COALESCE(SUM(total_hours) FILTER (WHERE ot_type = 'holiday'), 0)::numeric, 2) AS holiday_hours,
       ROUND(COALESCE(SUM(total_hours), 0)::numeric, 2) AS total_hours
     FROM ot_records
     WHERE EXTRACT(YEAR FROM ot_date) = $1
       AND EXTRACT(MONTH FROM ot_date) = $2
       AND status = 'approved'
     GROUP BY employee_id`,
    [year, month]
  );
  const otMap = {};
  otRows.forEach(r => {
    otMap[r.employee_id] = {
      weekday: parseFloat(r.weekday_hours || 0),
      holiday: parseFloat(r.holiday_hours || 0),
      total:   parseFloat(r.total_hours   || 0),
    };
  });

  // ดึงชื่อบริษัทจาก settings
  const companyRes = await db.query("SELECT value FROM settings WHERE key = 'company_name'");
  const companyName = companyRes.rows[0]?.value || 'บริษัท ต่อกัน อินชัวร์รันส์ โบรคเกอร์ จำกัด';
  const lastDay = new Date(year, month, 0).getDate();

  const wb = new ExcelJS.Workbook();
  wb.creator  = 'ต่อกัน HR System';
  wb.created  = new Date();

  // ════════════════════════════════════════════════════════════════════
  // SHEET 1 — บัญชีจ่ายเงินเดือน (ตรงตาม template)
  // ════════════════════════════════════════════════════════════════════
  const ws0 = wb.addWorksheet('บัญชีจ่ายเงินเดือน');

  // ── ความกว้างคอลัมน์ (A–T = 20 cols) ──────────────────────────────
  // A  B   C  D  E    F   G    H    I    J   K    L    M    N    O    P    Q   R   S   T
  [6, 18, 4, 4, 12, 8, 13, 12, 13, 8, 13, 12, 14, 14, 13, 14, 32, 12, 8, 8]
    .forEach((w, i) => { ws0.getColumn(i + 1).width = w; });

  const b = { top:{ style:'thin' }, left:{ style:'thin' }, bottom:{ style:'thin' }, right:{ style:'thin' } };
  const bMed = { top:{ style:'medium' }, left:{ style:'medium' }, bottom:{ style:'medium' }, right:{ style:'medium' } };
  const hFill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFD5E8FF' } };
  const numC  = '#,##0.00';

  function cellSet(cell, val, opts = {}) {
    cell.value = val;
    if (opts.bold)    cell.font = { ...(cell.font||{}), bold: true, size: opts.size || 11 };
    if (opts.size)    cell.font = { ...(cell.font||{}), size: opts.size };
    if (opts.center)  cell.alignment = { horizontal:'center', vertical:'middle', wrapText: true };
    if (opts.right)   cell.alignment = { horizontal:'right',  vertical:'middle' };
    if (opts.left)    cell.alignment = { horizontal:'left',   vertical:'middle' };
    if (opts.fill)    cell.fill = opts.fill;
    if (opts.border)  cell.border = opts.border;
    if (opts.numFmt)  cell.numFmt = opts.numFmt;
  }

  // ── แถว 1: ชื่อบริษัท ────────────────────────────────────────────
  ws0.mergeCells('A1:T1');
  cellSet(ws0.getCell('A1'), companyName, { bold:true, size:13, center:true });
  ws0.getRow(1).height = 24;

  // ── แถว 2: หัวเรื่อง ─────────────────────────────────────────────
  ws0.mergeCells('A2:T2');
  cellSet(ws0.getCell('A2'), 'บัญชีคำนวณค่าจ้าง ค่าทำงานล่วงเวลา ค่าทำงานในวันหยุด', { size:11, center:true });
  ws0.getRow(2).height = 18;

  // ── แถว 3: วันที่ ─────────────────────────────────────────────────
  ws0.mergeCells('A3:T3');
  cellSet(ws0.getCell('A3'), `วันที่   ${lastDay}   ${monthTH}    ${yearTH}`, { size:11, left:true });
  ws0.getRow(3).height = 18;

  // ── แถว 4-5: Header (double row) ─────────────────────────────────
  // Row 4 merged cells
  ws0.mergeCells('A4:A5'); // ลำดับที่
  ws0.mergeCells('B4:D5'); // ชื่อ - สกุล
  ws0.mergeCells('E4:G4'); // ค่าจ้าง
  ws0.mergeCells('H4:H5'); // โบนัส
  ws0.mergeCells('I4:K4'); // OT.
  ws0.mergeCells('L4:L5'); // เบี้ยพิเศษ
  ws0.mergeCells('M4:M5'); // รวมเงิน
  ws0.mergeCells('N4:N5'); // หักวันขาดงาน
  ws0.mergeCells('O4:O5'); // ประกันสังคม
  ws0.mergeCells('P4:P5'); // รวมเงินทั้งสิ้น
  ws0.mergeCells('Q4:Q5'); // หมายเหตุ
  ws0.mergeCells('R4:T5'); // ลงชื่อผู้รับเงิน

  const hdrTxt = [
    ['A4','ลำดับที่'],['B4','ชื่อ - สกุล'],['E4','ค่าจ้าง'],['H4','โบนัส'],
    ['I4','OT.'],['L4','เบี้ยพิเศษ'],['M4','รวมเงิน'],['N4','หักวันขาดงาน'],
    ['O4','ประกันสังคม'],['P4','รวมเงินทั้งสิ้น'],['Q4','หมายเหตุ'],['R4','ลงชื่อผู้รับเงิน'],
  ];
  hdrTxt.forEach(([addr, txt]) => {
    cellSet(ws0.getCell(addr), txt, { bold:true, size:10, center:true, fill:hFill, border:b });
  });
  ws0.getRow(4).height = 20;

  // Row 5 sub-headers
  const subTxt = [['E5','หน่วยละ'],['F5','เดือน/วัน'],['G5','รวมเงิน'],['I5','หน่วยละ'],['J5','ชม.'],['K5','รวมเงิน']];
  subTxt.forEach(([addr, txt]) => {
    cellSet(ws0.getCell(addr), txt, { bold:true, size:9, center:true, fill:hFill, border:b });
  });
  ws0.getRow(5).height = 18;

  // ── แถวข้อมูล ─────────────────────────────────────────────────────
  let p1Salary=0, p1Bonus=0, p1OTHrs=0, p1OTPay=0, p1Allow=0;
  let p1Gross=0, p1Absent=0, p1SS=0, p1Net=0;

  rows.forEach((r, idx) => {
    const rowNum = idx + 6;
    const salary  = parseFloat(r.salary || 0);
    const bonus   = parseFloat(r.bonus || 0);
    const otPay   = parseFloat(r.ot_pay || 0);
    const gross   = parseFloat(r.gross_income || 0);
    const absent  = parseFloat(r.absent_deduction || 0);
    const ss      = parseFloat(r.social_security || 0);
    const net     = parseFloat(r.net_income || 0);
    const allow   = Math.max(0, gross - salary - bonus - otPay);
    const otInfo  = otMap[r.employee_id] || { weekday:0, holiday:0, total:0 };
    const otHrs   = otInfo.total;
    const otRate  = salary > 0 ? salary / 30 / 8 : 0;

    // Remarks: OT breakdown
    const parts = [];
    if (otInfo.weekday > 0) parts.push(`OT วันปกติ ${otInfo.weekday.toFixed(2)} ช.ม`);
    if (otInfo.holiday > 0) parts.push(`OT วันหยุด ${otInfo.holiday.toFixed(2)} ช.ม`);
    const remark = parts.join('   ') || '';

    ws0.mergeCells(`B${rowNum}:D${rowNum}`);

    const rowData = [
      ['A', idx+1, { center:true, border:b }],
      ['B', r.employee_name, { left:true, border:b }],
      ['E', salary,  { right:true, border:b, numFmt:numC }],
      ['F', 1,       { center:true, border:b }],
      ['G', salary,  { right:true, border:b, numFmt:numC }],
      ['H', bonus,   { right:true, border:b, numFmt:numC }],
      ['I', otHrs > 0 ? otRate : 0, { right:true, border:b, numFmt:numC }],
      ['J', otHrs,   { right:true, border:b, numFmt:'#,##0.00' }],
      ['K', otPay,   { right:true, border:b, numFmt:numC }],
      ['L', allow,   { right:true, border:b, numFmt:numC }],
      ['M', gross,   { right:true, border:b, numFmt:numC }],
      ['N', absent,  { right:true, border:b, numFmt:numC }],
      ['O', ss,      { right:true, border:b, numFmt:numC }],
      ['P', net,     { right:true, border:b, numFmt:numC }],
      ['Q', remark,  { left:true,  border:b }],
    ];
    rowData.forEach(([col, val, opts]) => {
      const cell = ws0.getCell(`${col}${rowNum}`);
      cellSet(cell, val, opts);
    });
    // Empty signature cols
    ['R','S','T'].forEach(col => { ws0.getCell(`${col}${rowNum}`).border = b; });

    // Alternating row shade
    if (idx % 2 === 1) {
      ['A','B','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T'].forEach(col => {
        const c = ws0.getCell(`${col}${rowNum}`);
        if (!c.fill || c.fill.type !== 'pattern' || !c.fill.fgColor) {
          c.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFF5F8FF' } };
        }
      });
    }
    ws0.getRow(rowNum).height = 18;

    p1Salary += salary; p1Bonus += bonus; p1OTHrs += otHrs;
    p1OTPay  += otPay;  p1Allow += allow; p1Gross += gross;
    p1Absent += absent; p1SS    += ss;    p1Net   += net;
  });

  // ── แถวรวม ────────────────────────────────────────────────────────
  const totRow = rows.length + 6;
  ws0.mergeCells(`B${totRow}:D${totRow}`);

  const totFill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFFFF3CD' } };
  const totData = [
    ['A', ' '],['B','รวม'],
    ['E', p1Salary], ['F', rows.length], ['G', p1Salary],
    ['H', p1Bonus],  ['I', ''], ['J', p1OTHrs], ['K', p1OTPay],
    ['L', p1Allow],  ['M', p1Gross], ['N', p1Absent], ['O', p1SS],
    ['P', p1Net],    ['Q', ''], ['R',''], ['S',''], ['T',''],
  ];
  totData.forEach(([col, val]) => {
    const cell = ws0.getCell(`${col}${totRow}`);
    cell.value  = val;
    cell.font   = { bold: true, size: 10 };
    cell.fill   = totFill;
    cell.border = b;
    cell.alignment = { vertical:'middle', horizontal: (typeof val === 'number') ? 'right' : 'center' };
    if (typeof val === 'number' && !['F'].includes(col)) cell.numFmt = numC;
  });
  ws0.getRow(totRow).height = 20;

  // ── แถว SS employer ───────────────────────────────────────────────
  const ss1Row = totRow + 1;
  const ss2Row = totRow + 2;
  const apvRow = totRow + 3;

  ws0.mergeCells(`B${ss1Row}:D${ss1Row}`);
  ws0.getCell(`M${ss1Row}`).value = 'ผู้ประกันตน';
  ws0.getCell(`M${ss1Row}`).font  = { bold:true, size:10 };
  ws0.getCell(`M${ss1Row}`).alignment = { horizontal:'right', vertical:'middle' };
  ws0.getCell(`O${ss1Row}`).value  = p1SS;
  ws0.getCell(`O${ss1Row}`).numFmt = numC;
  ws0.getCell(`O${ss1Row}`).border = b;
  ws0.getRow(ss1Row).height = 18;

  ws0.mergeCells(`B${ss2Row}:D${ss2Row}`);
  ws0.getCell(`N${ss2Row}`).value = 'นายจ้าง';
  ws0.getCell(`N${ss2Row}`).font  = { bold:true, size:10 };
  ws0.getCell(`N${ss2Row}`).alignment = { horizontal:'right', vertical:'middle' };
  ws0.getCell(`O${ss2Row}`).value  = p1SS;
  ws0.getCell(`O${ss2Row}`).numFmt = numC;
  ws0.getCell(`O${ss2Row}`).border = b;
  ws0.getRow(ss2Row).height = 18;

  ws0.getCell(`B${apvRow}`).value = 'ผู้อนุมัติ........................................';
  ws0.getCell(`B${apvRow}`).font  = { size:10 };
  ws0.getCell(`O${apvRow}`).value  = p1SS * 2;
  ws0.getCell(`O${apvRow}`).numFmt = numC;
  ws0.getCell(`O${apvRow}`).border = b;
  ws0.getRow(apvRow).height = 22;

  // Freeze header rows
  ws0.views = [{ state:'frozen', ySplit: 5 }];

  // ── สไตล์ทั่วไป ──────────────────────────────────────────────────
  const hdrFill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1357B0' } };
  const hdrFont  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  const subFill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBFD3F0' } };
  const subFont  = { bold: true, size: 10 };
  const numFmt   = '#,##0.00';
  const thinBorder = {
    top:    { style: 'thin', color: { argb: 'FFD1D5DB' } },
    left:   { style: 'thin', color: { argb: 'FFD1D5DB' } },
    bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    right:  { style: 'thin', color: { argb: 'FFD1D5DB' } },
  };

  function applyHdr(row, fillColor) {
    row.eachCell(c => {
      c.fill   = fillColor || hdrFill;
      c.font   = fillColor ? subFont : hdrFont;
      c.border = thinBorder;
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    row.height = 22;
  }

  function applyData(row, shade) {
    row.eachCell({ includeEmpty: true }, c => {
      c.border = thinBorder;
      c.alignment = { vertical: 'middle' };
      if (shade) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
    });
    row.height = 18;
  }

  // ────────────────────────────────────────────────────────────────
  // SHEET 1 — สรุปเงินเดือน
  // ────────────────────────────────────────────────────────────────
  const ws1 = wb.addWorksheet('สรุปเงินเดือน');
  ws1.properties.defaultColWidth = 14;

  // Title
  ws1.mergeCells('A1:L1');
  const t1 = ws1.getCell('A1');
  t1.value = `สรุปเงินเดือนประจำเดือน ${periodTH} — ต่อกัน อินชัวร์รันส์ โบรคเกอร์ จำกัด`;
  t1.font  = { bold: true, size: 13, color: { argb: 'FF1357B0' } };
  t1.alignment = { horizontal: 'center', vertical: 'middle' };
  ws1.getRow(1).height = 28;

  ws1.mergeCells('A2:L2');

  const cols1 = [
    { header: 'ลำดับ',        key: 'no',     width: 6  },
    { header: 'รหัสพนักงาน',  key: 'code',   width: 14 },
    { header: 'ชื่อ-นามสกุล', key: 'name',   width: 22 },
    { header: 'แผนก',         key: 'dept',   width: 16 },
    { header: 'เงินเดือน',    key: 'salary', width: 14 },
    { header: 'OT Pay',       key: 'ot',     width: 12 },
    { header: 'รวมเงินได้',   key: 'gross',  width: 14 },
    { header: 'ประกันสังคม',  key: 'ss',     width: 13 },
    { header: 'กองทุนสำรองฯ', key: 'pf',    width: 14 },
    { header: 'ภาษี ณ ที่จ่าย', key: 'tax', width: 14 },
    { header: 'รวมรายหัก',    key: 'deduct', width: 14 },
    { header: 'เงินสุทธิ',    key: 'net',    width: 14 },
  ];
  ws1.columns = cols1;

  const hRow1 = ws1.getRow(3);
  hRow1.values = cols1.map(c => c.header);
  applyHdr(hRow1);
  cols1.forEach((c, i) => { ws1.getColumn(i + 1).width = c.width; });

  let totSalary = 0, totOT = 0, totGross = 0, totSS = 0, totPF = 0, totTax = 0, totDeduct = 0, totNet = 0;

  rows.forEach((r, idx) => {
    const row = ws1.addRow({
      no:     idx + 1,
      code:   r.employee_code,
      name:   r.employee_name,
      dept:   r.department_name || '-',
      salary: parseFloat(r.salary || 0),
      ot:     parseFloat(r.ot_pay || 0),
      gross:  parseFloat(r.gross_income || 0),
      ss:     parseFloat(r.social_security || 0),
      pf:     parseFloat(r.provident_fund || 0),
      tax:    parseFloat(r.tax_withholding || 0),
      deduct: parseFloat(r.total_deduction || 0),
      net:    parseFloat(r.net_income || 0),
    });
    ['salary','ot','gross','ss','pf','tax','deduct','net'].forEach(k => {
      row.getCell(cols1.findIndex(c => c.key === k) + 1).numFmt = numFmt;
    });
    applyData(row, idx % 2 === 1);
    totSalary += parseFloat(r.salary || 0);
    totOT     += parseFloat(r.ot_pay || 0);
    totGross  += parseFloat(r.gross_income || 0);
    totSS     += parseFloat(r.social_security || 0);
    totPF     += parseFloat(r.provident_fund || 0);
    totTax    += parseFloat(r.tax_withholding || 0);
    totDeduct += parseFloat(r.total_deduction || 0);
    totNet    += parseFloat(r.net_income || 0);
  });

  // Total row
  const totRow1 = ws1.addRow({
    no: '', code: '', name: 'รวมทั้งหมด', dept: `${rows.length} คน`,
    salary: totSalary, ot: totOT, gross: totGross,
    ss: totSS, pf: totPF, tax: totTax, deduct: totDeduct, net: totNet,
  });
  totRow1.eachCell((c, col) => {
    c.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
    c.font   = { bold: true, size: 10 };
    c.border = thinBorder;
    c.alignment = { vertical: 'middle', horizontal: col >= 5 ? 'right' : 'center' };
    if (col >= 5) c.numFmt = numFmt;
  });
  totRow1.height = 20;

  ws1.views = [{ state: 'frozen', ySplit: 3 }];

  // ────────────────────────────────────────────────────────────────
  // SHEET 3 — ภ.ง.ด.1
  // ────────────────────────────────────────────────────────────────
  const ws2 = wb.addWorksheet('ภ.ง.ด.1');

  ws2.mergeCells('A1:H1');
  const t2 = ws2.getCell('A1');
  t2.value = `แบบ ภ.ง.ด.1 — ภาษีเงินได้หัก ณ ที่จ่าย เดือน ${periodTH}`;
  t2.font  = { bold: true, size: 13, color: { argb: 'FF1357B0' } };
  t2.alignment = { horizontal: 'center', vertical: 'middle' };
  ws2.getRow(1).height = 28;
  ws2.mergeCells('A2:H2');

  ws2.mergeCells('A3:H3');
  const subT2 = ws2.getCell('A3');
  subT2.value = 'ผู้มีหน้าที่หักภาษี: บริษัท ต่อกัน อินชัวร์รันส์ โบรคเกอร์ จำกัด';
  subT2.font  = { size: 10, color: { argb: 'FF374151' } };
  ws2.getRow(3).height = 18;
  ws2.mergeCells('A4:H4');

  const cols2 = [
    { header: 'ลำดับ',            key: 'no',     width: 6  },
    { header: 'รหัสพนักงาน',      key: 'code',   width: 14 },
    { header: 'ชื่อ-นามสกุล',     key: 'name',   width: 24 },
    { header: 'เงินได้พึงประเมิน', key: 'income', width: 20 },
    { header: 'ประเภทเงินได้',     key: 'type',   width: 18 },
    { header: 'ภาษีที่หัก (บาท)',  key: 'tax',    width: 18 },
    { header: 'เงื่อนไข',         key: 'cond',   width: 14 },
    { header: 'หมายเหตุ',         key: 'remark', width: 16 },
  ];
  ws2.columns = cols2;

  const hRow2 = ws2.getRow(5);
  hRow2.values = cols2.map(c => c.header);
  applyHdr(hRow2);
  cols2.forEach((c, i) => { ws2.getColumn(i + 1).width = c.width; });

  let totTax2 = 0, totIncome2 = 0;
  rows.forEach((r, idx) => {
    const row = ws2.addRow({
      no:     idx + 1,
      code:   r.employee_code,
      name:   r.employee_name,
      income: parseFloat(r.gross_income || 0),
      type:   '40(1) เงินเดือน/ค่าจ้าง',
      tax:    parseFloat(r.tax_withholding || 0),
      cond:   '1',
      remark: '',
    });
    row.getCell(4).numFmt = numFmt;
    row.getCell(6).numFmt = numFmt;
    applyData(row, idx % 2 === 1);
    totIncome2 += parseFloat(r.gross_income || 0);
    totTax2    += parseFloat(r.tax_withholding || 0);
  });

  const totRow2 = ws2.addRow({
    no: '', code: '', name: 'รวม', income: totIncome2,
    type: '', tax: totTax2, cond: '', remark: '',
  });
  totRow2.eachCell((c, col) => {
    c.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
    c.font   = { bold: true };
    c.border = thinBorder;
    if (col === 4 || col === 6) c.numFmt = numFmt;
  });
  totRow2.height = 20;

  ws2.addRow([]);
  const noteRow2 = ws2.addRow(['', '', '** ยื่นแบบภายใน 7 วัน (online) หรือ 15 วัน (กระดาษ) นับจากวันสิ้นเดือน **']);
  noteRow2.getCell(3).font = { italic: true, color: { argb: 'FFDC2626' }, size: 10 };
  ws2.views = [{ state: 'frozen', ySplit: 5 }];

  // ────────────────────────────────────────────────────────────────
  // SHEET 4 — สปส. 1-10
  // ────────────────────────────────────────────────────────────────
  const ws3 = wb.addWorksheet('สปส. 1-10');

  ws3.mergeCells('A1:G1');
  const t3 = ws3.getCell('A1');
  t3.value = `แบบ สปส. 1-10 — รายงานเงินสมทบประกันสังคม เดือน ${periodTH}`;
  t3.font  = { bold: true, size: 13, color: { argb: 'FF1357B0' } };
  t3.alignment = { horizontal: 'center', vertical: 'middle' };
  ws3.getRow(1).height = 28;
  ws3.mergeCells('A2:G2');

  const ssRate = cfg.ssRate * 100;
  const ssMax  = cfg.ssMax;
  ws3.mergeCells('A3:G3');
  ws3.getCell('A3').value = `อัตราเงินสมทบ: ${ssRate}% (สูงสุด ${ssMax} บาท/เดือน) | นายจ้างสมทบเท่ากัน`;
  ws3.getCell('A3').font  = { size: 10, color: { argb: 'FF374151' } };
  ws3.getRow(3).height = 18;
  ws3.mergeCells('A4:G4');

  const cols3 = [
    { header: 'ลำดับ',                    key: 'no',     width: 6  },
    { header: 'รหัสพนักงาน',              key: 'code',   width: 14 },
    { header: 'ชื่อ-นามสกุล',             key: 'name',   width: 24 },
    { header: 'ค่าจ้างที่ใช้คำนวณ (บาท)', key: 'wage',   width: 22 },
    { header: 'เงินสมทบลูกจ้าง (บาท)',    key: 'empSS',  width: 20 },
    { header: 'เงินสมทบนายจ้าง (บาท)',    key: 'empRSS', width: 20 },
    { header: 'รวมเงินนำส่ง (บาท)',       key: 'total',  width: 18 },
  ];
  ws3.columns = cols3;

  const hRow3 = ws3.getRow(5);
  hRow3.values = cols3.map(c => c.header);
  applyHdr(hRow3);
  cols3.forEach((c, i) => { ws3.getColumn(i + 1).width = c.width; });

  let totWage = 0, totEmpSS = 0, totTotal = 0;
   rows.forEach((r, idx) => {
    const ss = parseFloat(r.social_security || 0);
    const row = ws3.addRow({
      no:     idx + 1,
      code:   r.employee_code,
      name:   r.employee_name,
      wage:   parseFloat(r.salary || 0),
      empSS:  ss,
      empRSS: ss,
      total:  ss * 2,
    });
    [4, 5, 6, 7].forEach(col => { row.getCell(col).numFmt = numFmt; });
    applyData(row, idx % 2 === 1);
    totWage  += parseFloat(r.salary || 0);
    totEmpSS += ss;
    totTotal += ss * 2;
  });

  const totRow3 = ws3.addRow({
    no: '', code: '', name: 'รวม', wage: totWage,
    empSS: totEmpSS, empRSS: totEmpSS, total: totTotal,
  });
  totRow3.eachCell((c, col) => {
    c.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
    c.font   = { bold: true };
    c.border = thinBorder;
    if (col >= 4) c.numFmt = numFmt;
  });
  totRow3.height = 20;

  ws3.addRow([]);
  const noteRow3 = ws3.addRow(['', '', '** ยื่นแบบ + นำส่งเงินสมทบภายในวันที่ 15 ของเดือนถัดไป **']);
  noteRow3.getCell(3).font = { italic: true, color: { argb: 'FFDC2626' }, size: 10 };
  ws3.views = [{ state: 'frozen', ySplit: 5 }];

  return { workbook: wb, periodTH, month, year };
}


/**
 * Export บัญชีคำนวณค่าจ้าง ค่าทำงานล่วงเวลา ค่าทำงานในวันหยุด (Excel)
 */
async function exportWageSheet(year, month) {
  const rows = await getPayroll(year, month);

  const thMonths = ['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
    'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const buddhistYear = year + 543;
  // วันสุดท้ายของเดือน
  const lastDay = new Date(year, month, 0).getDate();
  const periodTH = `วันที่  ${lastDay}  ${thMonths[month]}  ${buddhistYear}`;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('บัญชีค่าจ้าง', { pageSetup: { orientation: 'landscape', paperSize: 9 } });

  // --- Column widths ---
  ws.columns = [
    { key: 'no',      width: 6  },  // A ลำดับที่
    { key: 'name',    width: 22 },  // B ชื่อ-สกุล
    { key: 'rate',    width: 11 },  // C ค่าจ้าง หน่วยละ
    { key: 'period',  width: 9  },  // D เดือน/วัน
    { key: 'salary',  width: 12 },  // E รวมเงิน (ค่าจ้าง)
    { key: 'bonus',   width: 11 },  // F โบนัส
    { key: 'otRate',  width: 10 },  // G OT หน่วยละ
    { key: 'otHrs',   width: 8  },  // H OT ชม.
    { key: 'otPay',   width: 12 },  // I OT รวมเงิน
    { key: 'special', width: 12 },  // J เบี้ยพิเศษ
    { key: 'gross',   width: 13 },  // K รวมเงิน
    { key: 'absent',  width: 11 },  // L หักวันขาดงาน
    { key: 'ss',      width: 11 },  // M ประกันสังคม
    { key: 'net',     width: 13 },  // N รวมเงินทั้งสิน
    { key: 'remark',  width: 28 },  // O หมายเหตุ
    { key: 'sign',    width: 16 },  // P ลงชื่อผู้รับเงิน
  ];

  const numFmt = '#,##0.00';
  const thin = { style: 'thin' };
  const allBorder = { top: thin, left: thin, bottom: thin, right: thin };

  const hFill   = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const center  = { horizontal: 'center', vertical: 'middle' };
  const vcenter = { horizontal: 'left',   vertical: 'middle' };

  // ===== ROW 1: Company name =====
  ws.mergeCells('A1:P1');
  const r1 = ws.getRow(1); r1.height = 22;
  const cfg = await getPayrollSettings();
  const companyNameWage = await settingsService.get('company_name') || 'บริษัท ต่อกัน อินชัวร์รันส์ โบรคเกอร์ จำกัด';
  r1.getCell(1).value     = companyNameWage;
  r1.getCell(1).font      = { bold: true, size: 13, name: 'TH SarabunPSK' };
  r1.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

  // ===== ROW 2: Title =====
  ws.mergeCells('A2:P2');
  const r2 = ws.getRow(2); r2.height = 20;
  r2.getCell(1).value     = 'บัญชีคำนวณค่าจ้าง  ค่าทำงานล่วงเวลา  ค่าทำงานในวันหยุด';
  r2.getCell(1).font      = { bold: true, size: 13, name: 'TH SarabunPSK' };
  r2.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

  // ===== ROW 3: Date =====
  ws.mergeCells('A3:P3');
  const r3 = ws.getRow(3); r3.height = 20;
  r3.getCell(1).value     = periodTH;
  r3.getCell(1).font      = { bold: true, size: 13, name: 'TH SarabunPSK' };
  r3.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

  // blank row 4
  ws.getRow(4).height = 6;

  // ===== ROW 5-6: Headers =====
  // Merged header cells row 5
  ws.mergeCells('A5:A6'); // ลำดับที่
  ws.mergeCells('B5:B6'); // ชื่อ-สกุล
  ws.mergeCells('C5:E5'); // ค่าจ้าง (header)
  ws.mergeCells('F5:F6'); // โบนัส
  ws.mergeCells('G5:I5'); // OT. (header)
  ws.mergeCells('J5:J6'); // เบี้ยพิเศษ
  ws.mergeCells('K5:K6'); // รวมเงิน
  ws.mergeCells('L5:L6'); // หักวันขาดงาน
  ws.mergeCells('M5:M6'); // ประกันสังคม
  ws.mergeCells('N5:N6'); // รวมเงินทั้งสิน
  ws.mergeCells('O5:O6'); // หมายเหตุ
  ws.mergeCells('P5:P6'); // ลงชื่อ

  const hdrFont = { bold: true, size: 11, name: 'TH SarabunPSK' };
  const hdrFill = hFill('FFD9E1F2');

  const setHdr = (cell, val) => {
    const c = ws.getCell(cell);
    c.value = val; c.font = hdrFont; c.fill = hdrFill;
    c.alignment = { ...center, wrapText: true };
    c.border = allBorder;
  };

  setHdr('A5', 'ลำดับที่');    setHdr('B5', 'ชื่อ - สกุล');
  setHdr('C5', 'ค่าจ้าง');    setHdr('F5', 'โบนัส');
  setHdr('G5', 'OT.');         setHdr('J5', 'เบี้ยพิเศษ');
  setHdr('K5', 'รวมเงิน');    setHdr('L5', 'หักวัน\nขาดงาน');
  setHdr('M5', 'ประกันสังคม'); setHdr('N5', 'รวมเงิน\nทั้งสิน');
  setHdr('O5', 'หมายเหตุ');   setHdr('P5', 'ลงชื่อผู้รับเงิน');

  // Sub-headers row 6
  ['C6','D6','E6'].forEach((c,i) => setHdr(c, ['หน่วยละ','เดือน/วัน','รวมเงิน'][i]));
  ['G6','H6','I6'].forEach((c,i) => setHdr(c, ['หน่วยละ','ชม.','รวมเงิน'][i]));

  ws.getRow(5).height = 22;
  ws.getRow(6).height = 20;

  // ===== DATA ROWS =====
  const dataFont = { size: 11, name: 'TH SarabunPSK' };
  const altFill  = hFill('FFFCE4D6');
  const fmt2     = n => parseFloat(n||0);

  let totSalary=0, totBonus=0, totOtPay=0, totSpecial=0, totGross=0;
  let totAbsent=0, totSS=0, totNet=0;

  rows.forEach((r, idx) => {
    const rowNum = 7 + idx;
    const fill   = idx % 2 === 1 ? altFill : null;
    const ws_row = ws.getRow(rowNum);
    ws_row.height = 30;

    const salary      = fmt2(r.salary);
    const bonus       = fmt2(r.bonus);
    const otPay       = fmt2(r.ot_pay);
    const otHours     = fmt2(r.ot_hours);
    const special     = fmt2(r.special_allowance);
    const gross       = fmt2(r.gross_income);
    const absentDed   = fmt2(r.absent_deduction);
    const ss          = fmt2(r.social_security);
    const net         = fmt2(r.net_income);
    const wdOtH       = fmt2(r.weekday_ot_hours);
    const hdOtH       = fmt2(r.holiday_ot_hours);
    const otRate      = salary > 0 ? Math.round((salary / 30 / 8) * 1.5 * 100) / 100 : 0;
    const specialNote = r.special_allowance_note || '';

    // Remark
    let remark = '';
    if (wdOtH > 0) remark += `OT วันปกติ ${wdOtH} ชม.`;
    if (hdOtH > 0) remark += (remark ? '\n' : '') + `OT วันหยุด ${hdOtH} ชม.`;
    if (specialNote) remark += (remark ? '\n' : '') + `เบี้ยพิเศษ: ${specialNote}`;

    const cols = [
      { col: 'A', val: idx+1,   fmt: null,    align: center },
      { col: 'B', val: r.employee_name||'', fmt: null, align: vcenter },
      { col: 'C', val: salary,  fmt: numFmt,  align: null },
      { col: 'D', val: 1.00,    fmt: '0.00',  align: center },
      { col: 'E', val: salary,  fmt: numFmt,  align: null },
      { col: 'F', val: bonus||'-', fmt: bonus?numFmt:null, align: bonus?null:center },
      { col: 'G', val: otRate,  fmt: numFmt,  align: null },
      { col: 'H', val: otHours||'-', fmt: otHours?'0.00':null, align: otHours?null:center },
      { col: 'I', val: otPay||'-', fmt: otPay?numFmt:null, align: otPay?null:center },
      { col: 'J', val: special||'-', fmt: special?numFmt:null, align: special?null:center },
      { col: 'K', val: gross,   fmt: numFmt,  align: null },
      { col: 'L', val: absentDed||'-', fmt: absentDed?numFmt:null, align: absentDed?null:center },
      { col: 'M', val: ss,      fmt: numFmt,  align: null },
      { col: 'N', val: net,     fmt: numFmt,  align: null },
      { col: 'O', val: remark,  fmt: null,    align: { ...vcenter, wrapText: true } },
      { col: 'P', val: '',      fmt: null,    align: center },
    ];
    cols.forEach(({ col, val, fmt, align }) => {
      const cell = ws.getCell(`${col}${rowNum}`);
      cell.value     = val;
      cell.font      = dataFont;
      cell.border    = allBorder;
      if (fmt)   cell.numFmt    = fmt;
      if (align) cell.alignment = align;
      if (fill)  cell.fill      = fill;
    });

    totSalary += salary; totBonus += bonus; totOtPay += otPay;
    totSpecial += special; totGross += gross;
    totAbsent  += absentDed; totSS += ss; totNet += net;
  });

  // ===== TOTAL ROW =====
  const totRow = rows.length + 7;
  ws.getRow(totRow).height = 22;
  const totFill = hFill('FFD9E1F2');
  const totFont = { bold: true, size: 11, name: 'TH SarabunPSK' };

  const setTot = (col, val, fmt) => {
    const c = ws.getCell(`${col}${totRow}`);
    c.value = val; c.font = totFont; c.fill = totFill; c.border = allBorder;
    c.alignment = { horizontal: 'right', vertical: 'middle' };
    if (fmt) c.numFmt = fmt;
  };
  ws.mergeCells(`A${totRow}:B${totRow}`);
  const tc = ws.getCell(`A${totRow}`);
  tc.value = 'รวม'; tc.font = totFont; tc.fill = totFill; tc.border = allBorder;
  tc.alignment = { horizontal: 'center', vertical: 'middle' };

  setTot('E', totSalary,  numFmt); setTot('F', totBonus||'-', totBonus?numFmt:null);
  setTot('I', totOtPay||'-', totOtPay?numFmt:null);
  setTot('J', totSpecial||'-', totSpecial?numFmt:null);
  setTot('K', totGross,  numFmt);  setTot('L', totAbsent||'-', totAbsent?numFmt:null);
  setTot('M', totSS,     numFmt);  setTot('N', totNet,   numFmt);

  // ===== SS SUMMARY =====
  const r2ndRow = totRow + 2;
  const empSS = totSS;
  const empRow = ws.getRow(r2ndRow); empRow.height = 20;
  ws.mergeCells(`L${r2ndRow}:M${r2ndRow}`);
  ws.getCell(`L${r2ndRow}`).value = 'ผู้ประกันตน'; ws.getCell(`L${r2ndRow}`).font = totFont;
  ws.getCell(`L${r2ndRow}`).alignment = center;
  ws.getCell(`N${r2ndRow}`).value = empSS; ws.getCell(`N${r2ndRow}`).numFmt = numFmt;
  ws.getCell(`N${r2ndRow}`).font = totFont; ws.getCell(`N${r2ndRow}`).alignment = { horizontal: 'right' };

  const empRow2 = ws.getRow(r2ndRow + 1); empRow2.height = 20;
  ws.mergeCells(`L${r2ndRow+1}:M${r2ndRow+1}`);
  ws.getCell(`L${r2ndRow+1}`).value = 'นายจ้าง'; ws.getCell(`L${r2ndRow+1}`).font = totFont;
  ws.getCell(`L${r2ndRow+1}`).alignment = center;
  ws.getCell(`N${r2ndRow+1}`).value = empSS; ws.getCell(`N${r2ndRow+1}`).numFmt = numFmt;
  ws.getCell(`N${r2ndRow+1}`).font = totFont; ws.getCell(`N${r2ndRow+1}`).alignment = { horizontal: 'right' };

  const ssTotal = ws.getRow(r2ndRow + 2); ssTotal.height = 20;
  ws.mergeCells(`L${r2ndRow+2}:M${r2ndRow+2}`);
  ws.getCell(`N${r2ndRow+2}`).value = empSS * 2; ws.getCell(`N${r2ndRow+2}`).numFmt = numFmt;
  ws.getCell(`N${r2ndRow+2}`).font = { ...totFont, bold: true }; ws.getCell(`N${r2ndRow+2}`).border = { top: thin, bottom: thin };

  // Approver line
  const approveRow = r2ndRow + 4;
  ws.mergeCells(`A${approveRow}:F${approveRow}`);
  ws.getCell(`A${approveRow}`).value = 'ผู้อนุมัติ.............................................';
  ws.getCell(`A${approveRow}`).font  = { size: 11, name: 'TH SarabunPSK' };

  ws.views = [{ state: 'frozen', ySplit: 6 }];

  return { workbook: wb, month, year };
}

// ── bulkUpdatePayrollStatus — อัปเดตสถานะทั้งเดือนพร้อมกัน ─────────
async function bulkUpdatePayrollStatus(year, month, status) {
  const VALID = ['draft', 'confirmed', 'paid'];
  if (!VALID.includes(status)) throw new Error(`status ต้องเป็น: ${VALID.join(', ')}`);
  const { rowCount } = await db.query(
    `UPDATE payroll_records SET status=$3, updated_at=NOW()
     WHERE year=$1 AND month=$2 AND status != $3`,
    [year, month, status]
  );
  return rowCount;
}

module.exports = { calculatePayslip, generatePayroll, getPayroll, getPayslip,
  updatePayrollStatus, bulkUpdatePayrollStatus, getPayrollSettings,
  sendPayslipsViaLine, exportPayrollExcel, exportWageSheet };
