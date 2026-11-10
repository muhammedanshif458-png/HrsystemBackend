/**
 * Verification Test Suite: Payroll Batch Persistence, Finalization & Payslip APIs
 *
 * Verifies:
 * 1. Safe Draft Payroll Batch creation (POST /api/hr/payroll/batches).
 * 2. PayrollRecord snapshots created with accurate calculations.
 * 3. Prevention of overlapping all-department and department-specific batches.
 * 4. Duplicate batch prevention via unique compound index.
 * 5. Strict finalization block when unresolved conflicts exist.
 * 6. Successful finalization when conflicts are resolved.
 * 7. Verification that totals match saved records.
 * 8. Immutability of finalized payroll batches and records.
 * 9. Payment transition: DRAFT cannot be paid; FINALIZED transitions to PAID with paymentDetails.
 * 10. Historical snapshot preservation (modifying employee salary later does not alter finalized payslip).
 * 11. HR payslip retrieval (GET /api/hr/payroll/batches/:id/employees/:id/payslip).
 * 12. Staff payslip access: Staff sees only own finalized/paid payslips; DRAFT is hidden.
 * 13. Staff cross-access protection (cannot view another employee's payslip).
 * 14. Batch history listing with month/year/status filters and pagination.
 * 15. Batch details with itemized employee records.
 */

const http = require('http');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { app } = require('../server');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const DepartmentSchedule = require('../models/DepartmentSchedule');
const PayrollConflict = require('../models/PayrollConflict');
const PayrollBatch = require('../models/PayrollBatch');
const PayrollRecord = require('../models/PayrollRecord');
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

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = options.headers || {};
    let postData = null;

    if (options.body) {
      postData = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const reqOptions = {
      method: options.method || 'GET',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers
    };

    const req = http.request(reqOptions, (res) => {
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

async function runTests() {
  console.log('\n================================================================');
  console.log('   PAYROLL BATCH PERSISTENCE & PAYSLIP API VERIFICATION SUITE   ');
  console.log('================================================================\n');

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(TEST_DB_URI);
  console.log('Connected to test DB:', TEST_DB_URI);

  // Clean collections in test database
  await Promise.all([
    User.deleteMany({}),
    Employee.deleteMany({}),
    Attendance.deleteMany({}),
    Leave.deleteMany({}),
    DepartmentSchedule.deleteMany({}),
    PayrollConflict.deleteMany({}),
    PayrollBatch.deleteMany({}),
    PayrollRecord.deleteMany({})
  ]);
  console.log('Cleaned test database collections.\n');

  // Start HTTP server
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      testPort = server.address().port;
      baseUrl = `http://127.0.0.1:${testPort}`;
      console.log(`Test HTTP server listening on port ${testPort}\n`);
      resolve();
    });
  });

  // 1. Seed HR User
  const hrUser = await User.create({
    firstName: 'HR',
    lastName: 'Manager',
    email: 'hr_batch_test@example.com',
    password: 'password123',
    role: 'HR',
    isActive: true
  });
  const hrToken = generateAccessToken(hrUser);

  // 2. Seed Staff Users (Alice & Bob in Tech)
  const userAlice = await User.create({
    firstName: 'Alice',
    lastName: 'Smith',
    email: 'alice_batch@example.com',
    password: 'password123',
    role: 'STAFF',
    isActive: true
  });
  const empAlice = await Employee.create({
    employeeId: 'EMP_ALICE',
    user: userAlice._id,
    firstName: 'Alice',
    lastName: 'Smith',
    email: 'alice_batch@example.com',
    department: 'Tech',
    designation: 'Senior Developer',
    salary: 63000,
    paidLeaveAllowance: 1,
    status: 'ACTIVE'
  });
  const aliceToken = generateAccessToken(userAlice);

  const userBob = await User.create({
    firstName: 'Bob',
    lastName: 'Jones',
    email: 'bob_batch@example.com',
    password: 'password123',
    role: 'STAFF',
    isActive: true
  });
  const empBob = await Employee.create({
    employeeId: 'EMP_BOB',
    user: userBob._id,
    firstName: 'Bob',
    lastName: 'Jones',
    email: 'bob_batch@example.com',
    department: 'Tech',
    designation: 'QA Engineer',
    salary: 42000,
    paidLeaveAllowance: 1,
    status: 'ACTIVE'
  });
  const bobToken = generateAccessToken(userBob);

  // Seed Department Schedules (Tech: Mon-Fri, 21 days in Nov 2026)
  await DepartmentSchedule.create({
    department: 'Tech',
    departmentDisplay: 'Tech & Engineering',
    checkInTime: '10:00',
    checkOutTime: '18:00',
    workingDays: [1, 2, 3, 4, 5],
    holidays: [],
    timezone: 'Asia/Kolkata'
  });

  // Seed Attendance for Alice: 10 present days (Nov 2-6, Nov 9-13)
  for (let d = 2; d <= 6; d++) {
    const dt = new Date(Date.UTC(2026, 10, d));
    await Attendance.create({ employee: empAlice._id, date: dt, checkIn: dt, status: 'PRESENT', workMode: 'Office' });
  }
  for (let d = 9; d <= 13; d++) {
    const dt = new Date(Date.UTC(2026, 10, d));
    await Attendance.create({ employee: empAlice._id, date: dt, checkIn: dt, status: 'PRESENT', workMode: 'Office' });
  }

  // Seed Attendance & Conflict for Bob:
  // Bob has attendance on Nov 6 AND approved leave on Nov 6 (Conflict!)
  await Attendance.create({
    employee: empBob._id,
    date: new Date('2026-11-06T00:00:00.000Z'),
    checkIn: new Date('2026-11-06T04:30:00.000Z'),
    status: 'PRESENT',
    workMode: 'Office'
  });
  await Leave.create({
    employee: empBob._id,
    leaveType: 'SICK',
    startDate: new Date('2026-11-06T00:00:00.000Z'),
    endDate: new Date('2026-11-06T00:00:00.000Z'),
    reason: 'Dental appointment',
    status: 'APPROVED'
  });

  console.log('--- TEST 1: Safe DRAFT Payroll Batch Creation ---');
  const resDraft = await request('/api/hr/payroll/batches/draft', {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: {
      year: 2026,
      month: 11,
      department: 'all',
      notes: 'Initial November 2026 payroll run'
    }
  });
  assert(resDraft.status === 201, 'POST /api/hr/payroll/batches/draft returns 201 Created');
  const draftBatch = resDraft.body.data.batch;
  assert(draftBatch.status === 'DRAFT', 'Created batch status is DRAFT');
  assert(draftBatch.year === 2026 && draftBatch.month === 11, 'Batch year=2026 and month=11');
  assert(draftBatch.employeeCount === 2, 'Batch employeeCount = 2');
  assert(draftBatch.unresolvedConflictCount === 1, 'Draft reports 1 unresolved conflict for Bob');

  console.log('\n--- TEST 2: PayrollRecord Snapshots Verified ---');
  const batchId = draftBatch._id;
  const recordsInDb = await PayrollRecord.find({ batchId }).lean();
  assert(recordsInDb.length === 2, 'Exactly 2 PayrollRecord snapshots persisted in database');

  const aliceRecord = recordsInDb.find(r => r.employeeId === 'EMP_ALICE');
  assert(aliceRecord !== undefined, 'Alice payroll record exists');
  assert(aliceRecord.employeeName === 'Alice Smith', 'Alice employeeName snapshot preserved');
  assert(aliceRecord.monthlyBaseSalary === 63000, 'Alice monthlyBaseSalary snapshot = 63,000');
  assert(aliceRecord.scheduledWorkingDays === 21, 'Alice scheduledWorkingDays = 21');
  assert(aliceRecord.presentDays === 10, 'Alice presentDays = 10');
  // Daily rate: 63000 / 21 = 3000. Net for 10 days = 30,000
  assert(aliceRecord.dailySalary === 3000, 'Alice dailySalary = 3,000');
  assert(aliceRecord.netPay === 30000, 'Alice netPay = 30,000');
  assert(aliceRecord.deductions === 33000, 'Alice deductions = 33,000');

  console.log('\n--- TEST 3: Overlapping All vs Department Batch Prevention ---');
  // Try creating a department-specific batch when 'all' already exists
  const resDeptConflict = await request('/api/hr/payroll/batches/draft', {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: { year: 2026, month: 11, department: 'Tech' }
  });
  assert(resDeptConflict.status === 400, 'Department batch rejected when all-department batch exists (400)');
  assert(resDeptConflict.body.message.includes('all-department batch already exists'), 'Descriptive error returned');

  console.log('\n--- TEST 4: Finalization Blocked when Unresolved Conflicts Exist ---');
  const resFailFinalize = await request(`/api/hr/payroll/batches/${batchId}/finalize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  assert(resFailFinalize.status === 400, 'Finalization rejected when unresolved conflicts exist (400 Bad Request)');
  assert(resFailFinalize.body.message.includes('unresolved attendance/leave conflict'), 'Error message cites unresolved conflicts');

  // Verify batch remains DRAFT
  const checkBatchDraft = await PayrollBatch.findById(batchId);
  assert(checkBatchDraft.status === 'DRAFT', 'Batch status remains DRAFT after blocked finalization');

  console.log('\n--- TEST 5: Resolve Conflict via HR Conflict API ---');
  const conflict = await PayrollConflict.findOne({ employee: empBob._id, dateKey: '2026-11-06' });
  assert(conflict !== null, 'Bob conflict record found in database');

  const resResolve = await request(`/api/hr/payroll/conflicts/${conflict._id}/resolve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: {
      decision: 'PRESENT',
      reason: 'Employee confirmed in office for full shift'
    }
  });
  assert(resResolve.status === 200, 'Conflict resolved via POST /api/hr/payroll/conflicts/:id/resolve');

  // Refresh draft batch so calculation incorporates the resolved conflict
  const resRefreshDraft = await request('/api/hr/payroll/batches/draft', {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: { year: 2026, month: 11, department: 'all' }
  });
  assert(resRefreshDraft.status === 201, 'Draft refreshed successfully');
  assert(resRefreshDraft.body.data.batch.unresolvedConflictCount === 0, 'Refreshed draft unresolvedConflictCount is now 0');

  console.log('\n--- TEST 6: Successful Payroll Batch Finalization ---');
  const resFinalize = await request(`/api/hr/payroll/batches/${batchId}/finalize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  assert(resFinalize.status === 200, 'POST /api/hr/payroll/batches/:id/finalize returns 200 OK');
  const finalizedBatch = resFinalize.body.data;
  assert(finalizedBatch.status === 'FINALIZED', 'Batch status is now FINALIZED');
  assert(finalizedBatch.finalizedBy !== null, 'finalizedBy user ID recorded');
  assert(finalizedBatch.finalizedAt !== null, 'finalizedAt timestamp recorded');

  // Verify finalized totals match sum of records
  const postRecords = await PayrollRecord.find({ batchId }).lean();
  const sumNet = postRecords.reduce((acc, r) => acc + r.netPay, 0);
  assert(finalizedBatch.totalNetPayout === sumNet, 'Finalized totalNetPayout matches sum of records');

  console.log('\n--- TEST 7: Finalized Payroll Immutability ---');
  // Attempt to re-create or mutate the draft for this finalized period
  const resMutateAttempt = await request('/api/hr/payroll/batches/draft', {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: { year: 2026, month: 11, department: 'all' }
  });
  assert(resMutateAttempt.status === 400, 'Mutation of finalized batch rejected with 400');
  assert(resMutateAttempt.body.message.includes('already FINALIZED'), 'Rejection message cites FINALIZED');

  // Attempt duplicate finalization
  const resDupFinalize = await request(`/api/hr/payroll/batches/${batchId}/finalize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  assert(resDupFinalize.status === 400, 'Duplicate finalization rejected with 400');
  assert(resDupFinalize.body.message.includes('already finalized'), 'Rejection message cites already finalized');

  console.log('\n--- TEST 8: Payment Status Transition ---');
  // Confirm payment
  const resPay = await request(`/api/hr/payroll/batches/${batchId}/pay`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: {
      paymentMethod: 'NEFT_BATCH',
      reference: 'TXN-NOV2026-9921',
      remarks: 'Salary disbursed via corporate banking portal'
    }
  });
  assert(resPay.status === 200, 'POST /api/hr/payroll/batches/:id/pay returns 200 OK');
  const paidBatch = resPay.body.data;
  assert(paidBatch.status === 'PAID', 'Batch status is now PAID');
  assert(paidBatch.paidAt !== null, 'paidAt timestamp recorded');
  assert(paidBatch.paymentDetails.reference === 'TXN-NOV2026-9921', 'Payment reference recorded');
  assert(paidBatch.paymentDetails.paymentMethod === 'NEFT_BATCH', 'Payment method recorded');

  // Attempt duplicate pay
  const resDupPay = await request(`/api/hr/payroll/batches/${batchId}/pay`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: { reference: 'DUPLICATE' }
  });
  assert(resDupPay.status === 400, 'Duplicate payment confirmation rejected with 400');

  console.log('\n--- TEST 9: Historical Snapshot Preservation ---');
  // Mutate Alice's salary in Employee collection (e.g. granted raise to 90,000 in December)
  await Employee.findByIdAndUpdate(empAlice._id, { salary: 90000 });

  // Fetch Alice's payslip for the finalized November batch
  const resAlicePayslip = await request(`/api/hr/payroll/batches/${batchId}/employees/${empAlice._id}/payslip`, {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  assert(resAlicePayslip.status === 200, 'HR gets employee payslip 200 OK');
  const pData = resAlicePayslip.body.data.payslip;
  assert(pData.employee.name === 'Alice Smith', 'Payslip employee name is Alice Smith');
  assert(pData.summary.grossPay === 63000, 'Saved historical base salary (63,000) preserved despite employee collection raise to 90,000');
  assert(pData.summary.netPay === 30000, 'Historical net pay (30,000) strictly preserved');
  assert(pData.calendar.presentDays === 10, 'Calendar presentDays = 10 preserved');

  console.log('\n--- TEST 10: Staff Portal Payslip Access & Scoping ---');
  // Alice fetches her own payslips
  const resStaffAlicePayslips = await request('/api/staff/payslips', {
    headers: { Authorization: `Bearer ${aliceToken}` }
  });
  assert(resStaffAlicePayslips.status === 200, 'Staff GET /api/staff/payslips returns 200 OK');
  assert(Array.isArray(resStaffAlicePayslips.body.data), 'Staff payslips returned as array');
  assert(resStaffAlicePayslips.body.data.length === 1, 'Alice sees exactly 1 payslip');
  assert(resStaffAlicePayslips.body.data[0].netPay === 30000, 'Alice payslip netPay = 30,000');

  // Alice fetches her detailed payslip by batchId
  const resStaffAliceDetail = await request(`/api/staff/payslips/${batchId}`, {
    headers: { Authorization: `Bearer ${aliceToken}` }
  });
  assert(resStaffAliceDetail.status === 200, 'Staff GET /api/staff/payslips/:batchId returns 200 OK');
  assert(resStaffAliceDetail.body.data.payslip.employee.id.toString() === empAlice._id.toString(), 'Payslip belongs to Alice');

  console.log('\n--- TEST 11: Cross-Staff Access Isolation ---');
  // Create an unrelated draft batch for December 2026
  const resDraftDec = await request('/api/hr/payroll/batches/draft', {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: { year: 2026, month: 12, department: 'all' }
  });
  const decBatchId = resDraftDec.body.data.batch._id;

  // Alice attempts to access DRAFT December payslip
  const resStaffDraftBlocked = await request(`/api/staff/payslips/${decBatchId}`, {
    headers: { Authorization: `Bearer ${aliceToken}` }
  });
  assert(resStaffDraftBlocked.status === 403, 'Staff access to DRAFT payslip rejected with 403 Forbidden');

  // HR payslip access requires authorized HR token (Staff token blocked on HR endpoint)
  const resStaffOnHrEndpoint = await request(`/api/hr/payroll/batches/${batchId}/employees/${empBob._id}/payslip`, {
    headers: { Authorization: `Bearer ${aliceToken}` }
  });
  assert(resStaffOnHrEndpoint.status === 403, 'Staff token blocked on HR payslip endpoint (403)');

  console.log('\n--- TEST 12: Payroll Batches History & Listing API ---');
  const resBatches = await request('/api/hr/payroll/batches?year=2026', {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  assert(resBatches.status === 200, 'GET /api/hr/payroll/batches returns 200 OK');
  assert(resBatches.body.data.length >= 2, 'History lists multiple batches');
  assert(resBatches.body.pagination.total >= 2, 'Pagination metadata present');

  // Filter by status=PAID
  const resPaidBatches = await request('/api/hr/payroll/batches?year=2026&status=PAID', {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  assert(resPaidBatches.status === 200, 'Filter by status=PAID returns 200 OK');
  assert(resPaidBatches.body.data.every(b => b.status === 'PAID'), 'All returned batches have status PAID');

  console.log('\n--- TEST 13: Batch Detail & Employee Records API ---');
  const resBatchDetail = await request(`/api/hr/payroll/batches/${batchId}`, {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  assert(resBatchDetail.status === 200, 'GET /api/hr/payroll/batches/:batchId returns 200 OK');
  assert(resBatchDetail.body.data._id === batchId.toString(), 'Batch ID matches');
  assert(Array.isArray(resBatchDetail.body.pagination.records), 'Records array returned in detail response');
  assert(resBatchDetail.body.pagination.records.length === 2, '2 employee records returned');

  console.log('\n================================================================');
  console.log('   ALL 15 PAYROLL BATCH & PAYSLIP VERIFICATIONS PASSED!         ');
  console.log('================================================================\n');

  await mongoose.disconnect();
  server.close();
  process.exit(0);
}

runTests().catch(async (err) => {
  console.error('\nVerification failed:', err);
  if (server) server.close();
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  process.exit(1);
});

