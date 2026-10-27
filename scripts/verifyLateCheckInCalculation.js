const assert = require('assert/strict');
const mongoose = require('mongoose');
require('dotenv').config();

const DepartmentSchedule = require('../models/DepartmentSchedule');
const Employee = require('../models/Employee');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const staffService = require('../services/staffService');
const hrService = require('../services/hrService');
const { getUtcDateForKey, getDateKey } = require('../utils/attendanceSchedule');

async function runRegressionSuite() {
  console.log('========================================================================');
  console.log('   REGRESSION TEST SUITE: LATE CHECK-IN CALCULATION & HR API RESPONSE   ');
  console.log('========================================================================\n');

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hr_management');

  // Clean test fixtures
  await DepartmentSchedule.deleteMany({ department: { $in: ['TECH', 'TEST_DEPT', 'MIDNIGHT_DEPT'] } });
  await Attendance.deleteMany({ remarks: /regression-test/i });
  await Employee.deleteMany({ email: /regression.*@company\.com/i });
  await User.deleteMany({ email: /regression.*@company\.com/i });

  // 1. Configure Tech Department Schedule: 10:00 check-in, 15 min grace, Asia/Kolkata
  console.log('--- 1. Setting up Test Department Schedules ---');
  const techSchedule = await hrService.createDepartmentSchedule({
    department: 'Tech',
    checkInTime: '10:00',
    checkOutTime: '18:00',
    gracePeriodMinutes: 15,
    timezone: 'Asia/Kolkata',
    effectiveDate: '2026-01-01',
    description: 'Tech official schedule with 15 min grace'
  });
  assert.equal(techSchedule.department, 'TECH');
  assert.equal(techSchedule.checkInTime, '10:00');
  assert.equal(techSchedule.gracePeriodMinutes, 15);
  console.log('✓ Configured Tech schedule: 10:00 check-in, 15 min grace, Asia/Kolkata');

  // Schedule for across-midnight / timezone boundary testing: 23:30 check-in, America/New_York
  const nySchedule = await hrService.createDepartmentSchedule({
    department: 'MidnightDept',
    checkInTime: '23:30',
    checkOutTime: '07:30',
    gracePeriodMinutes: 0,
    timezone: 'America/New_York',
    effectiveDate: '2026-01-01',
    description: 'Near-midnight New York schedule'
  });
  console.log('✓ Configured Near-Midnight schedule: 23:30 check-in, America/New_York\n');

  // Helper to create test employee and user
  let empCounter = 1;
  async function createTestEmployee(department) {
    const email = `regression.emp${empCounter++}@company.com`;
    const user = await User.create({
      firstName: 'RegTest',
      lastName: `Emp${empCounter}`,
      email,
      password: 'Password@123',
      role: 'STAFF'
    });
    const emp = await Employee.create({
      user: user._id,
      employeeId: `REG${String(empCounter).padStart(4, '0')}`,
      firstName: 'RegTest',
      lastName: `Emp${empCounter}`,
      email,
      department,
      designation: 'Engineer',
      status: 'ACTIVE'
    });
    return { user, emp };
  }

  const testDate = '2026-10-27';

  // --- Scenario A: Check-in before scheduled time ---
  console.log('--- Scenario A: Check-in before scheduled time (09:45 IST vs 10:00) ---');
  const { user: userA, emp: empA } = await createTestEmployee('Tech');
  const checkInA = new Date('2026-10-27T04:15:00.000Z'); // 09:45 IST
  const attA = await staffService.checkIn(userA, 'regression-test A', checkInA);
  assert.equal(attA.isLate, false, 'Before scheduled time must be isLate: false');
  assert.equal(attA.late, false, 'Before scheduled time must be late: false');
  assert.equal(attA.minutesLate, 0, 'Before scheduled time must be minutesLate: 0');
  assert.equal(attA.status, 'PRESENT', 'Status remains PRESENT');
  assert.equal(attA.scheduleConfigured, true, 'Schedule must be configured');
  assert.equal(attA.scheduledCheckIn, '10:00');
  assert.equal(attA.scheduleTimeZone, 'Asia/Kolkata');
  console.log('✓ Scenario A Passed: On-time check-in before scheduled time');

  // --- Scenario B: Check-in exactly at scheduled time ---
  console.log('\n--- Scenario B: Check-in exactly at scheduled time (10:00 IST vs 10:00) ---');
  const { user: userB, emp: empB } = await createTestEmployee('Tech');
  const checkInB = new Date('2026-10-27T04:30:00.000Z'); // 10:00 IST
  const attB = await staffService.checkIn(userB, 'regression-test B', checkInB);
  assert.equal(attB.isLate, false, 'Exactly at scheduled time must be isLate: false');
  assert.equal(attB.late, false, 'Exactly at scheduled time must be late: false');
  assert.equal(attB.minutesLate, 0, 'Exactly at scheduled time must be minutesLate: 0');
  assert.equal(attB.status, 'PRESENT');
  assert.equal(attB.scheduleConfigured, true);
  console.log('✓ Scenario B Passed: On-time check-in exactly at scheduled time');

  // --- Scenario C: Check-in after scheduled time but within grace period ---
  console.log('\n--- Scenario C: Check-in within grace period (10:10 IST vs 10:00 with 15 min grace) ---');
  const { user: userC, emp: empC } = await createTestEmployee('Tech');
  const checkInC = new Date('2026-10-27T04:40:00.000Z'); // 10:10 IST
  const attC = await staffService.checkIn(userC, 'regression-test C', checkInC);
  assert.equal(attC.isLate, false, 'Within grace period must be isLate: false');
  assert.equal(attC.late, false, 'Within grace period must be late: false');
  assert.equal(attC.minutesLate, 0, 'Within grace period must be minutesLate: 0');
  assert.equal(attC.status, 'PRESENT');
  assert.equal(attC.scheduleConfigured, true);
  console.log('✓ Scenario C Passed: On-time check-in within configured grace period');

  // --- Scenario D: Check-in after configured grace period ---
  console.log('\n--- Scenario D: Check-in after grace period (10:35 IST vs 10:00 + 15 min grace = 10:15 cutoff) ---');
  const { user: userD, emp: empD } = await createTestEmployee('Technology'); // Alias/canonical mapping test
  const checkInD = new Date('2026-10-27T05:05:00.000Z'); // 10:35 IST
  const attD = await staffService.checkIn(userD, 'regression-test D', checkInD);
  assert.equal(attD.isLate, true, 'After grace cutoff must be isLate: true');
  assert.equal(attD.late, true, 'After grace cutoff must be late: true');
  assert.equal(attD.minutesLate, 20, '10:35 vs 10:15 cutoff must be exactly 20 minutesLate');
  assert.equal(attD.status, 'PRESENT', 'Status remains PRESENT even when late');
  assert.equal(attD.scheduleConfigured, true, 'Canonical department must resolve scheduleConfigured: true');
  assert.equal(attD.scheduledCheckIn, '10:00');
  assert.equal(attD.scheduleTimeZone, 'Asia/Kolkata');
  assert.equal(attD.scheduleSnapshot?.gracePeriodMinutes, 15);
  console.log('✓ Scenario D Passed: Late check-in after grace period with exact minutesLate (20 mins)');

  // --- Scenario E: Employee with no configured schedule ---
  console.log('\n--- Scenario E: Employee with no configured schedule ---');
  const { user: userE, emp: empE } = await createTestEmployee('UnconfiguredDepartment');
  const checkInE = new Date('2026-10-27T06:00:00.000Z');
  const attE = await staffService.checkIn(userE, 'regression-test E', checkInE);
  assert.equal(attE.scheduleConfigured, false, 'Missing schedule must have scheduleConfigured: false');
  assert.equal(attE.scheduleStatus, 'UNCONFIGURED', 'Missing schedule must have scheduleStatus: UNCONFIGURED');
  assert.equal(attE.scheduledCheckIn, null, 'scheduledCheckIn must be null');
  assert.equal(attE.scheduleTimeZone, null, 'scheduleTimeZone must be null');
  assert.equal(attE.isLate, false, 'Unconfigured employee must not be classified late');
  assert.equal(attE.late, false);
  assert.equal(attE.minutesLate, 0);
  assert.equal(attE.status, 'PRESENT');
  console.log('✓ Scenario E Passed: Employee without schedule recorded safely as unconfigured');

  // --- Scenario F: Timezone boundary / near-midnight check-in ---
  console.log('\n--- Scenario F: Near-midnight check-in across timezone boundary (23:45 NY vs 23:30 schedule) ---');
  const { user: userF, emp: empF } = await createTestEmployee('MidnightDept');
  // 2026-10-27 23:45 EDT (America/New_York, UTC-4) = 2026-10-28 03:45:00 UTC
  const checkInF = new Date('2026-10-28T03:45:00.000Z');
  const attF = await staffService.checkIn(userF, 'regression-test F', checkInF);
  assert.equal(attF.isLate, true, '23:45 vs 23:30 cutoff must be late');
  assert.equal(attF.minutesLate, 15, '23:45 vs 23:30 cutoff must be exactly 15 minutes late');
  assert.equal(attF.scheduleConfigured, true);
  assert.equal(attF.scheduleTimeZone, 'America/New_York');
  // Date must map to local New York workday: 2026-10-27
  assert.equal(attF.date.toISOString().slice(0, 10), '2026-10-27', 'Workday matches local New York calendar date');
  console.log('✓ Scenario F Passed: Timezone boundary correctly resolved to local workday and late calculation');

  // --- 2. Test HR Attendance API: GET /api/hr/attendance?date=... ---
  console.log('\n--- 2. Inspecting HR Attendance API GET /api/hr/attendance ---');
  const hrTechResult = await hrService.getAttendance({
    date: testDate,
    department: 'Tech',
    status: 'PRESENT',
    page: 1,
    limit: 20
  });

  console.log(`Retrieved ${hrTechResult.attendance.length} attendance records for department=Tech on date=${testDate}`);
  assert(hrTechResult.attendance.length >= 3, 'Must return records for employees in Tech/Technology');

  // Verify late record D in HR response
  const lateRecordInHr = hrTechResult.attendance.find(r => r.staffId === empD._id.toString());
  assert(Boolean(lateRecordInHr), 'Late record D must be in HR response');
  assert.equal(lateRecordInHr.isLate, true, 'HR API response has isLate: true');
  assert.equal(lateRecordInHr.late, true, 'HR API response has late: true');
  assert.equal(lateRecordInHr.minutesLate, 20, 'HR API response has minutesLate: 20');
  assert.equal(lateRecordInHr.scheduleConfigured, true, 'HR API response has scheduleConfigured: true');
  assert.equal(lateRecordInHr.scheduledCheckIn, '10:00', 'HR API response has scheduledCheckIn: 10:00');
  assert.equal(lateRecordInHr.scheduleTimeZone, 'Asia/Kolkata', 'HR API response has scheduleTimeZone: Asia/Kolkata');
  assert.equal(lateRecordInHr.status, 'PRESENT', 'HR API response has status: PRESENT');
  assert.equal(typeof lateRecordInHr.checkInTime, 'string', 'checkInTime is ISO string');
  assert.equal(typeof lateRecordInHr.scheduleSnapshot, 'object', 'scheduleSnapshot is populated');
  console.log('✓ HR Attendance API: Late record verified with exact expected fields and values');

  // Verify Date Filtering Integrity: querying another date must NOT return today\'s records
  const emptyDateResult = await hrService.getAttendance({
    date: '2025-01-01',
    department: 'Tech',
    status: 'PRESENT',
    page: 1,
    limit: 20
  });
  assert.equal(emptyDateResult.attendance.length, 0, 'Querying different date returns 0 records (no cross-date leaks)');
  console.log('✓ HR Attendance API: Strict date filtering verified (no cross-date data leakage)');

  // --- 3. Test HR Dashboard Late Statistics ---
  console.log('\n--- 3. Verifying HR Dashboard Late Arrival Statistics ---');
  const dashboardStats = await hrService.getDashboardStats(testDate);
  console.log('Dashboard Stats on testDate:', {
    todayPresent: dashboardStats.todayPresent,
    todayLate: dashboardStats.todayLate,
    lateArrivals: dashboardStats.lateArrivals
  });
  assert(typeof dashboardStats.todayLate === 'number', 'todayLate must be a number');
  assert(dashboardStats.todayLate >= 1, 'todayLate must include checked-in late staff');
  assert.equal(dashboardStats.todayLate, dashboardStats.lateArrivals, 'todayLate and lateArrivals must match exactly');
  console.log('✓ HR Dashboard: todayLate and lateArrivals correctly reflect late check-ins\n');

  // Cleanup test fixtures
  await DepartmentSchedule.deleteMany({ department: { $in: ['TECH', 'TEST_DEPT', 'MIDNIGHT_DEPT'] } });
  await Attendance.deleteMany({ remarks: /regression-test/i });
  await Employee.deleteMany({ email: /regression.*@company\.com/i });
  await User.deleteMany({ email: /regression.*@company\.com/i });

  console.log('========================================================================');
  console.log('   ALL REGRESSION TESTS COMPLETED SUCCESSFULLY!                         ');
  console.log('========================================================================');

  await mongoose.disconnect();
}

runRegressionSuite().catch(err => {
  console.error('\nRegression test failed:', err);
  process.exit(1);
});
