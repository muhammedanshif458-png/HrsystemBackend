const http = require('http');
const mongoose = require('mongoose');

// Target server
const PORT = parseInt(process.env.PORT, 10) || 5000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, text: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function run() {
  console.log('=== Starting End-to-End Late Arrivals Verification ===\n');

  // 1. Admin Login
  console.log('1. Logging in as Admin...');
  const adminLoginRes = await request('POST', '/api/auth/login', {
    email: 'admin@hrmanagement.com',
    password: 'Admin@12345'
  });

  if (adminLoginRes.status !== 200 || !adminLoginRes.body?.data?.accessToken) {
    throw new Error(`Admin login failed: ${JSON.stringify(adminLoginRes.body)}`);
  }
  const adminToken = adminLoginRes.body.data.accessToken;
  console.log('Admin login successful. Token acquired.\n');

  // 2. Setup / Verify Department Schedule for 'Technology'
  console.log('2. Configuring Department Schedule for Technology...');
  const schedulePayload = {
    department: 'Technology',
    timeZone: 'Asia/Kolkata',
    checkInTime: '09:30',
    checkOutTime: '18:30',
    gracePeriodMinutes: 15,
    halfDayCutoffMinutes: 240,
    workingDays: [1, 2, 3, 4, 5, 6] // Mon-Sat
  };

  const scheduleRes = await request('POST', '/api/hr/department-schedules', schedulePayload, adminToken);
  console.log(`Schedule save response status: ${scheduleRes.status}`);

  // 3. Ensure Test Employee exists
  console.log('\n3. Setting up authorized test employee...');
  await mongoose.connect('mongodb://127.0.0.1:27017/hr_management');
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const Employee = mongoose.model('Employee', new mongoose.Schema({}, { strict: false }));
  const Attendance = mongoose.model('Attendance', new mongoose.Schema({}, { strict: false }));

  const testEmail = 'authorized.test.late@example.com';
  const testPassword = 'Password@123';
  const bcrypt = require('bcryptjs');
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(testPassword, salt);

  let testUser = await User.findOne({ email: testEmail });
  if (!testUser) {
    testUser = await User.create({
      firstName: 'Vikram',
      lastName: 'LateTester',
      email: testEmail,
      password: passwordHash,
      role: 'STAFF',
      department: 'Technology',
      isActive: true
    });
  } else {
    testUser.password = passwordHash;
    testUser.role = 'STAFF';
    testUser.department = 'Technology';
    testUser.isActive = true;
    await testUser.save();
  }

  let testEmployee = await Employee.findOne({ user: testUser._id });
  if (!testEmployee) {
    testEmployee = await Employee.create({
      user: testUser._id,
      employeeId: 'TECH_TEST_9999',
      firstName: 'Vikram',
      lastName: 'LateTester',
      email: testEmail,
      department: 'Technology',
      designation: 'Senior QA Engineer',
      role: 'STAFF',
      status: 'ACTIVE',
      joiningDate: new Date('2025-01-01')
    });
  } else {
    testEmployee.status = 'ACTIVE';
    testEmployee.department = 'Technology';
    await testEmployee.save();
  }

  // Clear any existing attendance for this test employee today so we can test clean check-in
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const endOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
  await Attendance.deleteMany({
    employee: testEmployee._id,
    date: { $gte: startOfDay, $lte: endOfDay }
  });
  console.log(`Cleared today's test records for employeeId: ${testEmployee.employeeId}`);

  // 4. Login as Test Employee
  console.log('\n4. Logging in as test staff employee...');
  const staffLoginRes = await request('POST', '/api/auth/login', {
    email: testEmail,
    password: testPassword
  });

  if (staffLoginRes.status !== 200 || !staffLoginRes.body?.data?.accessToken) {
    throw new Error(`Staff login failed: ${JSON.stringify(staffLoginRes.body)}`);
  }
  const staffToken = staffLoginRes.body.data.accessToken;
  console.log('Staff login successful.\n');

  // 5. Staff Check-in after grace period
  console.log('5. Performing staff check-in after grace period...');
  const checkInRes = await request('POST', '/api/staff/attendance/check-in', {
    remarks: 'Checking in late for verification test'
  }, staffToken);

  console.log(`Check-in response status: ${checkInRes.status}`);
  console.log('Check-in response body:', JSON.stringify(checkInRes.body, null, 2));

  if (checkInRes.status !== 201) {
    throw new Error(`Check-in failed with status ${checkInRes.status}`);
  }

  const attRecord = checkInRes.body.data;
  console.log('\nVerifying stored check-in attributes:');
  console.log(`- isLate: ${attRecord.isLate} (expected: true)`);
  console.log(`- late: ${attRecord.late} (expected: true)`);
  console.log(`- minutesLate: ${attRecord.minutesLate} (expected: > 0)`);
  console.log(`- status: ${attRecord.status}`);
  console.log(`- scheduleStatus: ${attRecord.scheduleStatus}`);

  if (attRecord.isLate !== true || attRecord.late !== true || attRecord.minutesLate <= 0) {
    throw new Error('Check-in record lateness attributes failed validation!');
  }

  // 6. Query GET /api/hr/attendance?date=YYYY-MM-DD
  const todayDateStr = now.toISOString().split('T')[0];
  console.log(`\n6. Querying GET /api/hr/attendance?date=${todayDateStr} as Admin...`);
  const hrAttendanceRes = await request('GET', `/api/hr/attendance?date=${todayDateStr}`, null, adminToken);

  console.log(`HR attendance response status: ${hrAttendanceRes.status}`);
  const attendanceList = hrAttendanceRes.body?.data?.records || hrAttendanceRes.body?.data || [];
  console.log(`Total attendance records returned: ${attendanceList.length}`);

  const matchingRecord = attendanceList.find(r => 
    (r.employeeId === 'TECH_TEST_9999' || r.staffId === testUser._id.toString() || (r.employee && r.employee._id === testUser._id.toString()))
  );

  if (!matchingRecord) {
    throw new Error(`Could not find test employee record in GET /api/hr/attendance for date ${todayDateStr}`);
  }

  console.log('Found matching HR attendance record:', {
    id: matchingRecord.id,
    staffId: matchingRecord.staffId,
    employeeId: matchingRecord.employeeId,
    employeeName: matchingRecord.employeeName,
    isLate: matchingRecord.isLate,
    late: matchingRecord.late,
    minutesLate: matchingRecord.minutesLate,
    scheduledCheckIn: matchingRecord.scheduledCheckIn,
    scheduleConfigured: matchingRecord.scheduleConfigured,
    status: matchingRecord.status
  });

  if (matchingRecord.isLate !== true || matchingRecord.late !== true || matchingRecord.minutesLate <= 0) {
    throw new Error('HR attendance record is missing lateness flags!');
  }

  // 7. Query GET /api/hr/dashboard?date=YYYY-MM-DD
  console.log(`\n7. Querying GET /api/hr/dashboard?date=${todayDateStr} as Admin...`);
  const hrDashboardRes = await request('GET', `/api/hr/dashboard?date=${todayDateStr}`, null, adminToken);

  console.log(`HR dashboard response status: ${hrDashboardRes.status}`);
  const metrics = hrDashboardRes.body?.data || {};
  console.log('HR Dashboard metrics:', {
    totalEmployees: metrics.totalEmployees,
    todayPresent: metrics.todayPresent,
    lateArrivals: metrics.lateArrivals,
    todayLate: metrics.todayLate,
    todayAbsent: metrics.todayAbsent
  });

  if (metrics.lateArrivals < 1 && metrics.todayLate < 1) {
    throw new Error('Dashboard metrics do not reflect late arrival count!');
  }
  console.log(`Confirmed: late count in dashboard is lateArrivals=${metrics.lateArrivals}, todayLate=${metrics.todayLate}\n`);

  console.log('=== End-to-End Verification Passed Successfully ===');
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('\nVerification FAILED:', err);
  process.exit(1);
});
