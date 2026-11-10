/**
 * Verification Test Suite: HR Dashboard API Connection, CORS & Super Admin Authorization
 *
 * Verifies:
 * 1. Backend health endpoint (GET /api/health) returns 200.
 * 2. CORS preflight (OPTIONS /api/hr/dashboard) from Flutter Web (http://localhost:60895) returns 204 with credentials & allow-headers.
 * 3. CORS preflight from 127.0.0.1, localhost, and other Flutter Web development ports.
 * 4. Dashboard API without JWT returns 401 Unauthorized.
 * 5. Dashboard API with invalid JWT returns 401 Unauthorized.
 * 6. Dashboard API with STAFF JWT returns 403 Forbidden.
 * 7. Dashboard API with HR JWT returns 200 OK.
 * 8. Dashboard API with SUPER_ADMIN JWT returns 200 OK with valid metrics schema.
 * 9. CORS response headers present on actual GET responses.
 * 10. Database connection lifecycle stability.
 */

const http = require('http');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { app } = require('../server');
const User = require('../models/User');
const Employee = require('../models/Employee');
const { generateAccessToken } = require('../utils/jwt');

const TEST_DB_URI = 'mongodb://127.0.0.1:27017/hr_management_test';

let server;
let baseUrl;
let testPort;

function assert(condition, message) {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}

function requestRaw(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json,
          text: data
        });
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function run() {
  console.log('\n================================================================');
  console.log('   HR DASHBOARD API CONNECTION & CORS VERIFICATION SUITE       ');
  console.log('================================================================\n');

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(TEST_DB_URI);
  console.log(`Connected to test DB: ${TEST_DB_URI}`);

  await User.deleteMany({});
  await Employee.deleteMany({});
  console.log('Cleaned test database collections.\n');

  server = http.createServer(app);
  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      testPort = server.address().port;
      baseUrl = `http://127.0.0.1:${testPort}`;
      console.log(`Test HTTP server listening on port ${testPort}\n`);
      resolve();
    });
  });

  // Seed Users: Super Admin, HR, and Staff
  const saUser = new User({
    firstName: 'Super',
    lastName: 'Admin',
    email: 'superadmin.dash@company.com',
    password: 'Password123!',
    role: 'SUPER_ADMIN',
    isActive: true
  });
  await saUser.save();

  const hrUser = new User({
    firstName: 'HR',
    lastName: 'Manager',
    email: 'hr.dash@company.com',
    password: 'Password123!',
    role: 'HR',
    isActive: true
  });
  await hrUser.save();

  const staffUser = new User({
    firstName: 'Staff',
    lastName: 'Member',
    email: 'staff.dash@company.com',
    password: 'Password123!',
    role: 'STAFF',
    isActive: true
  });
  await staffUser.save();

  const saToken = generateAccessToken(saUser);
  const hrToken = generateAccessToken(hrUser);
  const staffToken = generateAccessToken(staffUser);

  // --- TEST 1: Health endpoint ---
  console.log('--- TEST 1: Backend Health Check ---');
  const healthRes = await requestRaw({
    hostname: '127.0.0.1',
    port: testPort,
    path: '/api/health',
    method: 'GET'
  });
  assert(healthRes.status === 200, 'GET /api/health returns HTTP 200 OK');
  assert(healthRes.body?.success === true, 'Health check response contains success: true');

  // --- TEST 2: CORS Preflight from Flutter Web (localhost:60895) ---
  console.log('\n--- TEST 2: CORS Preflight for Flutter Web (http://localhost:60895) ---');
  const preflightRes = await requestRaw({
    hostname: '127.0.0.1',
    port: testPort,
    path: '/api/hr/dashboard',
    method: 'OPTIONS',
    headers: {
      'Origin': 'http://localhost:60895',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type,cache-control,x-requested-with'
    }
  });
  assert(preflightRes.status === 204, 'OPTIONS preflight returns HTTP 204 No Content');
  assert(preflightRes.headers['access-control-allow-origin'] === 'http://localhost:60895',
    'access-control-allow-origin matches Flutter Web origin (http://localhost:60895)');
  assert(preflightRes.headers['access-control-allow-credentials'] === 'true',
    'access-control-allow-credentials is true');
  assert(Boolean(preflightRes.headers['access-control-allow-methods']),
    'access-control-allow-methods header is present');
  assert(preflightRes.headers['access-control-allow-methods'].includes('GET'),
    'access-control-allow-methods includes GET');

  // --- TEST 3: CORS Preflight from other local Flutter Web development ports ---
  console.log('\n--- TEST 3: Dynamic Localhost Development Port CORS ---');
  const dynamicPorts = ['http://localhost:50250', 'http://127.0.0.1:51834', 'http://localhost:61234'];
  for (const origin of dynamicPorts) {
    const dynRes = await requestRaw({
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/hr/dashboard',
      method: 'OPTIONS',
      headers: {
        'Origin': origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,content-type'
      }
    });
    assert(dynRes.status === 204, `OPTIONS for ${origin} returns 204`);
    assert(dynRes.headers['access-control-allow-origin'] === origin,
      `access-control-allow-origin strictly matches ${origin}`);
  }

  // --- TEST 4: Unauthorized request without JWT ---
  console.log('\n--- TEST 4: Dashboard API without JWT ---');
  const noAuthRes = await requestRaw({
    hostname: '127.0.0.1',
    port: testPort,
    path: '/api/hr/dashboard',
    method: 'GET',
    headers: { 'Origin': 'http://localhost:60895' }
  });
  assert(noAuthRes.status === 401, 'GET /api/hr/dashboard without JWT returns 401 Unauthorized');
  assert(noAuthRes.body?.success === false, 'success is false');
  assert(noAuthRes.body?.message?.includes('No authorization token provided'),
    'Descriptive authentication error returned');
  assert(noAuthRes.headers['access-control-allow-origin'] === 'http://localhost:60895',
    'CORS header preserved on 401 error response');

  // --- TEST 5: Unauthorized request with invalid JWT ---
  console.log('\n--- TEST 5: Dashboard API with invalid JWT ---');
  const badTokenRes = await requestRaw({
    hostname: '127.0.0.1',
    port: testPort,
    path: '/api/hr/dashboard',
    method: 'GET',
    headers: {
      'Origin': 'http://localhost:60895',
      'Authorization': 'Bearer invalid.bogus.jwt.token'
    }
  });
  assert(badTokenRes.status === 401, 'GET /api/hr/dashboard with invalid JWT returns 401');

  // --- TEST 6: Forbidden request with STAFF role ---
  console.log('\n--- TEST 6: Dashboard API with STAFF role JWT ---');
  const staffRes = await requestRaw({
    hostname: '127.0.0.1',
    port: testPort,
    path: '/api/hr/dashboard',
    method: 'GET',
    headers: {
      'Origin': 'http://localhost:60895',
      'Authorization': `Bearer ${staffToken}`
    }
  });
  assert(staffRes.status === 403, 'GET /api/hr/dashboard with STAFF token returns 403 Forbidden');
  assert(staffRes.headers['access-control-allow-origin'] === 'http://localhost:60895',
    'CORS header preserved on 403 error response');

  // --- TEST 7: Authorized request with HR role JWT ---
  console.log('\n--- TEST 7: Dashboard API with HR role JWT ---');
  const hrRes = await requestRaw({
    hostname: '127.0.0.1',
    port: testPort,
    path: '/api/hr/dashboard',
    method: 'GET',
    headers: {
      'Origin': 'http://localhost:60895',
      'Authorization': `Bearer ${hrToken}`
    }
  });
  assert(hrRes.status === 200, 'GET /api/hr/dashboard with HR token returns 200 OK');
  assert(hrRes.body?.success === true, 'HR request response success is true');

  // --- TEST 8: Authorized request with SUPER_ADMIN role JWT ---
  console.log('\n--- TEST 8: Dashboard API with SUPER_ADMIN role JWT ---');
  const saRes = await requestRaw({
    hostname: '127.0.0.1',
    port: testPort,
    path: '/api/hr/dashboard',
    method: 'GET',
    headers: {
      'Origin': 'http://localhost:60895',
      'Authorization': `Bearer ${saToken}`
    }
  });
  assert(saRes.status === 200, 'GET /api/hr/dashboard with SUPER_ADMIN token returns 200 OK');
  assert(saRes.body?.success === true, 'Super Admin response success is true');
  assert(saRes.headers['access-control-allow-origin'] === 'http://localhost:60895',
    'CORS allow-origin header present on 200 response');
  assert(saRes.headers['access-control-allow-credentials'] === 'true',
    'CORS allow-credentials header present on 200 response');

  // Validate Dashboard metrics structure
  const data = saRes.body?.data;
  assert(data !== null && typeof data === 'object', 'Dashboard response data is an object');
  assert(typeof data.totalEmployees === 'number', 'totalEmployees is a number');
  assert(typeof data.activeEmployees === 'number', 'activeEmployees is a number');
  assert(typeof data.todayPresent === 'number', 'todayPresent is a number');
  assert(typeof data.lateArrivals === 'number', 'lateArrivals is a number');
  assert(typeof data.todayWfh === 'number', 'todayWfh is a number');
  assert(typeof data.pendingLeaves === 'number', 'pendingLeaves is a number');
  assert(typeof data.approvedLeaves === 'number', 'approvedLeaves is a number');
  console.log('  [PASS] Dashboard metrics payload schema verified complete.');

  // --- TEST 9: Date parameter filtering on Dashboard API ---
  console.log('\n--- TEST 9: Dashboard API with specific date query ---');
  const dateRes = await requestRaw({
    hostname: '127.0.0.1',
    port: testPort,
    path: '/api/hr/dashboard?date=2026-11-09',
    method: 'GET',
    headers: {
      'Origin': 'http://localhost:60895',
      'Authorization': `Bearer ${saToken}`
    }
  });
  assert(dateRes.status === 200, 'Dashboard with ?date=2026-11-09 returns 200 OK');
  assert(dateRes.body?.data?.date === '2026-11-09', 'Dashboard returns requested dateKey');

  console.log('\n================================================================');
  console.log('   ALL 16 HR DASHBOARD & CORS CONNECTION TESTS PASSED!          ');
  console.log('================================================================\n');

  await mongoose.disconnect();
  server.close();
  process.exit(0);
}

run().catch(err => {
  console.error('\nVerification failed:', err);
  if (server) server.close();
  if (mongoose.connection) mongoose.disconnect();
  process.exit(1);
});

