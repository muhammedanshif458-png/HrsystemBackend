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

    console.log('--- TEST 1: STAFF + OFFICE + no location (omitted & null) -> Success 200 ---');
    // 1a. location omitted
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
    assert.strictEqual(officeHistory1.latitude, null);
    assert.strictEqual(officeHistory1.longitude, null);

    // 1b. location explicit null
    const officeNullLoc = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'OFFICE',
      location: null
    });
    assert.strictEqual(officeNullLoc.status, 200, 'OFFICE login with location=null must succeed');
    const officeHistory2 = await StaffLoginHistory.findOne({ employeeId: employee._id }).sort({ loginAt: -1 });
    assert.strictEqual(officeHistory2.locationStatus, 'NOT_PROVIDED');

    console.log('--- TEST 2: STAFF + OFFICE + valid location -> Success 200, location captured ---');
    const officeValidLoc = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'OFFICE',
      location: validLocation
    });
    assert.strictEqual(officeValidLoc.status, 200, 'OFFICE login with valid location must succeed');
    const officeHistory3 = await StaffLoginHistory.findOne({ employeeId: employee._id }).sort({ loginAt: -1 });
    assert.strictEqual(officeHistory3.workMode, 'OFFICE');
    assert.strictEqual(officeHistory3.locationStatus, 'CAPTURED');
    assert.strictEqual(officeHistory3.latitude, validLocation.latitude);
    assert.strictEqual(officeHistory3.longitude, validLocation.longitude);

    console.log('--- TEST 3: STAFF + WORK_FROM_HOME + valid location -> Success 200, location captured ---');
    const wfhValidLoc = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'WORK_FROM_HOME',
      location: validLocation
    });
    assert.strictEqual(wfhValidLoc.status, 200, 'WORK_FROM_HOME login with valid location must succeed');
    assert.strictEqual(wfhValidLoc.body.data.workMode, 'WORK_FROM_HOME');
    const wfhHistory1 = await StaffLoginHistory.findOne({ employeeId: employee._id }).sort({ loginAt: -1 });
    assert.strictEqual(wfhHistory1.workMode, 'WORK_FROM_HOME');
    assert.strictEqual(wfhHistory1.locationStatus, 'CAPTURED');
    assert.strictEqual(wfhHistory1.latitude, validLocation.latitude);
    assert.strictEqual(wfhHistory1.longitude, validLocation.longitude);

    console.log('--- TEST 4: STAFF + WORK_FROM_HOME + no location -> HTTP 400 ---');
    // 4a. location omitted
    const wfhNoLoc = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'WORK_FROM_HOME'
    });
    assert.strictEqual(wfhNoLoc.status, 400, 'WORK_FROM_HOME login without location must return HTTP 400');
    assert.strictEqual(wfhNoLoc.body.success, false);

    // 4b. location null
    const wfhNullLoc = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'WORK_FROM_HOME',
      location: null
    });
    assert.strictEqual(wfhNullLoc.status, 400, 'WORK_FROM_HOME login with location=null must return HTTP 400');
    assert.strictEqual(wfhNullLoc.body.success, false);

    console.log('--- TEST 5: STAFF + WORK_FROM_HOME + invalid location -> validation failure (422) ---');
    // 5a. Out-of-range latitude (> 90)
    const invalidLat = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'WORK_FROM_HOME',
      location: { ...validLocation, latitude: 91.5 }
    });
    assert.strictEqual(invalidLat.status, 422, 'Latitude > 90 must trigger validation failure 422');
    assert.strictEqual(invalidLat.body.success, false);
    // Ensure coordinates are not exposed in validation errors
    const errorStringLat = JSON.stringify(invalidLat.body);
    assert(!errorStringLat.includes('91.5'), 'Coordinates must not be echoed in validation error responses');

    // 5b. Out-of-range longitude (> 180)
    const invalidLng = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'WORK_FROM_HOME',
      location: { ...validLocation, longitude: -185 }
    });
    assert.strictEqual(invalidLng.status, 422, 'Longitude < -180 must trigger validation failure 422');
    const errorStringLng = JSON.stringify(invalidLng.body);
    assert(!errorStringLng.includes('-185'), 'Coordinates must not be echoed in validation error responses');

    // 5c. Negative accuracy (< 0)
    const invalidAcc = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'WORK_FROM_HOME',
      location: { ...validLocation, accuracy: -3.5 }
    });
    assert.strictEqual(invalidAcc.status, 422, 'Negative accuracy must trigger validation failure 422');
    const errorStringAcc = JSON.stringify(invalidAcc.body);
    assert(!errorStringAcc.includes('-3.5'), 'Accuracy value must not be echoed in validation error responses');

    // 5d. Non-ISO 8601 capturedAt
    const invalidDate = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'WORK_FROM_HOME',
      location: { ...validLocation, capturedAt: 'invalid-date-string' }
    });
    assert.strictEqual(invalidDate.status, 422, 'Non-ISO 8601 date must trigger validation failure 422');

    console.log('--- TEST 6: Non-STAFF accounts are NOT blocked by staff location policy ---');
    // HR login without location
    const hrLoginNoLoc = await request(server, 'POST', '/api/auth/login', {
      email: hr.email,
      password: 'TestPassword123!'
    });
    assert.strictEqual(hrLoginNoLoc.status, 200, 'HR login without location must succeed');

    // HR login with WORK_FROM_HOME and no location
    const hrWfhNoLoc = await request(server, 'POST', '/api/auth/login', {
      email: hr.email,
      password: 'TestPassword123!',
      workMode: 'WORK_FROM_HOME'
    });
    assert.strictEqual(hrWfhNoLoc.status, 200, 'HR login with WORK_FROM_HOME and no location must succeed');

    // SUPER_ADMIN login without location
    const superAdminLogin = await request(server, 'POST', '/api/auth/login', {
      email: superAdmin.email,
      password: 'TestPassword123!'
    });
    assert.strictEqual(superAdminLogin.status, 200, 'SUPER_ADMIN login without location must succeed');

    console.log('--- TEST 7: STAFF_LOGIN_REQUIRE_LOCATION config behavior & compatibility ---');
    // Set STAFF_LOGIN_REQUIRE_LOCATION = true
    env.staffLoginRequireLocation = true;

    // 7a. Non-STAFF is STILL not blocked when config is true
    const hrWithConfig = await request(server, 'POST', '/api/auth/login', {
      email: hr.email,
      password: 'TestPassword123!'
    });
    assert.strictEqual(hrWithConfig.status, 200, 'HR login without location must succeed even when config is true');

    const superAdminWithConfig = await request(server, 'POST', '/api/auth/login', {
      email: superAdmin.email,
      password: 'TestPassword123!'
    });
    assert.strictEqual(superAdminWithConfig.status, 200, 'SUPER_ADMIN login must succeed even when config is true');

    // 7b. STAFF + OFFICE + no location is STILL allowed when config is true (mode policy takes precedence)
    const officeWithConfig = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'OFFICE'
    });
    assert.strictEqual(officeWithConfig.status, 200, 'STAFF OFFICE login without location must succeed even when config is true');

    // 7c. STAFF legacy (no workMode) + no location is rejected with 400 when config is true
    const legacyBlocked = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!'
    });
    assert.strictEqual(legacyBlocked.status, 400, 'STAFF legacy login without location must be rejected when config is true');

    // 7d. Reset config to false: legacy login without location succeeds
    env.staffLoginRequireLocation = false;
    const legacyAllowed = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!'
    });
    assert.strictEqual(legacyAllowed.status, 200, 'STAFF legacy login without location must succeed when config is false');
    const legacyHistory = await StaffLoginHistory.findOne({ employeeId: employee._id }).sort({ loginAt: -1 });
    assert.strictEqual(legacyHistory.locationStatus, 'NOT_PROVIDED');

    // 7e. Even when config is false, WORK_FROM_HOME without location is STILL rejected
    const wfhStillRejected = await request(server, 'POST', '/api/auth/login', {
      email: staff.email,
      password: 'TestPassword123!',
      workMode: 'WORK_FROM_HOME'
    });
    assert.strictEqual(wfhStillRejected.status, 400, 'WORK_FROM_HOME without location must be rejected even when config is false');

    console.log('\nAll StaffHub login location policy verification checks passed successfully!');
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

