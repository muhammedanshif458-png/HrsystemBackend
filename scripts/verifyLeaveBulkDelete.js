const mongoose = require('mongoose');
const http = require('http');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { app } = require('../server');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Leave = require('../models/Leave');
const Attendance = require('../models/Attendance');
const Task = require('../models/Task');

const TEST_DB_URI = process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017/hr_management_leave_bulk_test';

let server;
let baseUrl;
let hrToken;
let superAdminToken;
let staffToken;

let techEmp;
let teleEmp;

function assert(condition, message) {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}

async function request(endpoint, options = {}) {
  const url = `${baseUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const status = response.status;
  let json = null;
  try {
    json = await response.json();
  } catch (_) {}

  return { status, body: json };
}

async function run() {
  console.log('\n================================================================');
  console.log('   SECURE LEAVE BULK DELETION VERIFICATION TEST SUITE');
  console.log('   (Bulk Delete, Clear All, Status Enforcement & Scoped Filtering)');
  console.log('================================================================\n');

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(TEST_DB_URI);
  console.log(`Connected to test DB: ${TEST_DB_URI}`);
  await mongoose.connection.db.dropDatabase();
  console.log('Database dropped and fresh for testing.\n');

  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`Test server listening at ${baseUrl}\n`);
      resolve();
    });
  });

  // 1. Seed Accounts
  console.log('--- SEEDING IDENTITIES ---');
  const hrUser = new User({
    firstName: 'Anita',
    lastName: 'Rao',
    email: 'anita.hr@testcorp.com',
    password: 'Password123!',
    role: 'HR',
    isActive: true
  });
  await hrUser.save();
  const hrLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'anita.hr@testcorp.com', password: 'Password123!' }
  });
  assert(hrLogin.status === 200, 'HR login successful');
  hrToken = hrLogin.body.data.token || hrLogin.body.data.accessToken;

  const saUser = new User({
    firstName: 'Super',
    lastName: 'Admin',
    email: 'superadmin@testcorp.com',
    password: 'Password123!',
    role: 'SUPER_ADMIN',
    isActive: true
  });
  await saUser.save();
  const saLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'superadmin@testcorp.com', password: 'Password123!' }
  });
  assert(saLogin.status === 200, 'Super Admin login successful');
  superAdminToken = saLogin.body.data.token || saLogin.body.data.accessToken;

  const staffUser = new User({
    firstName: 'Rohan',
    lastName: 'Verma',
    email: 'rohan.tech@testcorp.com',
    password: 'Password123!',
    role: 'STAFF',
    isActive: true
  });
  await staffUser.save();
  const staffLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'rohan.tech@testcorp.com', password: 'Password123!' }
  });
  assert(staffLogin.status === 200, 'Staff login successful');
  staffToken = staffLogin.body.data.token || staffLogin.body.data.accessToken;

  techEmp = new Employee({
    employeeId: 'EMP1001',
    user: staffUser._id,
    firstName: 'Rohan',
    lastName: 'Verma',
    email: 'rohan.tech@testcorp.com',
    department: 'Tech',
    designation: 'Software Engineer',
    status: 'ACTIVE'
  });
  await techEmp.save();

  teleEmp = new Employee({
    employeeId: 'EMP1002',
    user: hrUser._id, // linked for testing
    firstName: 'Pooja',
    lastName: 'Sharma',
    email: 'pooja.tele@testcorp.com',
    department: 'Telecalling',
    designation: 'Client Relationship Officer',
    status: 'ACTIVE'
  });
  await teleEmp.save();

  // Create an Attendance and Task record to verify zero cascade/side-effects
  const attendanceRecord = new Attendance({
    employee: techEmp._id,
    date: new Date('2026-10-25'),
    checkIn: new Date('2026-10-25T10:00:00.000Z'),
    status: 'PRESENT'
  });
  await attendanceRecord.save();

  const taskRecord = new Task({
    employee: techEmp._id,
    department: 'Tech',
    dueDate: '2026-11-01',
    title: 'Maintain Architecture',
    description: 'Ensure clean architecture',
    status: 'in-progress'
  });
  await taskRecord.save();

  // -------------------------------------------------------------------------
  // TEST GROUP 1: Access Control & Authorization Checks
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 1: Access Control & Authorization ---');
  {
    // Unauthenticated calls must return 401
    const unauthBulk = await request('/api/hr/leaves', { method: 'DELETE' });
    assert(unauthBulk.status === 401, 'DELETE /api/hr/leaves without token returns 401');

    const unauthClearAll = await request('/api/hr/leaves/all', { method: 'DELETE' });
    assert(unauthClearAll.status === 401, 'DELETE /api/hr/leaves/all without token returns 401');

    const unauthSingle = await request(`/api/hr/leaves/${new mongoose.Types.ObjectId()}`, { method: 'DELETE' });
    assert(unauthSingle.status === 401, 'DELETE /api/hr/leaves/:id without token returns 401');

    // Staff member calls must return 403 Forbidden
    const staffBulk = await request('/api/hr/leaves', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${staffToken}` },
      body: { ids: [new mongoose.Types.ObjectId().toString()] }
    });
    assert(staffBulk.status === 403, 'Staff token on DELETE /api/hr/leaves returns 403 Forbidden');

    const staffClearAll = await request('/api/hr/leaves/all', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${staffToken}` },
      body: { status: 'APPROVED' }
    });
    assert(staffClearAll.status === 403, 'Staff token on DELETE /api/hr/leaves/all returns 403 Forbidden');
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 2: Input Validation, Empty Selection & Ineligible Status Rejection
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: Validation & Protection of Ineligible Requests ---');
  {
    // Empty array
    const emptyRes = await request('/api/hr/leaves', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { ids: [] }
    });
    assert(emptyRes.status === 400, 'Empty ids array rejected with 400 Bad Request');

    // Missing ids
    const missingRes = await request('/api/hr/leaves', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: {}
    });
    assert(missingRes.status === 400, 'Missing ids field rejected with 400 Bad Request');

    // Invalid ObjectId format
    const invalidFormatRes = await request('/api/hr/leaves', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { ids: ['not-a-valid-id', '12345'] }
    });
    assert(invalidFormatRes.status === 400, 'Malformed ObjectId strings rejected with 400 Bad Request');

    // Non-existent ID
    const fakeId = new mongoose.Types.ObjectId().toString();
    const notFoundRes = await request('/api/hr/leaves', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { ids: [fakeId] }
    });
    assert(notFoundRes.status === 404, 'Non-existent leave request ID rejected with 404 Not Found');

    // Seed a PENDING leave request
    const pendingLeave = new Leave({
      employee: techEmp._id,
      leaveType: 'CASUAL',
      startDate: new Date('2026-11-01'),
      endDate: new Date('2026-11-02'),
      reason: 'Personal errand',
      status: 'PENDING'
    });
    await pendingLeave.save();

    // Attempt to delete PENDING leave
    const delPendingRes = await request('/api/hr/leaves', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { ids: [pendingLeave._id.toString()] }
    });
    assert(delPendingRes.status === 400, 'Attempt to delete PENDING leave rejected with 400 Bad Request');
    assert(
      delPendingRes.body.message.includes('Only APPROVED and REJECTED'),
      'Error message explicitly specifies only APPROVED and REJECTED can be deleted'
    );

    // Verify PENDING leave was NOT deleted
    const stillPending = await Leave.findById(pendingLeave._id);
    assert(stillPending !== null, 'PENDING leave was strictly preserved in the database');

    // Single delete endpoint on PENDING request
    const singlePendingRes = await request(`/api/hr/leaves/${pendingLeave._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(singlePendingRes.status === 400, 'Single delete on PENDING request rejected with 400 Bad Request');

    // Seed CANCELLED leave request
    const cancelledLeave = new Leave({
      employee: techEmp._id,
      leaveType: 'SICK',
      startDate: new Date('2026-11-05'),
      endDate: new Date('2026-11-06'),
      reason: 'Fever',
      status: 'CANCELLED'
    });
    await cancelledLeave.save();

    const delCancelledRes = await request('/api/hr/leaves', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { ids: [cancelledLeave._id.toString()] }
    });
    assert(delCancelledRes.status === 400, 'Attempt to delete CANCELLED leave rejected with 400 Bad Request');
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 3: Delete Selected REJECTED Requests
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: Bulk Delete Selected REJECTED Leaves ---');
  let rej1, rej2, rej3;
  {
    rej1 = new Leave({
      employee: techEmp._id,
      leaveType: 'CASUAL',
      startDate: new Date('2026-10-10'),
      endDate: new Date('2026-10-11'),
      reason: 'Vacation request',
      status: 'REJECTED',
      rejectionReason: 'Understaffed'
    });
    rej2 = new Leave({
      employee: techEmp._id,
      leaveType: 'CASUAL',
      startDate: new Date('2026-10-12'),
      endDate: new Date('2026-10-13'),
      reason: 'Trip',
      status: 'REJECTED',
      rejectionReason: 'Conflict with deployment'
    });
    rej3 = new Leave({
      employee: teleEmp._id,
      leaveType: 'SICK',
      startDate: new Date('2026-10-14'),
      endDate: new Date('2026-10-15'),
      reason: 'Flu',
      status: 'REJECTED',
      rejectionReason: 'No documentation'
    });
    await Promise.all([rej1.save(), rej2.save(), rej3.save()]);

    // Delete selected: rej1 and rej2
    const delRejRes = await request('/api/hr/leaves', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { ids: [rej1._id.toString(), rej2._id.toString()], status: 'REJECTED' }
    });
    assert(delRejRes.status === 200, 'DELETE /api/hr/leaves returns 200 OK');
    assert(delRejRes.body.data.deletedCount === 2, 'deletedCount is 2');

    // Confirm rej1 and rej2 are permanently removed from DB
    const checkRej1 = await Leave.findById(rej1._id);
    const checkRej2 = await Leave.findById(rej2._id);
    const checkRej3 = await Leave.findById(rej3._id);
    assert(checkRej1 === null, 'rej1 was permanently removed from MongoDB');
    assert(checkRej2 === null, 'rej2 was permanently removed from MongoDB');
    assert(checkRej3 !== null, 'Unselected rej3 remains in MongoDB');
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 4: Delete Selected APPROVED Requests
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: Bulk Delete Selected APPROVED Leaves ---');
  let app1, app2, app3;
  {
    app1 = new Leave({
      employee: techEmp._id,
      leaveType: 'ANNUAL',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-09-05'),
      reason: 'Annual family holiday',
      status: 'APPROVED',
      approvedBy: hrUser._id,
      approvedAt: new Date('2026-08-25')
    });
    app2 = new Leave({
      employee: techEmp._id,
      leaveType: 'MEDICAL',
      startDate: new Date('2026-09-10'),
      endDate: new Date('2026-09-12'),
      reason: 'Dental surgery',
      status: 'APPROVED',
      approvedBy: hrUser._id,
      approvedAt: new Date('2026-09-08')
    });
    app3 = new Leave({
      employee: teleEmp._id,
      leaveType: 'CASUAL',
      startDate: new Date('2026-09-20'),
      endDate: new Date('2026-09-21'),
      reason: 'Personal day',
      status: 'APPROVED',
      approvedBy: hrUser._id,
      approvedAt: new Date('2026-09-19')
    });
    await Promise.all([app1.save(), app2.save(), app3.save()]);

    // Test alternative endpoint: POST /api/hr/leaves/bulk-delete
    const delAppRes = await request('/api/hr/leaves/bulk-delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${superAdminToken}` },
      body: { ids: [app1._id.toString(), app2._id.toString()], status: 'APPROVED' }
    });
    assert(delAppRes.status === 200, 'POST /api/hr/leaves/bulk-delete returns 200 OK');
    assert(delAppRes.body.data.deletedCount === 2, 'deletedCount is 2');

    const checkApp1 = await Leave.findById(app1._id);
    const checkApp2 = await Leave.findById(app2._id);
    const checkApp3 = await Leave.findById(app3._id);
    assert(checkApp1 === null, 'app1 was permanently removed from MongoDB');
    assert(checkApp2 === null, 'app2 was permanently removed from MongoDB');
    assert(checkApp3 !== null, 'Unselected app3 remains in MongoDB');
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 5: Single Delete by ID (DELETE /api/hr/leaves/:id)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 5: Single Delete by ID ---');
  {
    const singleDelRes = await request(`/api/hr/leaves/${rej3._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(singleDelRes.status === 200, 'DELETE /api/hr/leaves/:id on REJECTED request returns 200 OK');
    assert(singleDelRes.body.data.deletedCount === 1, 'deletedCount is 1');

    const checkRej3After = await Leave.findById(rej3._id);
    assert(checkRej3After === null, 'rej3 successfully deleted via single DELETE endpoint');
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 6: Clear All Validation (Protection against Indiscriminate Deletion)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 6: Clear All Validation & Safety Guards ---');
  {
    // Clear all with missing status
    const noStatusRes = await request('/api/hr/leaves/all', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: {}
    });
    assert(noStatusRes.status === 400, 'Clear all without status rejected with 400 Bad Request');
    assert(
      noStatusRes.body.message.includes('Indiscriminate deletion of all leave requests is strictly forbidden'),
      'Rejection message warns against indiscriminate deletion'
    );

    // Clear all with PENDING status
    const pendingClearRes = await request('/api/hr/leaves/all', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { status: 'PENDING' }
    });
    assert(pendingClearRes.status === 400, 'Clear all for PENDING status rejected with 400 Bad Request');

    // Clear all with CANCELLED status
    const cancelledClearRes = await request('/api/hr/leaves/all', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { status: 'CANCELLED' }
    });
    assert(cancelledClearRes.status === 400, 'Clear all for CANCELLED status rejected with 400 Bad Request');
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 7: Clear All REJECTED Without Affecting Approved or Pending
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 7: Clear All REJECTED Leaves ---');
  {
    // Seed 3 more rejected leaves
    await Leave.insertMany([
      {
        employee: techEmp._id,
        leaveType: 'CASUAL',
        startDate: new Date('2026-10-01'),
        endDate: new Date('2026-10-02'),
        reason: 'R1',
        status: 'REJECTED'
      },
      {
        employee: teleEmp._id,
        leaveType: 'SICK',
        startDate: new Date('2026-10-03'),
        endDate: new Date('2026-10-04'),
        reason: 'R2',
        status: 'REJECTED'
      },
      {
        employee: techEmp._id,
        leaveType: 'UNPAID',
        startDate: new Date('2026-10-05'),
        endDate: new Date('2026-10-06'),
        reason: 'R3',
        status: 'REJECTED'
      }
    ]);

    const countRejectedBefore = await Leave.countDocuments({ status: 'REJECTED' });
    const countApprovedBefore = await Leave.countDocuments({ status: 'APPROVED' });
    const countPendingBefore = await Leave.countDocuments({ status: 'PENDING' });
    assert(countRejectedBefore === 3, 'Seeded 3 rejected leaves');
    assert(countApprovedBefore >= 1, 'Approved leaves exist before clear');
    assert(countPendingBefore >= 1, 'Pending leaves exist before clear');

    // Clear all REJECTED
    const clearRejRes = await request('/api/hr/leaves/all', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { status: 'REJECTED' }
    });
    assert(clearRejRes.status === 200, 'DELETE /api/hr/leaves/all returns 200 OK');
    assert(clearRejRes.body.data.deletedCount === 3, 'Successfully cleared all 3 rejected requests');

    const countRejectedAfter = await Leave.countDocuments({ status: 'REJECTED' });
    const countApprovedAfter = await Leave.countDocuments({ status: 'APPROVED' });
    const countPendingAfter = await Leave.countDocuments({ status: 'PENDING' });

    assert(countRejectedAfter === 0, 'All REJECTED leaves are now 0 in MongoDB');
    assert(countApprovedAfter === countApprovedBefore, 'APPROVED leaves were completely unaffected');
    assert(countPendingAfter === countPendingBefore, 'PENDING leaves were completely unaffected');
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 8: Clear All APPROVED with Scoped Filters
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 8: Clear All APPROVED Leaves with Scoped Filters ---');
  {
    // Seed approved leaves in Tech and Telecalling
    const techApp1 = new Leave({
      employee: techEmp._id,
      leaveType: 'SICK',
      startDate: new Date('2026-10-15'),
      endDate: new Date('2026-10-16'),
      reason: 'Tech sick leave',
      status: 'APPROVED'
    });
    const techApp2 = new Leave({
      employee: techEmp._id,
      leaveType: 'CASUAL',
      startDate: new Date('2026-10-18'),
      endDate: new Date('2026-10-19'),
      reason: 'Tech casual leave',
      status: 'APPROVED'
    });
    const teleApp1 = new Leave({
      employee: teleEmp._id,
      leaveType: 'CASUAL',
      startDate: new Date('2026-10-20'),
      endDate: new Date('2026-10-21'),
      reason: 'Telecalling casual leave',
      status: 'APPROVED'
    });
    await Promise.all([techApp1.save(), techApp2.save(), teleApp1.save()]);

    // Test clearing approved leaves scoped to department: Tech
    const clearTechRes = await request('/api/hr/leaves/clear-all', {
      method: 'POST',
      headers: { Authorization: `Bearer ${superAdminToken}` },
      body: { status: 'APPROVED', department: 'Tech' }
    });
    assert(clearTechRes.status === 200, 'POST /api/hr/leaves/clear-all with department=Tech returns 200 OK');
    assert(clearTechRes.body.data.deletedCount === 2, 'Deleted exactly the 2 Tech approved leaves');

    // Confirm Telecalling approved leaves remain intact
    const checkTeleApp1 = await Leave.findById(teleApp1._id);
    assert(checkTeleApp1 !== null, 'Telecalling approved leave remains intact in MongoDB');

    // Test clearing by leaveType
    const clearCasualRes = await request('/api/hr/leaves/all', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { status: 'APPROVED', leaveType: 'CASUAL' }
    });
    assert(clearCasualRes.status === 200, 'DELETE /api/hr/leaves/all with leaveType=CASUAL returns 200 OK');
    assert(clearCasualRes.body.data.deletedCount >= 1, 'Deleted casual approved leave');

    const checkTeleApp1After = await Leave.findById(teleApp1._id);
    assert(checkTeleApp1After === null, 'Telecalling casual approved leave deleted by leaveType filter');
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 9: Reports & Dashboard Metric Consistency After Deletion
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 9: Reports & Dashboard Metrics Consistency ---');
  {
    // Fetch HR Leave Reports
    const reportsRes = await request('/api/hr/reports/leaves', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(reportsRes.status === 200, 'GET /api/hr/reports/leaves returns 200 OK');
    const statusSummary = reportsRes.body.data.statusSummary || [];

    const overlapReports = await request('/api/hr/reports/leaves?startDate=2026-11-02&endDate=2026-11-02', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    const overlapDetails = await request('/api/hr/leaves?startDate=2026-11-02&endDate=2026-11-02&page=1&limit=1', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    const overlapPendingCount = overlapReports.body.data.statusSummary.find((item) => item._id === 'PENDING')?.count || 0;
    const overlapSummaryTotal = overlapReports.body.data.statusSummary.reduce((sum, item) => sum + item.count, 0);
    assert(overlapDetails.body.pagination.total === overlapSummaryTotal, 'inclusive date summary equals detail total across a one-row page');
    assert(overlapPendingCount >= 1, 'leave report uses the same inclusive overlapping range semantics');
    assert(!('document' in overlapDetails.body.data[0]) && !('email' in overlapDetails.body.data[0].employee), 'HR leave list omits document metadata and employee email');
    const combinedQuery = '?department=tech&startDate=2026-11-02&endDate=2026-11-02&status=pending&leaveType=casual';
    const combinedReport = await request(`/api/hr/reports/leaves${combinedQuery}`, { headers: { Authorization: `Bearer ${hrToken}` } });
    const combinedDetails = await request(`/api/hr/leaves${combinedQuery}&page=1&limit=1`, { headers: { Authorization: `Bearer ${hrToken}` } });
    const combinedTotal = combinedReport.body.data.statusSummary.reduce((sum, item) => sum + item.count, 0);
    assert(combinedTotal === 1 && combinedDetails.body.pagination.total === combinedTotal, 'combined case-insensitive department/date/status/type filters agree with paginated total');
    assert(combinedDetails.body.data.every((leave) => leave.employee.department === 'Tech'), 'leave department filter matches actual employee department exactly');
    const emptyDepartment = await request('/api/hr/leaves?department=missing-department', { headers: { Authorization: `Bearer ${hrToken}` } });
    const emptyReport = await request('/api/hr/reports/leaves?department=missing-department', { headers: { Authorization: `Bearer ${hrToken}` } });
    assert(emptyDepartment.body.pagination.total === 0 && emptyReport.body.data.statusSummary.length === 0, 'unknown leave department returns consistent empty results');
    assert((await request(`/api/hr/reports/leaves${combinedQuery}`, { headers: { Authorization: `Bearer ${staffToken}` } })).status === 403, 'leave report preserves HR/SUPER_ADMIN authorization');

    const rejectedSummaryItem = statusSummary.find(s => s._id === 'REJECTED');
    assert(!rejectedSummaryItem || rejectedSummaryItem.count === 0, 'Leave report confirms 0 REJECTED records');

    // Fetch HR Dashboard
    const dashRes = await request('/api/hr/dashboard', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(dashRes.status === 200, 'GET /api/hr/dashboard returns 200 OK');
    assert(dashRes.body.data.pendingLeaves >= 1, 'Dashboard pendingLeaves metric reflects preserved pending leaves');

    // Verify non-leave collections were NOT affected
    const checkAttendance = await Attendance.findById(attendanceRecord._id);
    assert(checkAttendance !== null, 'Attendance record remains intact (no cascade deletion)');

    const checkTask = await Task.findById(taskRecord._id);
    assert(checkTask !== null, 'Task record remains intact (no cascade deletion)');

    const checkEmployee = await Employee.findById(techEmp._id);
    assert(checkEmployee !== null, 'Employee record remains intact (no cascade deletion)');
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 10: Preserving Leave Approval & Rejection Workflows
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 10: Preserving Approval & Rejection Workflows ---');
  {
    // Seed a new pending leave request
    const freshPending = new Leave({
      employee: techEmp._id,
      leaveType: 'MEDICAL',
      startDate: new Date('2026-12-01'),
      endDate: new Date('2026-12-03'),
      reason: 'Checkup',
      status: 'PENDING'
    });
    await freshPending.save();

    // Approve workflow
    const approveRes = await request(`/api/hr/leaves/${freshPending._id}/approve`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(approveRes.status === 200, 'PUT /api/hr/leaves/:id/approve works as expected');
    assert(approveRes.body.data.status === 'APPROVED', 'Status transitioned to APPROVED');

    // Reject workflow on another request
    const freshPending2 = new Leave({
      employee: techEmp._id,
      leaveType: 'CASUAL',
      startDate: new Date('2026-12-10'),
      endDate: new Date('2026-12-11'),
      reason: 'Personal',
      status: 'PENDING'
    });
    await freshPending2.save();

    const rejectRes = await request(`/api/hr/leaves/${freshPending2._id}/reject`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { rejectionReason: 'Peak business period' }
    });
    assert(rejectRes.status === 200, 'PUT /api/hr/leaves/:id/reject works as expected');
    assert(rejectRes.body.data.status === 'REJECTED', 'Status transitioned to REJECTED');
  }

  // Cleanup
  server.close();
  await mongoose.disconnect();

  console.log('\n================================================================');
  console.log('   ALL LEAVE BULK DELETION TESTS PASSED! (100%)');
  console.log('================================================================\n');
}

run().catch((err) => {
  console.error('\nTest failed with error:', err);
  if (server) server.close();
  mongoose.disconnect();
  process.exit(1);
});
