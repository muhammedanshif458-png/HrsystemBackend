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

async function run() {
  let server;
  let mongod;
  const originalPolicy = env.staffLoginRequireLocation;

  try {
    ({ mongod } = await connectTestDatabase());

    // 1. Seed Accounts
    const hr = await User.create({
      firstName: 'HR',
      lastName: 'Manager',
      email: 'hr-policy-test@test.co',
      password: 'TestPassword123!',
      role: 'HR'
    });

    const superAdmin = await User.create({
      firstName: 'Super',
      lastName: 'Admin',
      email: 'superadmin-policy-test@test.co',
      password: 'TestPassword123!',
      role: 'SUPER_ADMIN'
    });

    const staff = await User.create({
      firstName: 'Staff',
      lastName: 'Member',
      email: 'staff-policy-test@test.co',
      password: 'TestPassword123!',
      role: 'STAFF'
    });

    const employee = await Employee.create({
      employeeId: 'STAFF-LOC-01',
      user: staff._id,
      firstName: 'Staff',
      lastName: 'Member',
      email: staff.email,
      department: 'Tech',
      designation: 'Software Engineer'
    });

    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    const validLocation = {
      latitude: 12.9715987,
      longitude: 77.5945627,
      accuracy: 14.2,
      capturedAt: '2026-11-05T06:00:00.000Z'
    };

    console.log('--- TEST 1: STAFF + OFFICE + no location (omitted) -> Success 200 ---');
    const officeNoLoc = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'OFFICE'
    });
    assert.strictEqual(officeNoLoc.status, 200, 'OFFICE login with omitted location must succeed');
    assert.strictEqual(officeNoLoc.body.data.workMode, 'OFFICE');
    const officeHistory1 = await StaffLoginHistory.findOne({ employeeId: employee._id }).sort({ loginAt: -1 });
    assert.strictEqual(officeHistory1.workMode, 'OFFICE');
    assert.strictEqual(officeHistory1.locationStatus, 'NOT_PROVIDED', 'OFFICE login without location must have NOT_PROVIDED status');
    assert.strictEqual(officeHistory1.latitude, null, 'No fake latitude');
    assert.strictEqual(officeHistory1.longitude, null, 'No fake longitude');
    assert.strictEqual(officeHistory1.accuracy, null, 'No fake accuracy');
    assert.strictEqual(officeHistory1.capturedAt, null, 'No fake capturedAt');

    console.log('--- TEST 2: STAFF + WORK_FROM_HOME + no location (omitted) -> Success 200 ---');
    const wfhNoLoc = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'WORK_FROM_HOME'
    });
    assert.strictEqual(wfhNoLoc.status, 200, 'WORK_FROM_HOME login with omitted location must succeed without GPS');
    assert.strictEqual(wfhNoLoc.body.data.workMode, 'WORK_FROM_HOME');
    const wfhHistory1 = await StaffLoginHistory.findOne({ employeeId: employee._id }).sort({ loginAt: -1 });
    assert.strictEqual(wfhHistory1.workMode, 'WORK_FROM_HOME');
    assert.strictEqual(wfhHistory1.locationStatus, 'NOT_PROVIDED', 'WORK_FROM_HOME login without location must have NOT_PROVIDED status');
    assert.strictEqual(wfhHistory1.latitude, null, 'No fake latitude');
    assert.strictEqual(wfhHistory1.longitude, null, 'No fake longitude');

    console.log('--- TEST 3: STAFF + OFFICE + null location -> Success 200 ---');
    const officeNullLoc = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'OFFICE',
      location: null
    });
    assert.strictEqual(officeNullLoc.status, 200, 'OFFICE login with location=null must succeed');
    const officeHistory2 = await StaffLoginHistory.findOne({ employeeId: employee._id }).sort({ loginAt: -1 });
    assert.strictEqual(officeHistory2.workMode, 'OFFICE');
    assert.strictEqual(officeHistory2.locationStatus, 'NOT_PROVIDED');
    assert.strictEqual(officeHistory2.latitude, null);
    assert.strictEqual(officeHistory2.longitude, null);

    console.log('--- TEST 4: STAFF + WORK_FROM_HOME + null location -> Success 200 ---');
    const wfhNullLoc = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'WORK_FROM_HOME',
      location: null
    });
    assert.strictEqual(wfhNullLoc.status, 200, 'WORK_FROM_HOME login with location=null must succeed without GPS');
    const wfhHistory2 = await StaffLoginHistory.findOne({ employeeId: employee._id }).sort({ loginAt: -1 });
    assert.strictEqual(wfhHistory2.workMode, 'WORK_FROM_HOME');
    assert.strictEqual(wfhHistory2.locationStatus, 'NOT_PROVIDED');
    assert.strictEqual(wfhHistory2.latitude, null);
    assert.strictEqual(wfhHistory2.longitude, null);

    console.log('--- TEST 5: Both modes save correct workMode and NOT_PROVIDED locationStatus ---');
    assert.strictEqual(officeHistory1.workMode, 'OFFICE');
    assert.strictEqual(officeHistory1.locationStatus, 'NOT_PROVIDED');
    assert.strictEqual(wfhHistory1.workMode, 'WORK_FROM_HOME');
    assert.strictEqual(wfhHistory1.locationStatus, 'NOT_PROVIDED');

    console.log('--- TEST 6: Invalid workMode is rejected ---');
    const invalidWorkMode = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'REMOTE_BEACH'
    });
    assert.strictEqual(invalidWorkMode.status, 422, 'Invalid workMode must be rejected by validator with 422');
    assert.strictEqual(invalidWorkMode.body.success, false);

    console.log('--- TEST 7: Legacy clients with valid location remain compatible ---');
    // 7a. OFFICE with valid location
    const officeWithLoc = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'OFFICE',
      location: validLocation
    });
    assert.strictEqual(officeWithLoc.status, 200, 'OFFICE login with valid location succeeds');
    const officeHistoryWithLoc = await StaffLoginHistory.findOne({ employeeId: employee._id }).sort({ loginAt: -1 });
    assert.strictEqual(officeHistoryWithLoc.workMode, 'OFFICE');
    assert.strictEqual(officeHistoryWithLoc.locationStatus, 'CAPTURED');
    assert.strictEqual(officeHistoryWithLoc.latitude, validLocation.latitude);
    assert.strictEqual(officeHistoryWithLoc.longitude, validLocation.longitude);
    assert.strictEqual(officeHistoryWithLoc.accuracy, validLocation.accuracy);

    // 7b. WORK_FROM_HOME with valid location
    const wfhWithLoc = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'WORK_FROM_HOME',
      location: validLocation
    });
    assert.strictEqual(wfhWithLoc.status, 200, 'WORK_FROM_HOME login with valid location succeeds');
    const wfhHistoryWithLoc = await StaffLoginHistory.findOne({ employeeId: employee._id }).sort({ loginAt: -1 });
    assert.strictEqual(wfhHistoryWithLoc.workMode, 'WORK_FROM_HOME');
    assert.strictEqual(wfhHistoryWithLoc.locationStatus, 'CAPTURED');
    assert.strictEqual(wfhHistoryWithLoc.latitude, validLocation.latitude);
    assert.strictEqual(wfhHistoryWithLoc.longitude, validLocation.longitude);

    // 7c. Invalid location fields when supplied are rejected (422) without leaking coordinates
    const invalidLat = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'WORK_FROM_HOME',
      location: { ...validLocation, latitude: 91.5 }
    });
    assert.strictEqual(invalidLat.status, 422, 'Latitude > 90 must trigger validation failure 422');
    assert(!JSON.stringify(invalidLat.body).includes('91.5'), 'Coordinates must not be echoed in validation error responses');

    const invalidAcc = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'OFFICE',
      location: { ...validLocation, accuracy: -5 }
    });
    assert.strictEqual(invalidAcc.status, 422, 'Negative accuracy must trigger validation failure 422');

    console.log('--- TEST 8: Non-STAFF accounts are NOT blocked ---');
    const hrLogin = await request(server, 'POST', '/api/auth/login', {
      email: hr.email,
      password: 'TestPassword123!'
    });
    assert.strictEqual(hrLogin.status, 200, 'HR login without location succeeds');

    const superAdminLogin = await request(server, 'POST', '/api/auth/login', {
      email: superAdmin.email,
      password: 'TestPassword123!'
    });
    assert.strictEqual(superAdminLogin.status, 200, 'SUPER_ADMIN login without location succeeds');

    console.log('--- TEST 9: STAFF_LOGIN_REQUIRE_LOCATION config cannot block OFFICE or WORK_FROM_HOME ---');
    env.staffLoginRequireLocation = true;

    // Both modes must succeed even if config is true
    const officeWithConfigTrue = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'OFFICE'
    });
    assert.strictEqual(officeWithConfigTrue.status, 200, 'OFFICE login must not be blocked when config is true');

    const wfhWithConfigTrue = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'WORK_FROM_HOME'
    });
    assert.strictEqual(wfhWithConfigTrue.status, 200, 'WORK_FROM_HOME login must not be blocked when config is true');

    // Legacy client without workMode is rejected when config is true
    const legacyBlocked = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!'
    });
    assert.strictEqual(legacyBlocked.status, 400, 'Legacy login without workMode is blocked when config is true');

    // When config is false, legacy client succeeds without location
    env.staffLoginRequireLocation = false;
    const legacyAllowed = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!'
    });
    assert.strictEqual(legacyAllowed.status, 200, 'Legacy login without location succeeds when config is false');
    const legacyHistory = await StaffLoginHistory.findOne({ employeeId: employee._id }).sort({ loginAt: -1 });
    assert.strictEqual(legacyHistory.locationStatus, 'NOT_PROVIDED');

    console.log('\nAll StaffHub login policy checks passed successfully (GPS-free login for both OFFICE and WORK_FROM_HOME)!');
  } finally {
    env.staffLoginRequireLocation = originalPolicy;
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.readyState) await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
}

run().catch(error => {
  console.error('Test run failed:', error);
  process.exitCode = 1;
});
