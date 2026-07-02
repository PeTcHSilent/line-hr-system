/**
 * Flex Message Templates สำหรับ LINE HR System
 * อ้างอิง: https://developers.line.biz/en/docs/messaging-api/flex-message-elements/
 */

/**
 * เมนูหลัก (ใช้ใน Rich Menu หรือส่งแบบ Flex)
 */
function mainMenu(employee) {
  return {
    type: 'flex',
    altText: 'เมนู HR',
    contents: {
      type: 'bubble',
      hero: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1E3A5F',
        paddingAll: '20px',
        contents: [
          { type: 'text', text: `สวัสดีคุณ${employee.name}`, color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: employee.department_name || '', color: '#aaaaaa', size: 'sm' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          menuRow('📋', 'ลางาน', 'action=open_leave_form'),
          menuRow('⏱', 'ขอ OT', 'action=open_ot_form'),
          menuRow('⏰', 'เช็คอิน / เช็คเอาท์', 'action=open_attendance'),
          menuRow('📊', 'วันลาคงเหลือ', 'action=check_balance'),
          menuRow('📢', 'ประกาศ HR', 'action=announcements'),
        ]
      }
    }
  };
}

function menuRow(icon, label, postbackData) {
  return {
    type: 'box', layout: 'horizontal', action: { type: 'postback', data: postbackData },
    contents: [
      { type: 'text', text: icon, size: 'lg', flex: 0 },
      { type: 'text', text: label, size: 'md', margin: 'md', gravity: 'center' },
      { type: 'text', text: '›', size: 'lg', color: '#aaaaaa', align: 'end', gravity: 'center' }
    ]
  };
}

/**
 * แสดงวันลาคงเหลือ
 * balances: array จาก employeeService.getLeaveBalance()
 *   fields: id, name, max_days, gender_restriction, used_days, effective_quota, seniority_years
 */
function leaveBalance(employee, balances) {
  const year = new Date().getFullYear() + 543; // พ.ศ.

  const items = balances.map(b => {
    // ใช้ effective_quota (คำนวณจาก leave_quota_rules + อายุงาน)
    // ถ้าไม่มี quota_rules ให้ fallback ไปที่ max_days
    const quota = (b.effective_quota != null) ? Number(b.effective_quota) : (b.max_days != null ? Number(b.max_days) : null);
    const used  = Number(b.used_days) || 0;
    const remaining = quota != null ? quota - used : null;

    // สีตามสถานะ: เขียว = ok, ส้ม = ≤ 3 วัน, แดง = หมด/เกิน
    let valueColor = '#111111';
    if (quota != null) {
      if (remaining <= 0)       valueColor = '#E53935';
      else if (remaining <= 3)  valueColor = '#F59E0B';
      else                      valueColor = '#16a34a';
    }

    const pending = Number(b.pending_days) || 0;
    const displayText = quota != null
      ? `${remaining}/${quota} วัน`
      : `ใช้ไป ${used} วัน`;
    const pendingText = pending > 0 ? ` (รอ ${pending} วัน)` : '';

    return {
      type: 'box', layout: 'horizontal', margin: 'sm',
      contents: [
        { type: 'text', text: b.name, size: 'sm', color: '#555555', flex: 3, wrap: true },
        {
          type: 'box', layout: 'vertical', flex: 2, alignItems: 'flex-end',
          contents: [
            { type: 'text', text: displayText, size: 'sm', color: valueColor, align: 'end', weight: 'bold' },
            ...(pending > 0 ? [{ type: 'text', text: pendingText, size: 'xxs', color: '#F59E0B', align: 'end' }] : [])
          ]
        }
      ]
    };
  });

  // แทรก separator ระหว่าง items
  const bodyContents = [];
  items.forEach((item, i) => {
    bodyContents.push(item);
    if (i < items.length - 1) bodyContents.push({ type: 'separator', margin: 'sm' });
  });

  return {
    type: 'flex',
    altText: `วันลาคงเหลือ ปี ${year} — ${employee.name}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#27ACB2',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: '📊 วันลาคงเหลือ', color: '#ffffff', size: 'lg', weight: 'bold' },
          { type: 'text', text: employee.name, color: '#ffffffCC', size: 'sm', margin: 'xs' },
          { type: 'text', text: `ปี ${year} | อายุงาน ${b_seniority(balances)} ปี`, color: '#ffffffAA', size: 'xs', margin: 'xs' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'none', paddingAll: '16px',
        contents: bodyContents.length ? bodyContents : [
          { type: 'text', text: 'ไม่มีข้อมูลประเภทการลา', size: 'sm', color: '#999999', align: 'center' }
        ]
      }
    }
  };
}

function b_seniority(balances) {
  const sy = balances[0]?.seniority_years;
  return sy != null ? sy : '-';
}

/**
 * ฟอร์มขอลา (เปิด LIFF)
 */
function leaveRequestForm(employee) {
  return {
    type: 'flex',
    altText: 'แบบฟอร์มลางาน',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#FF6B35',
        contents: [{ type: 'text', text: '📋 ขอลางาน', color: '#ffffff', size: 'lg', weight: 'bold' }]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: `กรุณากรอกข้อมูลการลาผ่านแบบฟอร์ม`, wrap: true, size: 'sm', color: '#555555' }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'primary', color: '#FF6B35',
          action: {
            type: 'uri',
            label: 'กรอกแบบฟอร์มลางาน',
            uri: `https://liff.line.me/${process.env.LIFF_ID}`
          }
        }]
      }
    }
  };
}

/**
 * Flex: เปิด LIFF ยื่น OT
 */
function otRequestForm(employee) {
  // LIFF ID สำหรับหน้า OT โดยเฉพาะ (endpoint: /liff/ot)
  // สร้างใน LINE Developers Console → LIFF → Add แล้วใส่ LIFF ID ที่ได้ใน .env
  const url = `https://liff.line.me/${process.env.LIFF_ID_OT || process.env.LIFF_ID}`;

  return {
    type: 'flex',
    altText: 'ขอทำงานล่วงเวลา (OT)',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#1357B0',
        contents: [
          { type: 'text', text: '⏱ ขอทำงานล่วงเวลา (OT)', color: '#ffffff', size: 'md', weight: 'bold' },
          { type: 'text', text: employee.name, color: '#FFFFFFBF', size: 'sm', margin: 'xs' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: 'กรอกวันที่ เวลา และเหตุผลการทำ OT ผ่านแบบฟอร์มด้านล่างได้เลยครับ', wrap: true, size: 'sm', color: '#555555' }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'primary', color: '#F47920',
          action: { type: 'uri', label: '📝 กรอกแบบฟอร์ม OT', uri: url }
        }]
      }
    }
  };
}

/**
 * แจ้งหัวหน้าเมื่อมีคำขอลาใหม่ (Push Message)
 */
function leaveApprovalRequest(leaveRequest, employee) {
  const start = new Date(leaveRequest.start_date).toLocaleDateString('th-TH');
  const end   = new Date(leaveRequest.end_date).toLocaleDateString('th-TH');

  // half-day label
  const halfDayLabel = leaveRequest.is_half_day
    ? ` (ครึ่งวัน${leaveRequest.half_day_period === 'morning' ? 'เช้า' : 'บ่าย'})`
    : '';
  const dateLabel = leaveRequest.is_half_day ? start : `${start} - ${end}`;
  const daysLabel = `${leaveRequest.total_days} วัน${halfDayLabel}`;

  return {
    type: 'flex',
    altText: `${employee.name} ขอลางาน`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#FF6B35',
        contents: [{ type: 'text', text: '⚠️ มีคำขออนุมัติการลา', color: '#ffffff', size: 'md', weight: 'bold' }]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          infoRow('พนักงาน', employee.name),
          infoRow('ประเภท', leaveRequest.leave_type_name || '-'),
          infoRow('วันที่', dateLabel),
          infoRow('จำนวน', daysLabel),
          { type: 'separator', margin: 'md' },
          { type: 'text', text: `เหตุผล: ${leaveRequest.reason || '-'}`, size: 'sm', color: '#555555', wrap: true }
        ]
      },
      footer: {
        type: 'box', layout: 'horizontal', spacing: 'sm',
        contents: [
          {
            type: 'button', style: 'primary', color: '#27ACB2', flex: 1,
            action: { type: 'postback', label: '✅ อนุมัติ', data: `action=approve_leave&leave_id=${leaveRequest.id}` }
          },
          {
            type: 'button', style: 'secondary', flex: 1,
            action: { type: 'postback', label: '❌ ปฏิเสธ', data: `action=reject_leave&leave_id=${leaveRequest.id}` }
          }
        ]
      }
    }
  };
}

function infoRow(label, value) {
  return {
    type: 'box', layout: 'horizontal',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#888888', flex: 2 },
      { type: 'text', text: value, size: 'sm', color: '#111111', flex: 3, wrap: true }
    ]
  };
}

/**
 * แจ้งพนักงานเมื่อสถานะการลาเปลี่ยน (approved / rejected)
 */
function leaveStatusUpdate(leave, status) {
  const isApproved = status === 'approved';
  const color = isApproved ? '#27ACB2' : '#E53935';
  const icon  = isApproved ? '✅' : '❌';
  const label = isApproved ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ';

  const start = leave.start_date ? new Date(leave.start_date).toLocaleDateString('th-TH') : '-';
  const end   = leave.end_date   ? new Date(leave.end_date).toLocaleDateString('th-TH')   : '-';

  return {
    type: 'flex',
    altText: `${icon} คำขอลา #${leave.id} ${label}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: color,
        contents: [
          { type: 'text', text: `${icon} ผลการพิจารณาลางาน`, color: '#ffffff', size: 'md', weight: 'bold' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          infoRow('สถานะ', label),
          infoRow('ประเภทการลา', leave.leave_type_name || '-'),
          infoRow('วันที่', `${start} – ${end}`),
          infoRow('จำนวน', `${leave.total_days || '-'} วัน`),
          ...(leave.reject_reason ? [{ type: 'separator', margin: 'md' },
            { type: 'text', text: `เหตุผล: ${leave.reject_reason}`, size: 'sm', color: '#888888', wrap: true }
          ] : [])
        ]
      }
    }
  };
}

/**
 * แจ้งหัวหน้า/HR เมื่อมีคำขอ OT ใหม่
 */
function otApprovalRequest(ot, employee) {
  const date  = ot.ot_date   ? new Date(ot.ot_date).toLocaleDateString('th-TH') : '-';
  const hours = ot.total_hours || '-';

  return {
    type: 'flex',
    altText: `⏱ ${employee.name} ขอทำ OT`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#1357B0',
        contents: [
          { type: 'text', text: '⏱ มีคำขออนุมัติ OT', color: '#ffffff', size: 'md', weight: 'bold' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          infoRow('พนักงาน', employee.name),
          infoRow('แผนก', employee.department_name || '-'),
          infoRow('วันที่', date),
          infoRow('เวลา', `${ot.start_time} – ${ot.end_time}`),
          infoRow('รวม', `${hours} ชั่วโมง`),
          ...(ot.reason ? [{ type: 'separator', margin: 'md' },
            { type: 'text', text: `เหตุผล: ${ot.reason}`, size: 'sm', color: '#555555', wrap: true }
          ] : [])
        ]
      },
      footer: {
        type: 'box', layout: 'horizontal', spacing: 'sm',
        contents: [
          {
            type: 'button', style: 'primary', color: '#1357B0', flex: 1,
            action: { type: 'postback', label: '✅ อนุมัติ', data: `action=approve_ot&ot_id=${ot.id}` }
          },
          {
            type: 'button', style: 'secondary', flex: 1,
            action: { type: 'postback', label: '❌ ปฏิเสธ', data: `action=reject_ot&ot_id=${ot.id}` }
          }
        ]
      }
    }
  };
}

/**
 * แจ้งพนักงานเมื่อสถานะ OT เปลี่ยน
 */
function otStatusUpdate(ot, status) {
  const isApproved = status === 'approved';
  const color = isApproved ? '#1357B0' : '#E53935';
  const icon  = isApproved ? '✅' : '❌';
  const label = isApproved ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ';
  const date  = ot.ot_date ? new Date(ot.ot_date).toLocaleDateString('th-TH') : '-';

  return {
    type: 'flex',
    altText: `${icon} คำขอ OT ${label}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: color,
        contents: [
          { type: 'text', text: `${icon} ผลการพิจารณา OT`, color: '#ffffff', size: 'md', weight: 'bold' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          infoRow('สถานะ', label),
          infoRow('วันที่', date),
          infoRow('เวลา', `${ot.start_time} – ${ot.end_time}`),
          infoRow('รวม', `${ot.total_hours || '-'} ชั่วโมง`)
        ]
      }
    }
  };
}

module.exports = {
  mainMenu, leaveBalance, leaveRequestForm, leaveApprovalRequest,
  leaveStatusUpdate, otRequestForm, otApprovalRequest, otStatusUpdate
};
