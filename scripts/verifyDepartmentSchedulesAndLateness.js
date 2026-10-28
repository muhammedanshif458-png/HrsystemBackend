const assert = require('assert');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { connectDB, disconnectDB } = require('../config/db');
const DepartmentSchedule = require('../models/DepartmentSchedule');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const { calculateLateness } = require('../utils/scheduleHelper');
const {
  classifyCheckIn,
  getDateKey,
  getLocalParts,
  getUtcDateForKey,
  isAttendanceForCurrentWorkday,
  getScheduleForDepartment
} = require('../utils/attendanceSchedule');
const hrService = require('../services/hrService');
const staffService = require('../services/staffService');
const { summarizeAttendanceDay } = require('../services/attendanceDashboardMetrics');

async function runTestSuite() {
  console.log('================================================================');
  console.log('   DEPARTMENT SCHEDULES & LATE ARRIVAL CALCULATION TEST SUITE   ');
  console.log('================================================================\n');

  await connectDB();

  // -------------------------------------------------------------------------
  // 1. Tech Schedule Resolution
  // -------------------------------------------------------------------------
  console.log('--- Test 1: Tech Schedule Resolution ---');
  const techSched = await DepartmentSchedule.getEffectiveSchedule('Tech', new Date());
  assert(techSched !== null, 'Effective schedule for Tech must exist');
  assert.strictEqual(techSched.checkInTime, '10:00', 'Tech checkInTime must be 10:00');
  assert.strictEqual(techSched.checkOutTime, '18:00', 'Tech checkOutTime must be 18:00');
  assert.strictEqual(techSched.timezone, 'Asia/Kolkata', 'Tech timezone must be Asia/Kolkata');
  console.log('  [PASS] Tech schedule resolved: 10:00 to 18:00 in Asia/Kolkata');

  // -------------------------------------------------------------------------
  // 2. Telecalling Schedule Resolution
  // -------------------------------------------------------------------------
  console.log('\n--- Test 2: Telecalling Schedule Resolution ---');
  const teleSched = await DepartmentSchedule.getEffectiveSchedule('Telecalling', new Date());
  assert(teleSched !== null, 'Effective schedule for Telecalling must exist');
  assert.strictEqual(teleSched.checkInTime, '09:00', 'Telecalling checkInTime must be 09:00');
  assert.strictEqual(teleSched.checkOutTime, '18:00', 'Telecalling checkOutTime must be 18:00');
  assert.strictEqual(teleSched.timezone, 'Asia/Kolkata', 'Telecalling timezone must be Asia/Kolkata');
  console.log('  [PASS] Telecalling schedule resolved: 09:00 to 18:00 in Asia/Kolkata');

  // -------------------------------------------------------------------------
  // 3. Department Aliases & Capitalization
  // -------------------------------------------------------------------------
  console.log('\n--- Test 3: Department Aliases & Capitalization Resolution ---');
  const techAliases = ['tech', 'Tech', 'TECH', 'Technology', 'Engineering', 'Tech & Engineering', 'Software', 'IT'];
  for (const alias of techAliases) {
    const key = DepartmentSchedule.toCanonicalDeptKey(alias);
    assert.strictEqual(key, 'TECH', `Alias '${alias}' must resolve to canonical key 'TECH'`);
    const sched = await DepartmentSchedule.getEffectiveSchedule(alias, new Date());
    assert(sched !== null, `Alias '${alias}' must resolve effective schedule`);
    assert.strictEqual(sched.checkInTime, '10:00', `Alias '${alias}' must resolve to Tech check-in time 10:00`);
    assert.strictEqual(sched.checkOutTime, '18:00', `Alias '${alias}' must resolve to Tech check-out time 18:00`);
  }
  console.log('  [PASS] All Tech department aliases resolve consistently to TECH (10:00 - 18:00)');

  const teleAliases = ['telecalling', 'Telecalling', 'TELECALLING', 'Tele-calling', 'Tele calling', 'Client Calling'];
  for (const alias of teleAliases) {
    const key = DepartmentSchedule.toCanonicalDeptKey(alias);
    assert.strictEqual(key, 'TELECALLING', `Alias '${alias}' must resolve to canonical key 'TELECALLING'`);
    const sched = await DepartmentSchedule.getEffectiveSchedule(alias, new Date());
    assert(sched !== null, `Alias '${alias}' must resolve effective schedule`);
    assert.strictEqual(sched.checkInTime, '09:00', `Alias '${alias}' must resolve to Telecalling check-in time 09:00`);
    assert.strictEqual(sched.checkOutTime, '18:00', `Alias '${alias}' must resolve to Telecalling check-out time 18:00`);
  }
  console.log('  [PASS] All Telecalling aliases resolve consistently to TELECALLING (09:00 - 18:00)');

  // Ensure no cross-mapping between Tech and Telecalling
  assert.notStrictEqual(DepartmentSchedule.toCanonicalDeptKey('Tech'), 'TELECALLING');
  assert.notStrictEqual(DepartmentSchedule.toCanonicalDeptKey('Telecalling'), 'TECH');
  console.log('  [PASS] No accidental cross-mapping between Tech and Telecalling');

  // -------------------------------------------------------------------------
  // 4. On-Time and Late Check-Ins (Illustrative Examples from Specification)
  // -------------------------------------------------------------------------
  console.log('\n--- Test 4: On-Time and Late Check-In Calculations (Grace = 0) ---');
  const techPolicy = { checkInTime: '10:00', checkOutTime: '18:00', gracePeriodMinutes: 0, timezone: 'Asia/Kolkata' };
  const telePolicy = { checkInTime: '09:00', checkOutTime: '18:00', gracePeriodMinutes: 0, timezone: 'Asia/Kolkata' };

  // Tech: 10:00 AM schedule
  // Tech on-time: 09:55 AM IST (04:25 UTC)
  const techOnTime = calculateLateness(new Date('2026-10-28T04:25:00.000Z'), techPolicy);
  assert.strictEqual(techOnTime.isLate, false, 'Tech at 09:55 AM IST must be on time');
  assert.strictEqual(techOnTime.minutesLate, 0, 'Tech at 09:55 AM IST must have 0 minutesLate');

  // Tech exact boundary: 10:00 AM IST (04:30 UTC)
  const techExact = calculateLateness(new Date('2026-10-28T04:30:00.000Z'), techPolicy);
  assert.strictEqual(techExact.isLate, false, 'Tech at 10:00 AM IST must be on time');
  assert.strictEqual(techExact.minutesLate, 0, 'Tech at 10:00 AM IST must have 0 minutesLate');

  // Tech 10:05 AM IST (04:35 UTC) -> 5 minutes late
  const techLate5 = calculateLateness(new Date('2026-10-28T04:35:00.000Z'), techPolicy);
  assert.strictEqual(techLate5.isLate, true, 'Tech at 10:05 AM IST must be late');
  assert.strictEqual(techLate5.minutesLate, 5, 'Tech at 10:05 AM IST must be exactly 5 minutes late');

  // Tech 10:30 AM IST (05:00 UTC) -> 30 minutes late
  const techLate30 = calculateLateness(new Date('2026-10-28T05:00:00.000Z'), techPolicy);
  assert.strictEqual(techLate30.isLate, true, 'Tech at 10:30 AM IST must be late');
  assert.strictEqual(techLate30.minutesLate, 30, 'Tech at 10:30 AM IST must be exactly 30 minutes late');

  // Telecalling: 09:00 AM schedule
  // Telecalling on-time: 08:50 AM IST (03:20 UTC)
  const teleOnTime = calculateLateness(new Date('2026-10-28T03:20:00.000Z'), telePolicy);
  assert.strictEqual(teleOnTime.isLate, false, 'Telecalling at 08:50 AM IST must be on time');
  assert.strictEqual(teleOnTime.minutesLate, 0, 'Telecalling at 08:50 AM IST must have 0 minutesLate');

  // Telecalling exact: 09:00 AM IST (03:30 UTC)
  const teleExact = calculateLateness(new Date('2026-10-28T03:30:00.000Z'), telePolicy);
  assert.strictEqual(teleExact.isLate, false, 'Telecalling at 09:00 AM IST must be on time');
  assert.strictEqual(teleExact.minutesLate, 0, 'Telecalling at 09:00 AM IST must have 0 minutesLate');

  // Telecalling 09:05 AM IST (03:35 UTC) -> 5 minutes late
  const teleLate5 = calculateLateness(new Date('2026-10-28T03:35:00.000Z'), telePolicy);
  assert.strictEqual(teleLate5.isLate, true, 'Telecalling at 09:05 AM IST must be late');
  assert.strictEqual(teleLate5.minutesLate, 5, 'Telecalling at 09:05 AM IST must be exactly 5 minutes late');

  // Telecalling 09:30 AM IST (04:00 UTC) -> 30 minutes late
  const teleLate30 = calculateLateness(new Date('2026-10-28T04:00:00.000Z'), telePolicy);
  assert.strictEqual(teleLate30.isLate, true, 'Telecalling at 09:30 AM IST must be late');
  assert.strictEqual(teleLate30.minutesLate, 30, 'Telecalling at 09:30 AM IST must be exactly 30 minutes late');
  console.log('  [PASS] All illustrative spec check-in cases verified (Tech 10:05->5m, 10:30->30m; Telecalling 09:05->5m, 09:30->30m)');

  // -------------------------------------------------------------------------
  // 5. Configured Grace Period Behavior
  // -------------------------------------------------------------------------
  console.log('\n--- Test 5: Configured Grace Period Policy ---');
  const techGrace15 = { checkInTime: '10:00', checkOutTime: '18:00', gracePeriodMinutes: 15, timezone: 'Asia/Kolkata' };

  // 10:14 AM IST (within 15 min grace) -> On time
  const withinGrace = calculateLateness(new Date('2026-10-28T04:44:00.000Z'), techGrace15);
  assert.strictEqual(withinGrace.isLate, false, '10:14 AM IST within 15 min grace must be on time');
  assert.strictEqual(withinGrace.minutesLate, 0, '10:14 AM IST within grace must have 0 minutesLate');

  // 10:15:00 AM IST (exact cutoff) -> On time
  const exactGrace = calculateLateness(new Date('2026-10-28T04:45:00.000Z'), techGrace15);
  assert.strictEqual(exactGrace.isLate, false, '10:15 AM IST exactly at cutoff must be on time');
  assert.strictEqual(exactGrace.minutesLate, 0, '10:15 AM IST at cutoff must have 0 minutesLate');

  // 10:16 AM IST (1 minute past grace) -> Late by 1 minute
  const pastGrace = calculateLateness(new Date('2026-10-28T04:46:00.000Z'), techGrace15);
  assert.strictEqual(pastGrace.isLate, true, '10:16 AM IST past 15 min grace must be late');
  assert.strictEqual(pastGrace.minutesLate, 1, '10:16 AM IST must be 1 minute late');
  console.log('  [PASS] Configured grace period behavior verified (inclusive boundary, accurate late duration)');

  // -------------------------------------------------------------------------
  // 6. Asia/Kolkata Date/Time Handling & UTC Date Boundaries
  // -------------------------------------------------------------------------
  console.log('\n--- Test 6: Asia/Kolkata Date/Time Handling ---');
  // 11:30 PM UTC on Oct 27 = 05:00 AM IST on Oct 28
  const earlyMorningUtc = new Date('2026-10-27T23:30:00.000Z');
  const dateKey = getDateKey(earlyMorningUtc, 'Asia/Kolkata');
  assert.strictEqual(dateKey, '2026-10-28', 'UTC date boundary correctly translates to IST calendar date 2026-10-28');

  const localParts = getLocalParts(earlyMorningUtc, 'Asia/Kolkata');
  assert.strictEqual(localParts.hour, '05', 'Hour in Asia/Kolkata must be 05');
  assert.strictEqual(localParts.minute, '00', 'Minute in Asia/Kolkata must be 00');

  const workdayUtcDate = getUtcDateForKey('2026-10-28');
  assert.strictEqual(workdayUtcDate.toISOString(), '2026-10-28T00:00:00.000Z');
  console.log('  [PASS] Asia/Kolkata date key and parts resolve correctly across UTC boundaries');

  // -------------------------------------------------------------------------
  // 7. HR Attendance Response Mapping & Field Consistency
  // -------------------------------------------------------------------------
  console.log('\n--- Test 7: HR Attendance Response Mapping & Consistent Fields ---');
  const attendanceRes = await hrService.getAttendance({ page: 1, limit: 10 });
  assert(Array.isArray(attendanceRes.attendance), 'attendance list must be an array');
  assert(attendanceRes.attendance.length > 0, 'attendance list should contain records');

  for (const record of attendanceRes.attendance) {
    // Verify all required fields from Section 3
    assert('scheduledCheckIn' in record, 'record must have scheduledCheckIn');
    assert('scheduledCheckOut' in record, 'record must have scheduledCheckOut');
    assert('scheduleConfigured' in record, 'record must have scheduleConfigured');
    assert('scheduleTimeZone' in record, 'record must have scheduleTimeZone');
    assert('gracePeriodMinutes' in record, 'record must have gracePeriodMinutes');
    assert('isLate' in record, 'record must have isLate');
    assert('late' in record, 'record must have late');
    assert('minutesLate' in record, 'record must have minutesLate');
    assert.strictEqual(typeof record.isLate, 'boolean', 'isLate must be a boolean');
    assert.strictEqual(typeof record.late, 'boolean', 'late must be a boolean');
    assert.strictEqual(typeof record.minutesLate, 'number', 'minutesLate must be a number');
    assert(record.minutesLate >= 0, 'minutesLate must be >= 0');

    // For Tech records, verify scheduled check-in is 10:00
    const dept = record.employee?.department || record.department;
    if (dept && DepartmentSchedule.toCanonicalDeptKey(dept) === 'TECH') {
      if (isAttendanceForCurrentWorkday(record)) {
        assert.strictEqual(record.scheduledCheckIn, '10:00', `Current Tech record must show 10:00 scheduledCheckIn, got ${record.scheduledCheckIn}`);
        assert.strictEqual(record.scheduledCheckOut, '18:00', `Current Tech record must show 18:00 scheduledCheckOut`);
      }
    }
    // For Telecalling records, verify scheduled check-in is 09:00
    if (dept && DepartmentSchedule.toCanonicalDeptKey(dept) === 'TELECALLING') {
      if (isAttendanceForCurrentWorkday(record)) {
        assert.strictEqual(record.scheduledCheckIn, '09:00', `Current Telecalling record must show 09:00 scheduledCheckIn, got ${record.scheduledCheckIn}`);
        assert.strictEqual(record.scheduledCheckOut, '18:00', `Current Telecalling record must show 18:00 scheduledCheckOut`);
      }
    }
  }
  console.log('  [PASS] All attendance records contain complete, consistent schedule and lateness fields');

  // -------------------------------------------------------------------------
  // 8. Dashboard Late Count Consistency
  // -------------------------------------------------------------------------
  console.log('\n--- Test 8: Dashboard Late Count Consistency ---');
  const dashboardStats = await hrService.getDashboardStats();
  assert(typeof dashboardStats.todayLate === 'number', 'dashboardStats.todayLate must be a number');
  assert(typeof dashboardStats.lateArrivals === 'number', 'dashboardStats.lateArrivals must be a number');
  assert.strictEqual(dashboardStats.todayLate, dashboardStats.lateArrivals, 'todayLate must equal lateArrivals');

  const lateQueryRes = await hrService.getAttendance({ status: 'LATE' });
  console.log(`  Dashboard lateArrivals: ${dashboardStats.lateArrivals} | status=LATE query count: ${lateQueryRes.pagination.total}`);
  assert.strictEqual(dashboardStats.lateArrivals, lateQueryRes.pagination.total, 'Dashboard lateArrivals count must match GET /api/hr/attendance?status=LATE total count');
  console.log('  [PASS] Dashboard late count is strictly consistent with attendance late query total');

  await disconnectDB();
  console.log('\n================================================================');
  console.log('   ALL 8 VERIFICATION CATEGORIES PASSED SUCCESSFULLY!          ');
  console.log('================================================================\n');
}

runTestSuite().catch(err => {
  console.error('\nTest suite failed:', err);
  process.exit(1);
});

