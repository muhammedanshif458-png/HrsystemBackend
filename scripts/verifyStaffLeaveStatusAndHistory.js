/**
 * STAFF LEAVE APPROVAL STATUS & HISTORY API VERIFICATION TEST SUITE
 *
 * Verifies:
 * 1. Staff submits Sick Leave → accepted (201) with correct identifiers (id, staffId, employeeId, staff).
 * 2. Staff history API returns the submitted request in PENDING state.
 * 3. Staff dashboard API returns pendingLeaves: 1, approvedLeaves: 0, latestLeave.status: PENDING.
 * 4. HR views leaves list and finds the pending request.
 * 5. HR approves the request via PUT /api/hr/leaves/:id/approve.
 * 6. Database record confirms persistence of APPROVED status, approvedBy, and approvedAt.
 * 7. Staff history API returns the approved request with status: APPROVED and matching staffId/employeeId.
 * 8. Staff dashboard API returns pendingLeaves: 0, approvedLeaves: 1, latestLeave.status: APPROVED.
 * 9. Pending requests remain Pending alongside Approved requests.
 * 10. HR rejects a request → status: REJECTED with rejectionReason.
 * 11. Rejected requests remain Rejected in staff history.
 * 12. Employee isolation: Staff B cannot see Staff A's leave records (history returns 0, detail returns 404).
 * 13. Complete response structure includes all required fields (id, staffId, employeeId, staff, leaveType,
 *     leaveTypeDisplay, startDate, endDate, totalDays, reason, status, submittedDate, approvedBy, approvedAt).
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'staff-leave-status-test-secret-at-least-32-chars-long!!';
process.env.JWT_REFRESH_SECRET = 'staff-leave-status-refresh-secret-at-least-32-chars!!';

const http = require('http');
const assert = require('assert');
const { connectTestDatabase } = require('./testDatabase');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Leave = require('../models/Leave');
const DepartmentSchedule = require('../models/DepartmentSchedule');

function makeRequest(server, method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const reqBody = body ? JSON.stringify(body) : null;
    const options = {
      hostname: '127.0.0.1',
      port: server.address().port,
      method,
      path,
      headers: {
        'Content-Type': 'application/json',
        ...(reqBody ? { 'Content-Length': Buffer.byteLength(reqBody) } : {}),
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ statusCode: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (reqBody) req.write(reqBody);
    req.end();
  });
}

async function createStaffUser(hrToken, server, suffix) {
  const ts = Date.now();
  const email = `leave_audit_${suffix}_${ts}@example.com`;
  const createRes = await makeRequest(server, 'POST', '/api/hr/employees',
    { Authorization: `Bearer ${hrToken}` },
    {
      name: `Leave Staff ${suffix}`,
      email,
      phoneNumber: `9876543${ts.toString().slice(-3)}`,
      department: 'Tech',
      designation: 'Software Engineer',
      workMode: 'Office',
      password: 'Password123!'
    }
  );
  if (createRes.statusCode !== 201) {
    throw new Error(`Failed to create staff ${suffix}: ${JSON.stringify(createRes.body)}`);
  }

  const loginRes = await makeRequest(server, 'POST', '/api/auth/login', {},
    { email, password: 'Password123!' }
  );
  if (loginRes.statusCode !== 200) {
    throw new Error(`Staff ${suffix} login failed: ${JSON.stringify(loginRes.body)}`);
  }

  const token = loginRes.body?.data?.accessToken || loginRes.body?.data?.token;
  const employeeData = loginRes.body?.data?.user?.employee;
  const staffId = employeeData?.employeeId || employeeData?._id?.toString() || '';

  return { email, token, employeeId: staffId, employeeMongoId: employeeData?._id?.toString() };
}

const today = new Date();
const futureDate = (offsetDays) => {
  const d = new Date(today);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
};

async function run() {
  console.log('================================================================');
  console.log('   STAFF LEAVE APPROVAL STATUS & HISTORY API TEST SUITE        ');
  console.log('================================================================\n');

  await connectTestDatabase();

  // Clean old test leaves
  await Leave.deleteMany({ reason: { $regex: /^AUDIT_LEAVE_/ } });

  // Seed HR user
  const hrEmail = `hr.leaveaudit.${Date.now()}@example.com`;
  await User.create({
    firstName: 'HR',
    lastName: 'Admin',
    email: hrEmail,
    password: 'HrPass123!',
    role: 'HR'
  });

  const existingTech = await DepartmentSchedule.findOne({ department: 'TECH' });
  if (!existingTech) {
    await DepartmentSchedule.create({
      department: 'TECH',
      departmentDisplay: 'Tech',
      checkInTime: '10:00',
      checkOutTime: '18:00',
      timezone: 'Asia/Kolkata',
      timeZone: 'Asia/Kolkata'
    });
  }

  const { app } = require('../server');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  let passed = 0;
  let failed = 0;

  function pass(label) {
    console.log(`  [PASS] ${label}`);
    passed++;
  }
  function fail(label, err) {
    console.error(`  [FAIL] ${label}: ${err?.message || err}`);
    failed++;
  }

  try {
    // ── Setup: HR Login ──────────────────────────────────────────────────────
    const hrLogin = await makeRequest(server, 'POST', '/api/auth/login', {},
      { email: hrEmail, password: 'HrPass123!' }
    );
    assert.strictEqual(hrLogin.statusCode, 200, 'HR login must succeed');
    const hrToken = hrLogin.body?.data?.accessToken || hrLogin.body?.data?.token;

    // ── Setup: Create Staff A and Staff B ────────────────────────────────────
    const staffA = await createStaffUser(hrToken, server, 'Alice');
    const staffB = await createStaffUser(hrToken, server, 'Bob');
    console.log(`  ✓ Staff Alice (ID: ${staffA.employeeId}) and Staff Bob (ID: ${staffB.employeeId}) created\n`);

    const authA = { Authorization: `Bearer ${staffA.token}` };
    const authB = { Authorization: `Bearer ${staffB.token}` };
    const authHR = { Authorization: `Bearer ${hrToken}` };

    let leaveA1Id = null;
    let leaveA2Id = null;

    // ── TEST 1: Staff submits Sick Leave ─────────────────────────────────────
    console.log('--- TEST 1: Staff submits Sick Leave request ---');
    try {
      const res = await makeRequest(server, 'POST', '/api/staff/leaves', authA, {
        leaveType: 'SICK',
        startDate: futureDate(10),
        endDate: futureDate(10),
        reason: 'AUDIT_LEAVE_sick_nov9'
      });
      assert.strictEqual(res.statusCode, 201, `Status code must be 201, got ${res.statusCode}`);
      assert.strictEqual(res.body.success, true, 'Response must indicate success');
      const data = res.body.data;
      assert.ok(data._id || data.id, 'Response must have an id');
      leaveA1Id = data._id || data.id;
      assert.strictEqual(data.status, 'PENDING', 'Initial status must be PENDING');
      assert.strictEqual(data.leaveType, 'SICK', 'leaveType must be SICK');
      assert.strictEqual(data.leaveTypeDisplay, 'Sick Leave', 'leaveTypeDisplay must be Sick Leave');
      assert.strictEqual(data.staffId, staffA.employeeId, `staffId must match employeeId (${staffA.employeeId})`);
      assert.strictEqual(data.employeeId, staffA.employeeId, `employeeId must match (${staffA.employeeId})`);
      assert.strictEqual(data.staff, staffA.employeeId, `staff identifier alias must match (${staffA.employeeId})`);
      assert.strictEqual(data.totalDays, 1, 'totalDays must be 1');
      pass('Staff submits Sick Leave: returns 201 with matching staffId and PENDING status');
    } catch (e) { fail('TEST 1: Staff submits Sick Leave', e); }

    // ── TEST 2: Staff history API returns the submitted request ──────────────
    console.log('--- TEST 2: Staff history API returns submitted request with matching staffId ---');
    try {
      const res = await makeRequest(server, 'GET', '/api/staff/leaves', authA);
      assert.strictEqual(res.statusCode, 200, `Status code must be 200, got ${res.statusCode}`);
      assert.strictEqual(res.body.success, true);
      const leaves = res.body.data;
      assert.ok(Array.isArray(leaves), 'data must be an array');
      assert.strictEqual(leaves.length, 1, 'Staff A must have exactly 1 leave request');
      const req = leaves[0];
      assert.strictEqual(req.id, leaveA1Id, 'Request ID must match submitted leave');
      assert.strictEqual(req.staffId, staffA.employeeId, `staffId must equal ${staffA.employeeId}`);
      assert.strictEqual(req.employeeId, staffA.employeeId, `employeeId must equal ${staffA.employeeId}`);
      assert.strictEqual(req.staff, staffA.employeeId, `staff must equal ${staffA.employeeId}`);
      assert.strictEqual(req.status, 'PENDING', 'Status must be PENDING');
      assert.strictEqual(req.totalDays, 1, 'totalDays must be 1');
      assert.strictEqual(res.body.pagination?.total, 1, 'pagination.total must be 1');
      pass('Staff history API: returns submitted leave with correct staffId and total count = 1');
    } catch (e) { fail('TEST 2: Staff history API', e); }

    // ── TEST 3: Staff dashboard API reflects pending leave ───────────────────
    console.log('--- TEST 3: Staff dashboard API returns pending count and latestLeave ---');
    try {
      const res = await makeRequest(server, 'GET', '/api/staff/dashboard', authA);
      assert.strictEqual(res.statusCode, 200, `Status code must be 200, got ${res.statusCode}`);
      const data = res.body.data;
      assert.strictEqual(data.pendingLeaves, 1, 'pendingLeaves count must be 1');
      assert.strictEqual(data.approvedLeaves, 0, 'approvedLeaves count must be 0');
      assert.ok(data.latestLeave, 'latestLeave must be present on dashboard');
      assert.strictEqual(data.latestLeave.id, leaveA1Id, 'latestLeave ID must match');
      assert.strictEqual(data.latestLeave.status, 'PENDING', 'latestLeave status must be PENDING');
      assert.strictEqual(data.latestLeave.staffId, staffA.employeeId, 'latestLeave staffId must match');
      pass('Staff dashboard API: returns pendingLeaves: 1, approvedLeaves: 0, latestLeave.status: PENDING');
    } catch (e) { fail('TEST 3: Staff dashboard API', e); }

    // ── TEST 4: HR sees the pending request ──────────────────────────────────
    console.log('--- TEST 4: HR retrieves leave requests and finds pending request ---');
    try {
      const res = await makeRequest(server, 'GET', `/api/hr/leaves?employeeId=${staffA.employeeId}`, authHR);
      assert.strictEqual(res.statusCode, 200, `Status code must be 200, got ${res.statusCode}`);
      const leaves = res.body.data;
      assert.ok(Array.isArray(leaves), 'HR data must be an array');
      const found = leaves.find(l => (l._id || l.id) === leaveA1Id);
      assert.ok(found, 'HR must see Staff A leave request');
      assert.strictEqual(found.status, 'PENDING', 'HR view must show status PENDING');
      assert.strictEqual(found.staffId, staffA.employeeId, 'HR view must have staffId');
      pass('HR leave listing: finds Staff A pending request');
    } catch (e) { fail('TEST 4: HR retrieves leave requests', e); }

    // ── TEST 5: HR approves the leave request ────────────────────────────────
    console.log('--- TEST 5: HR approves the leave request ---');
    try {
      const res = await makeRequest(server, 'PUT', `/api/hr/leaves/${leaveA1Id}/approve`, authHR);
      assert.strictEqual(res.statusCode, 200, `Approval status must be 200, got ${res.statusCode}`);
      assert.strictEqual(res.body.success, true);
      const data = res.body.data;
      assert.strictEqual(data.status, 'APPROVED', 'Approval response must have status APPROVED');
      assert.ok(data.approvedBy, 'approvedBy must be populated');
      assert.ok(data.approvedAt, 'approvedAt timestamp must be set');
      assert.strictEqual(data.staffId, staffA.employeeId, 'staffId must remain consistent');
      pass('HR approves leave: returns 200 with status APPROVED, approvedBy and approvedAt');
    } catch (e) { fail('TEST 5: HR approves leave', e); }

    // ── TEST 6: Verify MongoDB record persistence ────────────────────────────
    console.log('--- TEST 6: Verify database record persistence ---');
    try {
      const dbRecord = await Leave.findById(leaveA1Id).lean();
      assert.ok(dbRecord, 'Database record must exist');
      assert.strictEqual(dbRecord.status, 'APPROVED', 'Stored status in MongoDB must be APPROVED');
      assert.ok(dbRecord.approvedBy, 'Stored approvedBy in MongoDB must be set');
      assert.ok(dbRecord.approvedAt, 'Stored approvedAt in MongoDB must be set');
      assert.strictEqual(dbRecord.rejectionReason, null, 'rejectionReason must be null');
      pass('Database verification: record updated to APPROVED with approvedBy and approvedAt');
    } catch (e) { fail('TEST 6: Database verification', e); }

    // ── TEST 7: Staff history API returns APPROVED status ────────────────────
    console.log('--- TEST 7: Staff history API returns the approved request with status APPROVED ---');
    try {
      const res = await makeRequest(server, 'GET', '/api/staff/leaves', authA);
      assert.strictEqual(res.statusCode, 200, `Status code must be 200, got ${res.statusCode}`);
      const leaves = res.body.data;
      assert.strictEqual(leaves.length, 1, 'Staff A must have 1 leave record');
      const req = leaves[0];
      assert.strictEqual(req.id, leaveA1Id, 'ID must match approved leave');
      assert.strictEqual(req.status, 'APPROVED', 'Staff-facing status must be APPROVED (not PENDING)');
      assert.strictEqual(req.staffId, staffA.employeeId, `staffId must equal ${staffA.employeeId}`);
      assert.strictEqual(req.employeeId, staffA.employeeId, `employeeId must equal ${staffA.employeeId}`);
      assert.strictEqual(req.staff, staffA.employeeId, `staff alias must equal ${staffA.employeeId}`);
      assert.ok(req.approvedBy, 'approvedBy must be returned to staff');
      assert.ok(req.approvedAt, 'approvedAt must be returned to staff');
      assert.strictEqual(res.body.pagination?.total, 1, 'total count must be 1');
      pass('Staff history API: returns status APPROVED with matching staffId and approved metadata');
    } catch (e) { fail('TEST 7: Staff history API after approval', e); }

    // ── TEST 8: Staff dashboard API returns updated counts & status ──────────
    console.log('--- TEST 8: Staff dashboard API reflects approved status ---');
    try {
      const res = await makeRequest(server, 'GET', '/api/staff/dashboard', authA);
      assert.strictEqual(res.statusCode, 200, `Status code must be 200, got ${res.statusCode}`);
      const data = res.body.data;
      assert.strictEqual(data.pendingLeaves, 0, 'pendingLeaves count must now be 0');
      assert.strictEqual(data.approvedLeaves, 1, 'approvedLeaves count must now be 1');
      assert.ok(data.latestLeave, 'latestLeave must be present');
      assert.strictEqual(data.latestLeave.id, leaveA1Id, 'latestLeave must be the approved leave');
      assert.strictEqual(data.latestLeave.status, 'APPROVED', 'latestLeave status must be APPROVED');
      assert.strictEqual(data.latestLeave.staffId, staffA.employeeId, 'latestLeave staffId must match');
      pass('Staff dashboard API: returns pendingLeaves: 0, approvedLeaves: 1, latestLeave.status: APPROVED');
    } catch (e) { fail('TEST 8: Staff dashboard API after approval', e); }

    // ── TEST 9: Staff submits a second leave (Pending alongside Approved) ────
    console.log('--- TEST 9: Staff submits second leave (remains PENDING alongside APPROVED) ---');
    try {
      const res = await makeRequest(server, 'POST', '/api/staff/leaves', authA, {
        leaveType: 'CASUAL',
        startDate: futureDate(15),
        endDate: futureDate(16),
        reason: 'AUDIT_LEAVE_casual_vacation'
      });
      assert.strictEqual(res.statusCode, 201, `Status code must be 201, got ${res.statusCode}`);
      leaveA2Id = res.body.data._id || res.body.data.id;
      assert.strictEqual(res.body.data.status, 'PENDING');

      // Check staff history returns both leaves
      const histRes = await makeRequest(server, 'GET', '/api/staff/leaves', authA);
      assert.strictEqual(histRes.statusCode, 200);
      assert.strictEqual(histRes.body.data.length, 2, 'Staff A must now have 2 leave records');
      assert.strictEqual(histRes.body.pagination?.total, 2, 'Total count must be 2');

      const appLeave = histRes.body.data.find(l => l.id === leaveA1Id);
      const penLeave = histRes.body.data.find(l => l.id === leaveA2Id);
      assert.ok(appLeave, 'First leave must be present');
      assert.ok(penLeave, 'Second leave must be present');
      assert.strictEqual(appLeave.status, 'APPROVED', 'First leave must remain APPROVED');
      assert.strictEqual(penLeave.status, 'PENDING', 'Second leave must be PENDING');
      pass('Pending and Approved coexistence: history returns 2 total, one APPROVED and one PENDING');
    } catch (e) { fail('TEST 9: Pending alongside Approved', e); }

    // ── TEST 10: HR rejects the second leave ─────────────────────────────────
    console.log('--- TEST 10: HR rejects the second leave request ---');
    try {
      const res = await makeRequest(server, 'PUT', `/api/hr/leaves/${leaveA2Id}/reject`, authHR, {
        rejectionReason: 'Staff shortage on requested dates.'
      });
      assert.strictEqual(res.statusCode, 200, `Status must be 200, got ${res.statusCode}`);
      assert.strictEqual(res.body.data.status, 'REJECTED');
      assert.strictEqual(res.body.data.rejectionReason, 'Staff shortage on requested dates.');
      pass('HR rejects leave: returns 200 with status REJECTED and rejectionReason');
    } catch (e) { fail('TEST 10: HR rejects leave', e); }

    // ── TEST 11: Staff history shows REJECTED status ─────────────────────────
    console.log('--- TEST 11: Staff history displays REJECTED status accurately ---');
    try {
      const res = await makeRequest(server, 'GET', '/api/staff/leaves', authA);
      assert.strictEqual(res.statusCode, 200);
      const rejLeave = res.body.data.find(l => l.id === leaveA2Id);
      assert.ok(rejLeave, 'Rejected leave must be present');
      assert.strictEqual(rejLeave.status, 'REJECTED', 'Status must be REJECTED');
      assert.strictEqual(rejLeave.rejectionReason, 'Staff shortage on requested dates.');
      pass('Staff history API: displays REJECTED status with rejectionReason intact');
    } catch (e) { fail('TEST 11: Staff history REJECTED status', e); }

    // ── TEST 12: Employee Isolation ──────────────────────────────────────────
    console.log('--- TEST 12: Employee isolation — Staff B cannot access Staff A leaves ---');
    try {
      // Staff B history must have 0 leaves
      const bHistory = await makeRequest(server, 'GET', '/api/staff/leaves', authB);
      assert.strictEqual(bHistory.statusCode, 200);
      assert.strictEqual(bHistory.body.data.length, 0, 'Staff B must have 0 leaves');
      assert.strictEqual(bHistory.body.pagination?.total, 0, 'Staff B total count must be 0');

      // Staff B accessing Staff A leave detail must return 404
      const bDetail = await makeRequest(server, 'GET', `/api/staff/leaves/${leaveA1Id}`, authB);
      assert.strictEqual(bDetail.statusCode, 404, 'Accessing another staff leave must return 404');
      pass('Employee isolation: Staff B history is empty (0 total) and cross-access returns 404');
    } catch (e) { fail('TEST 12: Employee isolation', e); }

    // ── TEST 13: Response Schema Validation ──────────────────────────────────
    console.log('--- TEST 13: Full response schema validation for staff-facing leaves ---');
    try {
      const res = await makeRequest(server, 'GET', `/api/staff/leaves/${leaveA1Id}`, authA);
      assert.strictEqual(res.statusCode, 200);
      const l = res.body.data;

      // Required fields from prompt task 4:
      assert.ok(l.id, 'Must have id');
      assert.ok(l.staffId, 'Must have staffId');
      assert.ok(l.employeeId, 'Must have employeeId');
      assert.ok(l.staff, 'Must have staff alias');
      assert.ok(l.leaveType, 'Must have leaveType');
      assert.ok(l.leaveTypeDisplay, 'Must have leaveTypeDisplay');
      assert.ok(l.startDate, 'Must have startDate');
      assert.ok(l.endDate, 'Must have endDate');
      assert.ok(typeof l.totalDays === 'number', 'Must have totalDays as number');
      assert.ok(l.reason, 'Must have reason');
      assert.ok(l.status, 'Must have status');
      assert.ok(l.appliedAt || l.submittedDate || l.createdAt, 'Must have submission date');
      assert.ok(l.approvedBy, 'Must have approvedBy');
      assert.ok(l.approvedAt, 'Must have approvedAt');

      pass('Response schema validation: all 14 required fields present and typed correctly');
    } catch (e) { fail('TEST 13: Response schema validation', e); }

  } finally {
    await new Promise(r => server.close(r));
    await require('mongoose').disconnect().catch(() => {});
  }

  console.log('\n================================================================');
  if (failed === 0) {
    console.log(`   ALL ${passed} STAFF LEAVE STATUS & HISTORY TESTS PASSED!     `);
  } else {
    console.log(`   ${passed} passed, ${failed} FAILED                          `);
  }
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});

