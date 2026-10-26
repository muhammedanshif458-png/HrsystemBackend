process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'dedicated-attendance-test-secret-at-least-32-chars';
process.env.JWT_REFRESH_SECRET = 'dedicated-attendance-refresh-test-secret-at-least-32-chars';

const assert = require('assert');
const http = require('http');
const mongoose = require('mongoose');
const { app } = require('../server');
const { connectTestDatabase } = require('./testDatabase');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const DepartmentSchedule = require('../models/DepartmentSchedule');
const staffService = require('../services/staffService');
const hrService = require('../services/hrService');
const { generateAccessToken } = require('../utils/jwt');
const { getDateKey, getLocalParts } = require('../utils/attendanceSchedule');

const request = (server, method, path, token, body) => new Promise((resolve, reject) => {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const req = http.request({
    hostname: '127.0.0.1', port: server.address().port, method, path,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
    }
  }, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
  });
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
});

const localTimeToUtc = (dateKey, timeZone, hour, minute) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = new Date(targetAsUtc);
  for (let i = 0; i < 3; i += 1) {
    const local = getLocalParts(candidate, timeZone);
    const representedAsUtc = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), Number(local.hour), Number(local.minute));
    candidate = new Date(targetAsUtc - (representedAsUtc - candidate.getTime()));
  }
  return candidate;
};

const createIdentity = async (role, label, department = null) => {
  const email = `${label.toLowerCase()}@test.co`;
  const user = await User.create({ firstName: label, lastName: 'Test', email, password: 'TestPass123!', role, isActive: true });
  let employee = null;
  if (department) {
    employee = await Employee.create({
      employeeId: `T${label.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9)}`,
      user: user._id, firstName: label, lastName: 'Test', email,
      department, designation: 'Test Employee', status: 'ACTIVE'
    });
  }
  return { user, employee, token: generateAccessToken(user) };
};

const run = async () => {
  let mongod;
  let server;
  try {
    ({ mongod } = await connectTestDatabase());
    const hr = await createIdentity('HR', 'HrAdmin');
    const superAdmin = await createIdentity('SUPER_ADMIN', 'SuperAdmin');
    const staffA = [
      await createIdentity('STAFF', 'AlphaBefore', 'Alpha Department'),
      await createIdentity('STAFF', 'AlphaExact', 'Alpha Department'),
      await createIdentity('STAFF', 'AlphaAfter', 'Alpha Department'),
      await createIdentity('STAFF', 'AlphaGrace', 'Alpha Department'),
      await createIdentity('STAFF', 'AlphaAbsent', 'Alpha Department'),
      await createIdentity('STAFF', 'BetaAfter', 'Beta Department'),
      await createIdentity('STAFF', 'NoSchedule', 'Unconfigured Department')
    ];
    const techRegression = await createIdentity('STAFF', 'TechScheduleRegression', 'Tech');

    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    const setAlpha = await request(server, 'PUT', '/api/hr/departments/Alpha%20Department/schedule', hr.token, {
      checkInTime: '09:00', timeZone: 'Asia/Kolkata', gracePeriodMinutes: 0
    });
    assert.strictEqual(setAlpha.status, 200, 'HR saves Alpha schedule');
    const setBeta = await request(server, 'PUT', '/api/hr/departments/Beta%20Department/schedule', hr.token, {
      checkInTime: '10:00', timeZone: 'Asia/Kolkata', gracePeriodMinutes: 0
    });
    assert.strictEqual(setBeta.status, 200, 'HR saves Beta schedule');
    // Synthetic test fixture only: the development database has no approved Tech schedule.
    assert.strictEqual((await request(server, 'PUT', '/api/hr/departments/Tech/schedule', hr.token, {
      checkInTime: '10:00', timeZone: 'Asia/Kolkata', gracePeriodMinutes: 0
    })).status, 200, 'Tech regression schedule is persisted through the HR API');
    const saved = await request(server, 'GET', '/api/hr/departments/Alpha%20Department/schedule', hr.token);
    assert.strictEqual(saved.status, 200, 'HR retrieves configured schedule');
    assert.strictEqual(saved.body.data.checkInTime, '09:00');
    assert.strictEqual(saved.body.data.timeZone, 'Asia/Kolkata');
    assert.strictEqual((await request(server, 'GET', '/api/hr/departments/Alpha%20Department/schedule', superAdmin.token)).status, 200, 'Super Admin can retrieve department schedule');

    for (const [department, body] of [
      ['missing-department', { checkInTime: '09:00', timeZone: 'Asia/Kolkata', gracePeriodMinutes: 0 }],
      ['Alpha Department', { checkInTime: '25:00', timeZone: 'Asia/Kolkata', gracePeriodMinutes: 0 }],
      ['Alpha Department', { checkInTime: '09:00', timeZone: 'Mars/Olympus', gracePeriodMinutes: 0 }],
      ['Alpha Department', { checkInTime: '09:00', timeZone: 'Asia/Kolkata', gracePeriodMinutes: -1 }],
      ['Alpha Department', { checkInTime: '09:00', timeZone: 'Asia/Kolkata', gracePeriodMinutes: '5' }]
    ]) {
      const result = await request(server, 'PUT', `/api/hr/departments/${encodeURIComponent(department)}/schedule`, hr.token, body);
      assert([400, 404].includes(result.status), `invalid schedule rejected (${department}, ${JSON.stringify(body)})`);
    }
    assert.strictEqual((await request(server, 'PUT', '/api/hr/departments/Alpha%20Department/schedule', null, { checkInTime: '09:00', timeZone: 'Asia/Kolkata' })).status, 401, 'unauthenticated schedule update rejected');
    assert.strictEqual((await request(server, 'PUT', '/api/hr/departments/Alpha%20Department/schedule', staffA[0].token, { checkInTime: '09:00', timeZone: 'Asia/Kolkata' })).status, 403, 'staff schedule update rejected');
    assert.strictEqual((await request(server, 'GET', '/api/hr/dashboard', superAdmin.token)).status, 200, 'Super Admin is authorized for HR dashboard');
    assert.strictEqual((await request(server, 'GET', '/api/hr/dashboard', staffA[0].token)).status, 403, 'staff dashboard access rejected');

    const tz = 'Asia/Kolkata';
    const today = getDateKey(new Date(), tz);
    const times = [
      localTimeToUtc(today, tz, 8, 59),
      localTimeToUtc(today, tz, 9, 0),
      localTimeToUtc(today, tz, 9, 1)
    ];
    for (let i = 0; i < 3; i += 1) await staffService.checkIn(staffA[i].user, '', times[i]);
    // Check-in 5 minutes after schedule remains within the explicit 10-minute grace period.
    await DepartmentSchedule.updateOne({ department: 'Alpha Department' }, { $set: { gracePeriodMinutes: 10 } });
    await staffService.checkIn(staffA[3].user, '', localTimeToUtc(today, tz, 9, 5));
    // Different department schedule gives this employee a distinct threshold.
    await staffService.checkIn(staffA[5].user, '', localTimeToUtc(today, tz, 10, 1));
    // Regression for the reported class: a 12:58 local check-in with a 10:00 Tech schedule.
    const techAt1258 = await staffService.checkIn(techRegression.user, '', localTimeToUtc(today, tz, 12, 58));
    assert.strictEqual(techAt1258.late, true, '12:58 local Tech check-in is late against its 10:00 schedule');
    assert.strictEqual(techAt1258.status, 'PRESENT', 'late flag does not replace the established attendance status');
    const unconfigured = await staffService.checkIn(staffA[6].user, '', localTimeToUtc(today, tz, 11, 0));

    const alphaRows = await Attendance.find({ employee: { $in: staffA.slice(0, 4).map(x => x.employee._id) } }).sort({ checkIn: 1 }).lean();
    assert.deepStrictEqual(alphaRows.map(r => r.late), [false, false, true, false], 'before, exact, after, and grace behavior persisted');
    assert.strictEqual(unconfigured.scheduleConfigured, false, 'missing schedule is recorded as unconfigured');
    assert.strictEqual(unconfigured.late, false, 'missing schedule does not infer late');
    assert.strictEqual(await Attendance.countDocuments({ employee: staffA[4].employee._id }), 0, 'employee without check-in has no late record');

    const boundary = new Date('2026-01-01T00:30:00.000Z');
    const boundaryEmployee = await createIdentity('STAFF', 'Boundary', 'Boundary Department');
    await request(server, 'PUT', '/api/hr/departments/Boundary%20Department/schedule', hr.token, {
      checkInTime: '09:00', timeZone: 'America/Los_Angeles', gracePeriodMinutes: 0
    });
    const boundaryAttendance = await staffService.checkIn(boundaryEmployee.user, '', boundary);
    assert.strictEqual(boundaryAttendance.date.toISOString(), '2025-12-31T00:00:00.000Z', 'local workday boundary is stored under local date');
    assert.strictEqual(boundaryAttendance.late, true, 'historical boundary fixture is late under its saved schedule');

    const lateRows = await request(server, 'GET', '/api/hr/attendance?status=LATE', hr.token);
    assert.strictEqual(lateRows.status, 200);
    assert.strictEqual(lateRows.body.data.length, 3, 'LATE filter returns only checked-in late records');
    assert(!lateRows.body.data.some(row => row.employee._id === boundaryEmployee.employee._id.toString()), 'LATE filter excludes historical workdays');
    const alphaLate = await request(server, 'GET', '/api/hr/attendance?department=Alpha%20Department&status=LATE', hr.token);
    assert.strictEqual(alphaLate.body.data.length, 1, 'department filter returns Alpha late row');
    assert(alphaLate.body.data[0].employee.department === 'Alpha Department');
    const betaLate = await request(server, 'GET', '/api/hr/attendance?department=Beta%20Department&status=LATE', hr.token);
    assert.strictEqual(betaLate.body.data.length, 1, 'different department threshold classifies Beta independently');
    const techLate = await request(server, 'GET', '/api/hr/attendance?department=Tech&status=LATE', hr.token);
    assert.strictEqual(techLate.body.data.length, 1, 'Tech department late filter returns the 12:58 regression record');
    assert.strictEqual(techLate.body.data[0].scheduledCheckIn, '10:00');
    assert.strictEqual(techLate.body.data[0].scheduleTimeZone, 'Asia/Kolkata');

    // Dashboard count is checked against late records whose saved workday is today's local date.
    const expectedTodayLate = await Attendance.countDocuments({ late: true, checkIn: { $ne: null }, date: new Date(`${today}T00:00:00.000Z`) });
    const dashboard = await hrService.getDashboardStats();
    assert.strictEqual(dashboard.lateArrivals, expectedTodayLate, 'dashboard count matches underlying dated late records');
    assert.strictEqual(dashboard.lateArrivals, 3, 'dashboard excludes grace, unconfigured, absent, and historical boundary records');
    assert.strictEqual(dashboard.lateArrivals, lateRows.body.data.length, 'dashboard count and current-workday LATE list agree');
    const dashboardResponse = await request(server, 'GET', '/api/hr/dashboard', hr.token);
    assert.strictEqual(dashboardResponse.status, 200, 'authenticated HR dashboard API responds');
    assert.strictEqual(dashboardResponse.body.data.lateArrivals, 3, 'dashboard API envelope exposes numeric late-arrival count');

    console.log('Attendance integration checks passed (database-backed schedule, check-in, filtering, dashboard, validation, and authorization).');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
};

run().catch(error => { console.error(error); process.exitCode = 1; });
