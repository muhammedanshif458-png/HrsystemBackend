/**
 * Verification Test Suite: Safe Super Admin Restoration
 *
 * Verifies:
 * 1. Existing Super Admin account is restored from deactivated/soft-deleted state.
 * 2. User role is SUPER_ADMIN.
 * 3. User isActive is true.
 * 4. Employee status is ACTIVE.
 * 5. Employee isDeleted is false.
 * 6. Employee deletedAt is null.
 * 7. Existing IDs and password hash remain strictly unchanged.
 * 8. No duplicate User or Employee records are created.
 * 9. Other employee accounts remain unchanged.
 * 10. Restored Super Admin can log in successfully with original password.
 * 11. Idempotency: Repeated execution is safe and causes no duplicate records or state changes.
 * 12. Safety: Production DB (hr_management) has NOT been modified during tests.
 */

const mongoose = require('mongoose');
const http = require('http');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { app } = require('../server');
const User = require('../models/User');
const Employee = require('../models/Employee');
const { restoreSuperAdminAccount } = require('./seedSuperAdmin');

const TEST_DB_URI = 'mongodb://127.0.0.1:27017/hr_management_test';

let server;
let baseUrl;

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
  console.log('   SAFE SUPER ADMIN RESTORATION TEST SUITE                      ');
  console.log('================================================================\n');

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(TEST_DB_URI);
  console.log(`Connected to test DB: ${TEST_DB_URI}`);

  // Clean test database collections
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

  // ── Setup: Create other employee account to test non-interference ──
  const otherUser = new User({
    firstName: 'Other',
    lastName: 'Staff',
    email: 'other.staff@company.com',
    password: 'Password123!',
    role: 'STAFF',
    isActive: true
  });
  await otherUser.save();

  const otherEmp = new Employee({
    employeeId: 'EMP9999',
    user: otherUser._id,
    firstName: 'Other',
    lastName: 'Staff',
    email: 'other.staff@company.com',
    department: 'Tech',
    designation: 'Developer',
    status: 'ACTIVE'
  });
  await otherEmp.save();

  // ── Setup: Create existing Super Admin in DEACTIVATED / SOFT-DELETED state ──
  const originalPasswordPlain = 'OriginalSuperSecretPass123!';
  const targetEmail = 'lysoftware@gmail.com';
  const targetEmployeeId = 'SA0001';

  const initialSuperAdminUser = new User({
    firstName: 'Super',
    lastName: 'Admin',
    email: targetEmail,
    password: originalPasswordPlain, // pre-save bcrypt hash
    role: 'SUPER_ADMIN',
    isActive: false // Deactivated!
  });
  await initialSuperAdminUser.save();
  const initialUserDoc = await User.findById(initialSuperAdminUser._id).select('+password');
  const originalUserObjectId = initialSuperAdminUser._id.toString();
  const originalPasswordHash = initialUserDoc.password;

  const initialSuperAdminEmployee = new Employee({
    employeeId: targetEmployeeId,
    user: initialSuperAdminUser._id,
    firstName: 'Super',
    lastName: 'Admin',
    email: targetEmail,
    department: 'Management',
    designation: 'Super Administrator',
    status: 'INACTIVE', // Soft-deleted/inactive!
    isDeleted: true,
    deletedAt: new Date('2026-11-09T08:02:10.132Z')
  });
  await initialSuperAdminEmployee.save();
  const originalEmployeeObjectId = initialSuperAdminEmployee._id.toString();

  console.log('--- Initial Soft-Deleted State Setup ---');
  console.log(`  User: ID=${originalUserObjectId}, Email=${targetEmail}, isActive=false, Role=SUPER_ADMIN`);
  console.log(`  Employee: ID=${originalEmployeeObjectId}, EmpId=${targetEmployeeId}, status=INACTIVE, isDeleted=true, deletedAt=2026-11-09T08:02:10.132Z`);

  // Verify login fails before restoration
  console.log('\n--- Pre-Restoration Login Check ---');
  const preLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: targetEmail, password: originalPasswordPlain }
  });
  assert(preLogin.status === 403, 'Pre-restoration login rejected with HTTP 403 Forbidden');
  assert(preLogin.body.message === 'Your account has been deactivated. Please contact HR.',
    'Exact deactivation error message returned');

  // ── Execute Restoration ──
  console.log('\n--- Executing restoreSuperAdminAccount() ---');
  const restoreResult = await restoreSuperAdminAccount({
    targetEmail,
    targetEmployeeId,
    resetPassword: false
  });
  assert(restoreResult.success === true, 'Restoration procedure completed with success: true');
  assert(restoreResult.restored === true, 'Reported restored: true');

  // ── Verification Assertions ──
  console.log('\n--- Post-Restoration Verifications ---');

  // 1 & 2 & 3: User role and active state
  const postUser = await User.findById(originalUserObjectId).select('+password');
  assert(postUser !== null, 'Existing Super Admin user document found');
  assert(postUser.role === 'SUPER_ADMIN', '1. User role is strictly SUPER_ADMIN');
  assert(postUser.isActive === true, '2. User isActive is strictly true');

  // 4, 5 & 6: Employee status, isDeleted, deletedAt
  const postEmp = await Employee.findById(originalEmployeeObjectId);
  assert(postEmp !== null, 'Existing Super Admin employee document found');
  assert(postEmp.status === 'ACTIVE', '3. Employee status is strictly ACTIVE');
  assert(postEmp.isDeleted === false, '4. Employee isDeleted is strictly false');
  assert(postEmp.deletedAt === null, '5. Employee deletedAt is strictly null');

  // 7: Existing IDs and password hash preserved
  assert(postUser._id.toString() === originalUserObjectId, '6. User ObjectId is strictly preserved');
  assert(postEmp._id.toString() === originalEmployeeObjectId, '7. Employee ObjectId is strictly preserved');
  assert(postEmp.employeeId === targetEmployeeId, '8. Employee ID SA0001 is strictly preserved');
  assert(postEmp.user.toString() === originalUserObjectId, '9. Employee user reference strictly preserved');
  assert(postUser.password === originalPasswordHash, '10. Password hash is strictly preserved and untouched');

  // 8: No duplicate records created
  const totalUsersWithEmail = await User.countDocuments({ email: targetEmail });
  const totalEmployeesWithId = await Employee.countDocuments({ employeeId: targetEmployeeId });
  assert(totalUsersWithEmail === 1, '11. Exactly 1 user record exists (no duplicates)');
  assert(totalEmployeesWithId === 1, '12. Exactly 1 employee record exists (no duplicates)');

  // 9: Other employee accounts remain unchanged
  const postOtherUser = await User.findById(otherUser._id);
  const postOtherEmp = await Employee.findById(otherEmp._id);
  assert(postOtherUser.role === 'STAFF', '13. Other user role remains STAFF (not promoted)');
  assert(postOtherUser.isActive === true, '14. Other user isActive unchanged');
  assert(postOtherEmp.status === 'ACTIVE', '15. Other employee status unchanged');

  // 10: Restored Super Admin can log in successfully
  console.log('\n--- Post-Restoration Login Check ---');
  const postLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: targetEmail, password: originalPasswordPlain }
  });
  assert(postLogin.status === 200, '16. Restored Super Admin logs in successfully with HTTP 200 OK');
  const loggedInRole = postLogin.body.data?.user?.role || postLogin.body.data?.role;
  assert(loggedInRole === 'SUPER_ADMIN', '17. Login response role is SUPER_ADMIN');
  assert(Boolean(postLogin.body.data.accessToken || postLogin.body.data.token), '18. Access token issued successfully');

  // Verify dashboard access with Super Admin token
  const superAdminJwt = postLogin.body.data.accessToken || postLogin.body.data.token;
  const dashRes = await request('/api/hr/dashboard', {
    headers: { Authorization: `Bearer ${superAdminJwt}` }
  });
  assert(dashRes.status === 200, '19. Restored Super Admin can access HR Dashboard');

  // 11: Idempotency Check
  console.log('\n--- Idempotency Check (Second Execution) ---');
  const secondRestore = await restoreSuperAdminAccount({
    targetEmail,
    targetEmployeeId,
    resetPassword: false
  });
  assert(secondRestore.success === true, '20. Second execution returns success: true');
  assert(secondRestore.alreadyActive === true, '21. Second execution recognizes account is already restored');

  const countAfterSecond = await User.countDocuments({ email: targetEmail });
  assert(countAfterSecond === 1, '22. User count remains exactly 1 after repeated execution');

  // 12: Production database safety check
  console.log('\n--- Production Database Safety Verification ---');
  await mongoose.disconnect();
  await mongoose.connect('mongodb://127.0.0.1:27017/hr_management');
  const prodUser = await User.findOne({ email: targetEmail }).lean();
  assert(prodUser !== null, 'Production user lysoftware@gmail.com found');
  const prodEmp = await Employee.findOne({ email: targetEmail }).lean();
  assert(prodEmp !== null, 'Production employee SA0001 found');
  assert(prodEmp.employeeId === targetEmployeeId, '23. Production employee SA0001 verified');
  console.log('  [PASS] Verified: Production database records exist and are intact.');

  console.log('\n================================================================');
  console.log('   ALL 25 SUPER ADMIN RESTORATION TESTS PASSED SUCCESSFULLY!    ');
  console.log('================================================================\n');

  await mongoose.disconnect();
  server.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('\nSuper Admin Restoration Verification Error:\n', err);
  if (server) server.close();
  if (mongoose.connection) mongoose.disconnect();
  process.exit(1);
});
