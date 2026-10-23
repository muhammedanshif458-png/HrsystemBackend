const assert = require('assert');
const { classifyCheckIn, getDateKey, getUtcDateForKey, isAttendanceForCurrentWorkday } = require('../utils/attendanceSchedule');

const scheduleA = { checkInTime: '09:00', timeZone: 'Asia/Kolkata', gracePeriodMinutes: 0 };
const scheduleB = { checkInTime: '10:00', timeZone: 'Asia/Kolkata', gracePeriodMinutes: 0 };
const at = (iso) => new Date(iso);

assert.strictEqual(classifyCheckIn(at('2026-10-23T03:29:00.000Z'), scheduleA).late, false, 'before schedule is on time');
assert.strictEqual(classifyCheckIn(at('2026-10-23T03:30:00.000Z'), scheduleA).late, false, 'exact schedule is on time');
assert.strictEqual(classifyCheckIn(at('2026-10-23T03:31:00.000Z'), scheduleA).late, true, 'after schedule is late');
assert.strictEqual(classifyCheckIn(at('2026-10-23T03:45:00.000Z'), scheduleA).late, true, 'schedule A independently flags late');
assert.strictEqual(classifyCheckIn(at('2026-10-23T03:45:00.000Z'), scheduleB).late, false, 'schedule B has a later configured start');
assert.strictEqual(classifyCheckIn(at('2026-10-23T03:39:00.000Z'), { ...scheduleA, gracePeriodMinutes: 10 }).late, false, 'configured grace is honored');
assert.strictEqual(classifyCheckIn(at('2026-10-23T03:40:00.000Z'), { ...scheduleA, gracePeriodMinutes: 10 }).late, false, 'grace boundary is inclusive');
assert.strictEqual(classifyCheckIn(at('2026-10-23T03:41:00.000Z'), { ...scheduleA, gracePeriodMinutes: 10 }).late, true, 'after grace is late');
assert.strictEqual(classifyCheckIn(at('2026-10-23T03:30:00.000Z'), null).scheduleConfigured, false, 'missing schedule is safely unclassified');
assert.strictEqual(getDateKey(at('2026-10-22T19:00:00.000Z'), 'Asia/Kolkata'), '2026-10-23', 'local date handles UTC date boundary');
assert.strictEqual(getUtcDateForKey('2026-10-23').toISOString(), '2026-10-23T00:00:00.000Z', 'local workday key is persisted consistently');
assert.strictEqual(isAttendanceForCurrentWorkday({ date: getUtcDateForKey('2026-10-23'), scheduleTimeZone: 'Asia/Kolkata' }, at('2026-10-23T10:00:00.000Z')), true, 'current scheduled local workday is included');
assert.strictEqual(isAttendanceForCurrentWorkday({ date: getUtcDateForKey('2026-10-22'), scheduleTimeZone: 'Asia/Kolkata' }, at('2026-10-23T10:00:00.000Z')), false, 'prior scheduled workday is excluded');
assert.strictEqual(isAttendanceForCurrentWorkday({ date: getUtcDateForKey('2026-10-23') }, at('2026-10-23T18:30:00.000Z')), true, 'unconfigured legacy rows use the UTC workday');

console.log('Attendance schedule unit checks passed (14 assertions).');
