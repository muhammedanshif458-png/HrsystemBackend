process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'dedicated-staff-login-test-secret-at-least-32-chars';
process.env.JWT_REFRESH_SECRET = 'dedicated-staff-login-refresh-secret-at-least-32';

const assert = require('assert');
const http = require('http');
const mongoose = require('mongoose');
const { app } = require('../server');
const { connectTestDatabase } = require('./testDatabase');
const User = require('../models/User');
const Employee = require('../models/Employee');
const StaffLoginHistory = require('../models/StaffLoginHistory');
const env = require('../config/env');

const request = (server, method, path, body, token) => new Promise((resolve, reject) => {
  const payload = body ? Buffer.from(JSON.stringify(body)) : null;
  const req = http.request({
    hostname: '127.0.0.1', port: server.address().port, method, path,
    headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  }, res => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
  });
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
});

async function run() {
  let server;
  let mongod;
  const originalPolicy = env.staffLoginRequireLocation;
  try {
    ({ mongod } = await connectTestDatabase());
    const hr = await User.create({ firstName: 'HR', lastName: 'Admin', email: 'hr-login@test.co', password: 'TestPass123!', role: 'HR' });
    const staff = await User.create({ firstName: 'Staff', lastName: 'One', email: 'staff-login@test.co', password: 'TestPass123!', role: 'STAFF' });
    const employee = await Employee.create({ employeeId: 'LOGIN-1', user: staff._id, firstName: 'Staff', lastName: 'One', email: staff.email, department: 'Tech', designation: 'Engineer' });
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    const location = { latitude: 12.9716, longitude: 77.5946, accuracy: 12.5, capturedAt: '2026-10-30T04:00:00.000Z' };
    const office = await request(server, 'POST', '/api/auth/login', { email: staff.email, password: 'TestPass123!', workMode: 'OFFICE', location });
    assert.strictEqual(office.status, 200);
    assert.strictEqual(office.body.data.workMode, 'OFFICE');
    assert(!JSON.stringify(office.body.data.user).includes('latitude'), 'GPS is not exposed in the ordinary login profile response');
    const wfh = await request(server, 'POST', '/api/auth/login', { email: staff.email, password: 'TestPass123!', workMode: 'WORK_FROM_HOME', location });
    assert.strictEqual(wfh.status, 200);
    assert.strictEqual(wfh.body.data.workMode, 'WORK_FROM_HOME');
    assert.strictEqual(await StaffLoginHistory.countDocuments({ employeeId: employee._id }), 2, 'each successful login creates a record');
    const invalid = await request(server, 'POST', '/api/auth/login', { email: staff.email, password: 'TestPass123!', location: { ...location, latitude: 91 } });
    assert.strictEqual(invalid.status, 422, 'out-of-range coordinates are rejected');
    const invalidLongitude = await request(server, 'POST', '/api/auth/login', { email: staff.email, password: 'TestPass123!', location: { ...location, longitude: -181 } });
    assert.strictEqual(invalidLongitude.status, 422, 'out-of-range longitude is rejected');
    const invalidAccuracy = await request(server, 'POST', '/api/auth/login', { email: staff.email, password: 'TestPass123!', location: { ...location, accuracy: -1 } });
    assert.strictEqual(invalidAccuracy.status, 422, 'negative accuracy is rejected');

    env.staffLoginRequireLocation = false;
    const legacy = await request(server, 'POST', '/api/auth/login', { email: staff.email, password: 'TestPass123!' });
    assert.strictEqual(legacy.status, 200, 'legacy email/password login remains supported');
    assert.strictEqual((await StaffLoginHistory.findOne({ employeeId: employee._id }).sort({ loginAt: -1 })).locationStatus, 'NOT_PROVIDED');
    env.staffLoginRequireLocation = true;
    const required = await request(server, 'POST', '/api/auth/login', { email: staff.email, password: 'TestPass123!' });
    assert.strictEqual(required.status, 400, 'configured required-location policy rejects missing location');

    const staffToken = office.body.data.accessToken;
    const denied = await request(server, 'GET', `/api/hr/employees/${employee._id}/login-history`, null, staffToken);
    assert.strictEqual(denied.status, 403, 'staff cannot access precise login history');
    env.staffLoginRequireLocation = false;
    const hrLogin = await request(server, 'POST', '/api/auth/login', { email: hr.email, password: 'TestPass123!' });
    const history = await request(server, 'GET', `/api/hr/employees/${employee._id}/login-history?page=1&limit=10`, null, hrLogin.body.data.accessToken);
    assert.strictEqual(history.status, 200);
    assert(history.body.data.some(record => record.latitude === location.latitude && record.accuracy === location.accuracy));
    console.log('Staff login tracking checks passed (work modes, GPS, multiple sessions, validation, policy, legacy login, and HR access control).');
  } finally {
    env.staffLoginRequireLocation = originalPolicy;
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.readyState) await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
