const http = require('http');
const assert = require('assert');
const mongoose = require('mongoose');
const env = require('../config/env');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const { app } = require('../server');

let server;
let serverPort;

function makeRequest(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const reqHeaders = { ...headers };
    let postData = null;

    if (body) {
      postData = typeof body === 'string' ? body : JSON.stringify(body);
      if (!reqHeaders['Content-Type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: serverPort,
        path,
        method,
        headers: reqHeaders
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(rawData);
          } catch {
            parsed = rawData;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed
          });
        });
      }
    );

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function pass(msg) {
  console.log(`  [PASS] ${msg}`);
}

async function run() {
  console.log('\n================================================================');
  console.log('   VERIFY CHECKED-OUT ATTENDANCE ENDPOINTS FOR HR DASHBOARD    ');
  console.log('================================================================\n');

  const testDbUri = 'mongodb://127.0.0.1:27017/hr_management_checked_out_test';
  await mongoose.connect(testDbUri);
  console.log('Connected to test DB:', mongoose.connection.name);
  await mongoose.connection.db.dropDatabase();

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  serverPort = server.address().port;
  console.log('Test HTTP server listening on port', serverPort);

  try {
    // 1. Seed HR user and staff user
    const hrUser = new User({
      firstName: 'HR',
      lastName: 'Manager',
      email: 'hr.attendance@example.com',
      password: 'password123',
      role: 'HR',
      isActive: true
    });
    await hrUser.save();

    const staffUser = new User({
      firstName: 'Staff',
      lastName: 'Member',
      email: 'staff.member@example.com',
      password: 'password123',
      role: 'STAFF',
      isActive: true
    });
    await staffUser.save();

    // Authenticate HR
    const hrLogin = await makeRequest('POST', '/api/auth/login', {}, { email: 'hr.attendance@example.com', password: 'password123' });
    assert.strictEqual(hrLogin.statusCode, 200);
    const hrToken = hrLogin.body.data.token;
    const hrAuth = { Authorization: `Bearer ${hrToken}` };

    // Authenticate Staff
    const staffLogin = await makeRequest('POST', '/api/auth/login', {}, { email: 'staff.member@example.com', password: 'password123' });
    assert.strictEqual(staffLogin.statusCode, 200);
    const staffToken = staffLogin.body.data.token;
    const staffAuth = { Authorization: `Bearer ${staffToken}` };

    pass('HR and Staff users authenticated successfully');

    // 2. Test Access Control
    // Unauthenticated
    const unauthRes = await makeRequest('GET', '/api/hr/attendance/checked-out');
    assert.strictEqual(unauthRes.statusCode, 401);
    pass('Unauthenticated request rejected with 401');

    // Staff access (RBAC)
    const staffRes = await makeRequest('GET', '/api/hr/attendance/checked-out', staffAuth);
    assert.strictEqual(staffRes.statusCode, 403);
    pass('Staff request rejected with 403 Forbidden');

    // HR access initially (0 checked out)
    const hrResInit = await makeRequest('GET', '/api/hr/attendance/checked-out', hrAuth);
    assert.strictEqual(hrResInit.statusCode, 200);
    assert.strictEqual(hrResInit.body.success, true);
    assert.strictEqual(hrResInit.body.count, 0);
    assert.strictEqual(hrResInit.body.data.count, 0);
    assert.strictEqual(hrResInit.body.data.checkedOutCount, 0);
    pass('Initial GET /api/hr/attendance/checked-out returns count = 0 with exact JSON structure');

    // Also check alias /api/hr/attendance/checked-out/count
    const hrResAlias = await makeRequest('GET', '/api/hr/attendance/checked-out/count', hrAuth);
    assert.strictEqual(hrResAlias.statusCode, 200);
    assert.strictEqual(hrResAlias.body.count, 0);
    assert.strictEqual(hrResAlias.body.data.checkedOutCount, 0);
    pass('Alias GET /api/hr/attendance/checked-out/count returns identical structure and 0 count');

    // 3. Seed active employees & attendance records
    const emp1 = new Employee({
      user: new mongoose.Types.ObjectId(),
      employeeId: 'EMP001',
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@example.com',
      department: 'Tech',
      designation: 'Software Engineer',
      status: 'ACTIVE'
    });
    await emp1.save();

    const emp2 = new Employee({
      user: new mongoose.Types.ObjectId(),
      employeeId: 'EMP002',
      firstName: 'Bob',
      lastName: 'Jones',
      email: 'bob@example.com',
      department: 'Tech',
      designation: 'QA Engineer',
      status: 'ACTIVE'
    });
    await emp2.save();

    const emp3 = new Employee({
      user: new mongoose.Types.ObjectId(),
      employeeId: 'EMP003',
      firstName: 'Charlie',
      lastName: 'Brown',
      email: 'charlie@example.com',
      department: 'Telecalling',
      designation: 'Telecaller',
      status: 'ACTIVE'
    });
    await emp3.save();

    const inactiveEmp = new Employee({
      user: new mongoose.Types.ObjectId(),
      employeeId: 'EMP004',
      firstName: 'Diana',
      lastName: 'Prince',
      email: 'diana@example.com',
      department: 'Tech',
      designation: 'Designer',
      status: 'INACTIVE'
    });
    await inactiveEmp.save();

    const today = new Date();

    // Emp 1: Checked in and CHECKED OUT today
    await Attendance.create({
      employee: emp1._id,
      date: today,
      checkIn: new Date(today.getTime() - 8 * 3600000),
      checkOut: new Date(today.getTime() - 1 * 3600000),
      status: 'PRESENT'
    });

    // Emp 2: Checked in but NOT checked out yet
    await Attendance.create({
      employee: emp2._id,
      date: today,
      checkIn: new Date(today.getTime() - 4 * 3600000),
      checkOut: null,
      status: 'PRESENT'
    });

    // Emp 3: Raw document with legacy/alternate status 'Checked Out'
    await mongoose.connection.collection('attendances').insertOne({
      employee: emp3._id,
      date: today,
      checkIn: new Date(today.getTime() - 6 * 3600000),
      checkOut: new Date(today.getTime() - 1 * 3600000),
      status: 'Checked Out'
    });

    // Inactive Emp: Checked out, but should not be counted under active staff dashboard
    await Attendance.create({
      employee: inactiveEmp._id,
      date: today,
      checkIn: new Date(today.getTime() - 7 * 3600000),
      checkOut: new Date(today.getTime() - 2 * 3600000),
      status: 'PRESENT'
    });

    // 4. Test Checked-out count with populated attendance records
    const resAfterCheckOut = await makeRequest('GET', '/api/hr/attendance/checked-out', hrAuth);
    assert.strictEqual(resAfterCheckOut.statusCode, 200);
    // emp1 (checkOut date set) + emp3 (status: 'Checked Out') = 2 active employees checked out
    assert.strictEqual(resAfterCheckOut.body.count, 2, 'Must count exactly 2 checked out active employees');
    assert.strictEqual(resAfterCheckOut.body.data.count, 2);
    assert.strictEqual(resAfterCheckOut.body.data.checkedOutCount, 2);
    pass('GET /api/hr/attendance/checked-out returns 2 (Emp 1 with checkOut date + Emp 3 with Checked Out status)');

    // 5. Test Deduplication: Emp 1 has multiple check-outs across timestamps on same day
    await mongoose.connection.collection('attendances').insertOne({
      employee: emp1._id,
      date: new Date(today.getTime() + 1000),
      checkIn: new Date(today.getTime() - 30 * 60000),
      checkOut: new Date(),
      status: 'PRESENT'
    });
    const resDedup = await makeRequest('GET', '/api/hr/attendance/checked-out', hrAuth);
    assert.strictEqual(resDedup.body.count, 2, 'Emp 1 with multiple records must only be counted once');
    pass('Deduplication verified: Multiple check-outs for same employee counted once');

    // 6. Test specific date query param (?date=YYYY-MM-DD)
    const yesterday = new Date(Date.now() - 24 * 3600000);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    await Attendance.create({
      employee: emp2._id,
      date: yesterday,
      checkIn: new Date(yesterday.getTime() - 8 * 3600000),
      checkOut: new Date(yesterday.getTime() - 1 * 3600000),
      status: 'PRESENT'
    });

    const resYesterday = await makeRequest('GET', `/api/hr/attendance/checked-out?date=${yesterdayStr}`, hrAuth);
    assert.strictEqual(resYesterday.statusCode, 200);
    assert.strictEqual(resYesterday.body.count, 1, 'Yesterday should have exactly 1 checked out employee');
    pass(`Querying ?date=${yesterdayStr} correctly isolates checked-out count to 1`);

    // 7. Verify /api/hr/attendance/:employeeId is NOT shadowed by /attendance/checked-out
    const resEmpDetail = await makeRequest('GET', `/api/hr/attendance/${emp1._id}`, hrAuth);
    assert.strictEqual(resEmpDetail.statusCode, 200, 'GET /api/hr/attendance/:employeeId must return 200');
    assert.strictEqual(resEmpDetail.body.success, true);
    assert.ok(Array.isArray(resEmpDetail.body.data), 'Returns attendance array for employee');
    pass('/api/hr/attendance/:employeeId continues to work and is not shadowed by /attendance/checked-out');

    console.log('\n================================================================');
    console.log('   ALL CHECKED-OUT ATTENDANCE TESTS PASSED (100%)');
    console.log('================================================================\n');

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error('\n[FATAL TEST RUNNER ERROR]:', err);
  process.exit(1);
});
