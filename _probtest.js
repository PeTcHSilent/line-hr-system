const dbPath=require.resolve('./src/db.js');
let S={ type:null, emp:null };
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{ query:async(sql,p)=>{
  if(/^\s*INSERT INTO leave_requests/i.test(sql.trim()))
    return {rows:[{id:1,leave_type_name:S.type.name,total_days:p[4]}]};
  if(/FROM leave_types WHERE id/.test(sql))      return {rows:[S.type]};
  if(/probation_status, probation_end_date/.test(sql)) return {rows:[S.emp]};
  if(/allowed_during_probation = TRUE/.test(sql)) return {rows:[{name:'ลาไม่รับเงิน'}]};
  if(/FROM holidays/i.test(sql))                 return {rows:[]};
  if(/status IN \('pending', 'approved'\)/.test(sql)) return {rows:[]};
  return {rows:[]};
}}};
const esPath=require.resolve('./src/services/employeeService.js');
require.cache[esPath]={id:esPath,filename:esPath,loaded:true,exports:{getLeaveBalance:async()=>[]}};
const hsPath=require.resolve('./src/services/holidayService.js');
require.cache[hsPath]={id:hsPath,filename:hsPath,loaded:true,exports:{getHolidayDatesInRange:async()=>new Set()}};
const ls=require('./src/services/leaveService');

let bad=0; const chk=(l,c,x='')=>{if(!c)bad++;console.log(`${c?'✅':'❌'} ${l}${x?'  → '+x:''}`)};
const req=()=>ls.createLeaveRequest({employeeId:7,leaveTypeId:1,startDate:'2026-11-02',endDate:'2026-11-03',reason:'x',employeeSex:'M'});

(async()=>{
  const VAC={id:1,name:'ลาพักร้อน',gender_restriction:null,allowed_during_probation:false};
  const SICK={id:2,name:'ลาป่วย',gender_restriction:null,allowed_during_probation:true};
  const UNPAID={id:5,name:'ลาไม่รับเงิน',gender_restriction:null,allowed_during_probation:true};

  console.log('━━━ พนักงานทดลองงาน (on_probation) ━━━');
  S.emp={name:'สมชาย',probation_status:'on_probation',probation_end_date:'2026-12-31'};
  S.type=VAC;
  try{ await req(); chk('ลาพักร้อน → ต้องถูกปฏิเสธ', false, 'ผ่านไปได้'); }
  catch(e){ chk('ลาพักร้อน → ถูกปฏิเสธ', /ทดลองงาน/.test(e.message), e.message.split('\n')[0]);
            chk('   แนะนำให้ใช้ลาไม่รับเงิน', /ลาไม่รับเงิน/.test(e.message));
            chk('   บอกวันสิ้นสุดทดลองงาน', /31\/12\/69/.test(e.message)); }
  S.type=SICK;
  try{ await req(); chk('ลาป่วย → ยื่นได้ (สิทธิตามกฎหมาย)', true); }catch(e){ chk('ลาป่วย → ยื่นได้', false, e.message); }
  S.type=UNPAID;
  try{ await req(); chk('ลาไม่รับเงิน → ยื่นได้', true); }catch(e){ chk('ลาไม่รับเงิน → ยื่นได้', false, e.message); }

  console.log('\n━━━ ต่อทดลองงาน (extended) ━━━');
  S.emp={name:'สมชาย',probation_status:'extended',probation_end_date:null};
  S.type=VAC;
  try{ await req(); chk('ลาพักร้อน → ต้องถูกปฏิเสธ', false); }
  catch(e){ chk('ลาพักร้อน → ถูกปฏิเสธ', /ทดลองงาน/.test(e.message));
            chk('   ไม่มีวันสิ้นสุด → ไม่พังและไม่โชว์วงเล็บว่าง', !/\(\)/.test(e.message)); }

  console.log('\n━━━ ผ่านทดลองงานแล้ว ━━━');
  S.emp={name:'สมชาย',probation_status:'passed',probation_end_date:'2026-06-30'};
  S.type=VAC;
  try{ await req(); chk('ลาพักร้อน → ยื่นได้', true); }catch(e){ chk('ลาพักร้อน → ยื่นได้', false, e.message); }

  console.log('\n━━━ พนักงานเก่า ไม่มีข้อมูลทดลองงาน (NULL) ━━━');
  S.emp={name:'สมหญิง',probation_status:null,probation_end_date:null};
  try{ await req(); chk('ถือว่าผ่านแล้ว → ยื่นได้', true); }catch(e){ chk('ถือว่าผ่านแล้ว → ยื่นได้', false, e.message); }

  console.log('\n━━━ ประเภทลาที่ยังไม่เคยตั้งค่า (undefined) ━━━');
  S.emp={name:'ใหม่',probation_status:'on_probation',probation_end_date:null};
  S.type={id:9,name:'ลาประเภทใหม่',gender_restriction:null};  // ไม่มี field เลย
  try{ await req(); chk('ไม่ได้ตั้งค่า → ไม่บล็อกโดยไม่ตั้งใจ', true); }
  catch(e){ chk('ไม่ได้ตั้งค่า → ไม่บล็อกโดยไม่ตั้งใจ', false, e.message); }

  console.log(bad?`\n❌ ไม่ผ่าน ${bad}`:'\n✅ ผ่านทั้งหมด'); process.exit(bad?1:0);
})();
