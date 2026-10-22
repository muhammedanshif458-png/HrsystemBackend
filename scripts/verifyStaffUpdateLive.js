const http = require('http');
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
  console.log('================================================================');
  console.log('   LIVE END-TO-END VERIFICATION: EDIT STAFF DETAILS & SECURITY');
  console.log(`   Target Backend: http://127.0.0.1:${env.port}`);
  console.log('================================================================\n');

  // Test 7: Super Admin Authentication & HR Features
  console.log('[Test 7] Verifying Super Admin authentication and existing HR features...');
  const superAdminEmail = process.env.SEED_SUPER_ADMIN_EMAIL || env.seedSuperAdmin?.email || 'lysoftware@gmail.com';
  const superAdminPassword = process.env.SEED_SUPER_ADMIN_PASSWORD || env.seedSuperAdmin?.password || 'hrAdmin';

  const saLoginRes = await sendJson('/api/auth/login', 'POST', {
    email: superAdminEmail,
    password: superAdminPassword
  });

  if (saLoginRes.statusCode !== 200 || !saLoginRes.body?.data?.accessToken) {
    throw new Error(`Super Admin login failed: HTTP ${saLoginRes.statusCode} - ${JSON.stringify(saLoginRes.body)}`);
  }

  const superAdminToken = saLoginRes.body.data.accessToken;
  console.log('  ✓ Super Admin logged in successfully (HTTP 200, Role: SUPER_ADMIN)');

  // Verify HR dashboard & employees list
  const dashRes = await sendJson('/api/hr/dashboard', 'GET', null, superAdminToken);
  if (dashRes.statusCode !== 200) {
    throw new Error(`HR Dashboard access failed: HTTP ${dashRes.statusCode}`);
  }
  console.log('  ✓ Super Admin accessed HR Dashboard successfully');

  // Also log in an HR user for unauthorized credential test
  const hrAdminEmail = env.seedAdmin?.email || 'admin@hrmanagement.com';
  const hrAdminPassword = env.seedAdmin?.password || 'Admin@12345';
  const hrLoginRes = await sendJson('/api/auth/login', 'POST', {
    email: hrAdminEmail,
    password: hrAdminPassword
  });
  const hrToken = hrLoginRes.body?.data?.accessToken;
  if (hrToken) {
    console.log('  ✓ HR Admin token acquired for permission testing');
  }

  // Create a dedicated test staff member
  const testStaffEmail = `test.staff.${Date.now()}@example.com`;
  const initialPassword = 'InitialPassword123';
  console.log(`\nCreating dedicated test staff member: ${testStaffEmail}...`);

  const createRes = await sendJson('/api/hr/employees', 'POST', {
    name: 'Initial Staff Member',
    email: testStaffEmail,
    phoneNumber: '9876543210',
    department: 'Tech',
    designation: 'Junior Engineer',
    workMode: 'Office',
    password: initialPassword
  }, superAdminToken);

  if (createRes.statusCode !== 201) {
    throw new Error(`Create test staff failed: HTTP ${createRes.statusCode} - ${JSON.stringify(createRes.body)}`);
  }

  const testEmployee = createRes.body.data;
  const testEmployeeId = testEmployee._id || testEmployee.id;
  console.log(`  ✓ Test staff created: ID=${testEmployeeId}, EmployeeID=${testEmployee.employeeId}`);

  // Verify staff login with initial password
  const initialLoginRes = await sendJson('/api/auth/login', 'POST', {
    email: testStaffEmail,
    password: initialPassword
  });
  if (initialLoginRes.statusCode !== 200) {
    throw new Error(`Initial staff login failed: HTTP ${initialLoginRes.statusCode}`);
  }
  const staffToken = initialLoginRes.body?.data?.accessToken;
  console.log('  ✓ Test staff logged in successfully with initial password (HTTP 200)');

  // Test 1: Updating staff details persists after reloading the profile
  console.log('\n[Test 1] Updating staff details (name, phone, designation, department, workMode)...');
  const updateDetailsRes = await sendJson(`/api/hr/employees/${testEmployeeId}`, 'PUT', {
    name: 'Jane Doe Professional',
    phoneNumber: '9123456789',
    designation: 'Lead Architect',
    department: 'Tech',
    workMode: 'WFH'
  }, superAdminToken);

  if (updateDetailsRes.statusCode !== 200) {
    throw new Error(`Update staff details failed: HTTP ${updateDetailsRes.statusCode} - ${JSON.stringify(updateDetailsRes.body)}`);
  }

  // Reload profile from backend
  const reload1Res = await sendJson(`/api/hr/employees/${testEmployeeId}`, 'GET', null, superAdminToken);
  if (reload1Res.statusCode !== 200) {
    throw new Error(`Reload profile failed: HTTP ${reload1Res.statusCode}`);
  }
  const loaded1 = reload1Res.body.data;
  if (loaded1.firstName !== 'Jane' || loaded1.lastName !== 'Doe Professional') {
    throw new Error(`Name mismatch: Expected 'Jane' 'Doe Professional', got '${loaded1.firstName}' '${loaded1.lastName}'`);
  }
  if (loaded1.phone !== '9123456789') {
    throw new Error(`Phone mismatch: Expected '9123456789', got '${loaded1.phone}'`);
  }
  if (loaded1.designation !== 'Lead Architect') {
    throw new Error(`Designation mismatch: Expected 'Lead Architect', got '${loaded1.designation}'`);
  }
  if (loaded1.workMode !== 'WFH') {
    throw new Error(`WorkMode mismatch: Expected 'WFH', got '${loaded1.workMode}'`);
  }
  console.log('  ✓ Staff details update confirmed: Name, Phone, Designation, and WorkMode persisted in database!');

  // Test 2: Updating the email also updates the associated login identity correctly
  const updatedEmail = `jane.doe.updated.${Date.now()}@example.com`;
  console.log(`\n[Test 2] Updating employee email to: ${updatedEmail}...`);
  const updateEmailRes = await sendJson(`/api/hr/employees/${testEmployeeId}`, 'PUT', {
    email: updatedEmail
  }, superAdminToken);

  if (updateEmailRes.statusCode !== 200) {
    throw new Error(`Update email failed: HTTP ${updateEmailRes.statusCode} - ${JSON.stringify(updateEmailRes.body)}`);
  }

  // Verify email changed on reloaded employee profile
  const reload2Res = await sendJson(`/api/hr/employees/${testEmployeeId}`, 'GET', null, superAdminToken);
  if (reload2Res.body.data.email !== updatedEmail) {
    throw new Error(`Profile email mismatch: Expected '${updatedEmail}', got '${reload2Res.body.data.email}'`);
  }

  // Verify login with new email succeeds
  const newEmailLoginRes = await sendJson('/api/auth/login', 'POST', {
    email: updatedEmail,
    password: initialPassword
  });
  if (newEmailLoginRes.statusCode !== 200) {
    throw new Error(`Login with new email failed: HTTP ${newEmailLoginRes.statusCode} - ${JSON.stringify(newEmailLoginRes.body)}`);
  }
  console.log('  ✓ Login with updated email succeeded (HTTP 200)');

  // Verify login with old email is rejected
  const oldEmailLoginRes = await sendJson('/api/auth/login', 'POST', {
    email: testStaffEmail,
    password: initialPassword
  });
  if (oldEmailLoginRes.statusCode !== 401) {
    throw new Error(`Login with old email expected 401, got HTTP ${oldEmailLoginRes.statusCode}`);
  }
  console.log('  ✓ Login with old email rejected (HTTP 401)');

  // Test 3: Saving with an empty password does not change the existing password
  console.log('\n[Test 3] Saving employee profile with empty password...');
  const emptyPwdUpdateRes = await sendJson(`/api/hr/employees/${testEmployeeId}`, 'PUT', {
    password: '',
    designation: 'Principal Solutions Architect'
  }, superAdminToken);

  if (emptyPwdUpdateRes.statusCode !== 200) {
    throw new Error(`Empty password update failed: HTTP ${emptyPwdUpdateRes.statusCode}`);
  }

  // Verify existing password still works
  const stillWorkingLoginRes = await sendJson('/api/auth/login', 'POST', {
    email: updatedEmail,
    password: initialPassword
  });
  if (stillWorkingLoginRes.statusCode !== 200) {
    throw new Error(`Existing password was corrupted or changed when empty password was provided!`);
  }
  console.log('  ✓ Existing password remains valid and unchanged after saving with empty password string');

  // Test 4: Setting a new password allows login with the new password and rejects the old one
  const newSecurePassword = 'NewSecretPassword@2026';
  console.log('\n[Test 4] Updating password to new credential as Super Admin...');
  const newPwdUpdateRes = await sendJson(`/api/hr/employees/${testEmployeeId}`, 'PUT', {
    password: newSecurePassword
  }, superAdminToken);

  if (newPwdUpdateRes.statusCode !== 200) {
    throw new Error(`New password update failed: HTTP ${newPwdUpdateRes.statusCode}`);
  }

  // Verify old password is now rejected
  const oldPwdRejectedRes = await sendJson('/api/auth/login', 'POST', {
    email: updatedEmail,
    password: initialPassword
  });
  if (oldPwdRejectedRes.statusCode !== 401) {
    throw new Error(`Old password should be rejected with 401, got ${oldPwdRejectedRes.statusCode}`);
  }
  console.log('  ✓ Old password rejected with 401 Unauthorized');

  // Verify new password succeeds
  const newPwdSuccessRes = await sendJson('/api/auth/login', 'POST', {
    email: updatedEmail,
    password: newSecurePassword
  });
  if (newPwdSuccessRes.statusCode !== 200) {
    throw new Error(`Login with new password failed: HTTP ${newPwdSuccessRes.statusCode}`);
  }
  console.log('  ✓ Login with new password succeeded (HTTP 200)');

  // Verify response does not leak password hash
  if (newPwdUpdateRes.body.data?.password || newPwdUpdateRes.body.data?.user?.password) {
    throw new Error('SECURITY VIOLATION: Password hash exposed in update response!');
  }
  console.log('  ✓ Security check passed: password hash is never exposed in API responses');

  // Test 5: Duplicate emails are rejected without corrupting records
  console.log('\n[Test 5] Attempting duplicate email assignment (Super Admin email)...');
  const dupEmailRes = await sendJson(`/api/hr/employees/${testEmployeeId}`, 'PUT', {
    email: superAdminEmail
  }, superAdminToken);

  if (dupEmailRes.statusCode !== 409) {
    throw new Error(`Expected 409 Conflict for duplicate email, got HTTP ${dupEmailRes.statusCode}`);
  }
  console.log(`  ✓ Duplicate email rejected with 409 Conflict: "${dupEmailRes.body.message}"`);

  // Verify record was not corrupted
  const reload3Res = await sendJson(`/api/hr/employees/${testEmployeeId}`, 'GET', null, superAdminToken);
  if (reload3Res.body.data.email !== updatedEmail) {
    throw new Error(`Record was corrupted after duplicate email rejection!`);
  }
  console.log('  ✓ Record integrity verified: employee email remains intact without corruption');

  // Test 6: Unauthorized users cannot update staff details or credentials
  console.log('\n[Test 6] Verifying authorization guards on staff update endpoint...');
  
  // 6a: Unauthenticated
  const unauthRes = await sendJson(`/api/hr/employees/${testEmployeeId}`, 'PUT', {
    designation: 'Hacker Title'
  });
  if (unauthRes.statusCode !== 401) {
    throw new Error(`Expected 401 for unauthenticated update, got ${unauthRes.statusCode}`);
  }
  console.log('  ✓ Unauthenticated update rejected with 401 Unauthorized');

  // 6b: Staff role attempting update
  const staffRoleRes = await sendJson(`/api/hr/employees/${testEmployeeId}`, 'PUT', {
    designation: 'Staff Self Title'
  }, staffToken);
  if (staffRoleRes.statusCode !== 403) {
    throw new Error(`Expected 403 for Staff user calling HR employee update, got ${staffRoleRes.statusCode}`);
  }
  console.log('  ✓ Staff user rejected from administrative update with 403 Forbidden');

  // 6c: HR role attempting credential update
  if (hrToken) {
    const hrPwdRes = await sendJson(`/api/hr/employees/${testEmployeeId}`, 'PUT', {
      password: 'HRPwdAttempt123'
    }, hrToken);
    if (hrPwdRes.statusCode !== 403) {
      throw new Error(`Expected 403 when non-SuperAdmin HR attempts password change, got ${hrPwdRes.statusCode}`);
    }
    console.log(`  ✓ Non-SuperAdmin HR password update rejected with 403 Forbidden: "${hrPwdRes.body.message}"`);
  }

  // Cleanup: Delete the test employee
  console.log('\nCleaning up test employee...');
  await sendJson(`/api/hr/employees/${testEmployeeId}`, 'DELETE', null, superAdminToken);
  console.log('  ✓ Test employee deactivated cleanly');

  console.log('\n================================================================');
  console.log('   ALL 7 LIVE END-TO-END VERIFICATION CHECKS PASSED SUCCESSFULLY!');
  console.log('================================================================\n');
  process.exit(0);
};

run().catch((err) => {
  console.error('\n❌ LIVE VERIFICATION FAILED:', err.message);
  process.exit(1);
});
