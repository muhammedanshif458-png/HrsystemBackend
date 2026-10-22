/**
 * Comprehensive Automated Test Suite for Company-Wide Birthday Celebrations
 * Covers unit logic, edge cases, leap years, privacy, and live HTTP endpoints
 */

const mongoose = require('mongoose');
const http = require('http');
const { app } = require('C:/Users/Admin/Downloads/HrsystemBackend/server');
const User = require('C:/Users/Admin/Downloads/HrsystemBackend/models/User');
const Employee = require('C:/Users/Admin/Downloads/HrsystemBackend/models/Employee');
const hrService = require('C:/Users/Admin/Downloads/HrsystemBackend/services/hrService');

function makeRequest(server, method, path, headers = {}, body = null) {
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
      res.on('data', (chunk) => { data += chunk; });
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

    req.on('error', (err) => reject(err));
    if (postData) req.write(postData);
    req.end();
  });
}

async function runBirthdayTestSuite() {
  console.log('\n================================================================================');
  console.log('   COMPANY-WIDE BIRTHDAY CELEBRATIONS - TEST & VERIFICATION SUITE');
  console.log('================================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  [PASS] ${message}`);
    } else {
      console.error(`  [FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  // Connect to test database
  const mongoUri = 'mongodb://127.0.0.1:27017/hr_management_birthday_test';
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB test database: ' + mongoUri);

  // Clean collections for clean isolation
  await Employee.deleteMany({});
  await User.deleteMany({});

  // Start HTTP server on dynamic port
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  console.log(`Test HTTP server listening on port ${port}.\n`);

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Empty Employee Dataset
    // -------------------------------------------------------------------------
    console.log('--- TEST GROUP 1: Empty Dataset ---');
    const emptyResult = await hrService.getCompanyBirthdays(30);
    assert(Array.isArray(emptyResult.today) && emptyResult.today.length === 0, 'Empty dataset returns empty today list');
    assert(Array.isArray(emptyResult.upcoming) && emptyResult.upcoming.length === 0, 'Empty dataset returns empty upcoming list');
    assert(emptyResult.totalToday === 0 && emptyResult.totalUpcoming === 0, 'Empty dataset returns zero totals');

    // -------------------------------------------------------------------------
    // TEST 2: Seed Test Employees with Diverse DOBs and Departments
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: Seed Test Data Across Departments ---');
    const refDate = new Date(2026, 9, 16); // October 16, 2026

    async function createTestEmp(empId, fName, lName, dept, desig, dobStr, status = 'ACTIVE') {
      const u = new User({
        firstName: fName,
        lastName: lName,
        email: `${empId.toLowerCase()}@test.com`,
        password: 'Password@123',
        role: 'STAFF',
        isActive: status === 'ACTIVE'
      });
      await u.save();

      const e = new Employee({
        employeeId: empId,
        user: u._id,
        firstName: fName,
        lastName: lName,
        email: `${empId.toLowerCase()}@test.com`,
        department: dept,
        designation: desig,
        dateOfBirth: dobStr ? new Date(dobStr) : null,
        status: status
      });
      await e.save();
      return e;
    }

    // 1. Birthday TODAY: Oct 16
    await createTestEmp('EMP001', 'Anita', 'Rao', 'Tech', 'Frontend Dev', '1992-10-16');
    // 2. Birthday Upcoming in 5 days: Oct 21
    await createTestEmp('EMP002', 'Arjun', 'Desai', 'Telecalling', 'Telecaller', '1995-10-21');
    // 3. Birthday Upcoming in 20 days: Nov 5
    await createTestEmp('EMP003', 'Neha', 'Sharma', 'Tech', 'Backend Dev', '1990-11-05');
    // 4. Birthday OUTSIDE 30 days: Dec 20
    await createTestEmp('EMP004', 'Vikram', 'Patel', 'Sales', 'Sales Rep', '1991-12-20');
    // 5. Birthday ALREADY PASSED this year: Oct 10
    await createTestEmp('EMP005', 'Kavita', 'Krishnan', 'HR', 'HR Specialist', '1988-10-10');
    // 6. Missing DOB (null)
    await createTestEmp('EMP006', 'Rahul', 'Verma', 'Tech', 'DevOps', null);
    // 7. Inactive Employee with birthday today
    await createTestEmp('EMP007', 'Inactive', 'User', 'Tech', 'Tester', '1993-10-16', 'INACTIVE');
    // 8. Terminated Employee with upcoming birthday
    await createTestEmp('EMP008', 'Terminated', 'User', 'Telecalling', 'Telecaller', '1994-10-25', 'TERMINATED');
    // 9. On Leave Employee with upcoming birthday in 10 days (Oct 26)
    await createTestEmp('EMP009', 'Pooja', 'Menon', 'Telecalling', 'Lead Caller', '1996-10-26', 'ON_LEAVE');

    console.log('Seeded test employees across Tech, Telecalling, Sales, and HR.');

    // -------------------------------------------------------------------------
    // TEST 3: Birthday Today, Upcoming, and Range Filtering
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Birthday Today and Upcoming Calculations ---');
    const res30 = await hrService.getCompanyBirthdays(30, refDate);

    assert(res30.today.length === 1, 'Exactly 1 active employee has birthday today');
    assert(res30.today[0].name === 'Anita Rao', "Today's birthday is Anita Rao");
    assert(res30.today[0].department === 'Tech', 'Department is Tech');
    assert(res30.today[0].isToday === true, 'isToday flag is true');
    assert(res30.today[0].daysUntil === 0, 'daysUntil is 0 for today');
    assert(res30.today[0].birthdayFormatted === 'Oct 16', "birthdayFormatted is 'Oct 16'");

    // Upcoming within 30 days: Arjun (Oct 21 -> 5 days), Pooja (Oct 26 -> 10 days), Neha (Nov 5 -> 20 days)
    assert(res30.upcoming.length === 3, 'Exactly 3 upcoming birthdays within 30 days');
    assert(res30.upcoming[0].name === 'Arjun Desai' && res30.upcoming[0].daysUntil === 5, 'First upcoming is Arjun Desai in 5 days');
    assert(res30.upcoming[1].name === 'Pooja Menon' && res30.upcoming[1].daysUntil === 10, 'Second upcoming is Pooja Menon (ON_LEAVE) in 10 days');
    assert(res30.upcoming[2].name === 'Neha Sharma' && res30.upcoming[2].daysUntil === 20, 'Third upcoming is Neha Sharma in 20 days');

    // Sorted by daysUntil
    assert(res30.upcoming[0].daysUntil <= res30.upcoming[1].daysUntil && res30.upcoming[1].daysUntil <= res30.upcoming[2].daysUntil, 'Upcoming birthdays are sorted by daysUntil ascending');

    // Verify company-wide: contains Tech and Telecalling
    const depts = new Set([...res30.today, ...res30.upcoming].map(b => b.department));
    assert(depts.has('Tech') && depts.has('Telecalling'), 'Contains both Tech and Telecalling employees (Company-wide)');

    // Verify inactive/terminated are excluded
    const allNames = [...res30.today, ...res30.upcoming].map(b => b.name);
    assert(!allNames.includes('Inactive User'), 'Inactive employee is excluded');
    assert(!allNames.includes('Terminated User'), 'Terminated employee is excluded');

    // Verify missing DOB is excluded
    assert(!allNames.includes('Rahul Verma'), 'Employee with null DOB is excluded');

    // Verify outside range (Vikram Patel on Dec 20 -> 65 days) is excluded when daysAhead=30
    assert(!allNames.includes('Vikram Patel'), 'Birthday outside 30 days window is excluded');

    // Now test with daysAhead = 70
    const res70 = await hrService.getCompanyBirthdays(70, refDate);
    const names70 = res70.upcoming.map(b => b.name);
    assert(names70.includes('Vikram Patel'), 'Birthday within 70 days window is included when daysAhead=70');

    // -------------------------------------------------------------------------
    // TEST 4: Year-End Transition (December to January)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: December to January Year Transition ---');
    await createTestEmp('EMP010', 'January', 'Baby', 'Tech', 'Engineer', '1997-01-05');
    const dec30 = new Date(2026, 11, 30); // Dec 30, 2026
    const resYearEnd = await hrService.getCompanyBirthdays(30, dec30);

    const janBirthday = resYearEnd.upcoming.find(b => b.name === 'January Baby');
    assert(!!janBirthday, 'January birthday found across year-end boundary');
    assert(janBirthday.daysUntil === 6, 'daysUntil correctly calculated as 6 days across new year boundary (Dec 30 to Jan 5)');
    assert(janBirthday.birthdayFormatted === 'Jan 5', "birthdayFormatted is 'Jan 5'");

    // -------------------------------------------------------------------------
    // TEST 5: February 29 in Non-Leap Year (2026) vs Leap Year (2028)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 5: Leap Day (Feb 29) Calculations ---');
    await createTestEmp('EMP011', 'Leap', 'Born', 'Telecalling', 'Agent', '2000-02-29');

    // In 2026 (non-leap year), Feb 29 birthday is celebrated on Feb 28
    const feb28_2026 = new Date(2026, 1, 28); // Feb 28, 2026
    const resNonLeap = await hrService.getCompanyBirthdays(30, feb28_2026);
    const leapIn2026 = resNonLeap.today.find(b => b.name === 'Leap Born');
    assert(!!leapIn2026, 'Feb 29 birthday celebrated on Feb 28 in non-leap year (2026)');
    assert(leapIn2026.isToday === true && leapIn2026.daysUntil === 0, 'Leap Day is today on Feb 28 in non-leap year');
    assert(leapIn2026.birthdayFormatted === 'Feb 28', "birthdayFormatted displays 'Feb 28' in non-leap year");

    // In 2028 (leap year), Feb 29 birthday is celebrated on Feb 29
    const feb28_2028 = new Date(2028, 1, 28); // Feb 28, 2028
    const resLeapUpcoming = await hrService.getCompanyBirthdays(30, feb28_2028);
    const leapIn2028Upcoming = resLeapUpcoming.upcoming.find(b => b.name === 'Leap Born');
    assert(!!leapIn2028Upcoming, 'Feb 29 birthday is upcoming tomorrow on Feb 28 in leap year (2028)');
    assert(leapIn2028Upcoming.daysUntil === 1, 'daysUntil is 1 in leap year');

    const feb29_2028 = new Date(2028, 1, 29); // Feb 29, 2028
    const resLeapToday = await hrService.getCompanyBirthdays(30, feb29_2028);
    const leapIn2028Today = resLeapToday.today.find(b => b.name === 'Leap Born');
    assert(!!leapIn2028Today, 'Feb 29 birthday is celebrated on Feb 29 in leap year (2028)');
    assert(leapIn2028Today.isToday === true && leapIn2028Today.daysUntil === 0, 'isToday is true on Feb 29');
    assert(leapIn2028Today.birthdayFormatted === 'Feb 29', "birthdayFormatted displays 'Feb 29' in leap year");

    // -------------------------------------------------------------------------
    // TEST 6: Privacy Guarantees
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 6: Privacy & Field Isolation ---');
    const allRecords = [...res30.today, ...res30.upcoming];
    for (const rec of allRecords) {
      assert(rec.dateOfBirth === undefined, `${rec.name} record does not expose dateOfBirth`);
      assert(rec.dob === undefined, `${rec.name} record does not expose dob`);
      assert(rec.birthYear === undefined, `${rec.name} record does not expose birthYear`);
      assert(rec.year === undefined, `${rec.name} record does not expose year`);
      assert(rec.age === undefined, `${rec.name} record does not expose age`);
      assert(rec.salary === undefined, `${rec.name} record does not expose salary`);
      assert(rec.phone === undefined, `${rec.name} record does not expose phone`);
      assert(rec.email === undefined, `${rec.name} record does not expose email`);
      assert(rec.address === undefined, `${rec.name} record does not expose address`);
      assert(rec.emergencyContact === undefined, `${rec.name} record does not expose emergency contact`);
      assert(typeof rec.name === 'string', 'Record contains name');
      assert(typeof rec.department === 'string', 'Record contains department');
      assert(typeof rec.birthdayFormatted === 'string', 'Record contains birthdayFormatted');
      assert(typeof rec.daysUntil === 'number', 'Record contains daysUntil');
    }

    // -------------------------------------------------------------------------
    // TEST 7: Authentication & Authorization on HTTP Endpoints
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 7: HTTP Endpoint Security & RBAC ---');

    // Create HR user and Staff user for testing
    const hrUser = new User({
      firstName: 'HR',
      lastName: 'Manager',
      email: 'hr.manager@test.com',
      password: 'Password@123',
      role: 'HR',
      isActive: true
    });
    await hrUser.save();

    const staffUser = new User({
      firstName: 'Regular',
      lastName: 'Staff',
      email: 'regular.staff@test.com',
      password: 'Password@123',
      role: 'STAFF',
      isActive: true
    });
    await staffUser.save();

    // Login HR
    const hrLogin = await makeRequest(server, 'POST', '/api/auth/login', {}, {
      email: 'hr.manager@test.com',
      password: 'Password@123'
    });
    const hrToken = hrLogin.body.data.accessToken;

    // Login Staff
    const staffLogin = await makeRequest(server, 'POST', '/api/auth/login', {}, {
      email: 'regular.staff@test.com',
      password: 'Password@123'
    });
    const staffToken = staffLogin.body.data.accessToken;

    // 1. Missing token
    const hrNoToken = await makeRequest(server, 'GET', '/api/hr/birthdays');
    assert(hrNoToken.statusCode === 401, 'GET /api/hr/birthdays without token returns 401');

    const staffNoToken = await makeRequest(server, 'GET', '/api/staff/birthdays');
    assert(staffNoToken.statusCode === 401, 'GET /api/staff/birthdays without token returns 401');

    // 2. Role isolation
    const staffOnHr = await makeRequest(server, 'GET', '/api/hr/birthdays', { Authorization: `Bearer ${staffToken}` });
    assert(staffOnHr.statusCode === 403, 'GET /api/hr/birthdays with STAFF role returns 403 Forbidden');

    const hrOnStaff = await makeRequest(server, 'GET', '/api/staff/birthdays', { Authorization: `Bearer ${hrToken}` });
    assert(hrOnStaff.statusCode === 403, 'GET /api/staff/birthdays with HR role returns 403 Forbidden');

    // 3. Authorized access
    const hrSuccess = await makeRequest(server, 'GET', '/api/hr/birthdays?daysAhead=30', { Authorization: `Bearer ${hrToken}` });
    assert(hrSuccess.statusCode === 200 && hrSuccess.body.success === true, 'GET /api/hr/birthdays with HR role returns 200 OK');
    assert(Array.isArray(hrSuccess.body.data.today) && Array.isArray(hrSuccess.body.data.upcoming), 'HR endpoint returns today and upcoming lists');

    const staffSuccess = await makeRequest(server, 'GET', '/api/staff/birthdays?daysAhead=30', { Authorization: `Bearer ${staffToken}` });
    assert(staffSuccess.statusCode === 200 && staffSuccess.body.success === true, 'GET /api/staff/birthdays with STAFF role returns 200 OK');
    assert(Array.isArray(staffSuccess.body.data.today) && Array.isArray(staffSuccess.body.data.upcoming), 'Staff endpoint returns today and upcoming lists');

    // 4. Consistency between HR and Staff endpoints
    assert(hrSuccess.body.data.today.length === staffSuccess.body.data.today.length, 'HR and Staff endpoints return identical today counts');
    assert(hrSuccess.body.data.upcoming.length === staffSuccess.body.data.upcoming.length, 'HR and Staff endpoints return identical upcoming counts');
    assert(hrSuccess.body.data.totalToday === staffSuccess.body.data.totalToday, 'HR and Staff totalToday match');
    assert(hrSuccess.body.data.totalUpcoming === staffSuccess.body.data.totalUpcoming, 'HR and Staff totalUpcoming match');

    // -------------------------------------------------------------------------
    // TEST 8: Invalid Query Parameters Validation (daysAhead)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 8: daysAhead Query Validation ---');
    const negDays = await makeRequest(server, 'GET', '/api/hr/birthdays?daysAhead=-5', { Authorization: `Bearer ${hrToken}` });
    assert(negDays.statusCode === 422, 'Negative daysAhead (-5) returns 422 Validation Error');

    const nonIntDays = await makeRequest(server, 'GET', '/api/hr/birthdays?daysAhead=abc', { Authorization: `Bearer ${hrToken}` });
    assert(nonIntDays.statusCode === 422, 'Non-integer daysAhead (abc) returns 422 Validation Error');

    const overMaxDays = await makeRequest(server, 'GET', '/api/hr/birthdays?daysAhead=500', { Authorization: `Bearer ${hrToken}` });
    assert(overMaxDays.statusCode === 422, 'Over maximum daysAhead (500 > 365) returns 422 Validation Error');

    const staffNeg = await makeRequest(server, 'GET', '/api/staff/birthdays?daysAhead=-1', { Authorization: `Bearer ${staffToken}` });
    assert(staffNeg.statusCode === 422, 'Staff endpoint: Negative daysAhead (-1) returns 422 Validation Error');

    // -------------------------------------------------------------------------
    // TEST 9: Employee DOB Creation and Mutation Validation
    // -------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 9: Employee DOB Validation & Mutation ---');

    // Create with invalid DOB
    const invalidDobRes = await makeRequest(server, 'POST', '/api/hr/employees', { Authorization: `Bearer ${hrToken}` }, {
      firstName: 'Invalid',
      lastName: 'DOB',
      email: 'invalid.dob@test.com',
      department: 'Tech',
      designation: 'Engineer',
      dateOfBirth: 'not-a-valid-date-string'
    });
    assert(invalidDobRes.statusCode === 422, 'Create employee with invalid DOB string returns 422');

    // Create with future DOB
    const futureDobRes = await makeRequest(server, 'POST', '/api/hr/employees', { Authorization: `Bearer ${hrToken}` }, {
      firstName: 'Future',
      lastName: 'DOB',
      email: 'future.dob@test.com',
      department: 'Tech',
      designation: 'Engineer',
      dateOfBirth: '2099-01-01'
    });
    assert(futureDobRes.statusCode === 422, 'Create employee with future DOB returns 422');

    // Create with valid DOB
    const validDobRes = await makeRequest(server, 'POST', '/api/hr/employees', { Authorization: `Bearer ${hrToken}` }, {
      firstName: 'Valid',
      lastName: 'DOB',
      email: 'valid.dob@test.com',
      department: 'Tech',
      designation: 'Engineer',
      dateOfBirth: '1995-07-20'
    });
    assert(validDobRes.statusCode === 201, 'Create employee with valid DOB returns 201');
    const createdId = validDobRes.body.data._id;

    // Update with invalid DOB
    const updateInvalid = await makeRequest(server, 'PUT', `/api/hr/employees/${createdId}`, { Authorization: `Bearer ${hrToken}` }, {
      dateOfBirth: 'invalid-date'
    });
    assert(updateInvalid.statusCode === 422, 'Update employee with invalid DOB returns 422');

    // Update with valid new DOB
    const updateValid = await makeRequest(server, 'PUT', `/api/hr/employees/${createdId}`, { Authorization: `Bearer ${hrToken}` }, {
      dateOfBirth: '1995-08-25'
    });
    assert(updateValid.statusCode === 200, 'Update employee with valid DOB returns 200');

    // Verify fetched employee has updated dateOfBirth
    const getUpdated = await makeRequest(server, 'GET', `/api/hr/employees/${createdId}`, { Authorization: `Bearer ${hrToken}` });
    assert(getUpdated.statusCode === 200, 'Get employee by ID returns 200');
    assert(getUpdated.body.data.dateOfBirth.startsWith('1995-08-25'), 'Employee record persisted updated dateOfBirth');

    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    console.log('\n================================================================================');
    console.log(`   TEST SUITE COMPLETE: ${passedTests} / ${totalTests} TESTS PASSED (100% SUCCESS)`);
    console.log('================================================================================\n');

  } finally {
    // Cleanup test database
    await Employee.deleteMany({});
    await User.deleteMany({});
    await mongoose.disconnect();
    server.close();
  }
}

runBirthdayTestSuite().catch((err) => {
  console.error('\nFATAL TEST FAILURE:', err);
  process.exit(1);
});
