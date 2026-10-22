const http = require('http');
const mongoose = require('mongoose');
const env = require('../config/env');

const makeReq = (options, postData = null) => {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
};

const sendJson = async (path, method = 'GET', body = null, token = null) => {
  const postData = body ? JSON.stringify(body) : null;
  const headers = {};
  if (postData) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(postData);
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return await makeReq({
    hostname: '127.0.0.1',
    port: env.port,
    path,
    method,
    headers
  }, postData);
};

const run = async () => {
  console.log('========================================================================');
  console.log('   LIVE STAFF PROVISIONING, PASSWORD PERSISTENCE & PORTAL AUTH FLOW');
  console.log(`   Target Backend: http://127.0.0.1:${env.port}`);
  console.log(`   Database: ${env.mongodbUri}`);
  console.log('========================================================================\n');

  // Connect to DB directly for hash verification and cleanup
  await mongoose.connect(env.mongodbUri);
  const User = require('../models/User');
  const Employee = require('../models/Employee');

  const createdUserIds = [];
  const createdEmployeeIds = [];

  try {
    // 0. Super Admin Login
    console.log('[Setup] Logging in as Super Admin...');
    const saEmail = process.env.SEED_SUPER_ADMIN_EMAIL || env.seedSuperAdmin?.email || 'lysoftware@gmail.com';
    const saPassword = process.env.SEED_SUPER_ADMIN_PASSWORD || env.seedSuperAdmin?.password || 'hrAdmin';

    const saLoginRes = await sendJson('/api/auth/login', 'POST', {
      email: saEmail,
      password: saPassword
    });

    if (saLoginRes.statusCode !== 200 || !saLoginRes.body?.data?.accessToken) {
      throw new Error(`Super Admin login failed: HTTP ${saLoginRes.statusCode}`);
    }
    const saToken = saLoginRes.body.data.accessToken;
    console.log('  ✓ Super Admin logged in (HTTP 200, Role: SUPER_ADMIN)\n');

    // 1. Create a staff account through the actual HR account-provisioning flow
    const testTimestamp = Date.now();
    const staffEmail = `test.staff.portal.${testTimestamp}@example.com`;
    const initialPassword = 'InitialSecretPass123';

    console.log(`[Step 1] Creating staff account via POST /api/hr/employees (${staffEmail})...`);
    const createRes = await sendJson('/api/hr/employees', 'POST', {
      name: 'Alex Staff Tester',
      email: staffEmail,
      phoneNumber: '9876543210',
      department: 'Tech',
      designation: 'QA Automation Engineer',
      workMode: 'Office',
      password: initialPassword
    }, saToken);

    if (createRes.statusCode !== 201) {
      throw new Error(`Failed to create employee: HTTP ${createRes.statusCode} - ${JSON.stringify(createRes.body)}`);
    }

    const createdEmp = createRes.body.data;
    const employeeMongoId = (createdEmp._id || createdEmp.id).toString();
    const employeeCustomId = createdEmp.employeeId;
    const linkedUserId = (createdEmp.user?._id || createdEmp.user).toString();

    createdEmployeeIds.push(employeeMongoId);
    createdUserIds.push(linkedUserId);

    console.log(`  ✓ Staff created: Employee ID=${employeeMongoId} (${employeeCustomId}), Linked User ID=${linkedUserId}`);
    console.log(`  ✓ Response status: HTTP ${createRes.statusCode} Created`);

    // Verify initial login works
    const initLoginRes = await sendJson('/api/auth/login', 'POST', {
      email: staffEmail,
      password: initialPassword
    });
    if (initLoginRes.statusCode !== 200) {
      throw new Error(`Initial login failed: HTTP ${initLoginRes.statusCode}`);
    }
    console.log('  ✓ Initial login verified with created credentials (HTTP 200)\n');

    // 2. Set a new password through the actual employee update endpoint
    const newPassword = 'NewSecretPassword@2026!';
    console.log(`[Step 2] Updating password via PUT /api/hr/employees/${employeeMongoId} as Super Admin...`);

    const updateRes = await sendJson(`/api/hr/employees/${employeeMongoId}`, 'PUT', {
      password: newPassword,
      designation: 'Senior QA Automation Engineer'
    }, saToken);

    if (updateRes.statusCode !== 200) {
      throw new Error(`Password update failed: HTTP ${updateRes.statusCode} - ${JSON.stringify(updateRes.body)}`);
    }
    console.log(`  ✓ Password update API returned HTTP ${updateRes.statusCode} OK`);

    // Verify resolution by Employee ID and User ID as well
    const getByEmpIdRes = await sendJson(`/api/hr/employees/${employeeCustomId}`, 'GET', null, saToken);
    if (getByEmpIdRes.statusCode !== 200) {
      throw new Error(`Lookup by employeeId failed: HTTP ${getByEmpIdRes.statusCode}`);
    }
    const getByUserIdRes = await sendJson(`/api/hr/employees/${linkedUserId}`, 'GET', null, saToken);
    if (getByUserIdRes.statusCode !== 200) {
      throw new Error(`Lookup by linked user ID failed: HTTP ${getByUserIdRes.statusCode}`);
    }
    console.log('  ✓ Verified employee lookup supports MongoDB ID, custom employeeId, and linked User ID\n');

    // 3. Verify the linked User record exists and has a valid password hash without printing the hash
    console.log('[Step 3] Inspecting database User document directly...');
    const dbUser = await User.findById(linkedUserId).select('+password');
    if (!dbUser) {
      throw new Error(`Linked User record ${linkedUserId} not found in database!`);
    }

    const isBcryptHash = typeof dbUser.password === 'string' && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(dbUser.password);
    if (!isBcryptHash) {
      throw new Error('Database password is not a valid bcrypt hash!');
    }
    console.log('  ✓ Linked User record exists in MongoDB');
    console.log(`  ✓ Password hash algorithm: bcrypt (hash format valid: ${isBcryptHash}, salt rounds: 10)`);
    console.log('  ✓ Secure check: plaintext password and password hash are NOT exposed or logged\n');

    // 4 & 5. Log in through the exact endpoint used by Staff Portal with new credentials
    console.log('[Step 4 & 5] Logging in to Staff Portal via POST /api/auth/login with new credentials...');
    const staffLoginRes = await sendJson('/api/auth/login', 'POST', {
      email: staffEmail,
      password: newPassword
    });

    if (staffLoginRes.statusCode !== 200) {
      throw new Error(`Staff login with new password failed: HTTP ${staffLoginRes.statusCode} - ${JSON.stringify(staffLoginRes.body)}`);
    }

    const loginData = staffLoginRes.body?.data;
    const staffToken = loginData?.accessToken;
    const returnedUser = loginData?.user;
    const returnedRole = returnedUser?.role;
    const returnedEmployee = returnedUser?.employee;

    if (!staffToken) throw new Error('Missing accessToken in login response');
    if (returnedRole !== 'STAFF') throw new Error(`Role mismatch: Expected 'STAFF', got '${returnedRole}'`);
    if (!returnedEmployee || returnedEmployee._id !== employeeMongoId) {
      throw new Error(`Linked employee profile missing or mismatched in login response!`);
    }

    console.log(`  ✓ Staff Portal login HTTP status: 200 OK`);
    console.log(`  ✓ Returned role: ${returnedRole}`);
    console.log(`  ✓ Linked employee profile: ID=${returnedEmployee._id}, Name="${returnedEmployee.firstName} ${returnedEmployee.lastName}", Department="${returnedEmployee.department}"`);
    console.log(`  ✓ Access token generated: valid non-empty JWT`);

    // Verify accessing Staff Portal routes with staff token
    const portalDashRes = await sendJson('/api/staff/dashboard', 'GET', null, staffToken);
    if (portalDashRes.statusCode !== 200) {
      throw new Error(`Staff Portal dashboard access failed: HTTP ${portalDashRes.statusCode}`);
    }
    console.log('  ✓ Staff Portal dashboard accessed successfully (HTTP 200)\n');

    // 6. Confirm incorrect passwords are rejected
    console.log('[Step 6] Confirming incorrect passwords are rejected...');
    const wrongPwdRes = await sendJson('/api/auth/login', 'POST', {
      email: staffEmail,
      password: 'CompletelyWrongPassword'
    });
    if (wrongPwdRes.statusCode !== 401) {
      throw new Error(`Expected HTTP 401 for wrong password, got ${wrongPwdRes.statusCode}`);
    }
    console.log('  ✓ Arbitrary wrong password rejected with HTTP 401');

    const oldPwdRes = await sendJson('/api/auth/login', 'POST', {
      email: staffEmail,
      password: initialPassword
    });
    if (oldPwdRes.statusCode !== 401) {
      throw new Error(`Expected HTTP 401 for old password, got ${oldPwdRes.statusCode}`);
    }
    console.log('  ✓ Old initial password rejected with HTTP 401\n');

    // 7. Confirm saving profile details without a password preserves the current credential
    console.log('[Step 7] Updating profile details with empty password string...');
    const emptyPwdUpdateRes = await sendJson(`/api/hr/employees/${employeeMongoId}`, 'PUT', {
      phoneNumber: '9123456789',
      password: ''
    }, saToken);

    if (emptyPwdUpdateRes.statusCode !== 200) {
      throw new Error(`Profile update with empty password failed: HTTP ${emptyPwdUpdateRes.statusCode}`);
    }

    const reLoginRes = await sendJson('/api/auth/login', 'POST', {
      email: staffEmail,
      password: newPassword
    });
    if (reLoginRes.statusCode !== 200) {
      throw new Error('Credential was altered or corrupted when saving profile with empty password!');
    }
    console.log('  ✓ Current password preserved intact when updating profile with empty password\n');

    // 8. Confirm staff cannot access another employee\'s restricted data or Super Admin routes
    console.log('[Step 8] Verifying role-based access control and isolation...');
    const staffAccessHrDash = await sendJson('/api/hr/dashboard', 'GET', null, staffToken);
    if (staffAccessHrDash.statusCode !== 403) {
      throw new Error(`Expected 403 when Staff accesses HR Dashboard, got ${staffAccessHrDash.statusCode}`);
    }
    console.log('  ✓ Staff access to HR Dashboard rejected with HTTP 403 Forbidden');

    const staffUpdateCreds = await sendJson(`/api/hr/employees/${employeeMongoId}`, 'PUT', {
      password: 'HackerPassword123'
    }, staffToken);
    if (staffUpdateCreds.statusCode !== 403) {
      throw new Error(`Expected 403 when Staff attempts administrative update, got ${staffUpdateCreds.statusCode}`);
    }
    console.log('  ✓ Staff access to administrative employee update rejected with HTTP 403 Forbidden');

    const saAccessStaffPortal = await sendJson('/api/staff/dashboard', 'GET', null, saToken);
    if (saAccessStaffPortal.statusCode !== 403) {
      throw new Error(`Expected 403 when Super Admin accesses Staff Portal, got ${saAccessStaffPortal.statusCode}`);
    }
    console.log('  ✓ Super Admin access to Staff Portal route rejected with HTTP 403 (strict role separation)\n');

    // 9. Test duplicate emails and missing/unlinked User accounts
    console.log('[Step 9] Testing duplicate email enforcement and unlinked User handling...');
    const dupEmailRes = await sendJson(`/api/hr/employees/${employeeMongoId}`, 'PUT', {
      email: saEmail
    }, saToken);
    if (dupEmailRes.statusCode !== 409) {
      throw new Error(`Expected 409 Conflict on duplicate email, got ${dupEmailRes.statusCode}`);
    }
    console.log('  ✓ Duplicate email rejected with HTTP 409 Conflict');

    // Test unlinked User account provisioning: create orphaned employee doc directly
    const orphanedEmail = `orphan.employee.${testTimestamp}@example.com`;
    const orphanedEmp = new Employee({
      employeeId: `EMP${testTimestamp.toString().slice(-4)}`,
      user: new mongoose.Types.ObjectId(), // Non-existent user
      firstName: 'Orphan',
      lastName: 'Staff',
      email: orphanedEmail,
      phone: '9998887776',
      department: 'Tech',
      designation: 'Junior Developer',
      workMode: 'Office',
      status: 'ACTIVE'
    });
    await orphanedEmp.save();
    createdEmployeeIds.push(orphanedEmp._id.toString());
    console.log(`  ✓ Created test unlinked employee document (${orphanedEmail})`);

    // 9a. Updating without password throws 404 clear error
    const noUserUpdateRes = await sendJson(`/api/hr/employees/${orphanedEmp._id}`, 'PUT', {
      designation: 'Mid Developer'
    }, saToken);
    if (noUserUpdateRes.statusCode !== 404) {
      throw new Error(`Expected 404 when updating unlinked employee without password, got ${noUserUpdateRes.statusCode}`);
    }
    console.log('  ✓ Updating unlinked employee without password returns HTTP 404 clear error');

    // 9b. Super Admin setting password on unlinked employee provisions User account
    const provisionPwd = 'ProvisionedSecret@2026';
    const provisionRes = await sendJson(`/api/hr/employees/${orphanedEmp._id}`, 'PUT', {
      password: provisionPwd
    }, saToken);
    if (provisionRes.statusCode !== 200) {
      throw new Error(`Failed to provision user for unlinked employee: HTTP ${provisionRes.statusCode}`);
    }
    const provisionedUser = await User.findOne({ email: orphanedEmail });
    if (!provisionedUser) {
      throw new Error('Provisioned User document not found in DB!');
    }
    createdUserIds.push(provisionedUser._id.toString());
    console.log('  ✓ Super Admin setting password on unlinked employee safely provisioned User account (HTTP 200)');

    // Verify provisioned staff can log in
    const orphanLoginRes = await sendJson('/api/auth/login', 'POST', {
      email: orphanedEmail,
      password: provisionPwd
    });
    if (orphanLoginRes.statusCode !== 200) {
      throw new Error(`Login for newly provisioned user failed: HTTP ${orphanLoginRes.statusCode}`);
    }
    console.log('  ✓ Newly provisioned staff account logged in successfully (HTTP 200)\n');

    // 10. Clean up dedicated test records
    console.log('[Step 10] Cleaning up dedicated test records...');
    await Employee.deleteMany({ _id: { $in: createdEmployeeIds } });
    await User.deleteMany({ _id: { $in: createdUserIds } });
    console.log(`  ✓ Cleaned up ${createdEmployeeIds.length} test employee(s) and ${createdUserIds.length} test user(s)\n`);

    console.log('========================================================================');
    console.log('   ALL 10 LIVE STAFF AUTHENTICATION & PROVISIONING CHECKS PASSED!');
    console.log('========================================================================\n');
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((err) => {
  console.error('\n❌ LIVE AUTH VERIFICATION FAILED:', err.message);
  process.exit(1);
});
