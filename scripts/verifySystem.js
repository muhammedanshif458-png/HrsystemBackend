const mongoose = require('mongoose');
const http = require('http');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { app } = require('../server');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
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

const runVerification = async () => {
  console.log('\n========================================');
  console.log('   HR MANAGEMENT SYSTEM TEST SUITE');
  console.log('========================================\n');

  let mongod = null;
  let server = null;

  try {
    // 1. Connect DB (try in-memory if local mongodb is not running)
    console.log('[1/20] Setting up MongoDB database...');
    let mongoUri;
    try {
      mongod = await MongoMemoryServer.create();
      mongoUri = mongod.getUri();
      console.log('  -> Using MongoMemoryServer for safe, isolated test run');
    } catch (e) {
      console.log('  -> MongoMemoryServer setup failed, falling back to local MongoDB', e.message);
      mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hr_management_test';
    }

    await mongoose.connect(mongoUri);
    console.log('  ✓ Connected to MongoDB successfully.');

    // 2. Start HTTP server
    console.log('[2/20] Starting test HTTP server...');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    console.log(`  ✓ Test server listening on port ${port}`);

    // 3. Test Health Endpoint
    console.log('[3/20] Testing GET /api/health...');
    const healthRes = await makeRequest(server, 'GET', '/api/health');
    if (healthRes.statusCode !== 200 || !healthRes.body.success) {
      throw new Error(`Health check failed: ${JSON.stringify(healthRes.body)}`);
    }
    console.log('  ✓ Health check passed:', healthRes.body.message);

    // 4. Create Initial HR User & Employee directly in DB
    console.log('[4/20] Seeding HR Admin account...');
    const hrUser = new User({
      firstName: 'HR',
      lastName: 'Director',
      email: 'admin@hrmanagement.com',
      password: 'Admin@12345',
      role: 'HR',
      isActive: true
    });
    await hrUser.save();

    const hrEmp = new Employee({
      employeeId: 'HR0001',
      user: hrUser._id,
      firstName: 'HR',
      lastName: 'Director',
      email: 'admin@hrmanagement.com',
      department: 'Human Resources',
      designation: 'HR Director',
      status: 'ACTIVE'
    });
    await hrEmp.save();
    console.log('  ✓ HR user and employee seeded.');

    // 5. Test HR Login
    console.log('[5/20] Testing POST /api/auth/login for HR...');
    const hrLoginRes = await makeRequest(server, 'POST', '/api/auth/login', {}, {
      email: 'admin@hrmanagement.com',
      password: 'Admin@12345'
    });
    if (hrLoginRes.statusCode !== 200 || !hrLoginRes.body.data.accessToken) {
      throw new Error(`HR login failed: ${JSON.stringify(hrLoginRes.body)}`);
    }
    const hrToken = hrLoginRes.body.data.accessToken;
    console.log('  ✓ HR login successful, received JWT access token.');

    // 6. Test Unauthorized Access (No Token)
    console.log('[6/20] Testing unauthorized access (missing Bearer token)...');
    const unauthRes = await makeRequest(server, 'GET', '/api/hr/dashboard');
    if (unauthRes.statusCode !== 401) {
      throw new Error(`Expected 401 for missing token, got ${unauthRes.statusCode}`);
    }
    console.log('  ✓ Unauthorized access properly rejected with 401.');

    // 7. Test HR Create Employee (POST /api/hr/employees)
    console.log('[7/20] Testing POST /api/hr/employees (HR role)...');
    const newEmpData = {
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice.smith@hrmanagement.com',
      password: 'Password@123',
      employeeId: 'EMP1001',
      phone: '+1987654321',
      department: 'Engineering',
      designation: 'Senior Developer',
      employmentType: 'FULL_TIME',
      salary: 85000,
      gender: 'FEMALE',
      city: 'San Francisco',
      country: 'USA'
    };
    const createEmpRes = await makeRequest(
      server,
      'POST',
      '/api/hr/employees',
      { Authorization: `Bearer ${hrToken}` },
      newEmpData
    );
    if (createEmpRes.statusCode !== 201 || !createEmpRes.body.data.employeeId) {
      throw new Error(`Create employee failed: ${JSON.stringify(createEmpRes.body)}`);
    }
    const createdEmployee = createEmpRes.body.data;
    console.log(`  ✓ Employee created: ${createdEmployee.employeeId} - ${createdEmployee.firstName} ${createdEmployee.lastName}`);

    // 8. Test Staff Login
    console.log('[8/20] Testing POST /api/auth/login for created Staff member...');
    const staffLoginRes = await makeRequest(server, 'POST', '/api/auth/login', {}, {
      email: 'alice.smith@hrmanagement.com',
      password: 'Password@123'
    });
    if (staffLoginRes.statusCode !== 200 || !staffLoginRes.body.data.accessToken) {
      throw new Error(`Staff login failed: ${JSON.stringify(staffLoginRes.body)}`);
    }
    const staffToken = staffLoginRes.body.data.accessToken;
    console.log('  ✓ Staff login successful.');

    // 9. Test Role Isolation: Staff token accessing HR route (must return 403 Forbidden)
    console.log('[9/20] Testing Staff token accessing HR route (/api/hr/dashboard)...');
    const staffOnHrRes = await makeRequest(
      server,
      'GET',
      '/api/hr/dashboard',
      { Authorization: `Bearer ${staffToken}` }
    );
    if (staffOnHrRes.statusCode !== 403) {
      throw new Error(`Expected 403 Forbidden, got ${staffOnHrRes.statusCode}`);
    }
    console.log('  ✓ Staff token properly rejected on HR route with 403 Forbidden.');

    // 10. Test Role Isolation: HR token accessing Staff route (must return 403 Forbidden)
    console.log('[10/20] Testing HR token accessing Staff route (/api/staff/dashboard)...');
    const hrOnStaffRes = await makeRequest(
      server,
      'GET',
      '/api/staff/dashboard',
      { Authorization: `Bearer ${hrToken}` }
    );
    if (hrOnStaffRes.statusCode !== 403) {
      throw new Error(`Expected 403 Forbidden, got ${hrOnStaffRes.statusCode}`);
    }
    console.log('  ✓ HR token properly rejected on Staff route with 403 Forbidden.');

    // 11. Test Staff Dashboard
    console.log('[11/20] Testing GET /api/staff/dashboard...');
    const staffDashRes = await makeRequest(
      server,
      'GET',
      '/api/staff/dashboard',
      { Authorization: `Bearer ${staffToken}` }
    );
    if (staffDashRes.statusCode !== 200 || !staffDashRes.body.data.employee) {
      throw new Error(`Staff dashboard failed: ${JSON.stringify(staffDashRes.body)}`);
    }
    console.log('  ✓ Staff dashboard returned authenticated staff information.');

    // 12. Test Staff Profile update
    console.log('[12/20] Testing PUT /api/staff/profile...');
    const updateProfileRes = await makeRequest(
      server,
      'PUT',
      '/api/staff/profile',
      { Authorization: `Bearer ${staffToken}` },
      { phone: '+1122334455', city: 'Oakland' }
    );
    if (updateProfileRes.statusCode !== 200 || updateProfileRes.body.data.phone !== '+1122334455') {
      throw new Error(`Update profile failed: ${JSON.stringify(updateProfileRes.body)}`);
    }
    console.log('  ✓ Staff profile updated successfully.');

    // 13. Test Attendance Check-in
    console.log('[13/20] Testing POST /api/staff/attendance/check-in...');
    const checkInRes = await makeRequest(
      server,
      'POST',
      '/api/staff/attendance/check-in',
      { Authorization: `Bearer ${staffToken}` },
      { remarks: 'Arrived on time at office' }
    );
    if (checkInRes.statusCode !== 201 || !checkInRes.body.data.checkIn) {
      throw new Error(`Check-in failed: ${JSON.stringify(checkInRes.body)}`);
    }
    console.log('  ✓ Attendance checked in successfully.');

    // 14. Test Duplicate Check-in Prevention
    console.log('[14/20] Testing duplicate check-in prevention (same day)...');
    const dupCheckInRes = await makeRequest(
      server,
      'POST',
      '/api/staff/attendance/check-in',
      { Authorization: `Bearer ${staffToken}` },
      { remarks: 'Second check-in attempt' }
    );
    if (dupCheckInRes.statusCode !== 400) {
      throw new Error(`Expected 400 for duplicate check-in, got ${dupCheckInRes.statusCode}`);
    }
    console.log('  ✓ Duplicate check-in prevented with 400 Bad Request.');

    // 15. Test Attendance Check-out
    console.log('[15/20] Testing POST /api/staff/attendance/check-out...');
    const checkOutRes = await makeRequest(
      server,
      'POST',
      '/api/staff/attendance/check-out',
      { Authorization: `Bearer ${staffToken}` },
      { remarks: 'Left for the day' }
    );
    if (checkOutRes.statusCode !== 200 || !checkOutRes.body.data.checkOut) {
      throw new Error(`Check-out failed: ${JSON.stringify(checkOutRes.body)}`);
    }
    console.log('  ✓ Checked out successfully. Working hours calculated:', checkOutRes.body.data.workingHours);

    // 16. Test Staff Apply Leave
    console.log('[16/20] Testing POST /api/staff/leaves...');
    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 5).toISOString().split('T')[0];
    const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7).toISOString().split('T')[0];
    
    const applyLeaveRes = await makeRequest(
      server,
      'POST',
      '/api/staff/leaves',
      { Authorization: `Bearer ${staffToken}` },
      {
        leaveType: 'CASUAL',
        startDate,
        endDate,
        reason: 'Attending family wedding event'
      }
    );
    if (applyLeaveRes.statusCode !== 201 || !applyLeaveRes.body.data._id) {
      throw new Error(`Apply leave failed: ${JSON.stringify(applyLeaveRes.body)}`);
    }
    const leaveId = applyLeaveRes.body.data._id;
    console.log(`  ✓ Leave request created with ID: ${leaveId} (Status: PENDING)`);

    // 17. Test Overlapping Leave Prevention
    console.log('[17/20] Testing overlapping leave prevention...');
    const overlapLeaveRes = await makeRequest(
      server,
      'POST',
      '/api/staff/leaves',
      { Authorization: `Bearer ${staffToken}` },
      {
        leaveType: 'SICK',
        startDate,
        endDate,
        reason: 'Another request on the exact same dates'
      }
    );
    if (overlapLeaveRes.statusCode !== 409) {
      throw new Error(`Expected 409 Conflict for overlapping leave, got ${overlapLeaveRes.statusCode}`);
    }
    console.log('  ✓ Overlapping leave request blocked with 409 Conflict.');

    // 18. Test HR Leave Approval
    console.log('[18/20] Testing PUT /api/hr/leaves/:id/approve (HR role)...');
    const approveRes = await makeRequest(
      server,
      'PUT',
      `/api/hr/leaves/${leaveId}/approve`,
      { Authorization: `Bearer ${hrToken}` }
    );
    if (approveRes.statusCode !== 200 || approveRes.body.data.status !== 'APPROVED') {
      throw new Error(`Leave approval failed: ${JSON.stringify(approveRes.body)}`);
    }
    console.log('  ✓ Leave approved successfully by HR.');

    // 19. Test HR Dashboard & Reports
    console.log('[19/20] Testing GET /api/hr/dashboard and /api/hr/reports/attendance...');
    const hrDashRes = await makeRequest(
      server,
      'GET',
      '/api/hr/dashboard',
      { Authorization: `Bearer ${hrToken}` }
    );
    if (hrDashRes.statusCode !== 200 || typeof hrDashRes.body.data.totalEmployees !== 'number') {
      throw new Error(`HR Dashboard failed: ${JSON.stringify(hrDashRes.body)}`);
    }
    const hrReportsRes = await makeRequest(
      server,
      'GET',
      '/api/hr/reports/attendance',
      { Authorization: `Bearer ${hrToken}` }
    );
    if (hrReportsRes.statusCode !== 200) {
      throw new Error(`HR Reports failed: ${JSON.stringify(hrReportsRes.body)}`);
    }
    console.log('  ✓ HR Dashboard & Reports generated accurately.');

    // 20. Test Input Validation Failure
    console.log('[20/20] Testing input validation (invalid email during login)...');
    const badLoginRes = await makeRequest(server, 'POST', '/api/auth/login', {}, {
      email: 'not-an-email',
      password: ''
    });
    if (badLoginRes.statusCode !== 422 || !badLoginRes.body.errors) {
      throw new Error(`Expected 422 Validation error, got ${badLoginRes.statusCode}`);
    }
    console.log('  ✓ Validation error returned status 422 with structured field errors.');

    console.log('\n========================================');
    console.log('  ALL 20 SYSTEM VERIFICATIONS PASSED!  ');
    console.log('========================================\n');
  } catch (error) {
    console.error('\n❌ Verification Failed:', error.message);
    if (error.stack) console.error(error.stack);
    process.exitCode = 1;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongod) {
      await mongod.stop();
    }
  }
};

runVerification();
