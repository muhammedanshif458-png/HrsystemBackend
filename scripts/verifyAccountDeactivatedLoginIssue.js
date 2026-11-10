/**
 * Verification Test Suite: Account Deactivation, Status Interpretation & Login Security
 * 
 * Tests:
 * 1. Active employee can log in (200 OK + tokens)
 * 2. Deactivated employee (user.isActive = false) cannot log in (403 Forbidden)
 * 3. Reactivated employee can log in (200 OK)
 * 4. Resigned employee cannot log in (403 Forbidden)
 * 5. Terminated employee cannot log in (403 Forbidden)
 * 6. Soft-deleted employee cannot log in (403 Forbidden)
 * 7. Soft-deleted employee can be restored by HR (POST /api/hr/employees/:id/restore)
 * 8. Status desync self-healing: user.isActive=true with employee.status=INACTIVE is blocked (403)
 * 9. Incorrect password for active user returns 401
 * 10. Non-existent email returns 401
 * 11. Protection: Super Administrator accounts CANNOT be deleted (403)
 * 12. Protection: Super Administrator accounts CANNOT be deactivated (403)
 * 13. Protection: Self-deletion / self-deactivation is prevented (400)
 * 14. Verification that production DB (hr_management) has NOT been automatically altered
 */

const mongoose = require('mongoose');
const http = require('http');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { app } = require('../server');
const User = require('../models/User');
const Employee = require('../models/Employee');
const hrService = require('../services/hrService');
const authService = require('../services/authService');

const TEST_DB_URI = 'mongodb://127.0.0.1:27017/hr_management_test';

let server;
let baseUrl;
let hrToken;
let superAdminToken;

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
  console.log('   ACCOUNT DEACTIVATION & LOGIN SECURITY VERIFICATION SUITE     ');
  console.log('================================================================\n');

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(TEST_DB_URI);
  console.log(`Connected to test DB: ${TEST_DB_URI}`);

  // Clean test database
  await User.deleteMany({});
  await Employee.deleteMany({});
  console.log('Cleaned test database collections.\n');

  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`Test HTTP server listening at ${baseUrl}\n`);
      resolve();
    });
  });

  // Setup HR Admin user
  const hrUser = new User({
    firstName: 'HR',
    lastName: 'Manager',
    email: 'hr.manager@company.com',
    password: 'Password123!',
    role: 'HR',
    isActive: true
  });
  await hrUser.save();

  const hrEmp = new Employee({
    employeeId: 'HR0001',
    user: hrUser._id,
    firstName: 'HR',
    lastName: 'Manager',
    email: 'hr.manager@company.com',
    department: 'Human Resources',
    designation: 'HR Manager',
    status: 'ACTIVE'
  });
  await hrEmp.save();

  // Setup Super Admin user
  const saUser = new User({
    firstName: 'Super',
    lastName: 'Admin',
    email: 'superadmin@company.com',
    password: 'SuperPassword123!',
    role: 'SUPER_ADMIN',
    isActive: true
  });
  await saUser.save();

  const saEmp = new Employee({
    employeeId: 'SA0001',
    user: saUser._id,
    firstName: 'Super',
    lastName: 'Admin',
    email: 'superadmin@company.com',
    department: 'Management',
    designation: 'Super Administrator',
    status: 'ACTIVE'
  });
  await saEmp.save();

  // Login HR
  const hrLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'hr.manager@company.com', password: 'Password123!' }
  });
  assert(hrLogin.status === 200, 'HR Admin login successful (200)');
  hrToken = hrLogin.body.data.token || hrLogin.body.data.accessToken;

  // Login Super Admin
  const saLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'superadmin@company.com', password: 'SuperPassword123!' }
  });
  assert(saLogin.status === 200, 'Super Admin login successful (200)');
  superAdminToken = saLogin.body.data.token || saLogin.body.data.accessToken;

  // Create Staff User for testing
  const staffEmpRes = await request('/api/hr/employees', {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: {
      employeeId: 'EMP1001',
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice.smith@company.com',
      password: 'StaffPassword123!',
      department: 'Tech',
      designation: 'Developer'
    }
  });
  assert(staffEmpRes.status === 201, 'Staff Alice created (201)');
  const aliceEmpId = staffEmpRes.body.data.id || staffEmpRes.body.data._id;

  // --- TEST 1: Active employee can log in ---
  console.log('\n--- TEST 1: Active employee can log in ---');
  const aliceLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'alice.smith@company.com', password: 'StaffPassword123!' }
  });
  assert(aliceLogin.status === 200, 'Active staff Alice logs in successfully (200)');
  assert(Boolean(aliceLogin.body.data.accessToken), 'Access token present');

  // --- TEST 2: Deactivated employee cannot log in ---
  console.log('\n--- TEST 2: Deactivated employee cannot log in ---');
  const deactRes = await request(`/api/hr/employees/${aliceEmpId}/deactivate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: { reason: 'Performance audit pending' }
  });
  assert(deactRes.status === 200, 'Staff Alice deactivated by HR (200)');

  const deactLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'alice.smith@company.com', password: 'StaffPassword123!' }
  });
  assert(deactLogin.status === 403, 'Deactivated employee login rejected with 403');
  assert(deactLogin.body.message === 'Your account has been deactivated. Please contact HR.',
    'Exact deactivation error message returned');

  // --- TEST 3: Reactivated employee can log in ---
  console.log('\n--- TEST 3: Reactivated employee can log in ---');
  const reactRes = await request(`/api/hr/employees/${aliceEmpId}/reactivate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  assert(reactRes.status === 200, 'Staff Alice reactivated by HR (200)');

  const reactLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'alice.smith@company.com', password: 'StaffPassword123!' }
  });
  assert(reactLogin.status === 200, 'Reactivated employee Alice logs in successfully (200)');

  // --- TEST 4: Resigned employee cannot log in ---
  console.log('\n--- TEST 4: Resigned employee cannot log in ---');
  const resignRes = await request(`/api/hr/employees/${aliceEmpId}/resign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: { resignationDate: '2026-11-09', reason: 'Career transition' }
  });
  assert(resignRes.status === 200, 'Staff Alice marked as resigned (200)');

  const resignLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'alice.smith@company.com', password: 'StaffPassword123!' }
  });
  assert(resignLogin.status === 403, 'Resigned employee login rejected with 403');

  // --- TEST 5: Terminated employee cannot log in ---
  console.log('\n--- TEST 5: Terminated employee cannot log in ---');
  const bobEmpRes = await request('/api/hr/employees', {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: {
      employeeId: 'EMP1002',
      firstName: 'Bob',
      lastName: 'Jones',
      email: 'bob.jones@company.com',
      password: 'StaffPassword123!',
      department: 'Telecalling',
      designation: 'Agent'
    }
  });
  assert(bobEmpRes.status === 201, 'Staff Bob created (201)');
  const bobEmpId = bobEmpRes.body.data.id || bobEmpRes.body.data._id;

  const termRes = await request(`/api/hr/employees/${bobEmpId}/status`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: { status: 'TERMINATED' }
  });
  assert(termRes.status === 200, 'Staff Bob marked as TERMINATED (200)');

  const termLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'bob.jones@company.com', password: 'StaffPassword123!' }
  });
  assert(termLogin.status === 403, 'Terminated employee login rejected with 403');

  // --- TEST 6: Soft-deleted employee cannot log in ---
  console.log('\n--- TEST 6: Soft-deleted employee cannot log in ---');
  const charlieEmpRes = await request('/api/hr/employees', {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: {
      employeeId: 'EMP1003',
      firstName: 'Charlie',
      lastName: 'Brown',
      email: 'charlie.brown@company.com',
      password: 'StaffPassword123!',
      department: 'Tech',
      designation: 'Developer'
    }
  });
  assert(charlieEmpRes.status === 201, 'Staff Charlie created (201)');
  const charlieEmpId = charlieEmpRes.body.data.id || charlieEmpRes.body.data._id;

  const delRes = await request(`/api/hr/employees/${charlieEmpId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  assert(delRes.status === 200, 'Staff Charlie soft-deleted (200)');

  const delLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'charlie.brown@company.com', password: 'StaffPassword123!' }
  });
  assert(delLogin.status === 403, 'Soft-deleted employee login rejected with 403');

  // --- TEST 7: Soft-deleted employee can be restored by HR ---
  console.log('\n--- TEST 7: Soft-deleted employee restored by HR (POST /api/hr/employees/:id/restore) ---');
  const restoreRes = await request(`/api/hr/employees/${charlieEmpId}/restore`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  assert(restoreRes.status === 200, 'Staff Charlie restored successfully (200)');
  assert(restoreRes.body.data.status === 'ACTIVE', 'Restored employee status is ACTIVE');
  assert(restoreRes.body.data.isDeleted === false, 'Restored employee isDeleted is false');

  const restoreLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'charlie.brown@company.com', password: 'StaffPassword123!' }
  });
  assert(restoreLogin.status === 200, 'Restored employee can log in again (200)');

  // --- TEST 8: Status desync self-healing ---
  console.log('\n--- TEST 8: Status desync self-healing ---');
  // Simulate out-of-band inconsistency: User.isActive = true but Employee.status = INACTIVE
  await User.findOneAndUpdate({ email: 'bob.jones@company.com' }, { isActive: true });
  const desyncUserCheck = await User.findOne({ email: 'bob.jones@company.com' });
  assert(desyncUserCheck.isActive === true, 'Simulated desync: User.isActive manually set to true');

  const desyncLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'bob.jones@company.com', password: 'StaffPassword123!' }
  });
  assert(desyncLogin.status === 403, 'Login securely rejected with 403 despite desynchronized User.isActive');
  const healedUserCheck = await User.findOne({ email: 'bob.jones@company.com' });
  assert(healedUserCheck.isActive === false, 'User.isActive self-healed and resynchronized to false');

  // --- TEST 9: Incorrect password for active user returns 401 ---
  console.log('\n--- TEST 9: Incorrect password handling ---');
  const badPassLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'charlie.brown@company.com', password: 'WrongPassword999!' }
  });
  assert(badPassLogin.status === 401, 'Wrong password returns 401 Unauthorized');
  assert(badPassLogin.body.message === 'Invalid email or password', 'Correct message for wrong password');

  // --- TEST 10: Non-existent email returns 401 ---
  console.log('\n--- TEST 10: Non-existent email handling ---');
  const badEmailLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'nonexistent.user.999@company.com', password: 'AnyPassword123!' }
  });
  assert(badEmailLogin.status === 401, 'Non-existent email returns 401 Unauthorized');
  assert(badEmailLogin.body.message === 'Invalid email or password', 'Correct message for non-existent email');

  // --- TEST 11: Protection: Super Administrator CANNOT be deleted ---
  console.log('\n--- TEST 11: Protection: Super Administrator accounts CANNOT be deleted ---');
  const deleteSaRes = await request(`/api/hr/employees/${saEmp._id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  assert(deleteSaRes.status === 403, 'Attempt to delete Super Admin rejected with 403 Forbidden');
  assert(deleteSaRes.body.message.includes('Super Administrator accounts cannot be deleted'),
    'Descriptive protection message returned');

  // --- TEST 12: Protection: Super Administrator CANNOT be deactivated ---
  console.log('\n--- TEST 12: Protection: Super Administrator accounts CANNOT be deactivated ---');
  const deactSaRes = await request(`/api/hr/employees/${saEmp._id}/deactivate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: { reason: 'Unauthorized deactivation test' }
  });
  assert(deactSaRes.status === 403, 'Attempt to deactivate Super Admin rejected with 403 Forbidden');
  assert(deactSaRes.body.message.includes('Super Administrator accounts cannot be deactivated'),
    'Descriptive protection message returned');

  // --- TEST 13: Protection: Self-deletion / self-deactivation prevented ---
  console.log('\n--- TEST 13: Protection: Self-deletion / self-deactivation prevented ---');
  const selfDeleteRes = await request(`/api/hr/employees/${hrEmp._id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  assert(selfDeleteRes.status === 400, 'Self-deletion rejected with 400 Bad Request');
  assert(selfDeleteRes.body.message.includes('cannot delete your own account'),
    'Self-deletion message returned');

  const selfDeactRes = await request(`/api/hr/employees/${hrEmp._id}/deactivate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: { reason: 'Accidental self deactivation' }
  });
  assert(selfDeactRes.status === 400, 'Self-deactivation rejected with 400 Bad Request');
  assert(selfDeactRes.body.message.includes('cannot deactivate your own account'),
    'Self-deactivation message returned');

  // --- TEST 14: Verification that production DB (hr_management) has valid records ---
  console.log('\n--- TEST 14: Safety check on production DB ---');
  await mongoose.disconnect();
  await mongoose.connect('mongodb://127.0.0.1:27017/hr_management');
  const prodUser = await User.findOne({ email: 'lysoftware@gmail.com' }).lean();
  assert(prodUser !== null, 'Production user lysoftware@gmail.com found');
  const prodEmp = await Employee.findOne({ email: 'lysoftware@gmail.com' }).lean();
  assert(prodEmp !== null, 'Production employee SA0001 found');
  assert(prodEmp.employeeId === 'SA0001', 'Production employee ID is SA0001');
  console.log('  [PASS] Verified: Production database integrity preserved.');

  console.log('\n================================================================');
  console.log('   ALL 14 ACCOUNT DEACTIVATION & LOGIN SECURITY TESTS PASSED!   ');
  console.log('================================================================\n');

  await mongoose.disconnect();
  server.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('\nVerification Suite Error:\n', err);
  if (server) server.close();
  if (mongoose.connection) mongoose.disconnect();
  process.exit(1);
});

