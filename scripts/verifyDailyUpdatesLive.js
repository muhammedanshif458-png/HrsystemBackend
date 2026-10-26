const mongoose = require('mongoose');
const http = require('http');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { app } = require('../server');
const User = require('../models/User');
const Employee = require('../models/Employee');
const DailyUpdate = require('../models/DailyUpdate');
const { generateAccessToken } = require('../utils/jwt');

// Helper to make HTTP requests against express app
const makeRequest = (server, method, path, headers = {}, body = null) => {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const reqHeaders = { ...headers };
    let postData = null;

    if (body) {
      postData = JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const options = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: reqHeaders
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: parsed
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
};

const run = async () => {
  console.log('\n========================================================================');
  console.log('   LIVE END-TO-END VERIFICATION: STAFF DAILY WORK UPDATES API');
  console.log('========================================================================\n');

  let mongod = null;
  let server = null;

  try {
    // 1. Setup isolated in-memory MongoDB
    console.log('[1/12] Setting up isolated database...');
    mongod = await MongoMemoryServer.create();
    const mongoUri = mongod.getUri();
    await mongoose.connect(mongoUri);
    console.log('  ✓ Connected to isolated MongoDB database.');

    // 2. Start HTTP server
    console.log('[2/12] Starting test HTTP server...');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    console.log(`  ✓ Test HTTP server listening on port ${port}`);

    // 3. Seed users & accounts
    console.log('[3/12] Seeding test accounts (Super Admin, HR Admin, Staff A, Staff B)...');
    
    // Super Admin
    const superAdminUser = await User.create({
      firstName: 'Super',
      lastName: 'Admin',
      email: 'lysoftware@gmail.com',
      password: 'password123',
      role: 'SUPER_ADMIN',
      isActive: true
    });
    const superAdminToken = generateAccessToken(superAdminUser);

    // HR Admin
    const hrUser = await User.create({
      firstName: 'HR',
      lastName: 'Manager',
      email: 'hr@example.com',
      password: 'password123',
      role: 'HR',
      isActive: true
    });
    const hrToken = generateAccessToken(hrUser);

    // Staff A (Tech)
    const staffUserA = await User.create({
      firstName: 'Alice',
      lastName: 'Tech',
      email: 'alice.tech@example.com',
      password: 'password123',
      role: 'STAFF',
      isActive: true
    });
    const employeeA = await Employee.create({
      employeeId: 'EMP101',
      user: staffUserA._id,
      firstName: 'Alice',
      lastName: 'Tech',
      email: 'alice.tech@example.com',
      department: 'Tech',
      designation: 'Software Engineer',
      status: 'ACTIVE'
    });
    const staffAToken = generateAccessToken(staffUserA);

    // Staff B (Telecalling)
    const staffUserB = await User.create({
      firstName: 'Bob',
      lastName: 'Telecall',
      email: 'bob.telecall@example.com',
      password: 'password123',
      role: 'STAFF',
      isActive: true
    });

    const employeeB = await Employee.create({
      employeeId: 'EMP102',
      user: staffUserB._id,
      firstName: 'Bob',
      lastName: 'Telecall',
      email: 'bob.telecall@example.com',
      department: 'Telecalling',
      designation: 'Support Specialist',
      status: 'ACTIVE'
    });
    const staffBToken = generateAccessToken(staffUserB);

    console.log('  ✓ Test accounts and employee records successfully seeded.');

    // 4. Test Unauthenticated Requests (401)
    console.log('\n[4/12] Testing unauthenticated access (HTTP 401)...');
    const unauthPost = await makeRequest(server, 'POST', '/api/staff/daily-updates', {}, { updateText: 'Testing without token' });
    if (unauthPost.statusCode !== 401) {
      throw new Error(`Expected 401 for unauthenticated POST, got HTTP ${unauthPost.statusCode}`);
    }

    const unauthGetHR = await makeRequest(server, 'GET', '/api/hr/daily-updates');
    if (unauthGetHR.statusCode !== 401) {
      throw new Error(`Expected 401 for unauthenticated HR GET, got HTTP ${unauthGetHR.statusCode}`);
    }
    console.log('  ✓ Both Staff submission and HR retrieval properly rejected with 401 Unauthorized.');

    // 5. Test Role-Based Authorization Guards (403)
    console.log('\n[5/12] Testing role-based authorization guards (HTTP 403)...');
    // HR cannot call staff submission endpoint
    const hrSubmitRes = await makeRequest(server, 'POST', '/api/staff/daily-updates', {
      Authorization: `Bearer ${hrToken}`
    }, { updateText: 'HR trying to submit staff update' });
    if (hrSubmitRes.statusCode !== 403) {
      throw new Error(`Expected 403 for HR calling staff daily updates, got HTTP ${hrSubmitRes.statusCode}`);
    }

    // Staff cannot call HR retrieval endpoint
    const staffGetHRRes = await makeRequest(server, 'GET', '/api/hr/daily-updates', {
      Authorization: `Bearer ${staffAToken}`
    });
    if (staffGetHRRes.statusCode !== 403) {
      throw new Error(`Expected 403 for Staff calling HR daily updates, got HTTP ${staffGetHRRes.statusCode}`);
    }
    console.log('  ✓ HR rejected on Staff portal (403) and Staff rejected on HR dashboard (403).');

    // 6. Test Input Validation (422)
    console.log('\n[6/12] Testing input validation for updateText & date (HTTP 422)...');
    // Missing updateText
    const emptyTextRes = await makeRequest(server, 'POST', '/api/staff/daily-updates', {
      Authorization: `Bearer ${staffAToken}`
    }, { updateText: '   ' });
    if (emptyTextRes.statusCode !== 422) {
      throw new Error(`Expected 422 for empty updateText, got HTTP ${emptyTextRes.statusCode}`);
    }
    console.log(`  ✓ Empty updateText rejected with 422: "${emptyTextRes.body.errors?.[0]?.message}"`);

    // Invalid date format
    const badDateRes = await makeRequest(server, 'POST', '/api/staff/daily-updates', {
      Authorization: `Bearer ${staffAToken}`
    }, { updateText: 'Valid update text', date: 'not-a-date' });
    if (badDateRes.statusCode !== 422) {
      throw new Error(`Expected 422 for invalid date, got HTTP ${badDateRes.statusCode}`);
    }
    console.log(`  ✓ Invalid date format rejected with 422: "${badDateRes.body.errors?.[0]?.message}"`);

    // Invalid hoursWorked
    const badHoursRes = await makeRequest(server, 'POST', '/api/staff/daily-updates', {
      Authorization: `Bearer ${staffAToken}`
    }, { updateText: 'Valid update text', hoursWorked: 99 });
    if (badHoursRes.statusCode !== 422) {
      throw new Error(`Expected 422 for out-of-range hoursWorked, got HTTP ${badHoursRes.statusCode}`);
    }
    console.log(`  ✓ Invalid hoursWorked (>24) rejected with 422: "${badHoursRes.body.errors?.[0]?.message}"`);

    // 7. Test Staff Submission & Identity Protection
    console.log('\n[7/12] Submitting daily work update through Staff API & verifying identity spoofing protection...');
    const spoofAttemptRes = await makeRequest(server, 'POST', '/api/staff/daily-updates', {
      Authorization: `Bearer ${staffAToken}`
    }, {
      title: 'Frontend API Integration',
      updateText: 'Completed the Flutter HR Dashboard integration and unit tests.',
      date: '2026-10-22',
      tasksCompleted: ['Refactored API service', 'Verified mock data compatibility'],
      blockers: 'None',
      hoursWorked: 7.5,
      // Attempting to spoof identity:
      employee: employeeB._id,
      employeeId: 'EMP9999',
      department: 'Finance'
    });

    if (spoofAttemptRes.statusCode !== 201) {
      throw new Error(`Staff submission failed: HTTP ${spoofAttemptRes.statusCode} - ${JSON.stringify(spoofAttemptRes.body)}`);
    }

    const createdUpdate = spoofAttemptRes.body.data;
    if (createdUpdate.title !== 'Frontend API Integration') {
      throw new Error(`Title mismatch! Expected "Frontend API Integration", got "${createdUpdate.title}"`);
    }
    if (createdUpdate.employeeId !== 'EMP101') {
      throw new Error(`Identity spoofing vulnerability! Expected EMP101, got ${createdUpdate.employeeId}`);
    }
    if (createdUpdate.department !== 'Tech') {
      throw new Error(`Department spoofing vulnerability! Expected Tech, got ${createdUpdate.department}`);
    }
    if (createdUpdate.staffId !== String(employeeA._id)) {
      throw new Error(`StaffId mismatch: Expected ${employeeA._id}, got ${createdUpdate.staffId}`);
    }
    console.log('  ✓ Staff update submitted successfully (HTTP 201)');
    console.log(`  ✓ Identity strictly verified from JWT: staffId=${createdUpdate.staffId}, employeeId=${createdUpdate.employeeId}, dept=${createdUpdate.department}`);

    // 8. Verify Record Persisted in MongoDB
    console.log('\n[8/12] Verifying record persistence in MongoDB collection "dailyupdates"...');
    const dbRecord = await DailyUpdate.findById(createdUpdate.id);
    if (!dbRecord) {
      throw new Error(`Record ${createdUpdate.id} was NOT found in MongoDB!`);
    }
    if (dbRecord.title !== 'Frontend API Integration') {
      throw new Error(`Title mismatch in database: ${dbRecord.title}`);
    }
    if (dbRecord.updateText !== 'Completed the Flutter HR Dashboard integration and unit tests.') {
      throw new Error(`Update text mismatch in database: ${dbRecord.updateText}`);
    }
    if (String(dbRecord.employee) !== String(employeeA._id)) {
      throw new Error(`Employee reference mismatch in database: ${dbRecord.employee}`);
    }
    if (dbRecord.date !== '2026-10-22') {
      throw new Error(`Date mismatch in database: ${dbRecord.date}`);
    }
    if (dbRecord.hoursWorked !== 7.5) {
      throw new Error(`Hours worked mismatch in database: ${dbRecord.hoursWorked}`);
    }
    console.log('  ✓ Record verified in MongoDB with correct fields, types, and references.');

    // 9. Staff Retrieves Own Updates & Privacy Isolation
    console.log('\n[9/12] Verifying staff isolation: staff can only see their own updates...');
    const staffAGetRes = await makeRequest(server, 'GET', '/api/staff/daily-updates', {
      Authorization: `Bearer ${staffAToken}`
    });
    if (staffAGetRes.statusCode !== 200 || staffAGetRes.body.data.length !== 1) {
      throw new Error(`Staff A expected 1 update, got ${staffAGetRes.body.data?.length}`);
    }
    console.log('  ✓ Staff A retrieved own daily update list (1 item).');

    // Staff B checks their updates (should be empty)
    const staffBGetRes = await makeRequest(server, 'GET', '/api/staff/daily-updates', {
      Authorization: `Bearer ${staffBToken}`
    });
    if (staffBGetRes.statusCode !== 200 || staffBGetRes.body.data.length !== 0) {
      throw new Error(`Staff B expected 0 updates, got ${staffBGetRes.body.data?.length}`);
    }
    console.log('  ✓ Staff B retrieved own empty update list (0 items).');

    // Staff B attempts to access Staff A's private update by ID
    const staffBPryingRes = await makeRequest(server, 'GET', `/api/staff/daily-updates/${createdUpdate.id}`, {
      Authorization: `Bearer ${staffBToken}`
    });
    if (staffBPryingRes.statusCode !== 403) {
      throw new Error(`Expected 403 when Staff B accesses Staff A's update, got HTTP ${staffBPryingRes.statusCode}`);
    }
    console.log('  ✓ Staff B blocked from viewing Staff A\'s private update with HTTP 403 Forbidden.');

    // Staff B now submits their own update
    const staffBSubmit = await makeRequest(server, 'POST', '/api/staff/daily-updates', {
      Authorization: `Bearer ${staffBToken}`
    }, {
      updateText: 'Conducted 45 client calls; closed 3 onboarding requests.',
      date: '2026-10-22',
      hoursWorked: 8
    });
    if (staffBSubmit.statusCode !== 201) {
      throw new Error(`Staff B submission failed: HTTP ${staffBSubmit.statusCode}`);
    }
    const updateB = staffBSubmit.body.data;
    console.log('  ✓ Staff B submitted own daily update successfully.');

    // 10. HR & Super Admin Retrieval
    console.log('\n[10/12] Retrieving updates as HR Admin and Super Admin...');
    const hrListRes = await makeRequest(server, 'GET', '/api/hr/daily-updates', {
      Authorization: `Bearer ${hrToken}`
    });
    if (hrListRes.statusCode !== 200 || hrListRes.body.data.length !== 2) {
      throw new Error(`HR expected 2 company-wide updates, got ${hrListRes.body.data?.length}`);
    }

    const saListRes = await makeRequest(server, 'GET', '/api/hr/daily-updates', {
      Authorization: `Bearer ${superAdminToken}`
    });
    if (saListRes.statusCode !== 200 || saListRes.body.data.length !== 2) {
      throw new Error(`Super Admin expected 2 company-wide updates, got ${saListRes.body.data?.length}`);
    }
    console.log('  ✓ Both HR and Super Admin successfully retrieved company-wide updates (2 items).');

    // Verify response schema contract compatibility with Flutter HR Dashboard
    const sample = hrListRes.body.data[0];
    const requiredKeys = ['id', '_id', 'staffId', 'employeeId', 'employeeName', 'department', 'title', 'date', 'updateText', 'createdAt'];
    for (const key of requiredKeys) {
      if (sample[key] === undefined) {
        throw new Error(`Missing expected key "${key}" in HR response object: ${JSON.stringify(sample)}`);
      }
    }
    console.log('  ✓ Response schema contract verified: id, staffId, employeeId, employeeName, department, title, date, updateText, and createdAt present.');

    // 11. Filtering and Pagination
    console.log('\n[11/12] Testing department, employee, date filtering and pagination...');
    
    // Filter by department=Tech
    const techOnlyRes = await makeRequest(server, 'GET', '/api/hr/daily-updates?department=Tech', {
      Authorization: `Bearer ${hrToken}`
    });
    if (techOnlyRes.body.data.length !== 1 || techOnlyRes.body.data[0].department !== 'Tech') {
      throw new Error(`Department filter failed: expected 1 Tech update, got ${techOnlyRes.body.data.length}`);
    }
    console.log('  ✓ Filter by department (department=Tech) returned only Tech updates.');

    // Filter by employeeId=EMP102
    const emp102Res = await makeRequest(server, 'GET', '/api/hr/daily-updates?employeeId=EMP102', {
      Authorization: `Bearer ${hrToken}`
    });
    if (emp102Res.body.data.length !== 1 || emp102Res.body.data[0].employeeId !== 'EMP102') {
      throw new Error(`Employee filter failed: expected EMP102, got ${emp102Res.body.data[0]?.employeeId}`);
    }
    console.log('  ✓ Filter by employeeId string (employeeId=EMP102) returned Bob\'s update.');

    // Filter by employee Mongo ID via endpoint
    const empSpecificRes = await makeRequest(server, 'GET', `/api/hr/employees/${employeeA._id}/daily-updates`, {
      Authorization: `Bearer ${hrToken}`
    });
    if (empSpecificRes.body.data.length !== 1 || empSpecificRes.body.data[0].employeeId !== 'EMP101') {
      throw new Error(`Employee-specific endpoint failed: expected EMP101, got ${empSpecificRes.body.data[0]?.employeeId}`);
    }
    console.log('  ✓ GET /api/hr/employees/:id/daily-updates returned employee\'s updates.');

    // Nonexistent employee filter
    const nonExistRes = await makeRequest(server, 'GET', '/api/hr/daily-updates?employeeId=NONEXISTENT', {
      Authorization: `Bearer ${hrToken}`
    });
    if (nonExistRes.body.data.length !== 0 || nonExistRes.body.pagination.total !== 0) {
      throw new Error('Expected 0 results for nonexistent employee filter');
    }
    console.log('  ✓ Nonexistent employee filter returned clean empty list (0 results).');

    // Pagination
    const pageRes = await makeRequest(server, 'GET', '/api/hr/daily-updates?page=1&limit=1', {
      Authorization: `Bearer ${hrToken}`
    });
    if (pageRes.body.data.length !== 1 || pageRes.body.pagination.total !== 2 || pageRes.body.pagination.totalPages !== 2) {
      throw new Error(`Pagination metadata mismatch: ${JSON.stringify(pageRes.body.pagination)}`);
    }
    console.log('  ✓ Pagination verified: page=1, limit=1 returned 1 item with total=2, totalPages=2.');

    // 12. Security: Verify no credential leakage
    console.log('\n[12/12] Verifying no passwords, hashes, or tokens are leaked in responses...');
    const rawResponseBody = JSON.stringify(hrListRes.body);
    if (rawResponseBody.includes('password') || rawResponseBody.includes('refreshToken')) {
      throw new Error('SECURITY VIOLATION: Sensitive authentication fields exposed in daily updates response!');
    }
    console.log('  ✓ Security check passed: no credentials or sensitive tokens exposed.');

    console.log('\n========================================================================');
    console.log('   ALL 12 END-TO-END VERIFICATION CHECKS PASSED SUCCESSFULLY!          ');
    console.log('========================================================================\n');
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (mongod) {
      await mongoose.disconnect();
      await mongod.stop();
    }
  }
};

run().catch((err) => {
  console.error('\n❌ VERIFICATION SCRIPT FAILED:', err);
  process.exit(1);
});
