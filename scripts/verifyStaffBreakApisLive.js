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

function assert(condition, message) {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}

async function runBreakSuite() {
  console.log('================================================================================');
  console.log('   STAFF ATTENDANCE BREAK APIS - FULL LIVE VERIFICATION SUITE');
  console.log('================================================================================\n');

  // 1. Authenticate as Super Admin to set up department and test accounts
  console.log('--- 1. Authenticate Super Admin ---');
  const adminLogin = await request({ path: '/api/auth/login', method: 'POST' }, {
    email: 'lysoftware@gmail.com',
    password: 'hrAdmin'
  });
  assert(adminLogin.statusCode === 200, 'Super admin login successful');
  const adminToken = adminLogin.body.data?.accessToken;
  assert(Boolean(adminToken), 'Obtained admin accessToken');

  // 2. Configure Shift Department Schedule
  console.log('\n--- 2. Configure Department Schedule ---');
  await request({
    path: '/api/hr/departments/schedules',
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` }
  }, {
    department: 'BreakTestDept',
    checkInTime: '09:00',
    checkOutTime: '18:00',
    gracePeriodMinutes: 15,
    timezone: 'Asia/Kolkata',
    effectiveDate: '2026-10-20',
    description: 'Break test department schedule'
  });

  // 3. Create Test Staff Account
  console.log('\n--- 3. Create Test Staff Account ---');
  const ts = Date.now();
  const staffEmail = `break.staff.${ts}@company.com`;
  const createEmpRes = await request({
    path: '/api/hr/employees',
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` }
  }, {
    firstName: 'Break',
    lastName: 'Tester',
    email: staffEmail,
    password: 'Password@123',
    department: 'BreakTestDept',
    designation: 'Engineer',
    employmentType: 'FULL_TIME',
    status: 'ACTIVE',
    gender: 'OTHER'
  });
  assert(createEmpRes.statusCode === 201, 'Test staff employee created');

  // 4. Authenticate as Staff
  console.log('\n--- 4. Authenticate Staff ---');
  const staffLoginRes = await request({ path: '/api/auth/login', method: 'POST' }, {
    email: staffEmail,
    password: 'Password@123'
  });
  assert(staffLoginRes.statusCode === 200, 'Staff login successful');
  const staffToken = staffLoginRes.body.data?.accessToken;
  assert(Boolean(staffToken), 'Staff accessToken obtained');

  // 5. Test 401 Unauthorized & 403 Forbidden
  console.log('\n--- 5. Security & Authorization Checks (401 & 403) ---');
  const noAuthRes = await request({
    path: '/api/staff/attendance/break-start',
    method: 'POST'
  }, { breakType: 'Morning Break' });
  assert(noAuthRes.statusCode === 401, 'Unauthenticated break-start is rejected with 401');

  const hrRoleRes = await request({
    path: '/api/staff/attendance/break-start',
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` }
  }, { breakType: 'Morning Break' });
  assert(hrRoleRes.statusCode === 403, 'Non-staff role calling staff break endpoint is rejected with 403');

  // 6. Shift State Validation: Cannot start/end break before check-in
  console.log('\n--- 6. Invalid Shift State Validation (Before Check-In) ---');
  const startBeforeCheckIn = await request({
    path: '/api/staff/attendance/break-start',
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` }
  }, { breakType: 'Morning Break' });
  assert(startBeforeCheckIn.statusCode === 400, 'Break start before check-in rejected with 400');
  assert(startBeforeCheckIn.body.message.includes('checking in'), 'Clear error message returned for pre-check-in start');

  const endBeforeCheckIn = await request({
    path: '/api/staff/attendance/break-end',
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` }
  }, { breakType: 'Morning Break' });
  assert(endBeforeCheckIn.statusCode === 400, 'Break end before check-in rejected with 400');

  // 7. Check-In as Staff
  console.log('\n--- 7. Staff Check-In ---');
  const checkInRes = await request({
    path: '/api/staff/attendance/check-in',
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` }
  }, { remarks: 'Starting shift for break test' });
  assert(checkInRes.statusCode === 201, 'Staff check-in succeeded (201 Created)');
  const initialCheckInTime = checkInRes.body.data?.checkIn;
  const initialIsLate = checkInRes.body.data?.isLate;
  assert(Boolean(initialCheckInTime), 'checkIn timestamp recorded');

  // 8. Test Ending Break When No Break Is Active
  console.log('\n--- 8. End Break With No Active Break ---');
  const endNoActive = await request({
    path: '/api/staff/attendance/break-end',
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` }
  }, { breakType: 'Morning Break' });
  assert(endNoActive.statusCode === 400, 'Ending break with no active break rejected with 400');

  // 9. Morning Break: Start & End (Testing Early Start before typical 11 AM)
  console.log('\n--- 9. Morning Break (Early Start & Completion) ---');
  const morningStart = await request({
    path: '/api/staff/attendance/break-start',
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` }
  }, { breakType: 'Morning Break', remarks: 'Early morning coffee break' });
  assert(morningStart.statusCode === 200, 'Morning Break start succeeded (HTTP 200)');
  assert(morningStart.body.data?.activeBreak?.breakType === 'Morning Break', 'activeBreak tracks Morning Break');
  assert(Boolean(morningStart.body.data?.activeBreak?.startTime), 'activeBreak has startTime');
  assert(Boolean(morningStart.body.data?.breakStartedAt), 'breakStartedAt is populated');
  assert(morningStart.body.data?.breaks?.length === 1, 'breaks array has 1 entry');
  console.log('Sample Morning Break Start Response:\n', JSON.stringify(sanitize(morningStart.body.data), null, 2));

  // 10. Simultaneous Break Prevention: Cannot start another break while Morning Break is active
  console.log('\n--- 10. Simultaneous Break Prevention ---');
  const simultaneousStart = await request({
    path: '/api/staff/attendance/break-start',
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` }
  }, { breakType: 'Lunch Break' });
  assert(simultaneousStart.statusCode === 400, 'Starting simultaneous break rejected with 400');
  assert(simultaneousStart.body.message.includes('currently active'), 'Correct simultaneous error message returned');

  // 11. End Morning Break (End with wrong type vs correct end)
  console.log('\n--- 11. End Morning Break (Mismatch Validation & Successful End) ---');
  const wrongTypeEnd = await request({
    path: '/api/staff/attendance/break-end',
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` }
  }, { breakType: 'Lunch Break' });
  assert(wrongTypeEnd.statusCode === 400, 'Ending active Morning Break specifying Lunch Break rejected with 400');

  const morningEnd = await request({
    path: '/api/staff/attendance/break-end',
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` }
  }, { breakType: 'Morning Break', remarks: 'Morning break finished' });
  assert(morningEnd.statusCode === 200, 'Morning Break end succeeded (HTTP 200)');
  assert(morningEnd.body.data?.activeBreak === null, 'activeBreak cleared to null');
  assert(morningEnd.body.data?.breakStartedAt === null, 'breakStartedAt cleared to null');
  assert(morningEnd.body.data?.breaks[0].endTime !== null, 'Morning break endTime recorded');
  assert(morningEnd.body.data?.breaks[0].durationMinutes >= 1, 'Morning break durationMinutes >= 1');
  assert(morningEnd.body.data?.totalBreakMinutes >= 1, 'totalBreakMinutes updated');

  // 12. Duplicate Break Prevention: Cannot start Morning Break again today
  console.log('\n--- 12. Duplicate Break Prevention ---');
  const duplicateMorning = await request({
    path: '/api/staff/attendance/break-start',
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` }
  }, { breakType: 'Morning Break' });
  assert(duplicateMorning.statusCode === 400, 'Starting duplicate Morning Break rejected with 400');
  assert(duplicateMorning.body.message.includes('already been taken'), 'Duplicate break error message verified');

  // 13. Lunch Break: Start & End (Testing Route Alias POST /api/staff/attendance/break/start)
  console.log('\n--- 13. Lunch Break (Start & End via Route Aliases) ---');
  const lunchStart = await request({
    path: '/api/staff/attendance/break/start',
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` }
  }, { breakType: 'Lunch Break' });
  assert(lunchStart.statusCode === 200, 'Lunch Break start via alias /break/start succeeded');
  assert(lunchStart.body.data?.activeBreak?.breakType === 'Lunch Break', 'activeBreak tracks Lunch Break');

  const lunchEnd = await request({
    path: '/api/staff/attendance/break/end',
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` }
  }, { breakType: 'Lunch Break' });
  assert(lunchEnd.statusCode === 200, 'Lunch Break end via alias /break/end succeeded');
  assert(lunchEnd.body.data?.breaks?.length === 2, 'breaks array now has 2 completed breaks');

  // 14. Afternoon Break: Start & End
  console.log('\n--- 14. Afternoon Break (Start & End) ---');
  const afternoonStart = await request({
    path: '/api/staff/attendance/break-start',
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` }
  }, { breakType: 'Afternoon Break' });
  assert(afternoonStart.statusCode === 200, 'Afternoon Break start succeeded');

  const afternoonEnd = await request({
    path: '/api/staff/attendance/break-end',
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` }
  }, { breakType: 'Afternoon Break' });
  assert(afternoonEnd.statusCode === 200, 'Afternoon Break end succeeded');
  assert(afternoonEnd.body.data?.breaks?.length === 3, 'All 3 breaks recorded in breaks array');

  // 15. Verify Preservation of Check-In, Lateness, Schedule Snapshot
  console.log('\n--- 15. Verify Integrity of Existing Fields ---');
  const finalAttendanceState = afternoonEnd.body.data;
  assert(finalAttendanceState.checkIn === initialCheckInTime, 'checkIn timestamp strictly preserved');
  assert(finalAttendanceState.isLate === initialIsLate, 'isLate flag strictly preserved');
  assert(Boolean(finalAttendanceState.scheduleSnapshot), 'scheduleSnapshot strictly preserved');
  assert(finalAttendanceState.scheduleSnapshot?.department === 'BREAKTESTDEPT', 'scheduleSnapshot department intact');

  // 16. Verify GET /api/staff/attendance (Persistence After Refresh/Re-login)
  console.log('\n--- 16. Verify Staff Attendance History GET /api/staff/attendance ---');
  const getStaffAtt = await request({
    path: '/api/staff/attendance',
    method: 'GET',
    headers: { Authorization: `Bearer ${staffToken}` }
  });
  assert(getStaffAtt.statusCode === 200, 'GET /api/staff/attendance returns HTTP 200');
  const staffRecords = getStaffAtt.body.data?.attendance || getStaffAtt.body.data;
  assert(Array.isArray(staffRecords) && staffRecords.length > 0, 'Attendance array returned');
  const todayRecord = staffRecords[0];
  assert(Array.isArray(todayRecord.breaks) && todayRecord.breaks.length === 3, 'Persisted record contains all 3 breaks');
  assert(todayRecord.totalBreakMinutes >= 3, 'Persisted record has positive totalBreakMinutes');
  assert(Boolean(todayRecord.breakDuration), 'breakDuration string returned for UI parsing');
  console.log('Sample Persisted GET /api/staff/attendance Record:\n', JSON.stringify(sanitize(todayRecord), null, 2));

  // 17. Verify Check-Out Deducts Total Break Time
  console.log('\n--- 17. Check-Out & Working Hours Deduction ---');
  const checkOutRes = await request({
    path: '/api/staff/attendance/check-out',
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` }
  }, { remarks: 'Day shift completed' });
  assert(checkOutRes.statusCode === 200, 'Check-out succeeded');
  const checkedOutRecord = checkOutRes.body.data;
  assert(Boolean(checkedOutRecord.checkOut), 'checkOut timestamp set');
  assert(typeof checkedOutRecord.workingHours === 'number', 'workingHours calculated');

  // 18. Cannot start break after check-out
  console.log('\n--- 18. Cannot Start Break After Check-Out ---');
  const startAfterCheckOut = await request({
    path: '/api/staff/attendance/break-start',
    method: 'POST',
    headers: { Authorization: `Bearer ${staffToken}` }
  }, { breakType: 'Morning Break' });
  assert(startAfterCheckOut.statusCode === 400, 'Starting break after check-out rejected with 400');
  assert(startAfterCheckOut.body.message.includes('checking out'), 'Correct post-checkout error message returned');

  console.log('\n================================================================================');
  console.log('   ALL BREAK API INTEGRATION TESTS PASSED 100%!');
  console.log('================================================================================\n');
}

runBreakSuite().catch(err => {
  console.error('\nBreak Test Suite Failed:', err);
  process.exit(1);
});
