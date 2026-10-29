const mongoose = require('mongoose');
const http = require('http');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { app } = require('../server');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const Task = require('../models/Task');
const hrService = require('../services/hrService');

const TEST_DB_URI = process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017/hr_management_lifecycle_test';

let server;
let baseUrl;
let hrToken;
let staffToken;

function assert(condition, message) {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}

function getList(res) {
  if (Array.isArray(res.body?.data)) return res.body.data;
  if (Array.isArray(res.body?.data?.employees)) return res.body.data.employees;
  return [];
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
  console.log('   EMPLOYEE LIFECYCLE VERIFICATION SUITE');
  console.log('   (Deactivate, Reactivate, Resign, Delete & Data Integrity)');
  console.log('================================================================\n');

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(TEST_DB_URI);
  console.log(`Connected to test DB: ${TEST_DB_URI}`);
  await mongoose.connection.db.dropDatabase();
  console.log('Database dropped and fresh for lifecycle verification.\n');

  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`Test HTTP server listening at ${baseUrl}\n`);
      resolve();
    });
  });

  // Seed HR user and login
  const hrUser = new User({
    firstName: 'HR',
    lastName: 'Manager',
    email: 'hr.manager@testcorp.com',
    password: 'Password123!',
    role: 'HR',
    isActive: true
  });
  await hrUser.save();

  const hrLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'hr.manager@testcorp.com', password: 'Password123!' }
  });
  assert(hrLogin.status === 200, 'HR login successful');
  hrToken = hrLogin.body.data.token || hrLogin.body.data.accessToken;

  // Seed normal Staff user and login
  const staffUser = new User({
    firstName: 'Normal',
    lastName: 'Staff',
    email: 'staff.member@testcorp.com',
    password: 'Password123!',
    role: 'STAFF',
    isActive: true
  });
  await staffUser.save();

  const staffLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'staff.member@testcorp.com', password: 'Password123!' }
  });
  assert(staffLogin.status === 200, 'Staff login successful');
  staffToken = staffLogin.body.data.token || staffLogin.body.data.accessToken;

  console.log('\n--- TEST GROUP 1: RBAC & Authentication on Lifecycle Endpoints ---');
  {
    // Unauthorized check
    const unauthDeact = await request('/api/hr/employees/dummy123/deactivate', { method: 'POST' });
    assert(unauthDeact.status === 401, 'POST /deactivate without auth returns 401');

    // Forbidden check (Staff token)
    const staffDeact = await request('/api/hr/employees/dummy123/deactivate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}` }
    });
    assert(staffDeact.status === 403, 'POST /deactivate with STAFF role returns 403 Forbidden');

    const staffReact = await request('/api/hr/employees/dummy123/reactivate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}` }
    });
    assert(staffReact.status === 403, 'POST /reactivate with STAFF role returns 403 Forbidden');

    const staffResign = await request('/api/hr/employees/dummy123/resign', {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}` }
    });
    assert(staffResign.status === 403, 'POST /resign with STAFF role returns 403 Forbidden');

    const staffDelete = await request('/api/hr/employees/dummy123', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${staffToken}` }
    });
    assert(staffDelete.status === 403, 'DELETE /employees/:id with STAFF role returns 403 Forbidden');
  }

  console.log('\n--- TEST GROUP 2: Create Active Employee & Initial State ---');
  let testEmpId;
  let testEmpObjId;
  {
    const createRes = await request('/api/hr/employees', {
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: {
        employeeId: 'EMP-LIFE-001',
        firstName: 'Vikram',
        lastName: 'Malhotra',
        email: 'vikram.m@testcorp.com',
        phone: '9876543210',
        department: 'Tech',
        designation: 'Software Engineer',
        password: 'Secret123456',
        joiningDate: '2024-01-15'
      }
    });
    assert(createRes.status === 201, 'Active employee created successfully');
    testEmpId = createRes.body.data.employeeId;
    testEmpObjId = createRes.body.data._id || createRes.body.data.id;
    assert(createRes.body.data.status === 'ACTIVE', 'Initial status is ACTIVE');

    // Test that new user can log in
    const empLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'vikram.m@testcorp.com', password: 'Secret123456' }
    });
    assert(empLogin.status === 200, 'Newly created active employee can login');

    // Listing API filter check
    const activeList = await request('/api/hr/employees?status=ACTIVE', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    const foundInActive = getList(activeList).find(e => e.employeeId === 'EMP-LIFE-001');
    assert(foundInActive !== undefined, 'Employee appears in GET /api/hr/employees?status=ACTIVE');
    assert(foundInActive.isResigned === false, 'isResigned is false');
    assert(foundInActive.isDeactivated === false, 'isDeactivated is false');

    const inactiveList = await request('/api/hr/employees?status=INACTIVE', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    const foundInInactive = getList(inactiveList).find(e => e.employeeId === 'EMP-LIFE-001');
    assert(foundInInactive === undefined, 'Active employee does NOT appear in status=INACTIVE');

    const resignedList = await request('/api/hr/employees?status=RESIGNED', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    const foundInResigned = getList(resignedList).find(e => e.employeeId === 'EMP-LIFE-001');
    assert(foundInResigned === undefined, 'Active employee does NOT appear in status=RESIGNED');
  }

  console.log('\n--- TEST GROUP 3: Deactivate Employee (Active -> Inactive) ---');
  {
    const deactRes = await request(`/api/hr/employees/${testEmpObjId}/deactivate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { reason: 'Extended personal sabbatical' }
    });
    assert(deactRes.status === 200, 'POST /deactivate returns 200 OK');
    assert(deactRes.body.data.status === 'INACTIVE', 'Status updated to INACTIVE in response');

    // Verify in database directly
    const empDoc = await Employee.findById(testEmpObjId).populate('user');
    assert(empDoc.status === 'INACTIVE', 'Persisted employee status is INACTIVE');
    assert(empDoc.user.isActive === false, 'Linked user.isActive is false');
    assert(empDoc.resignationDate === null, 'resignationDate remains null (not resigned)');

    // Verify login is blocked
    const blockedLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'vikram.m@testcorp.com', password: 'Secret123456' }
    });
    assert(blockedLogin.status === 403, 'Deactivated employee login blocked with 403');

    // Verify listing consistency: must be in INACTIVE, not in ACTIVE or RESIGNED
    const inactiveList = await request('/api/hr/employees?status=INACTIVE', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    const foundInInactive = getList(inactiveList).find(e => e.employeeId === 'EMP-LIFE-001');
    assert(foundInInactive !== undefined, 'Deactivated employee appears in GET /api/hr/employees?status=INACTIVE');
    assert(foundInInactive.isDeactivated === true, 'isDeactivated flag is true');
    assert(foundInInactive.isResigned === false, 'isResigned flag is false (not resigned!)');

    const resignedList = await request('/api/hr/employees?status=RESIGNED', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    const foundInResigned = getList(resignedList).find(e => e.employeeId === 'EMP-LIFE-001');
    assert(foundInResigned === undefined, 'Inactive employee does NOT appear in status=RESIGNED');

    // Repeated deactivation rejection
    const repeatDeact = await request(`/api/hr/employees/${testEmpObjId}/deactivate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(repeatDeact.status === 400, 'Cannot deactivate already inactive employee (returns 400)');
  }

  console.log('\n--- TEST GROUP 4: Reactivate Employee (Inactive -> Active) ---');
  {
    const reactRes = await request(`/api/hr/employees/${testEmpObjId}/reactivate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(reactRes.status === 200, 'POST /reactivate returns 200 OK');
    assert(reactRes.body.data.status === 'ACTIVE', 'Status updated to ACTIVE in response');

    // Direct DB check
    const empDoc = await Employee.findById(testEmpObjId).populate('user');
    assert(empDoc.status === 'ACTIVE', 'Persisted employee status is ACTIVE');
    assert(empDoc.user.isActive === true, 'Linked user.isActive is true');

    // Login is restored
    const loginAgain = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'vikram.m@testcorp.com', password: 'Secret123456' }
    });
    assert(loginAgain.status === 200, 'Reactivated employee can login again');

    // Repeated reactivation rejection
    const repeatReact = await request(`/api/hr/employees/${testEmpObjId}/reactivate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(repeatReact.status === 400, 'Cannot reactivate already active employee (returns 400)');
  }

  console.log('\n--- TEST GROUP 5: Formally Resign Employee (Active -> Resigned) ---');
  {
    const resignRes = await request(`/api/hr/employees/${testEmpObjId}/resign`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: {
        resignationDate: '2026-10-31',
        reason: 'Pursuing higher studies abroad'
      }
    });
    assert(resignRes.status === 200, 'POST /resign returns 200 OK');
    assert(resignRes.body.data.status === 'RESIGNED', 'Status is RESIGNED');
    assert(resignRes.body.data.resignationReason === 'Pursuing higher studies abroad', 'Resignation reason preserved');

    // Direct DB check
    const empDoc = await Employee.findById(testEmpObjId).populate('user');
    assert(empDoc.status === 'RESIGNED', 'Database status is RESIGNED');
    assert(empDoc.user.isActive === false, 'Linked user.isActive is false');
    assert(empDoc.resignationDate !== null, 'resignationDate is persisted in database');

    // Login blocked
    const loginBlocked = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'vikram.m@testcorp.com', password: 'Secret123456' }
    });
    assert(loginBlocked.status === 403, 'Resigned employee login blocked with 403');

    // Listing consistency
    const resignedList = await request('/api/hr/employees?status=RESIGNED', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    const foundInResigned = getList(resignedList).find(e => e.employeeId === 'EMP-LIFE-001');
    assert(foundInResigned !== undefined, 'Resigned employee appears in GET /api/hr/employees?status=RESIGNED');
    assert(foundInResigned.isResigned === true, 'isResigned flag is true');
    assert(foundInResigned.resignationReason === 'Pursuing higher studies abroad', 'resignationReason returned in list');

    const activeList = await request('/api/hr/employees?status=ACTIVE', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(!getList(activeList).some(e => e.employeeId === 'EMP-LIFE-001'), 'Resigned employee does NOT appear in status=ACTIVE');

    const inactiveList = await request('/api/hr/employees?status=INACTIVE', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(!getList(inactiveList).some(e => e.employeeId === 'EMP-LIFE-001'), 'Resigned employee does NOT appear in status=INACTIVE');

    // CANNOT reactivate a formally resigned employee
    const reactResign = await request(`/api/hr/employees/${testEmpObjId}/reactivate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(reactResign.status === 400, 'Reactivating a resigned employee is rejected with 400');

    // CANNOT deactivate an already resigned employee
    const deactResign = await request(`/api/hr/employees/${testEmpObjId}/deactivate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(deactResign.status === 400, 'Deactivating a resigned employee is rejected with 400');

    // CANNOT resign an already resigned employee
    const reResign = await request(`/api/hr/employees/${testEmpObjId}/resign`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(reResign.status === 400, 'Resigning an already resigned employee is rejected with 400');

    // CANNOT alter status via PATCH status without authorized override
    const patchStatus = await request(`/api/hr/employees/${testEmpObjId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { status: 'ACTIVE' }
    });
    assert(patchStatus.status === 400, 'PATCH /status on resigned employee is rejected with 400');
  }

  console.log('\n--- TEST GROUP 6: Preservation of Historical Records on Resignation & Soft Deletion ---');
  let historicalEmpId;
  let historicalEmpObjId;
  {
    // Create employee with historical records
    const createRes = await request('/api/hr/employees', {
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: {
        employeeId: 'EMP-HIST-002',
        firstName: 'Ananya',
        lastName: 'Sen',
        email: 'ananya.s@testcorp.com',
        phone: '9123456780',
        department: 'Tech',
        designation: 'QA Analyst',
        password: 'Password123!',
        joiningDate: '2023-06-01'
      }
    });
    historicalEmpId = createRes.body.data.employeeId;
    historicalEmpObjId = createRes.body.data._id || createRes.body.data.id;

    // Insert historical Attendance
    const att = new Attendance({
      employee: historicalEmpObjId,
      date: new Date('2026-10-01T09:00:00.000Z'),
      status: 'PRESENT',
      checkIn: new Date('2026-10-01T10:00:00.000Z'),
      scheduledCheckIn: '10:00'
    });
    await att.save();

    // Insert historical Leave
    const leave = new Leave({
      employee: historicalEmpObjId,
      leaveType: 'CASUAL',
      startDate: new Date('2026-10-10'),
      endDate: new Date('2026-10-12'),
      numberOfDays: 3,
      reason: 'Family function',
      status: 'APPROVED'
    });
    await leave.save();

    // Insert assigned Task
    const task = new Task({
      title: 'Regression Testing Suite',
      description: 'Run automated QA suite',
      employee: historicalEmpObjId,
      department: 'Tech',
      dueDate: '2026-11-15',
      status: 'done',
      createdBy: hrUser._id
    });
    await task.save();

    // Verify relations exist before delete
    const attBefore = await Attendance.countDocuments({ employee: historicalEmpObjId });
    const leaveBefore = await Leave.countDocuments({ employee: historicalEmpObjId });
    const taskBefore = await Task.countDocuments({ employee: historicalEmpObjId });
    assert(attBefore === 1 && leaveBefore === 1 && taskBefore === 1, 'Historical records created');

    // Attempting permanent hard delete without force should be rejected with 409
    const hardDeleteAttempt = await request(`/api/hr/employees/${historicalEmpObjId}?hard=true`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(hardDeleteAttempt.status === 409, 'Hard deletion of employee with historical data rejected with 409 Conflict');

    // Standard safe delete should soft-delete and preserve historical data
    const safeDeleteRes = await request(`/api/hr/employees/${historicalEmpObjId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(safeDeleteRes.status === 200, 'Standard DELETE returns 200 OK');
    assert(safeDeleteRes.body.data.softDeleted === true, 'Response confirms softDeleted = true');
    assert(safeDeleteRes.body.data.historicalRecordsPreserved === true, 'Response confirms historicalRecordsPreserved = true');

    // Verify historical records remain 100% intact
    const attAfter = await Attendance.countDocuments({ employee: historicalEmpObjId });
    const leaveAfter = await Leave.countDocuments({ employee: historicalEmpObjId });
    const taskAfter = await Task.countDocuments({ employee: historicalEmpObjId });
    assert(attAfter === 1, 'Attendance record remains intact after employee deletion');
    assert(leaveAfter === 1, 'Leave record remains intact after employee deletion');
    assert(taskAfter === 1, 'Task record remains intact after employee deletion');

    // Verify employee is soft-deleted
    const empDoc = await Employee.findById(historicalEmpObjId);
    assert(empDoc !== null, 'Employee document still exists in database');
    assert(empDoc.isDeleted === true, 'Employee has isDeleted = true');
    assert(empDoc.deletedAt !== null, 'Employee has deletedAt timestamp');

    // Verify excluded from standard employee list
    const standardList = await request('/api/hr/employees', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(!getList(standardList).some(e => e.employeeId === 'EMP-HIST-002'), 'Deleted employee excluded from standard list');

    // Verify can be found with includeDeleted=true or status=DELETED
    const deletedList = await request('/api/hr/employees?includeDeleted=true', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(getList(deletedList).some(e => e.employeeId === 'EMP-HIST-002'), 'Deleted employee visible with includeDeleted=true');
  }

  console.log('\n--- TEST GROUP 7: Hard Delete Employee with NO Historical Records ---');
  {
    // Create clean employee with no dependencies
    const createRes = await request('/api/hr/employees', {
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: {
        employeeId: 'EMP-CLEAN-003',
        firstName: 'Test',
        lastName: 'Orphan',
        email: 'orphan@testcorp.com',
        phone: '9000000000',
        department: 'Tech',
        designation: 'Intern',
        password: 'Password123!',
        joiningDate: '2026-01-01'
      }
    });
    const orphanId = createRes.body.data._id || createRes.body.data.id;

    // Hard delete orphan
    const hardDelete = await request(`/api/hr/employees/${orphanId}?hard=true`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(hardDelete.status === 200, 'DELETE with hard=true on record with no history succeeds (200)');
    assert(hardDelete.body.data.hardDeleted === true, 'Response confirms hardDeleted = true');

    // Verify completely removed from database
    const checkDoc = await Employee.findById(orphanId);
    assert(checkDoc === null, 'Employee record permanently removed from MongoDB');
  }

  console.log('\n--- TEST GROUP 8: Dashboard Counts Consistency ---');
  {
    const dashboardStats = await hrService.getDashboardStats();
    console.log('  Dashboard Stats:', {
      totalEmployees: dashboardStats.totalEmployees,
      activeEmployees: dashboardStats.activeEmployees,
      inactiveEmployees: dashboardStats.inactiveEmployees,
      resignedEmployees: dashboardStats.resignedEmployees
    });

    assert(typeof dashboardStats.totalEmployees === 'number', 'totalEmployees is a number');
    assert(typeof dashboardStats.activeEmployees === 'number', 'activeEmployees is a number');
    assert(typeof dashboardStats.inactiveEmployees === 'number', 'inactiveEmployees is a number');
    assert(typeof dashboardStats.resignedEmployees === 'number', 'resignedEmployees is a number');
    assert(dashboardStats.resignedEmployees >= 1, 'resignedEmployees accurately counts resigned staff');
  }

  console.log('\n================================================================');
  console.log('   ALL EMPLOYEE LIFECYCLE TESTS PASSED SUCCESSFULLY! (100%)');
  console.log('================================================================\n');

  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  server.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('\nTest Suite Error:\n', err);
  if (server) server.close();
  if (mongoose.connection) mongoose.disconnect();
  process.exit(1);
});
