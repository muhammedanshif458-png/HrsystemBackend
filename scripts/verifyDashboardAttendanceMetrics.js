const assert = require('assert/strict');
const { summarizeAttendanceDay } = require('../services/attendanceDashboardMetrics');

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
assert.deepEqual(result, { date: '2026-10-26', todayPresent: 2, todayAbsent: 0, lateArrivals: 1, onLeaveToday: 1, todayWfh: 1 });
console.log('Dashboard attendance fixture passed (3 active employees; duplicate attendance and leave rows deduplicated).');
