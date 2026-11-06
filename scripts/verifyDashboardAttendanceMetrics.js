const assert = require('assert/strict');
const {
  summarizeAttendanceDay,
  isWfhWorkMode,
  isOfficeWorkMode,
  getStoredAttendanceWorkMode
} = require('../services/attendanceDashboardMetrics');

// 1. Base fixture test (verifying existing keys + aliases wfhToday, wfh)
const employees = [{ _id: 'e1' }, { _id: 'e2' }, { _id: 'e3' }];
const attendanceRows = [
  { employee: { _id: 'e1', workMode: 'WFH' }, status: 'PRESENT', late: true, checkIn: new Date('2026-10-26T04:30:00Z') },
  { employee: { _id: 'e1', workMode: 'WFH' }, status: 'PRESENT', late: true, checkIn: new Date('2026-10-26T04:29:00Z') },
  { employee: { _id: 'e2', workMode: 'Office' }, status: 'HALF_DAY', late: false, checkIn: new Date('2026-10-26T04:00:00Z') }
];
const result = summarizeAttendanceDay({
  activeEmployeeIds: employees.map(employee => employee._id),
  attendanceRows,
  approvedLeaveRows: [{ employee: 'e3' }, { employee: 'e3' }],
  dateKey: '2026-10-26'
});
assert.deepEqual(result, {
  date: '2026-10-26',
  todayPresent: 2,
  todayAbsent: 0,
  lateArrivals: 1,
  onLeaveToday: 1,
  todayWfh: 1,
  wfhToday: 1,
  wfh: 1
});

// 2. Normalization unit tests for isWfhWorkMode
assert.strictEqual(isWfhWorkMode('WFH'), true, 'WFH should be true');
assert.strictEqual(isWfhWorkMode('wfh'), true, 'wfh should be true');
assert.strictEqual(isWfhWorkMode('WORK_FROM_HOME'), true, 'WORK_FROM_HOME should be true');
assert.strictEqual(isWfhWorkMode('Work From Home'), true, 'Work From Home should be true');
assert.strictEqual(isWfhWorkMode('work-from-home'), true, 'work-from-home should be true');
assert.strictEqual(isWfhWorkMode('OFFICE'), false, 'OFFICE should be false');
assert.strictEqual(isWfhWorkMode('Office'), false, 'Office should be false');
assert.strictEqual(isWfhWorkMode(null), false, 'null should be false');
assert.strictEqual(isWfhWorkMode(undefined), false, 'undefined should be false');

// 3. Normalization unit tests for isOfficeWorkMode
assert.strictEqual(isOfficeWorkMode('OFFICE'), true, 'OFFICE should be true');
assert.strictEqual(isOfficeWorkMode('Office'), true, 'Office should be true');
assert.strictEqual(isOfficeWorkMode('office'), true, 'office should be true');
assert.strictEqual(isOfficeWorkMode('WFH'), false, 'WFH should be false');

// 4. Stored attendance workMode priority
const rowStoredOffice = { workMode: 'Office', employee: { workMode: 'WFH' } };
assert.strictEqual(getStoredAttendanceWorkMode(rowStoredOffice), 'Office', 'Stored workMode must take precedence over employee workMode');
assert.strictEqual(isWfhWorkMode(getStoredAttendanceWorkMode(rowStoredOffice)), false, 'Stored Office should not be WFH');

const rowStoredWfh = { workMode: 'WORK_FROM_HOME', employee: { workMode: 'Office' } };
assert.strictEqual(getStoredAttendanceWorkMode(rowStoredWfh), 'WORK_FROM_HOME', 'Stored WORK_FROM_HOME must take precedence');
assert.strictEqual(isWfhWorkMode(getStoredAttendanceWorkMode(rowStoredWfh)), true, 'Stored WORK_FROM_HOME should be WFH');

// 5. Multiple workModes normalized in day summary
const multiEmployees = [{ _id: 'e1' }, { _id: 'e2' }, { _id: 'e3' }, { _id: 'e4' }];
const multiRows = [
  { employee: { _id: 'e1' }, workMode: 'WORK_FROM_HOME', status: 'PRESENT', checkIn: new Date('2026-10-26T04:00:00Z') },
  { employee: { _id: 'e2' }, workMode: 'Work From Home', status: 'PRESENT', checkIn: new Date('2026-10-26T04:05:00Z') },
  { employee: { _id: 'e3' }, workMode: 'WFH', status: 'HALF_DAY', checkIn: new Date('2026-10-26T04:10:00Z') },
  { employee: { _id: 'e4' }, workMode: 'OFFICE', status: 'PRESENT', checkIn: new Date('2026-10-26T04:15:00Z') }
];
const multiResult = summarizeAttendanceDay({
  activeEmployeeIds: multiEmployees.map(e => e._id),
  attendanceRows: multiRows,
  approvedLeaveRows: [],
  dateKey: '2026-10-26'
});
assert.strictEqual(multiResult.todayPresent, 4);
assert.strictEqual(multiResult.todayWfh, 3, 'e1, e2, e3 should be counted as WFH; e4 is OFFICE');
assert.strictEqual(multiResult.wfhToday, 3);
assert.strictEqual(multiResult.wfh, 3);

console.log('Dashboard attendance fixture passed (3 active employees; duplicate attendance and leave rows deduplicated).');
console.log('WFH normalization, aliases, and stored-workMode precedence checks passed.');
