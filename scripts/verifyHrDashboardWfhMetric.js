process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'dedicated-wfh-metrics-test-secret-at-least-32-chars';
process.env.JWT_REFRESH_SECRET = 'dedicated-wfh-metrics-refresh-secret-at-least-32';

const assert = require('assert');
const http = require('http');
const mongoose = require('mongoose');
const { app } = require('../server');
const { connectTestDatabase } = require('./testDatabase');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const hrService = require('../services/hrService');
const { getDateKey } = require('../utils/attendanceSchedule');

const request = (server, method, path, body, token) => new Promise((resolve, reject) => {
  const payload = body ? Buffer.from(JSON.stringify(body)) : null;
  const req = http.request({
    hostname: '127.0.0.1',
    port: server.address().port,
    method,
    path,
    headers: {
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  }, res => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      let parsedBody = {};
      try {
        parsedBody = data ? JSON.parse(data) : {};
      } catch (e) {
        parsedBody = { raw: data };
      }
      resolve({ status: res.statusCode, body: parsedBody });
    });
  });
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
});

async function runTestSuite() {
  console.log('================================================================');
  console.log('   HR DASHBOARD & ATTENDANCE WFH METRIC VERIFICATION SUITE      ');
  console.log('================================================================\n');

  await connectTestDatabase();

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  try {
    // Helper to create staff user + employee
    async function createStaffUserAndEmployee({ employeeId, firstName, lastName, department, designation, workMode }) {
      const email = `${employeeId.toLowerCase()}@lysoftware.com`;
      const user = await User.create({
        firstName,
        lastName,
        email,
        password: 'Password123!',
        role: 'STAFF'
      });
      const employee = await Employee.create({
        user: user._id,
        employeeId,
        firstName,
        lastName,
        email,
        department,
        designation,
        workMode: workMode || 'Office',
        status: 'ACTIVE'
      });
      return { user, employee };
    }

    // 1. Create HR Admin User and Employee
    const hrUser = await User.create({
      firstName: 'HR',
      lastName: 'Admin',
      email: 'hr_wfh_admin@lysoftware.com',
      password: 'Password123!',
      role: 'HR'
    });
    const hrEmployee = await Employee.create({
      user: hrUser._id,
      employeeId: 'EMP_HR_001',
      firstName: 'HR',
      lastName: 'Manager',
      email: 'hr_wfh_admin@lysoftware.com',
      department: 'Management',
      designation: 'HR Lead',
      workMode: 'Office',
      status: 'ACTIVE'
    });

    const loginRes = await request(server, 'POST', '/api/auth/login', {
      email: 'hr_wfh_admin@lysoftware.com',
      password: 'Password123!'
    });
    assert.strictEqual(loginRes.status, 200, 'HR Login must succeed');
    const hrToken = loginRes.body.data.token;

    // 2. Setup Test Employees
    const { employee: empWfh1 } = await createStaffUserAndEmployee({
      employeeId: 'EMP_WFH_001',
      firstName: 'Anjali',
      lastName: 'Sharma',
      department: 'Tech',
      designation: 'Engineer',
      workMode: 'Office' // Profile is Office, but check-in will be WORK_FROM_HOME
    });

    const { employee: empWfh2 } = await createStaffUserAndEmployee({
      employeeId: 'EMP_WFH_002',
      firstName: 'Rohan',
      lastName: 'Verma',
      department: 'Tech',
      designation: 'QA',
      workMode: 'WFH'
    });

    const { employee: empWfh3 } = await createStaffUserAndEmployee({
      employeeId: 'EMP_WFH_003',
      firstName: 'Pooja',
      lastName: 'Iyer',
      department: 'Telecalling',
      designation: 'Caller',
      workMode: 'WFH'
    });

    const { employee: empOffice } = await createStaffUserAndEmployee({
      employeeId: 'EMP_OFF_001',
      firstName: 'Vikram',
      lastName: 'Patel',
      department: 'Tech',
      designation: 'DevOps',
      workMode: 'Office'
    });

    const { employee: empProfileWfhButOfficeAtt } = await createStaffUserAndEmployee({
      employeeId: 'EMP_OFF_002',
      firstName: 'Siddharth',
      lastName: 'Rao',
      department: 'Tech',
      designation: 'Architect',
      workMode: 'WFH' // Profile is WFH, but Attendance record will be OFFICE
    });

    const { employee: empHistorical } = await createStaffUserAndEmployee({
      employeeId: 'EMP_HIST_001',
      firstName: 'Neha',
      lastName: 'Gupta',
      department: 'Tech',
      designation: 'Designer',
      workMode: 'WFH'
    });

    const today = new Date();
    const todayDateKey = getDateKey(today, 'Asia/Kolkata');
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

    // 3. Create Attendance Records (1 record per employee for today)
    // empWfh1: WORK_FROM_HOME (stored in Attendance)
    await Attendance.create({
      employee: empWfh1._id,
      date: today,
      checkIn: new Date(today.getTime() - 4 * 60 * 60 * 1000),
      workMode: 'WORK_FROM_HOME',
      status: 'PRESENT'
    });

    // empWfh2: Work From Home (stored in Attendance)
    await Attendance.create({
      employee: empWfh2._id,
      date: today,
      checkIn: new Date(today.getTime() - 4 * 60 * 60 * 1000),
      workMode: 'Work From Home',
      status: 'PRESENT'
    });

    // empWfh3: WFH (stored in Attendance)
    await Attendance.create({
      employee: empWfh3._id,
      date: today,
      checkIn: new Date(today.getTime() - 4 * 60 * 60 * 1000),
      workMode: 'WFH',
      status: 'HALF_DAY'
    });

    // empOffice: OFFICE (stored in Attendance)
    await Attendance.create({
      employee: empOffice._id,
      date: today,
      checkIn: new Date(today.getTime() - 4 * 60 * 60 * 1000),
      workMode: 'OFFICE',
      status: 'PRESENT'
    });

    // empProfileWfhButOfficeAtt: Office (stored in Attendance, profile is WFH)
    await Attendance.create({
      employee: empProfileWfhButOfficeAtt._id,
      date: today,
      checkIn: new Date(today.getTime() - 4 * 60 * 60 * 1000),
      workMode: 'Office',
      status: 'PRESENT'
    });

    // empHistorical: Yesterday WFH (stored in Attendance)
    await Attendance.create({
      employee: empHistorical._id,
      date: yesterday,
      checkIn: new Date(yesterday.getTime() - 4 * 60 * 60 * 1000),
      workMode: 'WORK_FROM_HOME',
      status: 'PRESENT'
    });

    console.log('--- TEST 1: Service Level getDashboardStats WFH Metric ---');
    const stats = await hrService.getDashboardStats(todayDateKey);
    console.log(`  todayWfh: ${stats.todayWfh}, wfhToday: ${stats.wfhToday}, wfh: ${stats.wfh}`);
    assert.strictEqual(stats.todayWfh, 3, 'todayWfh must be exactly 3 (empWfh1, empWfh2, empWfh3)');
    assert.strictEqual(stats.wfhToday, 3, 'wfhToday alias must equal todayWfh');
    assert.strictEqual(stats.wfh, 3, 'wfh alias must equal todayWfh');
    console.log('  [PASS] Service getDashboardStats correctly returned todayWfh = 3 and aliases.');

    console.log('\n--- TEST 2: HTTP GET /api/hr/dashboard returns todayWfh and aliases ---');
    const dashHttp = await request(server, 'GET', `/api/hr/dashboard?date=${todayDateKey}`, null, hrToken);
    assert.strictEqual(dashHttp.status, 200, 'Dashboard endpoint should return 200');
    assert.strictEqual(dashHttp.body.data.todayWfh, 3, 'HTTP response todayWfh must be 3');
    assert.strictEqual(dashHttp.body.data.wfhToday, 3, 'HTTP response wfhToday must be 3');
    assert.strictEqual(dashHttp.body.data.wfh, 3, 'HTTP response wfh must be 3');
    console.log('  [PASS] HTTP GET /api/hr/dashboard returns 200 with todayWfh: 3, wfhToday: 3, wfh: 3.');

    console.log('\n--- TEST 3: Stored Attendance.workMode is source of truth (Task 8) ---');
    // empWfh1 has profile Office, but attendance WORK_FROM_HOME -> counted as WFH
    // empProfileWfhButOfficeAtt has profile WFH, but attendance Office -> excluded from WFH
    assert.strictEqual(stats.todayWfh, 3, 'Stored workMode must take precedence over employee profile workMode');
    console.log('  [PASS] Profile workMode did not overwrite attendance workMode.');

    console.log('\n--- TEST 4: Historical attendance records excluded from today\'s WFH ---');
    // empHistorical attended yesterday with WORK_FROM_HOME
    assert.strictEqual(stats.todayWfh, 3, 'Yesterday attendance not counted in today\'s WFH');
    console.log('  [PASS] Historical records are not counted in today\'s WFH.');

    console.log('\n--- TEST 5: Attendance API GET /api/hr/attendance?workMode=WFH matches Dashboard ---');
    const attWfhRes = await hrService.getAttendance({ workMode: 'WFH', date: todayDateKey });
    console.log(`  Attendance API with workMode=WFH returned: ${attWfhRes.pagination.total} records`);
    assert.strictEqual(attWfhRes.pagination.total, 3, 'Attendance API workMode=WFH total must be 3');
    assert.strictEqual(attWfhRes.pagination.total, stats.todayWfh, 'Attendance page WFH count matches Dashboard todayWfh');
    console.log('  [PASS] Attendance page WFH count strictly matches Dashboard todayWfh (3 === 3).');

    console.log('\n--- TEST 6: Normalization across workMode query values ---');
    const attWfhAlt1 = await hrService.getAttendance({ workMode: 'WORK_FROM_HOME', date: todayDateKey });
    assert.strictEqual(attWfhAlt1.pagination.total, 3, 'workMode=WORK_FROM_HOME query matches normalized WFH records');

    const attWfhAlt2 = await hrService.getAttendance({ workMode: 'Work From Home', date: todayDateKey });
    assert.strictEqual(attWfhAlt2.pagination.total, 3, 'workMode="Work From Home" query matches normalized WFH records');

    const attWfhAlt3 = await hrService.getAttendance({ workMode: 'work_from_home', date: todayDateKey });
    assert.strictEqual(attWfhAlt3.pagination.total, 3, 'workMode="work_from_home" query matches normalized WFH records');
    console.log('  [PASS] Consistent normalization verified for WFH, WORK_FROM_HOME, Work From Home, work_from_home.');

    console.log('\n--- TEST 7: OFFICE workMode query strictly excludes WFH records ---');
    const attOfficeRes = await hrService.getAttendance({ workMode: 'Office', date: todayDateKey });
    assert.strictEqual(attOfficeRes.pagination.total, 2, 'Office query should return only the 2 Office attendance records');
    for (const rec of attOfficeRes.attendance) {
      assert(['OFFICE', 'Office'].includes(rec.workMode), `Record must be Office workMode, got: ${rec.workMode}`);
    }
    console.log('  [PASS] Office filter strictly returns office records and excludes all WFH records.');

    console.log('\n--- TEST 8: HTTP GET /api/hr/attendance?workMode=WFH endpoint ---');
    const attHttp = await request(server, 'GET', `/api/hr/attendance?workMode=WFH&date=${todayDateKey}`, null, hrToken);
    assert.strictEqual(attHttp.status, 200, 'HTTP attendance endpoint should return 200');
    assert.strictEqual(attHttp.body.data.length, 3, 'HTTP attendance endpoint should return 3 records');
    assert.strictEqual(attHttp.body.pagination.total, 3, 'HTTP pagination total should match dashboard WFH count');
    console.log('  [PASS] HTTP GET /api/hr/attendance returns 200 with 3 records and matching total.');

    console.log('\n--- TEST 9: Deduplication for same employee on same workday (Task 7) ---');
    // Now create a duplicate attendance record for empWfh1 on today
    await Attendance.create({
      employee: empWfh1._id,
      date: new Date(today.getTime() + 1000),
      checkIn: new Date(today.getTime() - 2 * 60 * 60 * 1000),
      workMode: 'WORK_FROM_HOME',
      status: 'PRESENT'
    });
    const emp1Records = await Attendance.find({ employee: empWfh1._id, date: { $gte: new Date(today.getTime() - 12 * 60 * 60 * 1000) } });
    assert.strictEqual(emp1Records.length, 2, 'empWfh1 now has 2 attendance records for today');

    const statsAfterDuplicate = await hrService.getDashboardStats(todayDateKey);
    console.log(`  todayWfh after duplicate checkIn: ${statsAfterDuplicate.todayWfh}`);
    assert.strictEqual(statsAfterDuplicate.todayWfh, 3, 'Duplicate attendance record must not inflate WFH count');
    console.log('  [PASS] Deduplication verified: duplicate attendance records do not inflate the WFH metric.');

    console.log('\n================================================================');
    console.log('   ALL 9 HR DASHBOARD & ATTENDANCE WFH METRIC TESTS PASSED!     ');
    console.log('================================================================\n');

  } finally {
    server.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}

runTestSuite().catch(err => {
  console.error('\nVerification suite failed:', err);
  process.exit(1);
});
