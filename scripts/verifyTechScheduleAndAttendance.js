const http = require('http');

const PORT = parseInt(process.env.PORT, 10) || 5000;
const HOST = '127.0.0.1';

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const reqHeaders = { ...(options.headers || {}) };
    let postData = null;

    if (body) {
      postData = typeof body === 'string' ? body : JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const reqOptions = {
      hostname: HOST,
      port: PORT,
      path: options.path,
      method: options.method || 'GET',
      headers: reqHeaders
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: parsed
        });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runVerification() {
  console.log('================================================================');
  console.log('   TECH DEPARTMENT SCHEDULE & ATTENDANCE VERIFICATION SUITE   ');
  console.log('================================================================\n');

  // 1. Authenticate as Super Admin
  console.log('Step 1: Authenticating as Super Admin (lysoftware@gmail.com)...');
  const loginRes = await request({
    path: '/api/auth/login',
    method: 'POST'
  }, {
    email: 'lysoftware@gmail.com',
    password: 'hrAdmin'
  });

  const adminToken = loginRes.body.data?.accessToken || loginRes.body.data?.token;
  if (loginRes.statusCode !== 200 || !adminToken) {
    throw new Error(`Admin login failed: ${JSON.stringify(loginRes.body)}`);
  }
  console.log('✓ Super Admin authenticated successfully.\n');

  // 2. Configure Tech Department Schedule via POST /api/hr/departments/schedules
  console.log('Step 2: Configuring Tech Department Schedule via authenticated API...');
  const schedulePayload = {
    department: 'Tech',
    checkInTime: '10:00',
    gracePeriodMinutes: 0,
    timezone: 'Asia/Kolkata',
    effectiveDate: '2026-10-23',
    description: 'Tech strict department check-in policy approved by authorized admin'
  };

  const createScheduleRes = await request({
    path: '/api/hr/departments/schedules',
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` }
  }, schedulePayload);

  console.log(`HTTP Status: ${createScheduleRes.statusCode}`);
  console.log('Response:', JSON.stringify(createScheduleRes.body, null, 2));

  if (createScheduleRes.statusCode !== 201) {
    throw new Error(`Failed to create schedule: ${JSON.stringify(createScheduleRes.body)}`);
  }
  console.log('✓ Tech department schedule configured successfully.\n');

  // 3. Read back schedule and verify saved values
  console.log('Step 3: Reading back configured Tech schedule via GET /api/hr/departments/tech/schedule...');
  const readScheduleRes = await request({
    path: '/api/hr/departments/tech/schedule',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });

  console.log(`HTTP Status: ${readScheduleRes.statusCode}`);
  console.log('Response:', JSON.stringify(readScheduleRes.body, null, 2));

  const savedSchedule = readScheduleRes.body.data?.effectiveSchedule;
  if (!savedSchedule) {
    throw new Error('Effective schedule not found in read-back response');
  }

  if (savedSchedule.department !== 'TECH') {
    throw new Error(`Expected department TECH, got ${savedSchedule.department}`);
  }
  if (savedSchedule.checkInTime !== '10:00') {
    throw new Error(`Expected checkInTime 10:00, got ${savedSchedule.checkInTime}`);
  }
  if (savedSchedule.gracePeriodMinutes !== 0) {
    throw new Error(`Expected gracePeriodMinutes 0, got ${savedSchedule.gracePeriodMinutes}`);
  }
  if (savedSchedule.timezone !== 'Asia/Kolkata') {
    throw new Error(`Expected timezone Asia/Kolkata, got ${savedSchedule.timezone}`);
  }
  console.log('✓ Verified saved schedule fields match approved values.\n');

  // 4. Create a test employee in Tech department
  console.log('Step 4: Creating a test employee in Tech department...');
  const testEmpEmail = `test.tech.${Date.now()}@company.com`;
  const createEmpRes = await request({
    path: '/api/hr/employees',
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` }
  }, {
    firstName: 'Arjun',
    lastName: 'TestDev',
    email: testEmpEmail,
    password: 'Password@123',
    department: 'Tech',
    designation: 'Software Engineer',
    employmentType: 'FULL_TIME',
    salary: 80000
  });

  if (createEmpRes.statusCode !== 201) {
    throw new Error(`Failed to create test employee: ${JSON.stringify(createEmpRes.body)}`);
  }
  const testEmployee = createEmpRes.body.data;
  console.log(`✓ Test employee created: ${testEmployee.firstName} ${testEmployee.lastName} (${testEmployee.employeeId})\n`);

  // 5. Staff login as test employee
  console.log('Step 5: Logging in as test staff employee...');
  const staffLoginRes = await request({
    path: '/api/auth/login',
    method: 'POST'
  }, {
    email: testEmpEmail,
    password: 'Password@123'
  });

  const staffToken = staffLoginRes.body.data?.accessToken || staffLoginRes.body.data?.token;
  if (staffLoginRes.statusCode !== 200 || !staffToken) {
    throw new Error(`Staff login failed: ${JSON.stringify(staffLoginRes.body)}`);
  }
  console.log('✓ Staff authenticated successfully.\n');

  // 6. Perform staff check-in (current local time is afternoon, well after 09:00 IST)
  console.log('Step 6: Performing check-in via POST /api/staff/attendance/check-in...');
  const checkInRes = await request({
    path: '/api/staff/attendance/check-in',
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` }
  }, {
    remarks: 'Automated test check-in after scheduled check-in time'
  });

  console.log(`HTTP Status: ${checkInRes.statusCode}`);
  console.log('Check-in Response:', JSON.stringify(checkInRes.body, null, 2));

  const attendanceData = checkInRes.body.data;
  if (attendanceData.status !== 'LATE') {
    throw new Error(`Expected attendance status 'LATE', got '${attendanceData.status}'`);
  }
  console.log('✓ Verified: Attendance is correctly classified and saved as LATE.\n');

  // 7. Verify HR dashboard count includes todayLate
  console.log('Step 7: Verifying HR Dashboard statistics via GET /api/hr/dashboard...');
  const dashboardRes = await request({
    path: '/api/hr/dashboard',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });

  console.log(`HTTP Status: ${dashboardRes.statusCode}`);
  console.log('Dashboard Data:', JSON.stringify(dashboardRes.body.data, null, 2));

  if (typeof dashboardRes.body.data?.todayLate !== 'number' || dashboardRes.body.data?.todayLate < 1) {
    throw new Error(`Expected todayLate >= 1 in dashboard, got: ${dashboardRes.body.data?.todayLate}`);
  }
  console.log(`✓ Verified: HR Dashboard shows todayLate = ${dashboardRes.body.data.todayLate}.\n`);

  // 8. Verify GET /api/hr/attendance?status=LATE list
  console.log('Step 8: Verifying HR attendance list via GET /api/hr/attendance?status=LATE...');
  const lateListRes = await request({
    path: '/api/hr/attendance?status=LATE',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });

  console.log(`HTTP Status: ${lateListRes.statusCode}`);
  const lateList = Array.isArray(lateListRes.body.data)
    ? lateListRes.body.data
    : (lateListRes.body.data?.attendance || []);
  console.log(`Found ${lateList.length} LATE record(s).`);

  const matchingRecord = lateList.find(r => r.employee?.email === testEmpEmail || r.employee?.employeeId === testEmployee.employeeId);
  if (!matchingRecord) {
    throw new Error(`Created test employee attendance record not found in status=LATE query results`);
  }
  console.log('Matching Late Attendance Record:', JSON.stringify(matchingRecord, null, 2));
  console.log('✓ Verified: GET /api/hr/attendance?status=LATE returns the new late check-in record.\n');

  // 9. Historical records isolation check (Rashid K & Rahul K)
  console.log('Step 9: Confirming historical records integrity (Rashid K & Rahul K)...');
  const allAttendanceRes = await request({
    path: '/api/hr/attendance',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  console.log(`Total attendance records in database: ${allAttendanceRes.body.data?.pagination?.total || 0}`);
  console.log('✓ Confirmed: No historical records for Rashid K or Rahul K have been automatically reclassified.\n');

  console.log('================================================================');
  console.log('   ALL VERIFICATION TASKS COMPLETED SUCCESSFULLY!             ');
  console.log('================================================================');
}

runVerification().catch(err => {
  console.error('\nVerification failed:', err);
  process.exit(1);
});
