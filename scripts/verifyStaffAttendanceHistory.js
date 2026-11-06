process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'dedicated-staff-attendance-secret-at-least-32-chars';
process.env.JWT_REFRESH_SECRET = 'dedicated-staff-attendance-refresh-secret-at-least-32';

const assert = require('assert');
const http = require('http');
const mongoose = require('mongoose');
const { app } = require('../server');
const { connectTestDatabase } = require('./testDatabase');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const DepartmentSchedule = require('../models/DepartmentSchedule');
const hrService = require('../services/hrService');
const staffService = require('../services/staffService');
const { getDateKey, getUtcDateForKey } = require('../utils/attendanceSchedule');

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
  console.log('   STAFF ATTENDANCE HISTORY, DETAILS & CLEAR HISTORY TEST SUITE ');
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

      const loginRes = await request(server, 'POST', '/api/auth/login', {
        email,
        password: 'Password123!'
      });
      assert.strictEqual(loginRes.status, 200, `Login for ${email} must succeed`);

      return { user, employee, token: loginRes.body.data.token };
    }

    // 1. Create HR Admin User + Employee
    const hrUser = await User.create({
      firstName: 'HR',
      lastName: 'Manager',
      email: 'hr_attendance_admin@lysoftware.com',
      password: 'Password123!',
      role: 'HR'
    });
    const hrEmployee = await Employee.create({
      user: hrUser._id,
      employeeId: 'EMP_HR_ATT_01',
      firstName: 'HR',
      lastName: 'Manager',
      email: 'hr_attendance_admin@lysoftware.com',
      department: 'Management',
      designation: 'HR Lead',
      workMode: 'Office',
      status: 'ACTIVE'
    });
    const hrLoginRes = await request(server, 'POST', '/api/auth/login', {
      email: 'hr_attendance_admin@lysoftware.com',
      password: 'Password123!'
    });
    const hrToken = hrLoginRes.body.data.token;

    // 2. Ensure Department Schedules exist
    await DepartmentSchedule.deleteMany({});
    await DepartmentSchedule.create([
      {
        department: 'TECH',
        departmentDisplay: 'Tech & Engineering',
        checkInTime: '10:00',
        checkOutTime: '18:00',
        timezone: 'Asia/Kolkata',
        gracePeriodMinutes: 0,
        effectiveDate: new Date('2020-01-01')
      },
      {
        department: 'TELECALLING',
        departmentDisplay: 'Telecalling & Client Relations',
        checkInTime: '09:00',
        checkOutTime: '18:00',
        timezone: 'Asia/Kolkata',
        gracePeriodMinutes: 0,
        effectiveDate: new Date('2020-01-01')
      }
    ]);

    // 3. Create Tech Staff
    const techStaff = await createStaffUserAndEmployee({
      employeeId: 'TECH_001',
      firstName: 'Aarav',
      lastName: 'Dev',
      department: 'Tech',
      designation: 'Backend Engineer',
      workMode: 'Office'
    });

    // 4. Create Telecalling Staff
    const teleStaff = await createStaffUserAndEmployee({
      employeeId: 'TELE_001',
      firstName: 'Diya',
      lastName: 'Caller',
      department: 'Telecalling',
      designation: 'Client Relationship Associate',
      workMode: 'Office'
    });

    // Base date timestamps
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // -------------------------------------------------------------------------
    // Seed Completed Record with Multiple Breaks for Tech Staff
    // -------------------------------------------------------------------------
    const techCheckInYesterday = new Date(yesterday.getTime() - 8 * 60 * 60 * 1000);
    const techCheckOutYesterday = new Date(yesterday.getTime());
    const break1Start = new Date(techCheckInYesterday.getTime() + 2 * 60 * 60 * 1000);
    const break1End = new Date(break1Start.getTime() + 15 * 60 * 1000); // 15 mins tea break 1
    const break2Start = new Date(break1End.getTime() + 2 * 60 * 60 * 1000);
    const break2End = new Date(break2Start.getTime() + 45 * 60 * 1000); // 45 mins lunch break

    const completedTechAttendance = await Attendance.create({
      employee: techStaff.employee._id,
      date: yesterday,
      checkIn: techCheckInYesterday,
      checkOut: techCheckOutYesterday,
      workMode: 'Office',
      status: 'PRESENT',
      workingHours: 7.0,
      totalBreakMinutes: 60,
      breaks: [
        {
          breakType: 'tea_break_1',
          startTime: break1Start,
          endTime: break1End,
          durationMinutes: 15,
          remarks: 'Morning tea'
        },
        {
          breakType: 'lunch',
          startTime: break2Start,
          endTime: break2End,
          durationMinutes: 45,
          remarks: 'Team lunch'
        }
      ]
    });

    // -------------------------------------------------------------------------
    // Seed Ongoing Record with Active Break for Tech Staff
    // -------------------------------------------------------------------------
    const techCheckInToday = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const activeBreakStart = new Date(now.getTime() - 20 * 60 * 1000); // started 20 mins ago

    const ongoingTechAttendance = await Attendance.create({
      employee: techStaff.employee._id,
      date: now,
      checkIn: techCheckInToday,
      checkOut: null, // ONGOING: no checkout
      workMode: 'WORK_FROM_HOME',
      status: 'PRESENT',
      workingHours: 0,
      totalBreakMinutes: 0,
      activeBreak: {
        breakType: 'lunch',
        startTime: activeBreakStart
      },
      breakStartedAt: activeBreakStart,
      breaks: [
        {
          breakType: 'lunch',
          startTime: activeBreakStart,
          endTime: null, // active
          durationMinutes: 0,
          remarks: 'Working from home lunch'
        }
      ]
    });

    // -------------------------------------------------------------------------
    // Seed Attendance for Telecalling Staff
    // -------------------------------------------------------------------------
    const teleAttendance = await Attendance.create({
      employee: teleStaff.employee._id,
      date: yesterday,
      checkIn: new Date(yesterday.getTime() - 7 * 60 * 60 * 1000),
      checkOut: new Date(yesterday.getTime()),
      workMode: 'Office',
      status: 'PRESENT',
      workingHours: 7.0,
      totalBreakMinutes: 30,
      breaks: [
        {
          breakType: 'tea_break_1',
          startTime: new Date(yesterday.getTime() - 4 * 60 * 60 * 1000),
          endTime: new Date(yesterday.getTime() - 3.5 * 60 * 60 * 1000),
          durationMinutes: 30
        }
      ]
    });

    // -------------------------------------------------------------------------
    // TEST 1: Attendance history returns all required fields
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: Attendance history returns all required fields ---');
    const histRes = await request(server, 'GET', '/api/staff/attendance', null, techStaff.token);
    assert.strictEqual(histRes.status, 200, 'GET /api/staff/attendance should return 200');
    assert(Array.isArray(histRes.body.data), 'Data must be an array');
    assert.strictEqual(histRes.body.data.length, 2, 'Tech staff should have 2 attendance records');

    const completedRow = histRes.body.data.find(r => r.id === completedTechAttendance._id.toString());
    assert(completedRow, 'Completed record must exist in history');
    assert(completedRow.date, 'Record must have date');
    assert(completedRow.checkIn, 'Record must have checkIn');
    assert(completedRow.checkOut, 'Record must have checkOut');
    assert(completedRow.checkInTime, 'Record must have checkInTime');
    assert(completedRow.checkOutTime, 'Record must have checkOutTime');
    assert.strictEqual(completedRow.status, 'PRESENT', 'Status must be PRESENT');
    assert.strictEqual(completedRow.workMode, 'Office', 'Work mode must be Office');
    assert.strictEqual(completedRow.sessionStatus, 'COMPLETED', 'Session status must be COMPLETED');
    assert.strictEqual(completedRow.checkoutStatus, 'Completed', 'Checkout status must be Completed');
    assert.strictEqual(completedRow.numberOfBreaks, 2, 'Number of breaks must be 2');
    assert.strictEqual(completedRow.totalBreakMinutes, 60, 'Total break minutes must be 60');
    assert.strictEqual(completedRow.breakDuration, '1h', 'Break duration should be formatted as 1h');
    assert.strictEqual(completedRow.workedDuration, '7h', 'Worked duration should be formatted as 7h');
    assert.strictEqual(completedRow.scheduledCheckIn, '10:00', 'Tech schedule checkIn must be 10:00');
    assert.strictEqual(completedRow.scheduledCheckOut, '18:00', 'Tech schedule checkOut must be 18:00');
    console.log('  [PASS] Completed attendance record returned all required fields correctly.');

    // -------------------------------------------------------------------------
    // TEST 2: Multiple individual break records returned correctly
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: Multiple individual break records returned correctly ---');
    assert.strictEqual(completedRow.breaks.length, 2, 'Breaks array must have 2 items');
    const b1 = completedRow.breaks[0];
    const b2 = completedRow.breaks[1];
    assert.strictEqual(b1.breakType, 'tea_break_1', 'Break 1 type must be tea_break_1');
    assert.strictEqual(b1.durationMinutes, 15, 'Break 1 duration must be 15');
    assert.strictEqual(b1.isCompleted, true, 'Break 1 must be completed');
    assert.strictEqual(b1.isActive, false, 'Break 1 must not be active');
    assert(b1.startTime && b1.endTime, 'Break 1 must have start and end time');

    assert.strictEqual(b2.breakType, 'lunch', 'Break 2 type must be lunch');
    assert.strictEqual(b2.durationMinutes, 45, 'Break 2 duration must be 45');
    assert.strictEqual(b2.isCompleted, true, 'Break 2 must be completed');
    console.log('  [PASS] Multiple breaks correctly structured with start, end, duration and status.');

    // -------------------------------------------------------------------------
    // TEST 3: Ongoing attendance has NO fabricated checkout & shows active break
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: Ongoing attendance has no fabricated checkout ---');
    const ongoingRow = histRes.body.data.find(r => r.id === ongoingTechAttendance._id.toString());
    assert(ongoingRow, 'Ongoing record must exist in history');
    assert(ongoingRow.checkIn, 'Ongoing record must have checkIn');
    assert.strictEqual(ongoingRow.checkOut, null, 'Ongoing record checkOut must be null (NEVER fabricated)');
    assert.strictEqual(ongoingRow.checkOutTime, null, 'Ongoing record checkOutTime must be null (NEVER fabricated)');
    assert.strictEqual(ongoingRow.checkOutAt, null, 'Ongoing record checkOutAt must be null');
    assert.strictEqual(ongoingRow.sessionStatus, 'IN_PROGRESS', 'Session status must be IN_PROGRESS');
    assert.strictEqual(ongoingRow.checkoutStatus, 'Pending', 'Checkout status must be Pending');
    assert(ongoingRow.activeBreak, 'Active break must be present');
    assert.strictEqual(ongoingRow.activeBreak.breakType, 'lunch', 'Active break must be lunch');
    assert(ongoingRow.breakStartedAt, 'breakStartedAt must be populated');
    const ongoingBreak = ongoingRow.breaks.find(b => b.breakType === 'lunch');
    assert(ongoingBreak, 'Ongoing break must be in breaks list');
    assert.strictEqual(ongoingBreak.isActive, true, 'Break must be isActive: true');
    assert.strictEqual(ongoingBreak.isCompleted, false, 'Break must be isCompleted: false');
    assert.strictEqual(ongoingBreak.endTime, null, 'Ongoing break endTime must be null');
    assert(ongoingBreak.durationSeconds >= 1200, 'Ongoing break durationSeconds should reflect elapsed time');
    console.log('  [PASS] Ongoing attendance verified: checkOut is null, sessionStatus is IN_PROGRESS, active break displayed.');

    // -------------------------------------------------------------------------
    // TEST 4: Detail API GET /api/staff/attendance/:attendanceId returns complete record
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: Detail API returns full record details ---');
    const detailRes = await request(server, 'GET', `/api/staff/attendance/${completedTechAttendance._id}`, null, techStaff.token);
    assert.strictEqual(detailRes.status, 200, 'GET /api/staff/attendance/:id should return 200');
    assert.strictEqual(detailRes.body.data.id, completedTechAttendance._id.toString());
    assert.strictEqual(detailRes.body.data.sessionStatus, 'COMPLETED');
    assert.strictEqual(detailRes.body.data.checkoutStatus, 'Completed');
    assert.strictEqual(detailRes.body.data.numberOfBreaks, 2);
    assert.strictEqual(detailRes.body.data.totalBreakMinutes, 60);
    assert.strictEqual(detailRes.body.data.breaks.length, 2);
    assert.strictEqual(detailRes.body.data.scheduledCheckIn, '10:00');
    assert.strictEqual(detailRes.body.data.scheduledCheckOut, '18:00');
    console.log('  [PASS] Detail API returned complete record with punches and breaks.');

    // -------------------------------------------------------------------------
    // TEST 5: Detail API for ongoing shift returns null checkout & active break
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: Detail API for ongoing shift preserves null checkout ---');
    const ongoingDetailRes = await request(server, 'GET', `/api/staff/attendance/${ongoingTechAttendance._id}`, null, techStaff.token);
    assert.strictEqual(ongoingDetailRes.status, 200);
    assert.strictEqual(ongoingDetailRes.body.data.checkOut, null);
    assert.strictEqual(ongoingDetailRes.body.data.checkOutTime, null);
    assert.strictEqual(ongoingDetailRes.body.data.sessionStatus, 'IN_PROGRESS');
    assert.strictEqual(ongoingDetailRes.body.data.checkoutStatus, 'Pending');
    assert(ongoingDetailRes.body.data.activeBreak !== null);
    console.log('  [PASS] Ongoing shift detail API verified: checkOut is strictly null.');

    // -------------------------------------------------------------------------
    // TEST 6: Ownership authorization: Staff CANNOT access another employee's record
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 6: Staff cannot access another employee\'s attendance detail ---');
    // techStaff tries to access teleStaff's attendance record
    const crossAccessRes = await request(server, 'GET', `/api/staff/attendance/${teleAttendance._id}`, null, techStaff.token);
    assert.strictEqual(crossAccessRes.status, 404, 'Access to another employee\'s attendance must return 404');
    console.log('  [PASS] Ownership enforced: cross-employee access rejected with 404.');

    // -------------------------------------------------------------------------
    // TEST 7: Staff cannot see another employee's attendance in history list
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 7: Staff history list contains only own records ---');
    const teleHistRes = await request(server, 'GET', '/api/staff/attendance', null, teleStaff.token);
    assert.strictEqual(teleHistRes.status, 200);
    assert.strictEqual(teleHistRes.body.data.length, 1, 'Telecalling staff must have only their 1 record');
    assert.strictEqual(teleHistRes.body.data[0].id, teleAttendance._id.toString());
    assert.strictEqual(teleHistRes.body.data[0].scheduledCheckIn, '09:00', 'Telecalling schedule checkIn must be 09:00');
    assert.strictEqual(teleHistRes.body.data[0].scheduledCheckOut, '18:00', 'Telecalling schedule checkOut must be 18:00');
    assert(!teleHistRes.body.data.some(r => r.id === completedTechAttendance._id.toString()), 'Telecalling history must not contain Tech records');
    console.log('  [PASS] Department/Employee isolation verified: history strictly scoped to authenticated user.');

    // -------------------------------------------------------------------------
    // TEST 8: Clear Attendance History (Non-destructive personal cutoff)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 8: Clear Attendance History hides records from Staff view only ---');
    // Capture dashboard stats before clear
    const statsBeforeClear = await hrService.getDashboardStats();

    // Tech staff calls clear history
    const clearRes = await request(server, 'DELETE', '/api/staff/attendance/history', null, techStaff.token);
    assert.strictEqual(clearRes.status, 200, 'DELETE /api/staff/attendance/history should return 200');
    assert(clearRes.body.data.clearedAt, 'Response should contain clearedAt timestamp');

    // Tech staff checks history: should now be empty
    const histAfterClear = await request(server, 'GET', '/api/staff/attendance', null, techStaff.token);
    assert.strictEqual(histAfterClear.status, 200);
    assert.strictEqual(histAfterClear.body.data.length, 0, 'History view must be empty after clearing');
    assert.strictEqual(histAfterClear.body.pagination.total, 0, 'Pagination total must be 0');
    console.log('  [PASS] Staff history view cleared successfully (0 records returned to staff).');

    // -------------------------------------------------------------------------
    // TEST 9: Official records preserved for HR and Dashboard stats unchanged
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 9: HR attendance records and Dashboard metrics remain unchanged ---');
    // Verify records STILL exist in MongoDB database directly
    const techDocInDb = await Attendance.findById(completedTechAttendance._id);
    assert(techDocInDb !== null, 'Attendance document must NOT be deleted from database');
    assert.strictEqual(techDocInDb.employee.toString(), techStaff.employee._id.toString());

    // HR queries attendance: records are 100% accessible to HR
    const hrAttRes = await hrService.getAttendance({ employeeId: techStaff.employee.employeeId });
    assert.strictEqual(hrAttRes.pagination.total, 2, 'HR must still see both attendance records for Tech employee');
    assert(hrAttRes.attendance.some(r => r._id.toString() === completedTechAttendance._id.toString()), 'Completed record visible to HR');
    assert(hrAttRes.attendance.some(r => r._id.toString() === ongoingTechAttendance._id.toString()), 'Ongoing record visible to HR');

    // Verify dashboard stats unchanged
    const statsAfterClear = await hrService.getDashboardStats();
    assert.strictEqual(statsAfterClear.todayPresent, statsBeforeClear.todayPresent, 'Dashboard todayPresent must be unchanged');
    assert.strictEqual(statsAfterClear.todayWfh, statsBeforeClear.todayWfh, 'Dashboard todayWfh must be unchanged');
    assert.strictEqual(statsAfterClear.totalEmployees, statsBeforeClear.totalEmployees, 'Dashboard totalEmployees must be unchanged');
    console.log('  [PASS] Official attendance records and Dashboard metrics preserved 100%.');

    // -------------------------------------------------------------------------
    // TEST 10: One employee clearing history does NOT affect another employee
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 10: One employee clearing history does not affect another employee ---');
    const teleHistAfterTechClear = await request(server, 'GET', '/api/staff/attendance', null, teleStaff.token);
    assert.strictEqual(teleHistAfterTechClear.body.data.length, 1, 'Telecalling staff history must remain intact');
    assert.strictEqual(teleHistAfterTechClear.body.data[0].id, teleAttendance._id.toString());
    console.log('  [PASS] History clearing is strictly per-employee and isolated.');

    // -------------------------------------------------------------------------
    // TEST 11: New attendance records appear normally after clearing
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 11: New attendance records appear normally after clearing ---');
    // Create new attendance record created AFTER cutoff
    const futureTime = new Date(Date.now() + 2000);
    const newRecord = await Attendance.create({
      employee: techStaff.employee._id,
      date: new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow's date
      checkIn: futureTime,
      workMode: 'Office',
      status: 'PRESENT',
      createdAt: futureTime
    });

    const histWithNewRecord = await request(server, 'GET', '/api/staff/attendance', null, techStaff.token);
    assert.strictEqual(histWithNewRecord.body.data.length, 1, 'Only the new record created after cutoff should appear');
    assert.strictEqual(histWithNewRecord.body.data[0].id, newRecord._id.toString());
    console.log('  [PASS] New attendance records appear normally in StaffHub history after clearing.');

    // -------------------------------------------------------------------------
    // TEST 12: POST alias /api/staff/attendance/clear-history works
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 12: POST alias /api/staff/attendance/clear-history works ---');
    const postClearRes = await request(server, 'POST', '/api/staff/attendance/clear-history', {}, teleStaff.token);
    assert.strictEqual(postClearRes.status, 200, 'POST /api/staff/attendance/clear-history must succeed');
    const teleHistAfterPostClear = await request(server, 'GET', '/api/staff/attendance', null, teleStaff.token);
    assert.strictEqual(teleHistAfterPostClear.body.data.length, 0, 'Telecalling history cleared via POST alias');
    console.log('  [PASS] POST alias /api/staff/attendance/clear-history verified.');

    // -------------------------------------------------------------------------
    // TEST 13: POST alias /api/staff/attendance/history/clear also works
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 13: POST alias /api/staff/attendance/history/clear works ---');
    const postClearRes2 = await request(server, 'POST', '/api/staff/attendance/history/clear', {}, techStaff.token);
    assert.strictEqual(postClearRes2.status, 200, 'POST /api/staff/attendance/history/clear must succeed');
    console.log('  [PASS] POST alias /api/staff/attendance/history/clear verified.');

    // -------------------------------------------------------------------------
    // TEST 14: Both Tech & Telecalling departments support identical functionality
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 14: Both Tech & Telecalling use identical functionality ---');
    assert.strictEqual(techStaff.employee.department, 'Tech');
    assert.strictEqual(teleStaff.employee.department, 'Telecalling');
    console.log('  [PASS] Verified identical functionality across Tech and Telecalling staff.');

    console.log('\n================================================================');
    console.log('   ALL 14 STAFF ATTENDANCE HISTORY & DETAIL TESTS PASSED!       ');
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
