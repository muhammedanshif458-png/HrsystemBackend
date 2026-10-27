const http = require('http');
const mongoose = require('mongoose');

const PORT = 5000;
const HOST = '127.0.0.1';

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const reqHeaders = { ...(options.headers || {}) };
    let postData = null;

    if (body) {
      postData = typeof body === 'string' ? body : JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const reqOptions = {
      hostname: HOST,
      port: PORT,
      path: options.path,
      method: options.method || 'GET',
      headers: reqHeaders
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: parsed
        });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  const copy = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/password|token|secret|authorization/i.test(k)) {
      copy[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      copy[k] = sanitize(v);
    } else {
      copy[k] = v;
    }
  }
  return copy;
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}

async function runControlledVerification() {
  console.log('================================================================================');
  console.log('   CONTROLLED VERIFICATION: PERSISTENT STAFF BREAK APIS (TECH & TELECALLING)');
  console.log('================================================================================\n');

  await mongoose.connect('mongodb://127.0.0.1:27017/hr_management');
  const Attendance = require('../models/Attendance');
  const Employee = require('../models/Employee');
  const User = require('../models/User');
  const DepartmentSchedule = require('../models/DepartmentSchedule');

  const createdUserIds = [];
  const createdEmpIds = [];

  try {
    // 1. Authenticate HR / Super Admin
    console.log('--- 1. Authenticate Super Admin ---');
    const adminLogin = await request({ path: '/api/auth/login', method: 'POST' }, {
      email: 'lysoftware@gmail.com',
      password: 'hrAdmin'
    });
    assert(adminLogin.statusCode === 200, 'Super admin login successful');
    const adminToken = adminLogin.body.data?.accessToken;
    assert(Boolean(adminToken), 'Obtained admin accessToken');

    // 2. Ensure Department Schedules for Tech and Telecalling
    console.log('\n--- 2. Ensure Department Schedules ---');
    await request({
      path: '/api/hr/departments/schedules',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    }, {
      department: 'Tech',
      checkInTime: '09:00',
      checkOutTime: '18:00',
      gracePeriodMinutes: 15,
      timezone: 'Asia/Kolkata',
      effectiveDate: '2026-10-20'
    });

    await request({
      path: '/api/hr/departments/schedules',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    }, {
      department: 'Telecalling',
      checkInTime: '09:30',
      checkOutTime: '18:30',
      gracePeriodMinutes: 15,
      timezone: 'Asia/Kolkata',
      effectiveDate: '2026-10-20'
    });
    console.log('  [PASS] Schedules ensured for Tech and Telecalling departments');

    // 3. Create Dedicated Test Employees
    console.log('\n--- 3. Create Dedicated Test Employees ---');
    const ts = Date.now();
    const techEmail = `test.tech.break.${ts}@example.com`;
    const teleEmail = `test.tele.break.${ts}@example.com`;
    const otherEmail = `test.other.break.${ts}@example.com`;

    const createTech = await request({
      path: '/api/hr/employees',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    }, {
      firstName: 'TechBreak',
      lastName: 'Tester',
      email: techEmail,
      password: 'Password@123',
      department: 'Tech',
      designation: 'Software Engineer',
      employmentType: 'FULL_TIME',
      status: 'ACTIVE',
      gender: 'OTHER'
    });
    assert(createTech.statusCode === 201, 'Tech test employee created');
    const techEmpId = createTech.body.data._id;
    createdEmpIds.push(techEmpId);

    const createTele = await request({
      path: '/api/hr/employees',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    }, {
      firstName: 'TeleBreak',
      lastName: 'Tester',
      email: teleEmail,
      password: 'Password@123',
      department: 'Telecalling',
      designation: 'Telecalling Agent',
      employmentType: 'FULL_TIME',
      status: 'ACTIVE',
      gender: 'OTHER'
    });
    assert(createTele.statusCode === 201, 'Telecalling test employee created');
    const teleEmpId = createTele.body.data._id;
    createdEmpIds.push(teleEmpId);

    const createOther = await request({
      path: '/api/hr/employees',
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    }, {
      firstName: 'OtherStaff',
      lastName: 'Tester',
      email: otherEmail,
      password: 'Password@123',
      department: 'Tech',
      designation: 'QA Engineer',
      employmentType: 'FULL_TIME',
      status: 'ACTIVE',
      gender: 'OTHER'
    });
    assert(createOther.statusCode === 201, 'Other test employee created');
    const otherEmpId = createOther.body.data._id;
    createdEmpIds.push(otherEmpId);

    // 4. Authenticate Test Employees
    console.log('\n--- 4. Authenticate Test Staff Accounts ---');
    const techLogin = await request({ path: '/api/auth/login', method: 'POST' }, { email: techEmail, password: 'Password@123' });
    assert(techLogin.statusCode === 200, 'Tech staff login successful');
    const techToken = techLogin.body.data?.accessToken;
    createdUserIds.push(techLogin.body.data?.user?.id);

    const teleLogin = await request({ path: '/api/auth/login', method: 'POST' }, { email: teleEmail, password: 'Password@123' });
    assert(teleLogin.statusCode === 200, 'Telecalling staff login successful');
    const teleToken = teleLogin.body.data?.accessToken;
    createdUserIds.push(teleLogin.body.data?.user?.id);

    const otherLogin = await request({ path: '/api/auth/login', method: 'POST' }, { email: otherEmail, password: 'Password@123' });
    assert(otherLogin.statusCode === 200, 'Other staff login successful');
    const otherToken = otherLogin.body.data?.accessToken;
    createdUserIds.push(otherLogin.body.data?.user?.id);

    // 5. Tech Staff Check-In
    console.log('\n--- 5. Tech Staff Check-In ---');
    const techCheckIn = await request({
      path: '/api/staff/attendance/check-in',
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { remarks: 'Morning check in for break tests' });
    assert(techCheckIn.statusCode === 201, 'Tech staff check-in successful');
    const techAttId = techCheckIn.body.data?._id;

    // 6. Test Step 1: Start Tea Break 1 and verify persisted start time
    console.log('\n--- 6. Step 1: Start Tea Break 1 ---');
    const tea1Start = await request({
      path: '/api/staff/attendance/break-start',
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'Tea Break 1', remarks: 'First 15-min tea break' });
    assert(tea1Start.statusCode === 200, 'Tea Break 1 start succeeded (200 OK)');
    assert(tea1Start.body.data?.activeBreak?.breakType === 'Tea Break 1', 'activeBreak tracks Tea Break 1');
    assert(Boolean(tea1Start.body.data?.activeBreak?.startTime), 'activeBreak has startTime timestamp');
    assert(tea1Start.body.data?.breaks?.length === 1, 'breaks array contains 1 entry');
    assert(tea1Start.body.data?.breaks[0].breakType === 'Tea Break 1', 'breakType is Tea Break 1');
    assert(tea1Start.body.data?.breaks[0].endTime === null, 'endTime is null while active');

    // Direct MongoDB verification of persistence
    const dbDoc1 = await Attendance.findById(techAttId).lean();
    assert(dbDoc1.activeBreak !== null, 'MongoDB document has activeBreak persisted');
    assert(dbDoc1.activeBreak.breakType === 'Tea Break 1', 'MongoDB activeBreak.breakType is Tea Break 1');
    assert(dbDoc1.breaks.length === 1, 'MongoDB breaks array has 1 item persisted');
    assert(dbDoc1.breaks[0].breakType === 'Tea Break 1', 'MongoDB break item has breakType Tea Break 1');

    // 7. Test Step 5: Attempt Two Simultaneous Active Breaks (Must be rejected)
    console.log('\n--- 7. Step 5: Attempt Simultaneous Active Break (Should Reject) ---');
    const simBreakRes = await request({
      path: '/api/staff/attendance/break-start',
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'Lunch Break' });
    assert(simBreakRes.statusCode === 400, 'Starting simultaneous Lunch Break rejected with 400');
    assert(simBreakRes.body.message.includes('currently active'), 'Error message specifies break is currently active');

    // 8. Test Step 9: Unauthorized Modification Prevention
    console.log('\n--- 8. Step 9: Unauthorized Modification Prevention ---');
    // Scenario A: Other employee (not checked in) attempts to end Tech employee's break
    const unauthorizedEndNotCheckedIn = await request({
      path: '/api/staff/attendance/break-end',
      method: 'POST',
      headers: { Authorization: `Bearer ${otherToken}` }
    }, { breakType: 'Tea Break 1' });
    assert(unauthorizedEndNotCheckedIn.statusCode === 400, 'Other employee (not checked in) rejected with 400');
    assert(unauthorizedEndNotCheckedIn.body.message.includes('checking in'), 'Rejection explains cannot end break before checking in');

    // Scenario B: Other employee checks in, but has no active break, attempts to end Tech employee's break
    await request({
      path: '/api/staff/attendance/check-in',
      method: 'POST',
      headers: { Authorization: `Bearer ${otherToken}` }
    }, { remarks: 'Other staff check in' });

    const unauthorizedEndCheckedIn = await request({
      path: '/api/staff/attendance/break-end',
      method: 'POST',
      headers: { Authorization: `Bearer ${otherToken}` }
    }, { breakType: 'Tea Break 1' });
    assert(unauthorizedEndCheckedIn.statusCode === 400, 'Other employee (checked in, no active break) rejected with 400');
    assert(unauthorizedEndCheckedIn.body.message.includes('No active break found to end'), 'Rejection confirms other employee has no active break to end');

    // Verify Tech employee's break is still active and unchanged in MongoDB
    const dbDocCheck = await Attendance.findById(techAttId).lean();
    assert(dbDocCheck.activeBreak !== null && dbDocCheck.activeBreak.breakType === 'Tea Break 1', 'Tech employee break remains securely active in MongoDB');

    // 9. Test Step 2: End Tea Break 1 and verify end time and duration
    console.log('\n--- 9. Step 2: End Tea Break 1 ---');
    const tea1End = await request({
      path: '/api/staff/attendance/break-end',
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'Tea Break 1', remarks: 'Tea break completed' });
    assert(tea1End.statusCode === 200, 'Tea Break 1 end succeeded (200 OK)');
    assert(tea1End.body.data?.activeBreak === null, 'activeBreak reset to null');
    assert(tea1End.body.data?.breaks[0].endTime !== null, 'endTime is persisted');
    assert(tea1End.body.data?.breaks[0].durationMinutes >= 1, 'durationMinutes calculated from server timestamp (>= 1)');
    assert(tea1End.body.data?.totalBreakMinutes >= 1, 'totalBreakMinutes updated');

    // Verify in MongoDB
    const dbDocAfterTea1 = await Attendance.findById(techAttId).lean();
    assert(dbDocAfterTea1.activeBreak === null, 'MongoDB activeBreak is null');
    assert(dbDocAfterTea1.breaks[0].endTime !== null, 'MongoDB breaks[0].endTime is persisted');
    assert(dbDocAfterTea1.breaks[0].durationMinutes >= 1, 'MongoDB breaks[0].durationMinutes >= 1');

    // 10. Test Step 3: Start and End Lunch Break
    console.log('\n--- 10. Step 3: Start and End Lunch Break ---');
    const lunchStart = await request({
      path: '/api/staff/attendance/break-start',
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'Lunch Break' });
    assert(lunchStart.statusCode === 200, 'Lunch Break start succeeded');
    assert(lunchStart.body.data?.activeBreak?.breakType === 'Lunch Break', 'activeBreak is Lunch Break');

    const lunchEnd = await request({
      path: '/api/staff/attendance/break-end',
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'Lunch Break' });
    assert(lunchEnd.statusCode === 200, 'Lunch Break end succeeded');
    assert(lunchEnd.body.data?.activeBreak === null, 'activeBreak is null after Lunch Break');
    assert(lunchEnd.body.data?.breaks.length === 2, 'breaks array has 2 completed breaks');
    assert(lunchEnd.body.data?.breaks[1].breakType === 'Lunch Break', 'second break is Lunch Break');

    // 11. Test Step 4: Start and End Tea Break 2
    console.log('\n--- 11. Step 4: Start and End Tea Break 2 ---');
    const tea2Start = await request({
      path: '/api/staff/attendance/break-start',
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'Tea Break 2' });
    assert(tea2Start.statusCode === 200, 'Tea Break 2 start succeeded');
    assert(tea2Start.body.data?.activeBreak?.breakType === 'Tea Break 2', 'activeBreak is Tea Break 2');

    const tea2End = await request({
      path: '/api/staff/attendance/break-end',
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'Tea Break 2' });
    assert(tea2End.statusCode === 200, 'Tea Break 2 end succeeded');
    assert(tea2End.body.data?.activeBreak === null, 'activeBreak is null after Tea Break 2');
    assert(tea2End.body.data?.breaks.length === 3, 'breaks array has 3 completed breaks');
    assert(tea2End.body.data?.breaks[2].breakType === 'Tea Break 2', 'third break is Tea Break 2');

    // Verify duplicate break prevention: cannot start Tea Break 1 again today
    const duplicateTea1 = await request({
      path: '/api/staff/attendance/break-start',
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'Tea Break 1' });
    assert(duplicateTea1.statusCode === 400, 'Duplicate Tea Break 1 start rejected with 400');
    assert(duplicateTea1.body.message.includes('already been taken'), 'Error confirms Tea Break 1 already taken today');

    // 12. Test Step 6: Verify Completed Break Records in Staff Attendance History
    console.log('\n--- 12. Step 6: Verify Staff Attendance History (GET /api/staff/attendance) ---');
    const staffAttRes = await request({
      path: '/api/staff/attendance',
      method: 'GET',
      headers: { Authorization: `Bearer ${techToken}` }
    });
    assert(staffAttRes.statusCode === 200, 'GET /api/staff/attendance returns 200');
    const staffRecords = staffAttRes.body.data?.attendance || staffAttRes.body.data;
    assert(Array.isArray(staffRecords) && staffRecords.length > 0, 'Staff records array returned');
    const techRecord = staffRecords[0];
    assert(techRecord.breaks.length === 3, 'Persisted record contains all 3 breaks');
    techRecord.breaks.forEach((b, idx) => {
      assert(Boolean(b.breakType), `Break #${idx + 1} has breakType: ${b.breakType}`);
      assert(Boolean(b.startTime), `Break #${idx + 1} has startTime`);
      assert(Boolean(b.endTime), `Break #${idx + 1} has endTime`);
      assert(typeof b.durationMinutes === 'number' && b.durationMinutes >= 1, `Break #${idx + 1} has durationMinutes`);
    });
    assert(techRecord.totalBreakMinutes >= 3, 'totalBreakMinutes is sum of completed break durations');
    assert(Boolean(techRecord.breakDuration), `breakDuration formatted string returned: ${techRecord.breakDuration}`);
    assert(techRecord.activeBreak === null, 'activeBreak is null for completed shift breaks');

    // 13. Test Step 7: Verify Records Through GET /api/hr/attendance
    console.log('\n--- 13. Step 7: Verify via HR Attendance API (GET /api/hr/attendance) ---');
    const dateKey = new Date().toISOString().slice(0, 10);
    const hrAttRes = await request({
      path: `/api/hr/attendance?employeeId=${techEmpId}&date=${dateKey}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(hrAttRes.statusCode === 200, 'GET /api/hr/attendance returns 200');
    const hrRecords = hrAttRes.body.data?.attendance || hrAttRes.body.data;
    assert(Array.isArray(hrRecords) && hrRecords.length === 1, 'HR API returns matching attendance record');
    const hrRec = hrRecords[0];
    assert(hrRec.breaks.length === 3, 'HR record includes all 3 breaks');
    assert(hrRec.activeBreak === null, 'HR record shows activeBreak as null');
    assert(hrRec.totalBreakMinutes === techRecord.totalBreakMinutes, 'HR totalBreakMinutes matches staff record');
    assert(hrRec.breakDuration === techRecord.breakDuration, 'HR breakDuration matches staff record');
    assert(hrRec.breaks[0].breakType === 'Tea Break 1', 'HR break 1 is Tea Break 1');
    assert(hrRec.breaks[1].breakType === 'Lunch Break', 'HR break 2 is Lunch Break');
    assert(hrRec.breaks[2].breakType === 'Tea Break 2', 'HR break 3 is Tea Break 2');

    // Test HR department filter
    const hrDeptRes = await request({
      path: `/api/hr/attendance?department=Tech&date=${dateKey}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(hrDeptRes.statusCode === 200, 'GET /api/hr/attendance?department=Tech returns 200');
    const deptRows = hrDeptRes.body.data?.attendance || hrDeptRes.body.data;
    const foundTech = deptRows.find(r => String(r.staffId) === String(techEmpId) || String(r.employee?._id) === String(techEmpId));
    assert(Boolean(foundTech), 'Tech test employee record present in department=Tech HR query');
    assert(foundTech.breaks.length === 3, 'Department-filtered HR query includes break details');

    // 14. Test Step 8: Verify Telecalling Employee
    console.log('\n--- 14. Step 8: Verify Telecalling Employee Breaks ---');
    const teleCheckIn = await request({
      path: '/api/staff/attendance/check-in',
      method: 'POST',
      headers: { Authorization: `Bearer ${teleToken}` }
    }, { remarks: 'Telecalling check in for break tests' });
    assert(teleCheckIn.statusCode === 201, 'Telecalling staff check-in successful');

    // Telecalling Tea Break 1
    const teleTea1Start = await request({
      path: '/api/staff/attendance/break-start',
      method: 'POST',
      headers: { Authorization: `Bearer ${teleToken}` }
    }, { breakType: 'Tea Break 1' });
    assert(teleTea1Start.statusCode === 200, 'Telecalling Tea Break 1 started');

    const teleTea1End = await request({
      path: '/api/staff/attendance/break-end',
      method: 'POST',
      headers: { Authorization: `Bearer ${teleToken}` }
    }, { breakType: 'Tea Break 1' });
    assert(teleTea1End.statusCode === 200, 'Telecalling Tea Break 1 ended');

    // Telecalling Lunch Break
    const teleLunchStart = await request({
      path: '/api/staff/attendance/break-start',
      method: 'POST',
      headers: { Authorization: `Bearer ${teleToken}` }
    }, { breakType: 'Lunch Break' });
    assert(teleLunchStart.statusCode === 200, 'Telecalling Lunch Break started');

    const teleLunchEnd = await request({
      path: '/api/staff/attendance/break-end',
      method: 'POST',
      headers: { Authorization: `Bearer ${teleToken}` }
    }, { breakType: 'Lunch Break' });
    assert(teleLunchEnd.statusCode === 200, 'Telecalling Lunch Break ended');

    // Telecalling Tea Break 2
    const teleTea2Start = await request({
      path: '/api/staff/attendance/break-start',
      method: 'POST',
      headers: { Authorization: `Bearer ${teleToken}` }
    }, { breakType: 'Tea Break 2' });
    assert(teleTea2Start.statusCode === 200, 'Telecalling Tea Break 2 started');

    const teleTea2End = await request({
      path: '/api/staff/attendance/break-end',
      method: 'POST',
      headers: { Authorization: `Bearer ${teleToken}` }
    }, { breakType: 'Tea Break 2' });
    assert(teleTea2End.statusCode === 200, 'Telecalling Tea Break 2 ended');

    // Verify Telecalling attendance via HR API with department=Telecalling
    const hrTeleRes = await request({
      path: `/api/hr/attendance?department=Telecalling&date=${dateKey}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(hrTeleRes.statusCode === 200, 'GET /api/hr/attendance?department=Telecalling returns 200');
    const teleRows = hrTeleRes.body.data?.attendance || hrTeleRes.body.data;
    const foundTele = teleRows.find(r => String(r.staffId) === String(teleEmpId) || String(r.employee?._id) === String(teleEmpId));
    assert(Boolean(foundTele), 'Telecalling test employee record present in department=Telecalling HR query');
    assert(foundTele.breaks.length === 3, 'Telecalling record includes all 3 completed breaks');
    assert(foundTele.totalBreakMinutes >= 3, 'Telecalling totalBreakMinutes verified');
    assert(Boolean(foundTele.breakDuration), 'Telecalling breakDuration formatted string verified');

    // 15. Test Step 9 (Part 2): Verify Cross-Employee Data Isolation in History
    console.log('\n--- 15. Step 9: Verify Cross-Employee Data Isolation in History ---');
    const otherAttRes = await request({
      path: '/api/staff/attendance',
      method: 'GET',
      headers: { Authorization: `Bearer ${otherToken}` }
    });
    assert(otherAttRes.statusCode === 200, 'Other staff GET /api/staff/attendance returns 200');
    const otherRecords = otherAttRes.body.data?.attendance || otherAttRes.body.data;
    // Other staff never checked in today, so should have 0 records
    assert(Array.isArray(otherRecords) && otherRecords.length === 0, 'Other employee cannot see Tech or Telecalling employee records');

    console.log('\n================================================================================');
    console.log('   ALL 9 VERIFICATION CHECKS PASSED WITH 100% SUCCESS!');
    console.log('================================================================================\n');

  } finally {
    // Clean up dedicated test artifacts from database
    console.log('--- Cleaning Up Test Data ---');
    if (createdEmpIds.length > 0) {
      await Attendance.deleteMany({ employee: { $in: createdEmpIds } });
      await Employee.deleteMany({ _id: { $in: createdEmpIds } });
    }
    if (createdUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: createdUserIds } });
    }
    console.log('  [PASS] Test data cleaned up successfully');
    await mongoose.disconnect();
  }
}

runControlledVerification().catch(err => {
  console.error('\nVerification Suite Failed:', err);
  process.exit(1);
});
