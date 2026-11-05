process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'dedicated-dept-counts-test-secret-at-least-32-chars';
process.env.JWT_REFRESH_SECRET = 'dedicated-dept-counts-refresh-secret-at-least-32';

const assert = require('assert');
const http = require('http');
const mongoose = require('mongoose');
const { app } = require('../server');
const { connectTestDatabase } = require('./testDatabase');
const User = require('../models/User');
const Employee = require('../models/Employee');
const DepartmentSchedule = require('../models/DepartmentSchedule');
const hrService = require('../services/hrService');

const request = (server, method, path, token, body = null) => new Promise((resolve, reject) => {
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
      let parsed = {};
      try {
        parsed = data ? JSON.parse(data) : {};
      } catch (e) {
        parsed = { raw: data };
      }
      resolve({ status: res.statusCode, body: parsed });
    });
  });
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
});

async function run() {
  console.log('\n================================================================');
  console.log('   DEPARTMENT-WISE EMPLOYEE COUNTS & LEADERSHIP TEST SUITE');
  console.log('================================================================\n');

  let server;
  let mongod;

  try {
    ({ mongod } = await connectTestDatabase());

    // 1. Seed HR and Staff Users
    const hrUser = await User.create({
      firstName: 'HR',
      lastName: 'Manager',
      email: 'hr.dept.test@example.com',
      password: 'Password123!',
      role: 'HR'
    });

    const staffUser1 = await User.create({
      firstName: 'Tech',
      lastName: 'ActiveOne',
      email: 'tech.active1@example.com',
      password: 'Password123!',
      role: 'STAFF'
    });

    const staffUser2 = await User.create({
      firstName: 'Tech',
      lastName: 'ActiveTwo',
      email: 'tech.active2@example.com',
      password: 'Password123!',
      role: 'STAFF'
    });

    const staffUser3 = await User.create({
      firstName: 'Tech',
      lastName: 'Inactive',
      email: 'tech.inactive@example.com',
      password: 'Password123!',
      role: 'STAFF'
    });

    const staffUser4 = await User.create({
      firstName: 'Tech',
      lastName: 'Resigned',
      email: 'tech.resigned@example.com',
      password: 'Password123!',
      role: 'STAFF'
    });

    const staffUser5 = await User.create({
      firstName: 'Tech',
      lastName: 'Deleted',
      email: 'tech.deleted@example.com',
      password: 'Password123!',
      role: 'STAFF'
    });

    const teleUser1 = await User.create({
      firstName: 'Tele',
      lastName: 'ActiveOne',
      email: 'tele.active1@example.com',
      password: 'Password123!',
      role: 'STAFF'
    });

    const teleUser2 = await User.create({
      firstName: 'Tele',
      lastName: 'Inactive',
      email: 'tele.inactive@example.com',
      password: 'Password123!',
      role: 'STAFF'
    });

    const otherUser = await User.create({
      firstName: 'Mgt',
      lastName: 'Leader',
      email: 'mgmt.active@example.com',
      password: 'Password123!',
      role: 'STAFF'
    });

    // 2. Seed Employees with distinct departments and statuses
    // Tech: 2 ACTIVE, 1 INACTIVE, 1 RESIGNED, 1 DELETED
    const empTech1 = await Employee.create({
      employeeId: 'TEST-TECH-01',
      user: staffUser1._id,
      firstName: 'Tech',
      lastName: 'ActiveOne',
      email: staffUser1.email,
      department: 'Tech',
      designation: 'Software Engineer',
      status: 'ACTIVE'
    });

    const empTech2 = await Employee.create({
      employeeId: 'TEST-TECH-02',
      user: staffUser2._id,
      firstName: 'Tech',
      lastName: 'ActiveTwo',
      email: staffUser2.email,
      department: 'Tech & Engineering',
      designation: 'QA Engineer',
      status: 'ACTIVE'
    });

    const empTechInactive = await Employee.create({
      employeeId: 'TEST-TECH-03',
      user: staffUser3._id,
      firstName: 'Tech',
      lastName: 'Inactive',
      email: staffUser3.email,
      department: 'Tech',
      designation: 'Backend Dev',
      status: 'INACTIVE'
    });

    const empTechResigned = await Employee.create({
      employeeId: 'TEST-TECH-04',
      user: staffUser4._id,
      firstName: 'Tech',
      lastName: 'Resigned',
      email: staffUser4.email,
      department: 'Tech',
      designation: 'DevOps',
      status: 'RESIGNED',
      resignationDate: new Date()
    });

    const empTechDeleted = await Employee.create({
      employeeId: 'TEST-TECH-05',
      user: staffUser5._id,
      firstName: 'Tech',
      lastName: 'Deleted',
      email: staffUser5.email,
      department: 'Tech',
      designation: 'Frontend Dev',
      status: 'INACTIVE',
      isDeleted: true,
      deletedAt: new Date()
    });

    // Telecalling: 1 ACTIVE, 1 INACTIVE
    const empTele1 = await Employee.create({
      employeeId: 'TEST-TELE-01',
      user: teleUser1._id,
      firstName: 'Tele',
      lastName: 'ActiveOne',
      email: teleUser1.email,
      department: 'Telecalling',
      designation: 'Outreach Agent',
      status: 'ACTIVE'
    });

    const empTeleInactive = await Employee.create({
      employeeId: 'TEST-TELE-02',
      user: teleUser2._id,
      firstName: 'Tele',
      lastName: 'Inactive',
      email: teleUser2.email,
      department: 'Telecalling & Client Relations',
      designation: 'Client Relations',
      status: 'INACTIVE'
    });

    // Other department: Management (must NOT be counted in Tech or Telecalling)
    const empMgmt = await Employee.create({
      employeeId: 'TEST-MGMT-01',
      user: otherUser._id,
      firstName: 'Mgt',
      lastName: 'Leader',
      email: otherUser.email,
      department: 'Management',
      designation: 'Operations Director',
      status: 'ACTIVE'
    });

    // 3. Seed Department Schedules (without assigned leader)
    await DepartmentSchedule.create({
      department: 'TECH',
      departmentDisplay: 'Tech',
      checkInTime: '10:00',
      checkOutTime: '18:00',
      timezone: 'Asia/Kolkata',
      timeZone: 'Asia/Kolkata'
    });

    await DepartmentSchedule.create({
      department: 'TELECALLING',
      departmentDisplay: 'Telecalling',
      checkInTime: '09:00',
      checkOutTime: '18:00',
      timezone: 'Asia/Kolkata',
      timeZone: 'Asia/Kolkata'
    });

    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

    // Authenticate HR
    const loginRes = await request(server, 'POST', '/api/auth/login', null, {
      email: hrUser.email,
      password: 'Password123!'
    });
    assert.strictEqual(loginRes.status, 200, 'HR login must succeed');
    const hrToken = loginRes.body.data.token || loginRes.body.data.accessToken;

    console.log('--- TEST 1: Tech & Engineering member counts match actual Tech employees ---');
    const deptsRes = await request(server, 'GET', '/api/hr/departments', hrToken);
    assert.strictEqual(deptsRes.status, 200, 'GET /api/hr/departments must return 200');
    assert(Array.isArray(deptsRes.body.data), 'Returns data array');

    const techDept = deptsRes.body.data.find(d => d.deptKey === 'tech');
    assert(techDept, 'Tech department exists in response');
    // Tech has: 2 ACTIVE + 1 INACTIVE = 3 totalMembers. Resigned (1) and Deleted (1) are excluded!
    assert.strictEqual(techDept.totalMembers, 3, 'Tech totalMembers must equal 3 (2 active + 1 inactive)');
    assert.strictEqual(techDept.staffCount, 3, 'Tech staffCount alias must equal totalMembers');
    console.log(`  [PASS] Tech totalMembers = ${techDept.totalMembers} (2 active + 1 inactive, excluding deleted and resigned)`);

    console.log('--- TEST 2: Telecalling member counts match actual Telecalling employees ---');
    const teleDept = deptsRes.body.data.find(d => d.deptKey === 'telecalling');
    assert(teleDept, 'Telecalling department exists in response');
    // Telecalling has: 1 ACTIVE + 1 INACTIVE = 2 totalMembers.
    assert.strictEqual(teleDept.totalMembers, 2, 'Telecalling totalMembers must equal 2 (1 active + 1 inactive)');
    assert.strictEqual(teleDept.staffCount, 2, 'Telecalling staffCount alias must equal totalMembers');
    console.log(`  [PASS] Telecalling totalMembers = ${teleDept.totalMembers} (1 active + 1 inactive)`);

    console.log('--- TEST 3: Active Staff count strictly excludes inactive and resigned employees ---');
    assert.strictEqual(techDept.activeStaff, 2, 'Tech activeStaff must equal 2');
    assert.strictEqual(techDept.activeCount, 2, 'Tech activeCount alias must equal activeStaff');
    assert.strictEqual(teleDept.activeStaff, 1, 'Telecalling activeStaff must equal 1');
    assert.strictEqual(teleDept.activeCount, 1, 'Telecalling activeCount alias must equal activeStaff');
    console.log(`  [PASS] Tech activeStaff = ${techDept.activeStaff} (excludes inactive & resigned)`);
    console.log(`  [PASS] Telecalling activeStaff = ${teleDept.activeStaff} (excludes inactive)`);

    console.log('--- TEST 4: An employee is never counted more than once, nor cross-counted into other departments ---');
    const totalCounted = techDept.totalMembers + teleDept.totalMembers;
    // Non-deleted employees in Tech (3) + Telecalling (2) = 5. Management (1) is NOT in Tech or Telecalling.
    assert.strictEqual(totalCounted, 5, 'Sum of Tech and Telecalling counts must equal 5');
    console.log('  [PASS] Mutual exclusivity verified: Management employee was not counted in Tech or Telecalling');

    console.log('--- TEST 5: Unassigned department leader returns null (no hardcoded data) ---');
    assert.strictEqual(techDept.leadName, null, 'Tech leadName must be null when unassigned');
    assert.strictEqual(teleDept.leadName, null, 'Telecalling leadName must be null when unassigned');
    assert(!JSON.stringify(deptsRes.body).includes('Anita Rao'), 'Hardcoded Anita Rao must not be present');
    assert(!JSON.stringify(deptsRes.body).includes('Neha Sharma'), 'Hardcoded Neha Sharma must not be present');
    console.log('  [PASS] No hardcoded leaders: leadName is null');

    console.log('--- TEST 6: Department counts update dynamically when employee department changes ---');
    // Move empTech1 from Tech to Telecalling
    empTech1.department = 'Telecalling';
    await empTech1.save();

    const deptsUpdated = await request(server, 'GET', '/api/hr/departments', hrToken);
    const techAfter = deptsUpdated.body.data.find(d => d.deptKey === 'tech');
    const teleAfter = deptsUpdated.body.data.find(d => d.deptKey === 'telecalling');

    assert.strictEqual(techAfter.totalMembers, 2, 'Tech totalMembers must decrease to 2');
    assert.strictEqual(techAfter.activeStaff, 1, 'Tech activeStaff must decrease to 1');
    assert.strictEqual(teleAfter.totalMembers, 3, 'Telecalling totalMembers must increase to 3');
    assert.strictEqual(teleAfter.activeStaff, 2, 'Telecalling activeStaff must increase to 2');
    console.log('  [PASS] Dynamic updates verified: moving employee updated both departments correctly');

    console.log('--- TEST 7: GET /api/hr/departments/:deptKey returns consistent single department data ---');
    const singleTech = await request(server, 'GET', '/api/hr/departments/tech', hrToken);
    assert.strictEqual(singleTech.status, 200);
    assert.strictEqual(singleTech.body.data.deptKey, 'tech');
    assert.strictEqual(singleTech.body.data.totalMembers, 2);
    assert.strictEqual(singleTech.body.data.activeStaff, 1);
    assert.strictEqual(singleTech.body.data.leadName, null);

    const singleTele = await request(server, 'GET', '/api/hr/departments/telecalling', hrToken);
    assert.strictEqual(singleTele.status, 200);
    assert.strictEqual(singleTele.body.data.deptKey, 'telecalling');
    assert.strictEqual(singleTele.body.data.totalMembers, 3);
    assert.strictEqual(singleTele.body.data.activeStaff, 2);

    console.log('\n================================================================');
    console.log('   ALL DEPARTMENT COUNT AND LEADERSHIP TESTS PASSED! (100%)');
    console.log('================================================================\n');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.readyState) await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exitCode = 1;
});

