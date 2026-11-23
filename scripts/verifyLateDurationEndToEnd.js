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

function assert(condition, message) {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}

async function run() {
  console.log('================================================================================');
  console.log('   DEPARTMENT-BASED LATE ARRIVALS & EXACT DURATION VERIFICATION SUITE');
  console.log('================================================================================\n');

  // 1. Authenticate as Super Admin
  console.log('--- 1. Authenticate Super Admin ---');
  const adminLogin = await request({
    path: '/api/auth/login',
    method: 'POST'
  }, {
    email: 'lysoftware@gmail.com',
    password: 'hrAdmin'
  });
  assert(adminLogin.statusCode === 200, 'Super admin login successful');
  const adminToken = adminLogin.body.data?.accessToken;
  assert(Boolean(adminToken), 'Super admin accessToken obtained');

  // 2. Configure Tech department schedule: 10:00 to 18:00
  console.log('\n--- 2. Configure Tech Department Schedule (10:00 - 18:00) ---');
  const techSchedRes = await request({
    path: '/api/hr/departments/schedules',
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` }
  }, {
    department: 'Tech',
    checkInTime: '10:00',
    checkOutTime: '18:00',
    gracePeriodMinutes: 0,
    timezone: 'Asia/Kolkata',
    effectiveDate: '2026-10-23',
    description: 'Tech official schedule: 10:00 AM to 6:00 PM, 0 min grace'
  });
  assert(techSchedRes.statusCode === 201, 'Tech schedule configured via POST /api/hr/departments/schedules');
  assert(techSchedRes.body.data?.checkInTime === '10:00', 'Tech checkInTime is 10:00');
  assert(techSchedRes.body.data?.checkOutTime === '18:00', 'Tech checkOutTime is 18:00');
  assert(techSchedRes.body.data?.department === 'TECH', 'Tech canonical department key is TECH');

  // 3. Configure Telecalling department schedule: 09:00 to 18:00
  console.log('\n--- 3. Configure Telecalling Department Schedule (09:00 - 18:00) ---');
  const teleSchedRes = await request({
    path: '/api/hr/departments/schedules',
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` }
  }, {
    department: 'Telecalling',
    checkInTime: '09:00',
    checkOutTime: '18:00',
    gracePeriodMinutes: 0,
    timezone: 'Asia/Kolkata',
    effectiveDate: '2026-10-23',
    description: 'Telecalling official schedule: 9:00 AM to 6:00 PM, 0 min grace'
  });
  assert(teleSchedRes.statusCode === 201, 'Telecalling schedule configured via POST /api/hr/departments/schedules');
  assert(teleSchedRes.body.data?.checkInTime === '09:00', 'Telecalling checkInTime is 09:00');
  assert(teleSchedRes.body.data?.checkOutTime === '18:00', 'Telecalling checkOutTime is 18:00');
  assert(teleSchedRes.body.data?.department === 'TELECALLING', 'Telecalling canonical department key is TELECALLING');

  // 4. Read back schedules via GET /api/hr/departments/:deptKey/schedule
  console.log('\n--- 4. Verify Schedule Read-Back ---');
  const readTechRes = await request({
    path: '/api/hr/departments/tech/schedule',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(readTechRes.statusCode === 200, 'GET /api/hr/departments/tech/schedule returns 200');
  assert(readTechRes.body.data?.effectiveSchedule?.checkInTime === '10:00', 'Read-back Tech checkInTime is 10:00');
  assert(readTechRes.body.data?.effectiveSchedule?.checkOutTime === '18:00', 'Read-back Tech checkOutTime is 18:00');

  const readTeleRes = await request({
    path: '/api/hr/departments/telecalling/schedule',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(readTeleRes.statusCode === 200, 'GET /api/hr/departments/telecalling/schedule returns 200');
  assert(readTeleRes.body.data?.effectiveSchedule?.checkInTime === '09:00', 'Read-back Telecalling checkInTime is 09:00');
  assert(readTeleRes.body.data?.effectiveSchedule?.checkOutTime === '18:00', 'Read-back Telecalling checkOutTime is 18:00');

  // 5. Test RBAC security on schedules
  console.log('\n--- 5. Security & Authorization Checks ---');
  const unauthRes = await request({
    path: '/api/hr/departments/schedules',
    method: 'GET'
  });
  assert(unauthRes.statusCode === 401, 'Unauthenticated request to schedules is rejected with 401');

  // 6. Create Staff Employees for Tech and Telecalling
  console.log('\n--- 6. Seed Test Employees & Real Check-in ---');
  const techEmpEmail = `emp.tech.${Date.now()}@company.com`;
  const teleEmpEmail = `emp.tele.${Date.now()}@company.com`;

  const empTech = await request({
    path: '/api/hr/employees',
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` }
  }, {
    firstName: 'Dev',
    lastName: 'TechUser',
    email: techEmpEmail,
    password: 'Password@123',
    department: 'Tech',
    designation: 'Engineer'
  });
  assert(empTech.statusCode === 201, 'Tech test employee created');

  const empTele = await request({
    path: '/api/hr/employees',
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` }
  }, {
    firstName: 'Caller',
    lastName: 'TeleUser',
    email: teleEmpEmail,
    password: 'Password@123',
    department: 'Telecalling',
    designation: 'Caller Agent'
  });
  assert(empTele.statusCode === 201, 'Telecalling test employee created');

  // Login as Tech employee & Check-In
  const techLogin = await request({
    path: '/api/auth/login',
    method: 'POST'
  }, {
    email: techEmpEmail,
    password: 'Password@123'
  });
  const techToken = techLogin.body.data?.accessToken;
  assert(Boolean(techToken), 'Tech employee login successful');

  // Attempting staff to access HR schedule endpoint should return 403
  const staffForbidden = await request({
    path: '/api/hr/departments/schedules',
    method: 'GET',
    headers: { Authorization: `Bearer ${techToken}` }
  });
  assert(staffForbidden.statusCode === 403, 'Staff token cannot access HR schedule API (HTTP 403)');

  // Perform Tech check-in (current time is afternoon ~17:00 IST, so check-in is after 10:00)
  const techCheckIn = await request({
    path: '/api/staff/attendance/check-in',
    method: 'POST',
    headers: { Authorization: `Bearer ${techToken}` }
  }, { remarks: 'Tech live late check-in test' });

  assert(techCheckIn.statusCode === 201, 'Tech check-in succeeded (HTTP 201)');
  const techAtt = techCheckIn.body.data;
  assert(techAtt.isLate === true, 'Tech attendance isLate flag is true');
  assert(techAtt.status === 'LATE', 'Tech attendance status is LATE');
  assert(typeof techAtt.minutesLate === 'number' && techAtt.minutesLate > 0, `Tech minutesLate is positive (${techAtt.minutesLate} mins)`);
  assert(techAtt.scheduleSnapshot?.scheduledCheckIn === '10:00', 'Tech scheduleSnapshot preserves scheduledCheckIn 10:00');
  assert(techAtt.scheduleSnapshot?.scheduledCheckOut === '18:00', 'Tech scheduleSnapshot preserves scheduledCheckOut 18:00');
  console.log(`    -> Tech employee checked in ${techAtt.minutesLate} minutes late relative to 10:00 IST`);

  // Login as Telecalling employee & Check-In
  const teleLogin = await request({
    path: '/api/auth/login',
    method: 'POST'
  }, {
    email: teleEmpEmail,
    password: 'Password@123'
  });
  const teleToken = teleLogin.body.data?.accessToken;
  assert(Boolean(teleToken), 'Telecalling employee login successful');

  const teleCheckIn = await request({
    path: '/api/staff/attendance/check-in',
    method: 'POST',
    headers: { Authorization: `Bearer ${teleToken}` }
  }, { remarks: 'Telecalling live late check-in test' });

  assert(teleCheckIn.statusCode === 201, 'Telecalling check-in succeeded (HTTP 201)');
  const teleAtt = teleCheckIn.body.data;
  assert(teleAtt.isLate === true, 'Telecalling attendance isLate flag is true');
  assert(teleAtt.status === 'LATE', 'Telecalling attendance status is LATE');
  assert(typeof teleAtt.minutesLate === 'number' && teleAtt.minutesLate > techAtt.minutesLate, `Telecalling check-in at 09:00 has more minutesLate (${teleAtt.minutesLate}) than Tech at 10:00 (${techAtt.minutesLate})`);
  assert(teleAtt.scheduleSnapshot?.scheduledCheckIn === '09:00', 'Telecalling scheduleSnapshot preserves scheduledCheckIn 09:00');
  console.log(`    -> Telecalling employee checked in ${teleAtt.minutesLate} minutes late relative to 09:00 IST`);

  // 7. Test HR Dashboard counts
  console.log('\n--- 7. Verify HR Dashboard Late Arrivals Count ---');
  const dashRes = await request({
    path: '/api/hr/dashboard',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(dashRes.statusCode === 200, 'GET /api/hr/dashboard returns 200');
  const stats = dashRes.body.data;
  console.log('    Dashboard Stats:', JSON.stringify({
    totalEmployees: stats.totalEmployees,
    todayPresent: stats.todayPresent,
    todayLate: stats.todayLate,
    lateArrivals: stats.lateArrivals
  }));
  assert(typeof stats.todayLate === 'number' && stats.todayLate >= 2, `Dashboard todayLate >= 2 (found ${stats.todayLate})`);
  assert(stats.todayLate === stats.lateArrivals, 'todayLate and lateArrivals match exactly');

  // 8. Test HR Attendance list filtering
  console.log('\n--- 8. Verify HR Attendance Filtering (status & department) ---');
  
  // All LATE
  const allLateRes = await request({
    path: '/api/hr/attendance?status=LATE',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(allLateRes.statusCode === 200, 'GET /api/hr/attendance?status=LATE returns 200');
  const allLateList = Array.isArray(allLateRes.body.data) ? allLateRes.body.data : [];
  assert(allLateList.length === stats.todayLate, `Dashboard late count (${stats.todayLate}) matches filtered list total (${allLateList.length})`);
  assert(allLateList.every(r => r.isLate === true && r.late === true), 'All records contain both authoritative isLate === true and legacy late === true');
  assert(allLateList.every(r => typeof r.minutesLate === 'number' && r.minutesLate > 0), 'All late records contain exact minutesLate > 0');
  assert(allLateList.every(r => typeof r.scheduledCheckIn === 'string' && Boolean(r.scheduledCheckIn)), 'All late records contain legacy scheduledCheckIn string');
  assert(allLateList.every(r => typeof r.scheduleTimeZone === 'string' && Boolean(r.scheduleTimeZone)), 'All late records contain legacy scheduleTimeZone string');
  assert(allLateList.every(r => r.scheduleSnapshot && typeof r.scheduleSnapshot === 'object'), 'All late records contain newer scheduleSnapshot object');

  // Tech LATE
  const techLateRes = await request({
    path: '/api/hr/attendance?department=Tech&status=LATE',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(techLateRes.statusCode === 200, 'GET /api/hr/attendance?department=Tech&status=LATE returns 200');
  const techLateList = Array.isArray(techLateRes.body.data) ? techLateRes.body.data : [];
  assert(techLateList.length >= 1, 'Tech late list returns at least 1 record');
  assert(techLateList.every(r => (r.employee?.department || '').toLowerCase().includes('tech')), 'All records in Tech query belong to Tech');

  // Telecalling LATE
  const teleLateRes = await request({
    path: '/api/hr/attendance?department=Telecalling&status=LATE',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(teleLateRes.statusCode === 200, 'GET /api/hr/attendance?department=Telecalling&status=LATE returns 200');
  const teleLateList = Array.isArray(teleLateRes.body.data) ? teleLateRes.body.data : [];
  assert(teleLateList.length >= 1, 'Telecalling late list returns at least 1 record');
  assert(teleLateList.every(r => (r.employee?.department || '').toLowerCase().includes('tele')), 'All records in Telecalling query belong to Telecalling');

  // 9. Auditable reclassification endpoint test (dryRun = true)
  console.log('\n--- 9. Safe Auditable Reclassification Dry-Run ---');
  const reclassifyRes = await request({
    path: '/api/hr/attendance/reclassify',
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` }
  }, {
    dryRun: true
  });
  assert(reclassifyRes.statusCode === 200, 'POST /api/hr/attendance/reclassify returns 200');
  assert(reclassifyRes.body.data?.dryRun === true, 'dryRun flag is true (no database writes performed)');
  console.log(`    -> Evaluated ${reclassifyRes.body.data?.totalScanned} records, ${reclassifyRes.body.data?.changedCount} would change`);

  console.log('\n================================================================================');
  console.log('   ALL INTEGRATION & VERIFICATION TESTS COMPLETED WITH 100% SUCCESS!');
  console.log('================================================================================');
}

run().catch(err => {
  console.error('\nVerification failed:', err);
  process.exit(1);
});
