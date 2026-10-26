const http = require('http');

const PORT = 5000;
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

function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  const copy = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/password|token|secret|authorization/i.test(k)) {
      copy[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      copy[k] = sanitize(v);
    } else {
      copy[k] = v;
    }
  }
  return copy;
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`  [FAIL] ${msg}`);
    throw new Error(msg);
  }
  console.log(`  [PASS] ${msg}`);
}

async function runAudit() {
  console.log('================================================================================');
  console.log('   FULL END-TO-END AUDIT: STAFF ATTENDANCE & HR LATE ARRIVALS VERIFICATION');
  console.log('================================================================================\n');

  // Step 1: Login Super Admin
  console.log('--- STEP 1: Super Admin Authentication ---');
  const adminLoginRes = await request({ path: '/api/auth/login', method: 'POST' }, {
    email: 'lysoftware@gmail.com',
    password: 'hrAdmin'
  });
  assert(adminLoginRes.statusCode === 200, 'Super admin authenticated');
  const adminToken = adminLoginRes.body.data?.accessToken;
  assert(Boolean(adminToken), 'Obtained admin accessToken');

  // Step 2: Configure Departments
  // Department A: Early cut-off (09:00) -> checking in now will be LATE
  // Department B: Late cut-off (23:00)  -> checking in now will be ON-TIME
  console.log('\n--- STEP 2: Configure Test Schedules (Asia/Kolkata) ---');
  const schedLate = await request({
    path: '/api/hr/departments/schedules',
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` }
  }, {
    department: 'EarlyShift',
    checkInTime: '09:00',
    checkOutTime: '18:00',
    gracePeriodMinutes: 0,
    timezone: 'Asia/Kolkata',
    effectiveDate: '2026-10-20',
    description: 'Early shift starting at 09:00 IST'
  });
  assert(schedLate.statusCode === 201, 'EarlyShift schedule configured (09:00 IST cutoff)');

  const schedOnTime = await request({
    path: '/api/hr/departments/schedules',
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` }
  }, {
    department: 'EveningShift',
    checkInTime: '23:00',
    checkOutTime: '07:00',
    gracePeriodMinutes: 15,
    timezone: 'Asia/Kolkata',
    effectiveDate: '2026-10-20',
    description: 'Evening shift starting at 23:00 IST (15 min grace)'
  });
  assert(schedOnTime.statusCode === 201, 'EveningShift schedule configured (23:00 IST cutoff)');

  // Step 3: Create Two Test Staff Accounts
  console.log('\n--- STEP 3: Create Test Staff Accounts ---');
  const ts = Date.now();
  const lateEmpRes = await request({
    path: '/api/hr/employees',
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` }
  }, {
    firstName: 'Late',
    lastName: 'Tester',
    email: `late.tester.${ts}@company.com`,
    password: 'Password@123',
    department: 'EarlyShift',
    designation: 'Specialist',
    employmentType: 'FULL_TIME',
    status: 'ACTIVE',
    gender: 'FEMALE'
  });
  assert(lateEmpRes.statusCode === 201, 'Late test employee created');
  const lateEmpId = lateEmpRes.body.data?._id;

  const onTimeEmpRes = await request({
    path: '/api/hr/employees',
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` }
  }, {
    firstName: 'OnTime',
    lastName: 'Tester',
    email: `ontime.tester.${ts}@company.com`,
    password: 'Password@123',
    department: 'EveningShift',
    designation: 'Specialist',
    employmentType: 'FULL_TIME',
    status: 'ACTIVE',
    gender: 'MALE'
  });
  assert(onTimeEmpRes.statusCode === 201, 'On-time test employee created');
  const onTimeEmpId = onTimeEmpRes.body.data?._id;

  // Step 4: Login as Late Staff and Check-In
  console.log('\n--- STEP 4: Staff Late Check-In (POST /api/staff/attendance/check-in) ---');
  const lateStaffLogin = await request({ path: '/api/auth/login', method: 'POST' }, {
    email: `late.tester.${ts}@company.com`,
    password: 'Password@123'
  });
  assert(lateStaffLogin.statusCode === 200, 'Late staff login successful');
  const lateStaffToken = lateStaffLogin.body.data?.accessToken;

  const lateCheckInRes = await request({
    path: '/api/staff/attendance/check-in',
    method: 'POST',
    headers: { Authorization: `Bearer ${lateStaffToken}` }
  }, { remarks: 'Test late check-in audit' });
  assert(lateCheckInRes.statusCode === 201, 'Late check-in HTTP 201 Created');
  const lateCheckInData = lateCheckInRes.body.data;
  assert(lateCheckInData.isLate === true, 'Late staff check-in has isLate === true');
  assert(lateCheckInData.late === true, 'Late staff check-in has late === true');
  assert(lateCheckInData.status === 'LATE', 'Late staff check-in has status === "LATE"');
  assert(lateCheckInData.minutesLate > 0, `Late staff check-in has minutesLate (${lateCheckInData.minutesLate}) > 0`);
  assert(lateCheckInData.scheduleSnapshot?.scheduledCheckIn === '09:00', 'Snapshot scheduledCheckIn is 09:00');
  assert(lateCheckInData.scheduleSnapshot?.timezone === 'Asia/Kolkata', 'Snapshot timezone is Asia/Kolkata');
  console.log('\n[Sample Verified POST /api/staff/attendance/check-in (Late)]:\n', JSON.stringify(sanitize(lateCheckInData), null, 2));

  // Step 5: Check-Out for Late Staff
  console.log('\n--- STEP 5: Staff Check-Out (POST /api/staff/attendance/check-out) ---');
  const lateCheckOutRes = await request({
    path: '/api/staff/attendance/check-out',
    method: 'POST',
    headers: { Authorization: `Bearer ${lateStaffToken}` }
  }, { remarks: 'Test end of shift check-out' });
  assert(lateCheckOutRes.statusCode === 200, 'Check-out HTTP 200 OK');
  const lateCheckOutData = lateCheckOutRes.body.data;
  assert(Boolean(lateCheckOutData.checkOut), 'Check-out timestamp persisted');
  assert(typeof lateCheckOutData.workingHours === 'number', 'Working hours calculated');
  assert(lateCheckOutData.isLate === true, 'isLate remains true after check-out');
  console.log('\n[Sample Verified POST /api/staff/attendance/check-out]:\n', JSON.stringify(sanitize(lateCheckOutData), null, 2));

  // Step 6: Login as On-Time Staff and Check-In
  console.log('\n--- STEP 6: Staff On-Time Check-In Verification ---');
  const onTimeStaffLogin = await request({ path: '/api/auth/login', method: 'POST' }, {
    email: `ontime.tester.${ts}@company.com`,
    password: 'Password@123'
  });
  assert(onTimeStaffLogin.statusCode === 200, 'On-time staff login successful');
  const onTimeStaffToken = onTimeStaffLogin.body.data?.accessToken;

  const onTimeCheckInRes = await request({
    path: '/api/staff/attendance/check-in',
    method: 'POST',
    headers: { Authorization: `Bearer ${onTimeStaffToken}` }
  }, { remarks: 'Test on-time check-in audit' });
  assert(onTimeCheckInRes.statusCode === 201, 'On-time check-in HTTP 201 Created');
  const onTimeCheckInData = onTimeCheckInRes.body.data;
  assert(onTimeCheckInData.isLate === false, 'On-time check-in has isLate === false');
  assert(onTimeCheckInData.late === false, 'On-time check-in has late === false');
  assert(onTimeCheckInData.status === 'PRESENT', 'On-time check-in has status === "PRESENT"');
  assert(onTimeCheckInData.minutesLate === 0, 'On-time check-in has minutesLate === 0');
  console.log('\n[Sample Verified POST /api/staff/attendance/check-in (On-Time)]:\n', JSON.stringify(sanitize(onTimeCheckInData), null, 2));

  // Step 7: Verify Staff Attendance History (GET /api/staff/attendance)
  console.log('\n--- STEP 7: Staff Attendance History (GET /api/staff/attendance) ---');
  const staffAttRes = await request({
    path: '/api/staff/attendance',
    method: 'GET',
    headers: { Authorization: `Bearer ${lateStaffToken}` }
  });
  assert(staffAttRes.statusCode === 200, 'GET /api/staff/attendance HTTP 200 OK');
  const staffRecords = staffAttRes.body.data?.attendance || staffAttRes.body.data;
  assert(Array.isArray(staffRecords) && staffRecords.length > 0, 'Attendance records returned');
  const firstStaffRec = staffRecords[0];
  assert(Boolean(firstStaffRec.checkInTime), 'Record has checkInTime for Flutter parser');
  assert(Boolean(firstStaffRec.checkOutTime), 'Record has checkOutTime for Flutter parser');
  assert(Boolean(firstStaffRec.workedDuration), 'Record has workedDuration for Flutter parser');
  assert(Boolean(firstStaffRec.staffId), 'Record has staffId for Flutter parser');
  console.log('\n[Sample Verified GET /api/staff/attendance item]:\n', JSON.stringify(sanitize(firstStaffRec), null, 2));

  // Step 8: Verify HR Dashboard Summary (GET /api/hr/dashboard)
  console.log('\n--- STEP 8: HR Dashboard Summary (GET /api/hr/dashboard) ---');
  const hrDashRes = await request({
    path: '/api/hr/dashboard',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(hrDashRes.statusCode === 200, 'GET /api/hr/dashboard HTTP 200 OK');
  const dashData = hrDashRes.body.data;
  assert(dashData.todayLate === dashData.lateArrivals, 'todayLate matches lateArrivals');
  assert(dashData.todayPresent >= 2, 'todayPresent includes both present and late staff');
  console.log('\n[Sample Verified GET /api/hr/dashboard]:\n', JSON.stringify(sanitize(dashData), null, 2));

  // Step 9: Verify HR Attendance List (GET /api/hr/attendance?status=LATE)
  console.log('\n--- STEP 9: HR Late Attendance Query (GET /api/hr/attendance?status=LATE) ---');
  const hrLateAttRes = await request({
    path: '/api/hr/attendance?status=LATE',
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(hrLateAttRes.statusCode === 200, 'GET /api/hr/attendance?status=LATE HTTP 200 OK');
  const hrLateList = hrLateAttRes.body.data?.attendance || hrLateAttRes.body.data;
  assert(Array.isArray(hrLateList), 'HR late list is array');
  const lateRecordFound = hrLateList.find(r => r.staffId === lateEmpId || r.employee?._id === lateEmpId);
  assert(Boolean(lateRecordFound), 'Late check-in appears in HR Late Arrivals list');
  assert(lateRecordFound.isLate === true, 'HR late record has isLate === true');
  assert(lateRecordFound.minutesLate > 0, `HR late record has exact minutesLate (${lateRecordFound.minutesLate})`);
  assert(lateRecordFound.department === 'EarlyShift', 'HR late record has correct department');

  // Verify that on-time staff is NOT in late list
  const onTimeRecordInLateList = hrLateList.find(r => r.staffId === onTimeEmpId || r.employee?._id === onTimeEmpId);
  assert(!onTimeRecordInLateList, 'On-time staff check-in is NOT in HR Late Arrivals list');

  console.log('\n[Sample Verified GET /api/hr/attendance Late Record]:\n', JSON.stringify(sanitize(lateRecordFound), null, 2));

  // Step 10: Verify Dry-Run Historical Reclassification
  console.log('\n--- STEP 10: Dry-Run Historical Reclassification (POST /api/hr/attendance/reclassify) ---');
  const reclassifyRes = await request({
    path: '/api/hr/attendance/reclassify',
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` }
  }, { dryRun: true });
  assert(reclassifyRes.statusCode === 200, 'Reclassify endpoint HTTP 200 OK');
  assert(reclassifyRes.body.data?.dryRun === true, 'dryRun is strictly enforced true');
  console.log('\n[Sample Verified Dry-Run Reclassification]:\n', JSON.stringify(sanitize(reclassifyRes.body.data), null, 2));

  console.log('\n================================================================================');
  console.log('   FULL END-TO-END AUDIT SUITE PASSED 100%! ALL CONTRACTS VERIFIED LIVE');
  console.log('================================================================================\n');
}

runAudit().catch(err => {
  console.error('\nAudit Failed:', err);
  process.exit(1);
});
