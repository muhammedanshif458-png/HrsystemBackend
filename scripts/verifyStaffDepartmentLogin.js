const http = require('http');
const mongoose = require('mongoose');
const User = require('../models/User');
const Employee = require('../models/Employee');
const authService = require('../services/authService');
const { app } = require('../server');
const env = require('../config/env');
const assert = require('assert');

let server;
let serverPort;

function makeRequest(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const reqHeaders = { ...headers };
    let postData = null;

    if (body) {
      postData = JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
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
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );

    req.on('error', reject);

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function main() {
  console.log('[Test] Connecting to MongoDB...');
  const testDbUri = (env.mongodbUri || 'mongodb://127.0.0.1:27017/hr_management').replace(/\/([^\/?]+)(\?|$)/, '/hr_management_dept_auth_test$2');
  await mongoose.connect(testDbUri);
  console.log('[Test] Connected to:', testDbUri);

  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      console.log(`[Test] Ephemeral HTTP test server listening on http://127.0.0.1:${serverPort}`);
      resolve();
    });
  });

  try {
    await User.deleteMany({ email: { $in: ['dept_tech_test@example.com', 'dept_tele_test@example.com', 'dept_admin_test@example.com'] } });
    await Employee.deleteMany({ email: { $in: ['dept_tech_test@example.com', 'dept_tele_test@example.com'] } });

    // 1. Create Tech Employee & User
    const techUser = await User.create({
      firstName: 'Tech',
      lastName: 'User',
      email: 'dept_tech_test@example.com',
      password: 'Password123!',
      role: 'STAFF',
      isActive: true
    });
    const techEmp = await Employee.create({
      user: techUser._id,
      employeeId: 'EMP_TECH_001',
      firstName: 'Tech',
      lastName: 'User',
      fullName: 'Tech Employee',
      email: 'dept_tech_test@example.com',
      department: 'Tech',
      designation: 'Software Engineer',
      status: 'ACTIVE'
    });

    // 2. Create Telecalling Employee & User
    const teleUser = await User.create({
      firstName: 'Tele',
      lastName: 'User',
      email: 'dept_tele_test@example.com',
      password: 'Password123!',
      role: 'STAFF',
      isActive: true
    });
    const teleEmp = await Employee.create({
      user: teleUser._id,
      employeeId: 'EMP_TELE_001',
      firstName: 'Tele',
      lastName: 'User',
      fullName: 'Telecalling Employee',
      email: 'dept_tele_test@example.com',
      department: 'Telecalling',
      designation: 'Telecaller',
      status: 'ACTIVE'
    });

    // 3. Create HR Admin User
    const adminUser = await User.create({
      firstName: 'Admin',
      lastName: 'User',
      email: 'dept_admin_test@example.com',
      password: 'Password123!',
      role: 'HR',
      isActive: true
    });

    console.log('[Test] Seeded test accounts successfully.');

    // --- Service Level Tests ---

    // Case 1: Tech employee logs in with matching department ('Tech') -> 200 OK
    {
      const res = await authService.login('dept_tech_test@example.com', 'Password123!', {
        department: 'Tech',
        workMode: 'OFFICE'
      });
      assert.ok(res.token, 'Expected token for matching Tech login');
      assert.strictEqual(res.user.email, 'dept_tech_test@example.com');
      console.log('✅ Case 1 Passed: Tech employee logged into Tech successfully (Service).');
    }

    // Case 2: Tech employee logs in with mismatched department ('Telecalling') -> 403 Forbidden
    {
      let caughtErr = null;
      try {
        await authService.login('dept_tech_test@example.com', 'Password123!', {
          department: 'Telecalling',
          workMode: 'OFFICE'
        });
      } catch (err) {
        caughtErr = err;
      }
      assert.ok(caughtErr, 'Expected error for mismatched department');
      assert.strictEqual(caughtErr.statusCode, 403);
      assert.strictEqual(
        caughtErr.message,
        'Access denied: Your account is registered under the Tech department, not Telecalling.'
      );
      console.log('✅ Case 2 Passed: Tech employee blocked from Telecalling department with 403 (Service).');
    }

    // Case 3: Telecalling employee logs in with mismatched department ('Tech') -> 403 Forbidden
    {
      let caughtErr = null;
      try {
        await authService.login('dept_tele_test@example.com', 'Password123!', {
          department: 'Tech',
          workMode: 'OFFICE'
        });
      } catch (err) {
        caughtErr = err;
      }
      assert.ok(caughtErr, 'Expected error for mismatched department');
      assert.strictEqual(caughtErr.statusCode, 403);
      assert.strictEqual(
        caughtErr.message,
        'Access denied: Your account is registered under the Telecalling department, not Tech.'
      );
      console.log('✅ Case 3 Passed: Telecalling employee blocked from Tech department with 403 (Service).');
    }

    // Case 4: Telecalling employee logs in with matching department ('Telecalling') -> 200 OK
    {
      const res = await authService.login('dept_tele_test@example.com', 'Password123!', {
        department: 'Telecalling',
        workMode: 'OFFICE'
      });
      assert.ok(res.token, 'Expected token for matching Telecalling login');
      assert.strictEqual(res.user.email, 'dept_tele_test@example.com');
      console.log('✅ Case 4 Passed: Telecalling employee logged into Telecalling successfully (Service).');
    }

    // Case 5: Staff employee logs in with NO department passed -> 200 OK
    {
      const res = await authService.login('dept_tech_test@example.com', 'Password123!', {
        workMode: 'OFFICE'
      });
      assert.ok(res.token, 'Expected token when department is omitted');
      console.log('✅ Case 5 Passed: Login without department parameter succeeds (Service).');
    }

    // Case 6: Admin logs in with department passed -> 200 OK (admin not blocked)
    {
      const res = await authService.login('dept_admin_test@example.com', 'Password123!', {
        department: 'Telecalling',
        workMode: 'OFFICE'
      });
      assert.ok(res.token, 'Expected token for Admin login');
      console.log('✅ Case 6 Passed: Admin account is not restricted by department login (Service).');
    }

    // Case 7: Bad password with mismatched department -> 401 Invalid credentials (not 403, no leak)
    {
      let caughtErr = null;
      try {
        await authService.login('dept_tech_test@example.com', 'WrongPassword!', {
          department: 'Telecalling',
          workMode: 'OFFICE'
        });
      } catch (err) {
        caughtErr = err;
      }
      assert.ok(caughtErr, 'Expected error for bad password');
      assert.strictEqual(caughtErr.statusCode, 401);
      assert.strictEqual(caughtErr.message, 'Invalid email or password');
      console.log('✅ Case 7 Passed: Invalid password returns 401 without leaking department mismatch (Service).');
    }

    // --- HTTP Route End-to-End Tests via POST /api/auth/login ---

    // Case 8: HTTP POST /api/auth/login Tech -> Tech (200 OK)
    {
      const res = await makeRequest('POST', '/api/auth/login', {}, {
        email: 'dept_tech_test@example.com',
        password: 'Password123!',
        department: 'Tech',
        workMode: 'OFFICE'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.token);
      console.log('✅ Case 8 Passed: HTTP POST /api/auth/login Tech -> Tech returned 200 with JWT.');
    }

    // Case 9: HTTP POST /api/auth/login Tech -> Telecalling (403 Forbidden)
    {
      const res = await makeRequest('POST', '/api/auth/login', {}, {
        email: 'dept_tech_test@example.com',
        password: 'Password123!',
        department: 'Telecalling',
        workMode: 'OFFICE'
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.message, 'Access denied: Your account is registered under the Tech department, not Telecalling.');
      assert.strictEqual(res.body.data, undefined);
      console.log('✅ Case 9 Passed: HTTP POST /api/auth/login Tech -> Telecalling returned 403 Forbidden.');
    }

    // Case 10: HTTP POST /api/auth/login Telecalling -> Tech (403 Forbidden)
    {
      const res = await makeRequest('POST', '/api/auth/login', {}, {
        email: 'dept_tele_test@example.com',
        password: 'Password123!',
        department: 'Tech',
        workMode: 'OFFICE'
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.message, 'Access denied: Your account is registered under the Telecalling department, not Tech.');
      console.log('✅ Case 10 Passed: HTTP POST /api/auth/login Telecalling -> Tech returned 403 Forbidden.');
    }

    // Case 11: HTTP POST /api/auth/login Telecalling -> Telecalling (200 OK)
    {
      const res = await makeRequest('POST', '/api/auth/login', {}, {
        email: 'dept_tele_test@example.com',
        password: 'Password123!',
        department: 'Telecalling',
        workMode: 'OFFICE'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.token);
      console.log('✅ Case 11 Passed: HTTP POST /api/auth/login Telecalling -> Telecalling returned 200 with JWT.');
    }

    // Case 12: HTTP POST /api/auth/login no department (200 OK)
    {
      const res = await makeRequest('POST', '/api/auth/login', {}, {
        email: 'dept_tech_test@example.com',
        password: 'Password123!',
        workMode: 'OFFICE'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.data.token);
      console.log('✅ Case 12 Passed: HTTP POST /api/auth/login without department returned 200 OK.');
    }

    // Case 13: HTTP POST /api/auth/login with division field alias (403 Forbidden)
    {
      const res = await makeRequest('POST', '/api/auth/login', {}, {
        email: 'dept_tech_test@example.com',
        password: 'Password123!',
        division: 'Telecalling',
        workMode: 'OFFICE'
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.message, 'Access denied: Your account is registered under the Tech department, not Telecalling.');
      console.log('✅ Case 13 Passed: HTTP POST /api/auth/login with division alias field rejected with 403.');
    }

    console.log('\n🎉 ALL 13 DEPARTMENT LOGIN VALIDATION TESTS PASSED SUCCESSFULLY!');
  } finally {
    await User.deleteMany({ email: { $in: ['dept_tech_test@example.com', 'dept_tele_test@example.com', 'dept_admin_test@example.com'] } });
    await Employee.deleteMany({ email: { $in: ['dept_tech_test@example.com', 'dept_tele_test@example.com'] } });
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
