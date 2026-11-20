const http = require('http');
const assert = require('assert');
const mongoose = require('mongoose');
const env = require('../config/env');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Leave = require('../models/Leave');
const Attendance = require('../models/Attendance');
const PayrollConflict = require('../models/PayrollConflict');
const payrollService = require('../services/payrollService');
const { app } = require('../server');

let server;
let serverPort;

function buildMultipart(fields, fileField) {
  const boundary = `---VerifyBoundary${Date.now()}`;
  const crlf = '\r\n';
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      parts.push(Buffer.from(
        `--${boundary}${crlf}` +
        `Content-Disposition: form-data; name="${name}"${crlf}${crlf}` +
        `${value}${crlf}`
      ));
    }
  }

  if (fileField) {
    parts.push(Buffer.from(
      `--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="${fileField.fieldName}"; filename="${fileField.filename}"${crlf}` +
      `Content-Type: application/pdf${crlf}${crlf}`
    ));
    parts.push(Buffer.isBuffer(fileField.data) ? fileField.data : Buffer.from(fileField.data));
    parts.push(Buffer.from(crlf));
  }

  parts.push(Buffer.from(`--${boundary}--${crlf}`));
  const payload = Buffer.concat(parts);

  return {
    payload,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': payload.length
    }
  };
}

function makeRequest(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const reqHeaders = { ...headers };
    let postData = null;

    if (body) {
      if (Buffer.isBuffer(body)) {
        postData = body;
      } else {
        postData = typeof body === 'string' ? body : JSON.stringify(body);
        if (!reqHeaders['Content-Type']) {
          reqHeaders['Content-Type'] = 'application/json';
        }
      }
      reqHeaders['Content-Length'] = Buffer.isBuffer(postData) ? postData.length : Buffer.byteLength(postData);
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

function pass(testName) {
  console.log(`  [PASS] ${testName}`);
}

async function run() {
  console.log('\n================================================================');
  console.log('   FULL-DAY & HALF-DAY LEAVES VERIFICATION SUITE');
  console.log('================================================================\n');

  const testDbUri = env.mongodbUri.includes('_test')
    ? env.mongodbUri
    : env.mongodbUri + '_full_half_leave_test';

  await mongoose.connect(testDbUri);
  console.log('Connected to test DB:', mongoose.connection.name);
  await mongoose.connection.db.dropDatabase();

  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      console.log(`Test HTTP server listening on port ${serverPort}\n`);
      resolve();
    });
  });

  try {
    // 1. Setup Admin and Staff Users
    console.log('--- SETUP: Seeding Admin and Employees ---');
    const hrUser = new User({
      firstName: 'HR',
      lastName: 'Admin',
      email: 'hr.leave.test@example.com',
      password: 'password123',
      role: 'HR',
      isActive: true
    });
    await hrUser.save();

    const techUser = new User({
      firstName: 'Tech',
      lastName: 'Dev',
      email: 'tech.dev@example.com',
      password: 'password123',
      role: 'STAFF',
      isActive: true
    });
    await techUser.save();

    const techEmp = new Employee({
      employeeId: 'TECH001',
      user: techUser._id,
      firstName: 'Tech',
      lastName: 'Dev',
      email: 'tech.dev@example.com',
      department: 'Tech',
      designation: 'Software Engineer',
      salary: 60000,
      paidLeaveAllowance: 1,
      status: 'ACTIVE'
    });
    await techEmp.save();

    const teleUser = new User({
      firstName: 'Tele',
      lastName: 'Agent',
      email: 'tele.agent@example.com',
      password: 'password123',
      role: 'STAFF',
      isActive: true
    });
    await teleUser.save();

    const teleEmp = new Employee({
      employeeId: 'TELE001',
      user: teleUser._id,
      firstName: 'Tele',
      lastName: 'Agent',
      email: 'tele.agent@example.com',
      department: 'Telecalling',
      designation: 'Calling Specialist',
      salary: 25000,
      paidLeaveAllowance: 1,
      status: 'ACTIVE'
    });
    await teleEmp.save();

    // Login users
    const hrLogin = await makeRequest('POST', '/api/auth/login', {}, { email: 'hr.leave.test@example.com', password: 'password123' });
    const hrToken = hrLogin.body.data.token;

    const techLogin = await makeRequest('POST', '/api/auth/login', {}, { email: 'tech.dev@example.com', password: 'password123' });
    const techToken = techLogin.body.data.token;

    const teleLogin = await makeRequest('POST', '/api/auth/login', {}, { email: 'tele.agent@example.com', password: 'password123' });
    const teleToken = teleLogin.body.data.token;

    const techAuth = { Authorization: `Bearer ${techToken}` };
    const teleAuth = { Authorization: `Bearer ${teleToken}` };
    const hrAuth = { Authorization: `Bearer ${hrToken}` };

    pass('HR Admin, Tech Employee, and Telecalling Employee created and authenticated');

    // ── TEST GROUP 1: Half-Day Validation Rules ─────────────────────────────
    console.log('\n--- TEST GROUP 1: Half-Day Validation Rules ---');

    // Test 1.1: HALF_DAY without halfDaySession -> Reject 422
    const resNoSession = await makeRequest('POST', '/api/staff/leaves', techAuth, {
      leaveType: 'CASUAL',
      durationType: 'HALF_DAY',
      startDate: '2026-11-25',
      endDate: '2026-11-25',
      reason: 'Doctor appointment'
    });
    assert.strictEqual(resNoSession.statusCode, 422, 'Missing halfDaySession must return 422');
    pass('HALF_DAY without halfDaySession rejected with 422');

    // Test 1.2: HALF_DAY with invalid halfDaySession -> Reject 422
    const resInvalidSession = await makeRequest('POST', '/api/staff/leaves', techAuth, {
      leaveType: 'CASUAL',
      durationType: 'HALF_DAY',
      halfDaySession: 'EVENING',
      startDate: '2026-11-25',
      endDate: '2026-11-25',
      reason: 'Doctor appointment'
    });
    assert.strictEqual(resInvalidSession.statusCode, 422, 'Invalid halfDaySession must return 422');
    pass('HALF_DAY with invalid halfDaySession (EVENING) rejected with 422');

    // Test 1.3: HALF_DAY with different start and end date -> Reject 422
    const resDiffDates = await makeRequest('POST', '/api/staff/leaves', techAuth, {
      leaveType: 'CASUAL',
      durationType: 'HALF_DAY',
      halfDaySession: 'FORENOON',
      startDate: '2026-11-25',
      endDate: '2026-11-26',
      reason: 'Doctor appointment'
    });
    assert.strictEqual(resDiffDates.statusCode, 422, 'Half-day with different start/end date must return 422');
    pass('HALF_DAY with different start and end date rejected with 422');

    // Test 1.4: FULL_DAY with halfDaySession provided -> Reject 422
    const resFullWithSession = await makeRequest('POST', '/api/staff/leaves', techAuth, {
      leaveType: 'CASUAL',
      durationType: 'FULL_DAY',
      halfDaySession: 'FORENOON',
      startDate: '2026-11-25',
      endDate: '2026-11-25',
      reason: 'Full day out'
    });
    assert.strictEqual(resFullWithSession.statusCode, 422, 'FULL_DAY with halfDaySession must return 422');
    pass('FULL_DAY with halfDaySession rejected with 422');

    // Test 1.5: Invalid durationType -> Reject 422
    const resInvalidType = await makeRequest('POST', '/api/staff/leaves', techAuth, {
      leaveType: 'CASUAL',
      durationType: 'QUARTER_DAY',
      startDate: '2026-11-25',
      endDate: '2026-11-25',
      reason: 'Quick leave'
    });
    assert.strictEqual(resInvalidType.statusCode, 422, 'Invalid durationType must return 422');
    pass('Invalid durationType rejected with 422');

    // ── TEST GROUP 2: Successful Persistence & Session Coexistence ──────────
    console.log('\n--- TEST GROUP 2: Half-Day Persistence & Complementary Sessions ---');

    // Test 2.1: Submit HALF_DAY FORENOON -> 201 Created
    const resHalfFN = await makeRequest('POST', '/api/staff/leaves', techAuth, {
      leaveType: 'CASUAL',
      durationType: 'HALF_DAY',
      halfDaySession: 'FORENOON',
      startDate: '2026-11-25',
      endDate: '2026-11-25',
      reason: 'Dentist visit in morning'
    });
    assert.strictEqual(resHalfFN.statusCode, 201, 'HALF_DAY FORENOON must return 201');
    const fnData = resHalfFN.body.data;
    assert.strictEqual(fnData.durationType, 'HALF_DAY', 'durationType must be HALF_DAY');
    assert.strictEqual(fnData.halfDaySession, 'FORENOON', 'halfDaySession must be FORENOON');
    assert.strictEqual(fnData.totalDays, 0.5, 'totalDays must be 0.5');
    assert.strictEqual(fnData.duration, 0.5, 'duration must be 0.5');
    assert.strictEqual(fnData.isHalfDay, true, 'isHalfDay must be true');
    assert.strictEqual(fnData.isFullDay, false, 'isFullDay must be false');
    pass('HALF_DAY FORENOON created with durationType=HALF_DAY, session=FORENOON, totalDays=0.5');

    // Test 2.2: Submit complementary HALF_DAY AFTERNOON on the exact same date -> 201 Created
    const resHalfAN = await makeRequest('POST', '/api/staff/leaves', techAuth, {
      leaveType: 'CASUAL',
      durationType: 'HALF_DAY',
      halfDaySession: 'AFTERNOON',
      startDate: '2026-11-25',
      endDate: '2026-11-25',
      reason: 'Personal errand in afternoon'
    });
    assert.strictEqual(resHalfAN.statusCode, 201, 'Complementary AFTERNOON session on same date must be allowed (201)');
    const anData = resHalfAN.body.data;
    assert.strictEqual(anData.halfDaySession, 'AFTERNOON');
    assert.strictEqual(anData.totalDays, 0.5);
    pass('Complementary HALF_DAY AFTERNOON on same date accepted without conflict');

    // Test 2.3: Submit duplicate FORENOON on the same date -> Reject 409 Conflict
    const resDuplicateFN = await makeRequest('POST', '/api/staff/leaves', techAuth, {
      leaveType: 'CASUAL',
      durationType: 'HALF_DAY',
      halfDaySession: 'FORENOON',
      startDate: '2026-11-25',
      endDate: '2026-11-25',
      reason: 'Second morning attempt'
    });
    assert.strictEqual(resDuplicateFN.statusCode, 409, 'Duplicate FORENOON on same date must return 409 Conflict');
    pass('Duplicate session (FORENOON on same date) properly rejected with 409 Conflict');

    // Test 2.4: Submit FULL_DAY on date already having half-day leave -> Reject 409 Conflict
    const resFullConflict = await makeRequest('POST', '/api/staff/leaves', techAuth, {
      leaveType: 'CASUAL',
      durationType: 'FULL_DAY',
      startDate: '2026-11-25',
      endDate: '2026-11-25',
      reason: 'Override with full day'
    });
    assert.strictEqual(resFullConflict.statusCode, 409, 'FULL_DAY overlapping existing half-day must return 409 Conflict');
    pass('FULL_DAY overlapping existing half-day leaves rejected with 409 Conflict');

    // ── TEST GROUP 3: Working-Day Calculation Rules (Tech vs Telecalling) ───
    console.log('\n--- TEST GROUP 3: Department Working-Day Duration Rules ---');

    // Nov 20, 2026 is Friday; Nov 21 is Saturday; Nov 22 is Sunday; Nov 23 is Monday.
    // Date range: 2026-11-20 to 2026-11-23 (4 calendar days)

    // Tech: Mon-Fri (Saturday & Sunday are weekly offs) -> Working days = 2 (Fri, Mon)
    const resTechWorkingDays = await makeRequest('POST', '/api/staff/leaves', techAuth, {
      leaveType: 'CASUAL',
      durationType: 'FULL_DAY',
      startDate: '2026-11-20',
      endDate: '2026-11-23',
      reason: 'Tech weekend trip'
    });
    assert.strictEqual(resTechWorkingDays.statusCode, 201, 'Tech leave submitted successfully');
    assert.strictEqual(resTechWorkingDays.body.data.totalDays, 2, 'Tech department Fri-Mon must calculate exactly 2 working days');
    assert.strictEqual(resTechWorkingDays.body.data.duration, 2, 'Tech duration must be 2');
    pass('Tech Fri-Mon leave correctly counts 2 working days (Sat & Sun excluded)');

    // Telecalling: Mon-Sat (Sunday only is weekly off) -> Working days = 3 (Fri, Sat, Mon)
    const resTeleWorkingDays = await makeRequest('POST', '/api/staff/leaves', teleAuth, {
      leaveType: 'CASUAL',
      durationType: 'FULL_DAY',
      startDate: '2026-11-20',
      endDate: '2026-11-23',
      reason: 'Telecalling weekend trip'
    });
    assert.strictEqual(resTeleWorkingDays.statusCode, 201, 'Telecalling leave submitted successfully');
    assert.strictEqual(resTeleWorkingDays.body.data.totalDays, 3, 'Telecalling department Fri-Mon must calculate exactly 3 working days');
    assert.strictEqual(resTeleWorkingDays.body.data.duration, 3, 'Telecalling duration must be 3');
    pass('Telecalling Fri-Mon leave correctly counts 3 working days (Saturday included, Sunday excluded)');

    // ── TEST GROUP 4: Backward Compatibility & Defaults ─────────────────────
    console.log('\n--- TEST GROUP 4: Backward Compatibility & Default Values ---');

    // Omitting durationType must default to FULL_DAY and halfDaySession to null
    const resDefault = await makeRequest('POST', '/api/staff/leaves', techAuth, {
      leaveType: 'SICK',
      startDate: '2026-11-27',
      endDate: '2026-11-27',
      reason: 'Sick day without durationType in payload'
    });
    assert.strictEqual(resDefault.statusCode, 201);
    assert.strictEqual(resDefault.body.data.durationType, 'FULL_DAY', 'Default durationType must be FULL_DAY');
    assert.strictEqual(resDefault.body.data.halfDaySession, null, 'Default halfDaySession must be null');
    assert.strictEqual(resDefault.body.data.totalDays, 1, 'Default 1-day sick leave totalDays must be 1');
    assert.strictEqual(resDefault.body.data.isFullDay, true);
    assert.strictEqual(resDefault.body.data.isHalfDay, false);
    pass('Default leave request defaults cleanly to FULL_DAY with null session');

    // ── TEST GROUP 5: HR Approval & Rejection Workflow ──────────────────────
    console.log('\n--- TEST GROUP 5: HR Approval & Rejection Workflow ---');

    // HR approves the half-day FORENOON request
    const approveRes = await makeRequest('PUT', `/api/hr/leaves/${fnData.id}/approve`, hrAuth);
    assert.strictEqual(approveRes.statusCode, 200, 'HR approval must return 200');
    assert.strictEqual(approveRes.body.data.status, 'APPROVED');
    assert.strictEqual(approveRes.body.data.durationType, 'HALF_DAY');
    assert.strictEqual(approveRes.body.data.halfDaySession, 'FORENOON');
    assert.strictEqual(approveRes.body.data.totalDays, 0.5);
    assert.ok(approveRes.body.data.approvedAt, 'approvedAt must be set');
    pass('HR approves half-day leave: status=APPROVED, totalDays=0.5 preserved');

    // HR rejects the half-day AFTERNOON request
    const rejectRes = await makeRequest('PUT', `/api/hr/leaves/${anData.id}/reject`, hrAuth, {
      rejectionReason: 'Urgent meeting in afternoon'
    });
    assert.strictEqual(rejectRes.statusCode, 200, 'HR rejection must return 200');
    assert.strictEqual(rejectRes.body.data.status, 'REJECTED');
    assert.strictEqual(rejectRes.body.data.rejectionReason, 'Urgent meeting in afternoon');
    assert.strictEqual(rejectRes.body.data.totalDays, 0.5);
    pass('HR rejects half-day leave: status=REJECTED with reason, totalDays=0.5 preserved');

    // ── TEST GROUP 6: Payroll & Leave Balance Integration ───────────────────
    console.log('\n--- TEST GROUP 6: Leave Balance & Payroll Calculations ---');

    // Create a dedicated employee for clean payroll math
    // Salary: ₹60,000, 20 scheduled working days in Nov 2026 (Tech) -> Daily rate = ₹3,000
    // Allowance: 1.0 day paid leave
    const payrollUser = new User({
      firstName: 'HalfDay',
      lastName: 'PayTester',
      email: 'halfday.payroll@example.com',
      password: 'password123',
      role: 'STAFF',
      isActive: true
    });
    await payrollUser.save();

    const payrollEmp = new Employee({
      employeeId: 'PAY001',
      user: payrollUser._id,
      firstName: 'HalfDay',
      lastName: 'PayTester',
      email: 'halfday.payroll@example.com',
      department: 'Tech',
      designation: 'Staff',
      salary: 60000,
      paidLeaveAllowance: 1.0, // 1 full day paid allowance = two 0.5 half-days
      status: 'ACTIVE'
    });
    await payrollEmp.save();

    // Leave 1: Nov 10 (Tue) HALF_DAY approved -> consumes 0.5 paid allowance
    await Leave.create({
      employee: payrollEmp._id,
      leaveType: 'CASUAL',
      durationType: 'HALF_DAY',
      halfDaySession: 'FORENOON',
      startDate: new Date('2026-11-10T00:00:00.000Z'),
      endDate: new Date('2026-11-10T00:00:00.000Z'),
      totalDays: 0.5,
      duration: 0.5,
      reason: 'Half-day 1',
      status: 'APPROVED'
    });

    // Leave 2: Nov 11 (Wed) HALF_DAY approved -> consumes remaining 0.5 paid allowance (total 1.0)
    await Leave.create({
      employee: payrollEmp._id,
      leaveType: 'CASUAL',
      durationType: 'HALF_DAY',
      halfDaySession: 'AFTERNOON',
      startDate: new Date('2026-11-11T00:00:00.000Z'),
      endDate: new Date('2026-11-11T00:00:00.000Z'),
      totalDays: 0.5,
      duration: 0.5,
      reason: 'Half-day 2',
      status: 'APPROVED'
    });

    // Leave 3: Nov 12 (Thu) HALF_DAY approved -> allowance exhausted, becomes 0.5 UNPAID
    await Leave.create({
      employee: payrollEmp._id,
      leaveType: 'CASUAL',
      durationType: 'HALF_DAY',
      halfDaySession: 'FORENOON',
      startDate: new Date('2026-11-12T00:00:00.000Z'),
      endDate: new Date('2026-11-12T00:00:00.000Z'),
      totalDays: 0.5,
      duration: 0.5,
      reason: 'Half-day 3 (unpaid)',
      status: 'APPROVED'
    });

    // Leave 4: Nov 13 (Fri) HALF_DAY PENDING -> must NOT consume allowance or count as approved
    await Leave.create({
      employee: payrollEmp._id,
      leaveType: 'CASUAL',
      durationType: 'HALF_DAY',
      halfDaySession: 'FORENOON',
      startDate: new Date('2026-11-13T00:00:00.000Z'),
      endDate: new Date('2026-11-13T00:00:00.000Z'),
      totalDays: 0.5,
      duration: 0.5,
      reason: 'Half-day 4 (pending)',
      status: 'PENDING'
    });

    // Attendance on Nov 10: HALF_DAY worked in afternoon + FORENOON leave = Complementary (0.5 + 0.5 = 1 day)
    await Attendance.create({
      employee: payrollEmp._id,
      date: new Date('2026-11-10T00:00:00.000Z'),
      checkIn: new Date('2026-11-10T14:00:00.000Z'),
      status: 'HALF_DAY',
      workMode: 'Office'
    });

    // Calculate payroll for November 2026
    const payrollRes = await payrollService.calculateEmployeePayroll(payrollEmp, 2026, 11);

    // Verify leave days breakdown
    assert.strictEqual(payrollRes.approvedLeaves, 1.5, 'Total approved leaves must be 1.5 days (three 0.5 half-days)');
    assert.strictEqual(payrollRes.approvedPaidLeaveDays, 1.0, 'Approved paid leave days must be capped at 1.0 day');
    assert.strictEqual(payrollRes.approvedUnpaidLeaveDays, 0.5, 'Approved unpaid leave days must be exactly 0.5 day');
    pass('Half-day leaves properly consume paid allowance (1.0 paid, 0.5 unpaid)');

    // Verify complementary attendance + leave:
    // Nov 10 had HALF_DAY attendance (0.5) + HALF_DAY leave (0.5) -> No conflict created!
    const conflicts = await PayrollConflict.find({ employee: payrollEmp._id });
    assert.strictEqual(conflicts.length, 0, 'Complementary half-day attendance + half-day leave must not trigger a conflict');
    pass('Complementary half-day attendance + leave evaluated with zero conflicts');

    // Verify payable days:
    // Tech schedule for Nov 2026: 21 weekdays (scheduledWorkingDays = 21)
    // Present = 0.5 (Nov 10 afternoon)
    // Paid leave = 1.0 (Nov 10 morning + Nov 11 afternoon)
    // Total payable days = 0.5 + 1.0 = 1.5 days
    assert.strictEqual(payrollRes.payableDays, 1.5, 'Payable days must be exactly 1.5 (0.5 worked + 1.0 paid leave)');
    // Daily rate = 60,000 / 21 = 2857.142857...
    // Net salary = 1.5 * (60,000 / 21) = 4285.71
    const expectedDailyRate = 60000 / payrollRes.scheduledWorkingDays;
    const expectedNetSalary = Math.round(expectedDailyRate * 1.5 * 100) / 100;
    const expectedDeductions = Math.round((60000 - expectedNetSalary) * 100) / 100;
    assert.strictEqual(payrollRes.netSalary, expectedNetSalary, `Net salary for 1.5 payable days must be ₹${expectedNetSalary}`);
    assert.strictEqual(payrollRes.deductions, expectedDeductions, `Deductions must equal ₹${expectedDeductions} without double deductions`);
    pass('Payroll net pay and deductions calculate with fractional half-day accuracy without double deductions');

    console.log('\n--- TEST GROUP 7: Medical Document Multipart Submission with Full & Half-Day ---');

    // 7.1: Submit Half-Day MEDICAL leave via multipart form-data
    const fakePdf = Buffer.from('%PDF-1.4 test medical certificate buffer content');
    const multipartData = buildMultipart(
      {
        leaveType: 'MEDICAL',
        durationType: 'HALF_DAY',
        halfDaySession: 'FORENOON',
        startDate: '2026-12-22',
        endDate: '2026-12-22',
        reason: 'Hospital visit in morning session'
      },
      {
        fieldName: 'document',
        filename: 'medical_cert_halfday.pdf',
        data: fakePdf
      }
    );

    const medRes = await makeRequest(
      'POST',
      '/api/staff/leaves',
      {
        Authorization: `Bearer ${techToken}`,
        ...multipartData.headers
      },
      multipartData.payload
    );

    assert.strictEqual(medRes.statusCode, 201, `Multipart half-day medical leave should return 201 Created: ${JSON.stringify(medRes.body)}`);
    const medLeave = medRes.body?.data?.leave || medRes.body?.data;
    assert.strictEqual(medLeave.leaveType, 'MEDICAL');
    assert.strictEqual(medLeave.durationType, 'HALF_DAY');
    assert.strictEqual(medLeave.halfDaySession, 'FORENOON');
    assert.strictEqual(medLeave.totalDays, 0.5);
    assert.strictEqual(medLeave.isHalfDay, true);
    assert.ok(medLeave.documentUrl || medLeave.documentId || medLeave.document, 'Medical document must be attached');
    const createdMedLeaveId = medLeave.id || medLeave._id || medLeave.leaveId;
    pass('Multipart submission of HALF_DAY Medical leave with PDF succeeds with attached document');

    // 7.2: HR detail endpoint retrieves half-day medical leave with document metadata intact
    const hrMedDetail = await makeRequest(
      'GET',
      `/api/hr/leaves/${createdMedLeaveId}`,
      { Authorization: `Bearer ${hrToken}` }
    );
    assert.strictEqual(hrMedDetail.statusCode, 200);
    const hrLeave = hrMedDetail.body?.data?.leave || hrMedDetail.body?.data;
    assert.strictEqual(hrLeave.durationType, 'HALF_DAY');
    assert.strictEqual(hrLeave.halfDaySession, 'FORENOON');
    assert.strictEqual(hrLeave.totalDays, 0.5);
    assert.ok(hrLeave.documentUrl || hrLeave.document, 'HR can access attached medical document');
    pass('HR detail endpoint returns complete half-day fields and accessible document proof');

    console.log('\n================================================================');
    console.log('   ALL FULL-DAY & HALF-DAY LEAVE TESTS PASSED (100%)');
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
  console.error('\n[TEST RUNNER FATAL ERROR]:', err);
  process.exit(1);
});
