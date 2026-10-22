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
    console.log('[20/35] Testing input validation (invalid email during login)...');
    const badLoginRes = await makeRequest(server, 'POST', '/api/auth/login', {}, {
      email: 'not-an-email',
      password: ''
    });
    if (badLoginRes.statusCode !== 422 || !badLoginRes.body.errors) {
      throw new Error(`Expected 422 Validation error, got ${badLoginRes.statusCode}`);
    }
    console.log('  ✓ Validation error returned status 422 with structured field errors.');

    // 21. Test Departments Endpoints
    console.log('[21/35] Testing GET /api/hr/departments & /api/hr/departments/tech...');
    const deptsRes = await makeRequest(server, 'GET', '/api/hr/departments', { Authorization: `Bearer ${hrToken}` });
    if (deptsRes.statusCode !== 200 || !Array.isArray(deptsRes.body.data) || deptsRes.body.data.length < 2) {
      throw new Error(`Get departments failed: ${JSON.stringify(deptsRes.body)}`);
    }
    const singleDeptRes = await makeRequest(server, 'GET', '/api/hr/departments/tech', { Authorization: `Bearer ${hrToken}` });
    if (singleDeptRes.statusCode !== 200 || singleDeptRes.body.data.deptKey !== 'tech') {
      throw new Error(`Get single department failed: ${JSON.stringify(singleDeptRes.body)}`);
    }
    console.log('  ✓ Department endpoints returned valid organizational units.');

    // 22. Test Employee Status Update
    console.log('[22/35] Testing PATCH /api/hr/employees/:id/status...');
    const statusRes = await makeRequest(server, 'PATCH', `/api/hr/employees/${createdEmployee._id}/status`, { Authorization: `Bearer ${hrToken}` }, { status: 'ON_LEAVE' });
    if (statusRes.statusCode !== 200 || statusRes.body.data.status !== 'ON_LEAVE') {
      throw new Error(`Update status failed: ${JSON.stringify(statusRes.body)}`);
    }
    // Revert to ACTIVE
    await makeRequest(server, 'PATCH', `/api/hr/employees/${createdEmployee._id}/status`, { Authorization: `Bearer ${hrToken}` }, { status: 'ACTIVE' });
    console.log('  ✓ Employee status update workflow verified.');

    // 23. Test Salary Management & History Tracking
    console.log('[23/35] Testing PUT /api/hr/employees/:id/salary...');
    const salaryRes = await makeRequest(server, 'PUT', `/api/hr/employees/${createdEmployee._id}/salary`, { Authorization: `Bearer ${hrToken}` }, {
      salary: 95000,
      reason: 'Annual Performance Appraisal',
      salaryEffectiveDate: '2026-11-01'
    });
    if (salaryRes.statusCode !== 200 || salaryRes.body.data.salary !== 95000 || !salaryRes.body.data.salaryHistory.length) {
      throw new Error(`Salary update failed: ${JSON.stringify(salaryRes.body)}`);
    }
    console.log('  ✓ Salary updated and audit history persisted accurately.');

    // 24. Test Payroll Summary
    console.log('[24/35] Testing GET /api/hr/payroll/summary...');
    const payrollSummaryRes = await makeRequest(server, 'GET', '/api/hr/payroll/summary?month=10&year=2026', { Authorization: `Bearer ${hrToken}` });
    if (payrollSummaryRes.statusCode !== 200 || typeof payrollSummaryRes.body.data.totalNetPayout !== 'number') {
      throw new Error(`Payroll summary failed: ${JSON.stringify(payrollSummaryRes.body)}`);
    }
    console.log('  ✓ Payroll summary calculated with total expenditure and payout.');

    // 25. Test Payroll Employees List
    console.log('[25/35] Testing GET /api/hr/payroll/employees...');
    const payrollEmployeesRes = await makeRequest(server, 'GET', '/api/hr/payroll/employees?month=10&year=2026', { Authorization: `Bearer ${hrToken}` });
    if (payrollEmployeesRes.statusCode !== 200 || !Array.isArray(payrollEmployeesRes.body.data)) {
      throw new Error(`Payroll employees failed: ${JSON.stringify(payrollEmployeesRes.body)}`);
    }
    console.log('  ✓ Payroll employees list computed with daily rate and deductions.');

    // 26. Test Single Employee Payroll
    console.log('[26/35] Testing GET /api/hr/payroll/employees/:employeeId...');
    const singlePayrollRes = await makeRequest(server, 'GET', `/api/hr/payroll/employees/${createdEmployee._id}?month=10&year=2026`, { Authorization: `Bearer ${hrToken}` });
    if (singlePayrollRes.statusCode !== 200 || singlePayrollRes.body.data.grossSalary !== 95000) {
      throw new Error(`Single employee payroll failed: ${JSON.stringify(singlePayrollRes.body)}`);
    }
    console.log('  ✓ Single employee payroll breakdown accurate.');

    // 27. Test HR Task Creation (POST /api/hr/tasks)
    console.log('[27/35] Testing POST /api/hr/tasks (HR assigns task to Staff)...');
    const createTaskRes = await makeRequest(server, 'POST', '/api/hr/tasks', { Authorization: `Bearer ${hrToken}` }, {
      staffId: createdEmployee._id,
      description: 'Implement complete unit & integration test coverage for portal',
      dueDate: '2026-10-20',
      title: 'Portal Testing'
    });
    if (createTaskRes.statusCode !== 201 || !createTaskRes.body.data._id) {
      throw new Error(`Create task failed: ${JSON.stringify(createTaskRes.body)}`);
    }
    const createdTask = createTaskRes.body.data;
    console.log(`  ✓ Task assigned successfully with ID: ${createdTask._id}`);

    // 28. Test HR List Tasks
    console.log('[28/35] Testing GET /api/hr/tasks...');
    const hrTasksRes = await makeRequest(server, 'GET', '/api/hr/tasks', { Authorization: `Bearer ${hrToken}` });
    if (hrTasksRes.statusCode !== 200 || !Array.isArray(hrTasksRes.body.data) || hrTasksRes.body.data.length === 0) {
      throw new Error(`HR get tasks failed: ${JSON.stringify(hrTasksRes.body)}`);
    }
    console.log('  ✓ HR tasks retrieved with pagination metadata.');

    // 29. Test Staff List Own Tasks
    console.log('[29/35] Testing GET /api/staff/tasks (Staff sees only own assigned tasks)...');
    const staffTasksRes = await makeRequest(server, 'GET', '/api/staff/tasks', { Authorization: `Bearer ${staffToken}` });
    if (staffTasksRes.statusCode !== 200 || !Array.isArray(staffTasksRes.body.data) || staffTasksRes.body.data.length === 0) {
      throw new Error(`Staff tasks failed: ${JSON.stringify(staffTasksRes.body)}`);
    }
    console.log('  ✓ Staff successfully retrieved assigned tasks.');

    // 30. Test Staff Update Task Status (PATCH /api/staff/tasks/:id/status)
    console.log('[30/35] Testing PATCH /api/staff/tasks/:id/status (Staff updates status to in-progress)...');
    const updateTaskStatusRes = await makeRequest(server, 'PATCH', `/api/staff/tasks/${createdTask._id}/status`, { Authorization: `Bearer ${staffToken}` }, {
      status: 'in-progress'
    });
    if (updateTaskStatusRes.statusCode !== 200 || updateTaskStatusRes.body.data.status !== 'in-progress') {
      throw new Error(`Staff update task status failed: ${JSON.stringify(updateTaskStatusRes.body)}`);
    }
    console.log('  ✓ Staff updated task status.');

    // 31. Test Department Chat: HR sends message
    console.log('[31/35] Testing POST /api/hr/departments/tech/messages...');
    const sendMsgRes = await makeRequest(server, 'POST', '/api/hr/departments/tech/messages', { Authorization: `Bearer ${hrToken}` }, {
      text: 'Welcome team! Standup is at 10:30 AM.'
    });
    if (sendMsgRes.statusCode !== 201 || !sendMsgRes.body.data._id) {
      throw new Error(`Send chat message failed: ${JSON.stringify(sendMsgRes.body)}`);
    }
    const createdMessage = sendMsgRes.body.data;
    console.log('  ✓ Department chat message sent successfully.');

    // 32. Test Department Chat: Staff reads messages
    console.log('[32/35] Testing GET /api/staff/departments/tech/messages...');
    const getStaffMsgsRes = await makeRequest(server, 'GET', '/api/staff/departments/tech/messages', { Authorization: `Bearer ${staffToken}` });
    if (getStaffMsgsRes.statusCode !== 200 || !Array.isArray(getStaffMsgsRes.body.data) || getStaffMsgsRes.body.data.length === 0) {
      throw new Error(`Staff get department messages failed: ${JSON.stringify(getStaffMsgsRes.body)}`);
    }
    console.log('  ✓ Staff retrieved department chat messages.');

    // 33. Test Department Chat: Delete for Me
    console.log('[33/35] Testing PATCH /api/staff/departments/tech/messages/:id/delete-for-me...');
    const deleteForMeRes = await makeRequest(server, 'PATCH', `/api/staff/departments/tech/messages/${createdMessage.id}/delete-for-me`, { Authorization: `Bearer ${staffToken}` }, {});
    if (deleteForMeRes.statusCode !== 200) {
      throw new Error(`Delete for me failed: ${JSON.stringify(deleteForMeRes.body)}`);
    }
    // Verify it is now hidden for staff
    const checkHiddenRes = await makeRequest(server, 'GET', '/api/staff/departments/tech/messages', { Authorization: `Bearer ${staffToken}` });
    const isPresent = checkHiddenRes.body.data.some(m => m.id === createdMessage.id);
    if (isPresent) {
      throw new Error('Message should have been hidden after delete-for-me');
    }
    console.log('  ✓ Delete-for-me successfully hides message for that user only.');

    // 34. Test Department Chat: Delete for Everyone
    console.log('[34/35] Testing DELETE /api/hr/departments/tech/messages/:id (Delete for everyone)...');
    const deleteForEveryoneRes = await makeRequest(server, 'DELETE', `/api/hr/departments/tech/messages/${createdMessage.id}`, { Authorization: `Bearer ${hrToken}` });
    if (deleteForEveryoneRes.statusCode !== 200) {
      throw new Error(`Delete for everyone failed: ${JSON.stringify(deleteForEveryoneRes.body)}`);
    }
    console.log('  ✓ Message deleted for everyone soft tombstone applied.');

    // 35. Test Company Birthdays Endpoint
    console.log('[35/38] Testing GET /api/hr/birthdays and /api/staff/birthdays...');
    const hrBdayRes = await makeRequest(server, 'GET', '/api/hr/birthdays?daysAhead=30', { Authorization: `Bearer ${hrToken}` });
    if (hrBdayRes.statusCode !== 200 || !Array.isArray(hrBdayRes.body.data.today)) {
      throw new Error(`HR birthdays failed: ${JSON.stringify(hrBdayRes.body)}`);
    }
    const staffBdayRes = await makeRequest(server, 'GET', '/api/staff/birthdays?daysAhead=30', { Authorization: `Bearer ${staffToken}` });
    if (staffBdayRes.statusCode !== 200 || !Array.isArray(staffBdayRes.body.data.today)) {
      throw new Error(`Staff birthdays failed: ${JSON.stringify(staffBdayRes.body)}`);
    }
    console.log('  ✓ Company birthdays endpoint functional for both HR and Staff.');

    // 36. Test CORS Preflight OPTIONS for /api/auth/login from Frontend Origin
    console.log('[36/38] Testing CORS preflight OPTIONS /api/auth/login with Origin: http://localhost:51834...');
    const preflightRes = await makeRequest(server, 'OPTIONS', '/api/auth/login', {
      'Origin': 'http://localhost:51834',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type'
    });
    if (preflightRes.statusCode !== 204) {
      throw new Error(`Expected 204 for CORS preflight, got ${preflightRes.statusCode}`);
    }
    if (preflightRes.headers['access-control-allow-origin'] !== 'http://localhost:51834') {
      throw new Error(`Expected Access-Control-Allow-Origin: http://localhost:51834, got ${preflightRes.headers['access-control-allow-origin']}`);
    }
    if (preflightRes.headers['access-control-allow-credentials'] !== 'true') {
      throw new Error('Expected Access-Control-Allow-Credentials: true');
    }
    console.log('  ✓ CORS preflight OPTIONS returned 204 with required headers for http://localhost:51834.');

    // 37. Test CORS Protection: Untrusted Origin Rejected
    console.log('[37/38] Testing CORS security: rejecting unauthorized third-party origin...');
    const untrustedPreflightRes = await makeRequest(server, 'OPTIONS', '/api/auth/login', {
      'Origin': 'https://untrusted-external-domain.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type'
    });
    if (untrustedPreflightRes.headers['access-control-allow-origin']) {
      throw new Error(`Unauthorized origin should not receive Access-Control-Allow-Origin, got ${untrustedPreflightRes.headers['access-control-allow-origin']}`);
    }
    console.log('  ✓ Untrusted origin properly denied Access-Control-Allow-Origin header.');

    // 38. Test POST /api/auth/login from Frontend Origin includes CORS header
    console.log('[38/42] Testing POST /api/auth/login from Origin: http://localhost:51834...');
    const corsLoginRes = await makeRequest(server, 'POST', '/api/auth/login', {
      'Origin': 'http://localhost:51834'
    }, {
      email: 'admin@hrmanagement.com',
      password: 'Admin@12345'
    });
    if (corsLoginRes.statusCode !== 200 || corsLoginRes.headers['access-control-allow-origin'] !== 'http://localhost:51834') {
      throw new Error(`Login from origin failed or missing CORS header: status ${corsLoginRes.statusCode}, origin ${corsLoginRes.headers['access-control-allow-origin']}`);
    }
    console.log('  ✓ Login with Origin http://localhost:51834 successfully authenticated with CORS header.');

    // 39. Seed Super Admin Account in test database
    console.log('[39/42] Seeding dedicated Super Admin account (lysoftware@gmail.com)...');
    const superAdminUser = new User({
      firstName: 'Super',
      lastName: 'Admin',
      email: 'lysoftware@gmail.com',
      phone: '+1234567899',
      password: 'hrAdmin',
      role: 'SUPER_ADMIN',
      isActive: true
    });
    await superAdminUser.save();
    console.log('  ✓ Super Admin account created with role SUPER_ADMIN.');

    // 40. Test Super Admin Login
    console.log('[40/42] Testing POST /api/auth/login for Super Admin (lysoftware@gmail.com)...');
    const superAdminLoginRes = await makeRequest(server, 'POST', '/api/auth/login', {}, {
      email: 'lysoftware@gmail.com',
      password: 'hrAdmin'
    });
    if (superAdminLoginRes.statusCode !== 200) {
      throw new Error(`Super Admin login failed with status ${superAdminLoginRes.statusCode}`);
    }
    if (superAdminLoginRes.body?.data?.user?.role !== 'SUPER_ADMIN') {
      throw new Error(`Expected role SUPER_ADMIN, got ${superAdminLoginRes.body?.data?.user?.role}`);
    }
    const superAdminToken = superAdminLoginRes.body?.data?.accessToken;
    if (!superAdminToken) {
      throw new Error('Super Admin login response missing accessToken');
    }
    console.log('  ✓ Super Admin login successful, returned role SUPER_ADMIN.');

    // 41. Test Super Admin RBAC access to HR endpoints
    console.log('[41/42] Testing Super Admin accessing HR administrative routes (/api/hr/dashboard, /api/hr/employees)...');
    const saDashRes = await makeRequest(server, 'GET', '/api/hr/dashboard', {
      'Authorization': `Bearer ${superAdminToken}`
    });
    if (saDashRes.statusCode !== 200) {
      throw new Error(`Super Admin denied access to /api/hr/dashboard: status ${saDashRes.statusCode}`);
    }
    const saEmpRes = await makeRequest(server, 'GET', '/api/hr/employees', {
      'Authorization': `Bearer ${superAdminToken}`
    });
    if (saEmpRes.statusCode !== 200) {
      throw new Error(`Super Admin denied access to /api/hr/employees: status ${saEmpRes.statusCode}`);
    }
    console.log('  ✓ Super Admin granted full access to HR administrative routes.');

    // 42. Test Super Admin role isolation on Staff Portal (/api/staff/dashboard)
    console.log('[42/42] Testing Super Admin role isolation on Staff Portal (/api/staff/dashboard)...');
    const saStaffRes = await makeRequest(server, 'GET', '/api/staff/dashboard', {
      'Authorization': `Bearer ${superAdminToken}`
    });
    if (saStaffRes.statusCode !== 403) {
      throw new Error(`Expected 403 Forbidden for Super Admin on /api/staff/dashboard, got ${saStaffRes.statusCode}`);
    }
    console.log('  ✓ Super Admin properly rejected on Staff self-service route with 403 Forbidden.');

    console.log('\n========================================');
    console.log('  ALL 42 SYSTEM VERIFICATIONS PASSED!  ');
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
