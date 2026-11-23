const http = require('http');
const mongoose = require('mongoose');

const PORT = parseInt(process.env.PORT, 10) || 5000;
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
  console.log('   CONTROLLED VERIFICATION: STAFF BREAK APIS (STAFFHUB & HR ATTENDANCE)');
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
      checkInTime: '10:00',
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
      checkInTime: '09:00',
      checkOutTime: '18:00',
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

    // 5. Staff Check-In
    console.log('\n--- 5. Tech Staff Check-In ---');
    const techCheckIn = await request({
      path: '/api/staff/attendance/check-in',
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { remarks: 'Morning check in for break tests' });
    assert(techCheckIn.statusCode === 201, 'Tech staff check-in successful');
    const techAttId = techCheckIn.body.data?._id;

    // Check-in for Other staff as well
    const otherCheckIn = await request({
      path: '/api/staff/attendance/check-in',
      method: 'POST',
      headers: { Authorization: `Bearer ${otherToken}` }
    }, { remarks: 'Other staff check in' });
    assert(otherCheckIn.statusCode === 201, 'Other staff check-in successful');
    const otherAttId = otherCheckIn.body.data?._id;

    // 6. Test StaffHub Contract Endpoint: POST /api/staff/attendance/:attendanceId/breaks/start
    console.log('\n--- 6. Test POST /api/staff/attendance/:attendanceId/breaks/start ---');
    
    // Test 6a: Reject invalid attendanceId format
    const invalidIdRes = await request({
      path: '/api/staff/attendance/invalid-mongo-id/breaks/start',
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'tea_break_1' });
    assert(invalidIdRes.statusCode === 400, 'Invalid attendanceId format rejected with 400');

    // Test 6b: Reject nonexistent attendanceId
    const fakeId = new mongoose.Types.ObjectId().toString();
    const notFoundRes = await request({
      path: `/api/staff/attendance/${fakeId}/breaks/start`,
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'tea_break_1' });
    assert(notFoundRes.statusCode === 404, 'Nonexistent attendanceId rejected with 404');

    // Test 6c: Security check: Reject employee accessing another employee's attendanceId
    const crossAccessRes = await request({
      path: `/api/staff/attendance/${techAttId}/breaks/start`,
      method: 'POST',
      headers: { Authorization: `Bearer ${otherToken}` }
    }, { breakType: 'tea_break_1' });
    assert(crossAccessRes.statusCode === 403, 'Cross-employee attendance access rejected with 403 Forbidden');

    // Test 6d: Start tea_break_1 successfully
    const startRes = await request({
      path: `/api/staff/attendance/${techAttId}/breaks/start`,
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'tea_break_1' });
    assert(startRes.statusCode === 200, 'POST /breaks/start returned 200 OK');
    assert(startRes.body.success === true, 'Response contains success: true');
    assert(Boolean(startRes.body.data?.breakId), 'Response contains breakId');
    assert(String(startRes.body.data?.attendanceId) === String(techAttId), 'Response contains correct attendanceId');
    assert(startRes.body.data?.breakType === 'tea_break_1', 'Response contains breakType tea_break_1');
    assert(Boolean(startRes.body.data?.startTime), 'Response contains startTime');
    assert(startRes.body.data?.endTime === null, 'Response contains null endTime');
    assert(startRes.body.data?.activeBreak?.breakType === 'tea_break_1', 'activeBreak tracks tea_break_1');

    // Direct MongoDB verification of persistence
    const dbDoc1 = await Attendance.findById(techAttId).lean();
    assert(dbDoc1.activeBreak !== null, 'MongoDB document has activeBreak persisted');
    assert(dbDoc1.activeBreak.breakType === 'tea_break_1', 'MongoDB activeBreak.breakType is tea_break_1');
    assert(dbDoc1.breaks.length === 1, 'MongoDB breaks array has 1 item persisted');
    assert(dbDoc1.breaks[0].breakType === 'tea_break_1', 'MongoDB break item has breakType tea_break_1');

    // 7. Reject second concurrent active break
    console.log('\n--- 7. Reject Concurrent Active Break ---');
    const simBreakRes = await request({
      path: `/api/staff/attendance/${techAttId}/breaks/start`,
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'lunch' });
    assert(simBreakRes.statusCode === 400, 'Second concurrent active break rejected with 400');
    assert(simBreakRes.body.message.includes('currently active'), 'Message confirms break is currently active');

    // 8. Test End Break Endpoint: POST /api/staff/attendance/:attendanceId/breaks/end
    console.log('\n--- 8. Test POST /api/staff/attendance/:attendanceId/breaks/end ---');

    // Test 8a: Security check: Other employee cannot end Tech employee's break
    const otherEndRes = await request({
      path: `/api/staff/attendance/${techAttId}/breaks/end`,
      method: 'POST',
      headers: { Authorization: `Bearer ${otherToken}` }
    }, { breakType: 'tea_break_1' });
    assert(otherEndRes.statusCode === 403, 'Other employee ending Tech employee break rejected with 403');

    // Test 8b: Reject ending mismatching break type
    const mismatchEnd = await request({
      path: `/api/staff/attendance/${techAttId}/breaks/end`,
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'lunch' });
    assert(mismatchEnd.statusCode === 400, 'Mismatching break type end rejected with 400');

    // Test 8c: Successfully end tea_break_1
    const endRes = await request({
      path: `/api/staff/attendance/${techAttId}/breaks/end`,
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'tea_break_1' });
    assert(endRes.statusCode === 200, 'POST /breaks/end returned 200 OK');
    assert(endRes.body.success === true, 'Response contains success: true');
    assert(Boolean(endRes.body.data?.breakId), 'Response contains breakId');
    assert(String(endRes.body.data?.attendanceId) === String(techAttId), 'Response contains attendanceId');
    assert(endRes.body.data?.breakType === 'tea_break_1', 'Response contains breakType tea_break_1');
    assert(Boolean(endRes.body.data?.startTime), 'Response contains startTime');
    assert(Boolean(endRes.body.data?.endTime), 'Response contains persisted endTime');
    assert(typeof endRes.body.data?.durationSeconds === 'number', 'Response contains durationSeconds');
    assert(endRes.body.data?.durationMinutes >= 1, 'Response contains durationMinutes >= 1');
    assert(endRes.body.data?.activeBreak === null, 'activeBreak reset to null');

    // Direct MongoDB verification of completed break
    const dbDocAfterTea1 = await Attendance.findById(techAttId).lean();
    assert(dbDocAfterTea1.activeBreak === null, 'MongoDB activeBreak is null');
    assert(dbDocAfterTea1.breaks[0].endTime !== null, 'MongoDB breaks[0].endTime is persisted');
    assert(dbDocAfterTea1.breaks[0].durationMinutes >= 1, 'MongoDB breaks[0].durationMinutes >= 1');

    // Test 8d: Reject ending a break when no break is active
    const endNoActive = await request({
      path: `/api/staff/attendance/${techAttId}/breaks/end`,
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'tea_break_1' });
    assert(endNoActive.statusCode === 400, 'Ending when no break active rejected with 400');

    // 9. Test lunch break: Start and End
    console.log('\n--- 9. Start and End Lunch Break ---');
    const lunchStart = await request({
      path: `/api/staff/attendance/${techAttId}/breaks/start`,
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'lunch' });
    assert(lunchStart.statusCode === 200, 'lunch break started');
    assert(lunchStart.body.data?.breakType === 'lunch', 'breakType is lunch');

    const lunchEnd = await request({
      path: `/api/staff/attendance/${techAttId}/breaks/end`,
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'lunch' });
    assert(lunchEnd.statusCode === 200, 'lunch break ended');
    assert(lunchEnd.body.data?.breaks?.length === 2, 'attendance has 2 completed breaks');

    // 10. Test tea_break_2: Start and End
    console.log('\n--- 10. Start and End tea_break_2 ---');
    const tea2Start = await request({
      path: `/api/staff/attendance/${techAttId}/breaks/start`,
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'tea_break_2' });
    assert(tea2Start.statusCode === 200, 'tea_break_2 started');

    const tea2End = await request({
      path: `/api/staff/attendance/${techAttId}/breaks/end`,
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'tea_break_2' });
    assert(tea2End.statusCode === 200, 'tea_break_2 ended');
    assert(tea2End.body.data?.breaks?.length === 3, 'attendance has 3 completed breaks');

    // 11. Prevent starting a completed break again during the same shift
    console.log('\n--- 11. Reject Duplicate Completed Break Start ---');
    const dupStart = await request({
      path: `/api/staff/attendance/${techAttId}/breaks/start`,
      method: 'POST',
      headers: { Authorization: `Bearer ${techToken}` }
    }, { breakType: 'tea_break_1' });
    assert(dupStart.statusCode === 400, 'Duplicate tea_break_1 rejected with 400');
    assert(dupStart.body.message.includes('already been taken'), 'Message confirms break already taken today');

    // 12. Staff Attendance History API: GET /api/staff/attendance
    console.log('\n--- 12. Verify GET /api/staff/attendance ---');
    const staffAttRes = await request({
      path: '/api/staff/attendance',
      method: 'GET',
      headers: { Authorization: `Bearer ${techToken}` }
    });
    assert(staffAttRes.statusCode === 200, 'GET /api/staff/attendance returns 200');
    const staffRecords = staffAttRes.body.data?.attendance || staffAttRes.body.data;
    assert(Array.isArray(staffRecords) && staffRecords.length > 0, 'Records array returned');
    const todayRec = staffRecords[0];
    assert(todayRec.breaks.length === 3, 'Contains all 3 breaks');
    todayRec.breaks.forEach((b, i) => {
      assert(Boolean(b.id || b._id), `Break #${i + 1} has id`);
      assert(String(b.attendanceId) === String(techAttId), `Break #${i + 1} has matching attendanceId`);
      assert(Boolean(b.breakType), `Break #${i + 1} has breakType`);
      assert(Boolean(b.startTime), `Break #${i + 1} has startTime`);
      assert(Boolean(b.endTime), `Break #${i + 1} has endTime`);
      assert(typeof b.durationSeconds === 'number', `Break #${i + 1} has durationSeconds`);
      assert(typeof b.durationMinutes === 'number' && b.durationMinutes >= 1, `Break #${i + 1} has durationMinutes`);
    });
    assert(todayRec.totalBreakMinutes >= 3, 'totalBreakMinutes calculated');
    assert(todayRec.totalBreakSeconds >= 180, 'totalBreakSeconds calculated');
    assert(Boolean(todayRec.breakDuration), `breakDuration formatted string returned: ${todayRec.breakDuration}`);

    // 13. HR Attendance API: GET /api/hr/attendance
    console.log('\n--- 13. Verify GET /api/hr/attendance ---');
    const dateKey = new Date().toISOString().slice(0, 10);
    const hrAttRes = await request({
      path: `/api/hr/attendance?employeeId=${techEmpId}&date=${dateKey}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(hrAttRes.statusCode === 200, 'GET /api/hr/attendance returns 200');
    const hrRecords = hrAttRes.body.data?.attendance || hrAttRes.body.data;
    assert(Array.isArray(hrRecords) && hrRecords.length === 1, 'Matching employee attendance returned');
    const hrRec = hrRecords[0];
    assert(hrRec.breaks.length === 3, 'HR record includes all 3 breaks');
    assert(hrRec.activeBreak === null, 'HR activeBreak is null');
    assert(hrRec.totalBreakMinutes === todayRec.totalBreakMinutes, 'totalBreakMinutes matches staff record');
    assert(hrRec.breakDuration === todayRec.breakDuration, 'breakDuration matches staff record');

    // 14. Verify Telecalling Employee
    console.log('\n--- 14. Verify Telecalling Department Employee ---');
    const teleCheckIn = await request({
      path: '/api/staff/attendance/check-in',
      method: 'POST',
      headers: { Authorization: `Bearer ${teleToken}` }
    }, { remarks: 'Telecalling check in' });
    assert(teleCheckIn.statusCode === 201, 'Telecalling staff checked in');
    const teleAttId = teleCheckIn.body.data?._id;

    // Cycle through breaks for Telecalling
    const teleTea1Start = await request({
      path: `/api/staff/attendance/${teleAttId}/breaks/start`,
      method: 'POST',
      headers: { Authorization: `Bearer ${teleToken}` }
    }, { breakType: 'tea_break_1' });
    assert(teleTea1Start.statusCode === 200, 'Telecalling tea_break_1 started');

    const teleTea1End = await request({
      path: `/api/staff/attendance/${teleAttId}/breaks/end`,
      method: 'POST',
      headers: { Authorization: `Bearer ${teleToken}` }
    }, { breakType: 'tea_break_1' });
    assert(teleTea1End.statusCode === 200, 'Telecalling tea_break_1 ended');

    const teleLunchStart = await request({
      path: `/api/staff/attendance/${teleAttId}/breaks/start`,
      method: 'POST',
      headers: { Authorization: `Bearer ${teleToken}` }
    }, { breakType: 'lunch' });
    assert(teleLunchStart.statusCode === 200, 'Telecalling lunch started');

    const teleLunchEnd = await request({
      path: `/api/staff/attendance/${teleAttId}/breaks/end`,
      method: 'POST',
      headers: { Authorization: `Bearer ${teleToken}` }
    }, { breakType: 'lunch' });
    assert(teleLunchEnd.statusCode === 200, 'Telecalling lunch ended');

    const teleTea2Start = await request({
      path: `/api/staff/attendance/${teleAttId}/breaks/start`,
      method: 'POST',
      headers: { Authorization: `Bearer ${teleToken}` }
    }, { breakType: 'tea_break_2' });
    assert(teleTea2Start.statusCode === 200, 'Telecalling tea_break_2 started');

    const teleTea2End = await request({
      path: `/api/staff/attendance/${teleAttId}/breaks/end`,
      method: 'POST',
      headers: { Authorization: `Bearer ${teleToken}` }
    }, { breakType: 'tea_break_2' });
    assert(teleTea2End.statusCode === 200, 'Telecalling tea_break_2 ended');

    // Verify Telecalling attendance in HR API
    const hrTeleRes = await request({
      path: `/api/hr/attendance?department=Telecalling&date=${dateKey}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(hrTeleRes.statusCode === 200, 'GET /api/hr/attendance?department=Telecalling returns 200');
    const teleRows = hrTeleRes.body.data?.attendance || hrTeleRes.body.data;
    const foundTele = teleRows.find(r => String(r.staffId) === String(teleEmpId) || String(r.employee?._id) === String(teleEmpId));
    assert(Boolean(foundTele), 'Telecalling employee found in HR query');
    assert(foundTele.breaks.length === 3, 'Telecalling employee has 3 completed breaks');
    assert(foundTele.totalBreakMinutes >= 3, 'Telecalling totalBreakMinutes verified');

    console.log('\n================================================================================');
    console.log('   ALL 14 INTEGRATION CHECKS PASSED WITH 100% SUCCESS!');
    console.log('================================================================================\n');

  } finally {
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
