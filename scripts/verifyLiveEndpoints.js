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

const nodeAssert = require('assert');

function assert(condition, message) {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}
assert.strictEqual = (actual, expected, message) => {
  if (actual !== expected) {
    const fullMsg = `${message} (expected: ${expected}, got: ${actual})`;
    console.error(`  [FAIL] ${fullMsg}`);
    throw new Error(`Assertion failed: ${fullMsg}`);
  }
  console.log(`  [PASS] ${message}`);
};

async function verifyLive() {
  console.log('================================================================');
  console.log('   LIVE HTTP BACKEND VERIFICATION (PORT 5000)                   ');
  console.log('================================================================\n');

  // 1. Authenticate as Super Admin
  console.log('1. Authenticating as Super Admin...');
  const loginRes = await request({
    path: '/api/auth/login',
    method: 'POST'
  }, {
    email: 'lysoftware@gmail.com',
    password: 'hrAdmin'
  });
  assert(loginRes.statusCode === 200, 'Super admin login successful (200)');
  const adminToken = loginRes.body.data?.accessToken || loginRes.body.data?.token;
  assert(Boolean(adminToken), 'Super admin token acquired');

  // 2. Verify Department Schedules via HR API
  console.log('\n2. Verifying Tech & Telecalling Schedules via GET /api/hr/departments/schedules...');
  const schedsRes = await request({
    path: '/api/hr/departments/schedules',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(schedsRes.statusCode === 200, 'GET /api/hr/departments/schedules returns 200');
  const schedList = schedsRes.body.data || [];
  const techSched = schedList.find(s => s.department === 'TECH');
  const teleSched = schedList.find(s => s.department === 'TELECALLING');

  assert(Boolean(techSched), 'TECH department schedule exists');
  assert(techSched.checkInTime === '10:00', `TECH schedule checkInTime is 10:00 (got ${techSched.checkInTime})`);
  assert(techSched.checkOutTime === '18:00', 'TECH schedule checkOutTime is 18:00');

  assert(Boolean(teleSched), 'TELECALLING department schedule exists');
  assert(teleSched.checkInTime === '09:00', `TELECALLING schedule checkInTime is 09:00 (got ${teleSched.checkInTime})`);
  assert(teleSched.checkOutTime === '18:00', 'TELECALLING schedule checkOutTime is 18:00');

  // 3. Test Staff Check-In for Tech
  console.log('\n3. Verifying Staff Check-In for Tech Employee...');
  const ts = Date.now();
  const techEmail = `live.tech.${ts}@example.com`;
  const createTechRes = await request({
    path: '/api/hr/employees',
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` }
  }, {
    firstName: 'DevLive',
    lastName: 'Tech',
    email: techEmail,
    password: 'Password@123',
    department: 'Tech',
    designation: 'Software Developer'
  });
  assert(createTechRes.statusCode === 201, 'Tech test employee created (201)');

  const techLoginRes = await request({
    path: '/api/auth/login',
    method: 'POST'
  }, { email: techEmail, password: 'Password@123' });
  assert(techLoginRes.statusCode === 200, 'Tech staff login successful');
  const techToken = techLoginRes.body.data?.accessToken;

  const techCheckInRes = await request({
    path: '/api/staff/attendance/check-in',
    method: 'POST',
    headers: { Authorization: `Bearer ${techToken}` }
  }, { remarks: 'Live Tech check-in verification' });
  assert(techCheckInRes.statusCode === 201, 'Tech staff check-in successful (201)');

  const techAttData = techCheckInRes.body.data;
  console.log('Tech Check-In Data:', JSON.stringify(techAttData, null, 2));
  assert.strictEqual(techAttData.scheduledCheckIn, '10:00', 'Tech check-in returns scheduledCheckIn: 10:00');
  assert.strictEqual(techAttData.scheduledCheckOut, '18:00', 'Tech check-in returns scheduledCheckOut: 18:00');
  assert.strictEqual(techAttData.scheduleConfigured, true, 'Tech check-in returns scheduleConfigured: true');
  assert.strictEqual(techAttData.scheduleTimeZone, 'Asia/Kolkata', 'Tech check-in returns scheduleTimeZone: Asia/Kolkata');
  assert(typeof techAttData.isLate === 'boolean', 'Tech check-in returns isLate (boolean)');
  assert(typeof techAttData.late === 'boolean', 'Tech check-in returns late (boolean)');
  assert(typeof techAttData.minutesLate === 'number', 'Tech check-in returns minutesLate (number)');

  // 4. Test Staff Check-In for Telecalling
  console.log('\n4. Verifying Staff Check-In for Telecalling Employee...');
  const teleEmail = `live.tele.${ts}@example.com`;
  const createTeleRes = await request({
    path: '/api/hr/employees',
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` }
  }, {
    firstName: 'CallerLive',
    lastName: 'Telecalling',
    email: teleEmail,
    password: 'Password@123',
    department: 'Telecalling',
    designation: 'Outbound Agent'
  });
  assert(createTeleRes.statusCode === 201, 'Telecalling test employee created (201)');

  const teleLoginRes = await request({
    path: '/api/auth/login',
    method: 'POST'
  }, { email: teleEmail, password: 'Password@123' });
  assert(teleLoginRes.statusCode === 200, 'Telecalling staff login successful');
  const teleToken = teleLoginRes.body.data?.accessToken;

  const teleCheckInRes = await request({
    path: '/api/staff/attendance/check-in',
    method: 'POST',
    headers: { Authorization: `Bearer ${teleToken}` }
  }, { remarks: 'Live Telecalling check-in verification' });
  assert(teleCheckInRes.statusCode === 201, 'Telecalling staff check-in successful (201)');

  const teleAttData = teleCheckInRes.body.data;
  console.log('Telecalling Check-In Data:', JSON.stringify(teleAttData, null, 2));
  assert.strictEqual(teleAttData.scheduledCheckIn, '09:00', 'Telecalling check-in returns scheduledCheckIn: 09:00');
  assert.strictEqual(teleAttData.scheduledCheckOut, '18:00', 'Telecalling check-in returns scheduledCheckOut: 18:00');
  assert.strictEqual(teleAttData.scheduleConfigured, true, 'Telecalling check-in returns scheduleConfigured: true');
  assert.strictEqual(teleAttData.scheduleTimeZone, 'Asia/Kolkata', 'Telecalling check-in returns scheduleTimeZone: Asia/Kolkata');
  assert(typeof teleAttData.isLate === 'boolean', 'Telecalling check-in returns isLate (boolean)');
  assert(typeof teleAttData.late === 'boolean', 'Telecalling check-in returns late (boolean)');
  assert(typeof teleAttData.minutesLate === 'number', 'Telecalling check-in returns minutesLate (number)');

  // 5. Verify GET /api/hr/attendance?date=YYYY-MM-DD&department=Tech&page=1&limit=20
  console.log('\n5. Verifying GET /api/hr/attendance?date=YYYY-MM-DD&department=Tech&page=1&limit=20...');
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const hrTechAttRes = await request({
    path: `/api/hr/attendance?date=${todayKey}&department=Tech&page=1&limit=20`,
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(hrTechAttRes.statusCode === 200, 'GET /api/hr/attendance for Tech returns 200');
  const hrTechList = hrTechAttRes.body.data?.attendance || hrTechAttRes.body.data || [];
  assert(hrTechList.length > 0, 'Tech attendance list contains records');
  for (const item of hrTechList) {
    assert.strictEqual(item.scheduledCheckIn, '10:00', `Tech attendance record must show scheduledCheckIn: 10:00 (got ${item.scheduledCheckIn})`);
    assert.strictEqual(item.scheduledCheckOut, '18:00', `Tech attendance record must show scheduledCheckOut: 18:00`);
    assert.strictEqual(item.scheduleConfigured, true, `Tech attendance record must show scheduleConfigured: true`);
    assert.strictEqual(item.scheduleTimeZone, 'Asia/Kolkata', `Tech attendance record must show scheduleTimeZone: Asia/Kolkata`);
    assert(typeof item.isLate === 'boolean', 'item must have boolean isLate');
    assert(typeof item.late === 'boolean', 'item must have boolean late');
    assert(typeof item.minutesLate === 'number', 'item must have number minutesLate');
  }
  console.log(`  [PASS] Tech attendance list (${hrTechList.length} records) all show scheduledCheckIn: 10:00, scheduledCheckOut: 18:00`);

  // 6. Verify GET /api/hr/attendance?date=YYYY-MM-DD&department=Telecalling&page=1&limit=20
  console.log('\n6. Verifying GET /api/hr/attendance?date=YYYY-MM-DD&department=Telecalling&page=1&limit=20...');
  const hrTeleAttRes = await request({
    path: `/api/hr/attendance?date=${todayKey}&department=Telecalling&page=1&limit=20`,
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(hrTeleAttRes.statusCode === 200, 'GET /api/hr/attendance for Telecalling returns 200');
  const hrTeleList = hrTeleAttRes.body.data?.attendance || hrTeleAttRes.body.data || [];
  assert(hrTeleList.length > 0, 'Telecalling attendance list contains records');
  for (const item of hrTeleList) {
    assert.strictEqual(item.scheduledCheckIn, '09:00', `Telecalling attendance record must show scheduledCheckIn: 09:00 (got ${item.scheduledCheckIn})`);
    assert.strictEqual(item.scheduledCheckOut, '18:00', `Telecalling attendance record must show scheduledCheckOut: 18:00`);
    assert.strictEqual(item.scheduleConfigured, true, `Telecalling attendance record must show scheduleConfigured: true`);
    assert.strictEqual(item.scheduleTimeZone, 'Asia/Kolkata', `Telecalling attendance record must show scheduleTimeZone: Asia/Kolkata`);
    assert(typeof item.isLate === 'boolean', 'item must have boolean isLate');
    assert(typeof item.late === 'boolean', 'item must have boolean late');
    assert(typeof item.minutesLate === 'number', 'item must have number minutesLate');
  }
  console.log(`  [PASS] Telecalling attendance list (${hrTeleList.length} records) all show scheduledCheckIn: 09:00, scheduledCheckOut: 18:00`);

  // 7. Verify Dashboard Summary Endpoint (GET /api/hr/dashboard)
  console.log('\n7. Verifying Dashboard Summary Endpoint (GET /api/hr/dashboard)...');
  const dashRes = await request({
    path: '/api/hr/dashboard',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert(dashRes.statusCode === 200, 'GET /api/hr/dashboard returns 200');
  const dashData = dashRes.body.data;
  console.log('Dashboard Summary:', JSON.stringify({
    totalEmployees: dashData.totalEmployees,
    activeEmployees: dashData.activeEmployees,
    todayPresent: dashData.todayPresent,
    todayLate: dashData.todayLate,
    lateArrivals: dashData.lateArrivals
  }, null, 2));

  assert(typeof dashData.todayLate === 'number', 'todayLate is a number');
  assert(typeof dashData.lateArrivals === 'number', 'lateArrivals is a number');
  assert.strictEqual(dashData.todayLate, dashData.lateArrivals, 'todayLate equals lateArrivals');

  // Verify consistency with GET /api/hr/attendance?status=LATE
  const lateListRes = await request({
    path: '/api/hr/attendance?status=LATE',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const lateTotal = lateListRes.body.pagination?.total ?? (lateListRes.body.data?.attendance?.length || 0);
  console.log(`Dashboard lateArrivals: ${dashData.lateArrivals} | status=LATE query total: ${lateTotal}`);
  assert.strictEqual(dashData.lateArrivals, lateTotal, 'Dashboard lateArrivals matches status=LATE query count');
  console.log('  [PASS] Dashboard summary late count is strictly consistent with attendance records');

  console.log('\n================================================================');
  console.log('   ALL LIVE API VERIFICATIONS PASSED SUCCESSFULLY!             ');
  console.log('================================================================\n');
}

verifyLive().catch(err => {
  console.error('\nLive verification failed:', err);
  process.exit(1);
});
