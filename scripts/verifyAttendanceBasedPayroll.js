/**
 * Verification Test Suite: Attendance-Based Payroll Calculation & Conflict Resolution
 *
 * Covers:
 * 1. Zero payable days -> ₹0 salary (Zero attendance bug fixed).
 * 2. One payable day -> 1 day's daily salary.
 * 3. Full payable days -> exact full monthly base salary.
 * 4. HALF_DAY correction -> counted as 0.5 day.
 * 5. Valid WFH -> 1.0 day credit and tracked in wfhDays.
 * 6. Paid leave allowance -> paid up to allowance, excess unpaid.
 * 7. Unpaid leave -> leaveType UNPAID always unpaid.
 * 8. Attendance + Approved Leave Conflict -> PAYROLL_CONFLICT, unresolved excluded.
 * 9. Conflict HR Resolution -> POST /api/hr/payroll/conflicts/:id/resolve.
 * 10. Pending and Rejected leaves -> not counted in payroll or conflicts.
 * 11. Tech vs Telecalling department calendars -> Mon-Fri (21 days) vs Mon-Sat (25 days).
 * 12. Weekly offs & company holidays -> weekly offs not LOP, paid holidays counted.
 * 13. Resigned & Terminated employee eligibility -> consistent across summary & list.
 * 14. Duplicate attendance prevention -> same date counted at most once.
 * 15. Future-dated leaves outside month -> excluded from target month.
 * 16. Summary totals strictly match sum of employee payroll records.
 */

const http = require('http');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { app } = require('../server');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const DepartmentSchedule = require('../models/DepartmentSchedule');
const PayrollConflict = require('../models/PayrollConflict');
const { generateAccessToken } = require('../utils/jwt');

const TEST_DB_URI = 'mongodb://127.0.0.1:27017/hr_management_test';

let server;
let baseUrl;
let testPort;

function assert(condition, message) {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = options.headers || {};
    let postData = null;

    if (options.body) {
      postData = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const reqOptions = {
      method: options.method || 'GET',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json,
          text: data
        });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('\n================================================================');
  console.log('   ATTENDANCE-BASED PAYROLL CALCULATION VERIFICATION SUITE       ');
  console.log('================================================================\n');

  // Connect to isolated test database
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(TEST_DB_URI);
  console.log('Connected to test DB:', TEST_DB_URI);

  // Clean collections in test database
  await Promise.all([
    User.deleteMany({}),
    Employee.deleteMany({}),
    Attendance.deleteMany({}),
    Leave.deleteMany({}),
    DepartmentSchedule.deleteMany({}),
    PayrollConflict.deleteMany({})
  ]);
  console.log('Cleaned test database collections.\n');

  // Start HTTP server on dynamic port
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      testPort = server.address().port;
      baseUrl = `http://127.0.0.1:${testPort}`;
      console.log(`Test HTTP server listening on port ${testPort}\n`);
      resolve();
    });
  });

  // Seed HR User
  const hrUser = await User.create({
    firstName: 'HR',
    lastName: 'Admin',
    email: 'hr_payroll_test@example.com',
    password: 'password123',
    role: 'HR',
    isActive: true
  });
  const hrToken = generateAccessToken(hrUser);

  // Seed Department Schedules
  // Tech: Mon-Fri (1,2,3,4,5)
  const techSchedule = await DepartmentSchedule.create({
    department: 'Tech',
    departmentDisplay: 'Tech & Engineering',
    checkInTime: '10:00',
    checkOutTime: '18:00',
    workingDays: [1, 2, 3, 4, 5],
    holidays: ['2026-11-12'], // Nov 12 is a configured holiday (Thursday)
    timezone: 'Asia/Kolkata'
  });

  // Telecalling: Mon-Sat (1,2,3,4,5,6)
  const telecallingSchedule = await DepartmentSchedule.create({
    department: 'Telecalling',
    departmentDisplay: 'Telecalling & Sales',
    checkInTime: '09:00',
    checkOutTime: '18:00',
    workingDays: [1, 2, 3, 4, 5, 6],
    holidays: [],
    timezone: 'Asia/Kolkata'
  });

  // Target payroll period: November 2026
  // November 2026 has 30 days:
  // Tech: Mon-Fri = 21 working days minus 1 holiday (Nov 12) = 20 scheduled working days, 9 weekly offs, 1 holiday.
  // Telecalling: Mon-Sat = 25 working days, 5 weekly offs, 0 holidays.

  // 1. Employee with ZERO attendance (Tech, ₹60,000)
  const userZero = await User.create({ firstName: 'Zero', lastName: 'Att', email: 'zero@example.com', password: 'password123', role: 'STAFF', isActive: true });
  const empZero = await Employee.create({
    employeeId: 'EMP_ZERO',
    user: userZero._id,
    firstName: 'Zero',
    lastName: 'Attendance',
    email: 'zero@example.com',
    department: 'Tech',
    designation: 'Developer',
    salary: 60000,
    paidLeaveAllowance: 1,
    status: 'ACTIVE'
  });

  // 2. Employee with ONE payable day (Tech, ₹60,000)
  const userOne = await User.create({ firstName: 'One', lastName: 'Day', email: 'one@example.com', password: 'password123', role: 'STAFF', isActive: true });
  const empOne = await Employee.create({
    employeeId: 'EMP_ONE',
    user: userOne._id,
    firstName: 'One',
    lastName: 'DayWorker',
    email: 'one@example.com',
    department: 'Tech',
    designation: 'Developer',
    salary: 60000,
    paidLeaveAllowance: 1,
    status: 'ACTIVE'
  });
  // 1 present attendance record on Nov 2 (Monday)
  await Attendance.create({
    employee: empOne._id,
    date: new Date('2026-11-02T04:30:00.000Z'),
    checkIn: new Date('2026-11-02T04:30:00.000Z'),
    status: 'PRESENT',
    workMode: 'Office'
  });

  // 3. Employee with FULL payable days (Telecalling, ₹25,000, 25 working days)
  const userFull = await User.create({ firstName: 'Full', lastName: 'Att', email: 'full@example.com', password: 'password123', role: 'STAFF', isActive: true });
  const empFull = await Employee.create({
    employeeId: 'EMP_FULL',
    user: userFull._id,
    firstName: 'Full',
    lastName: 'Attendance',
    email: 'full@example.com',
    department: 'Telecalling',
    designation: 'Caller',
    salary: 25000,
    paidLeaveAllowance: 1,
    status: 'ACTIVE'
  });
  // Create attendance for all 25 Mon-Sat days of Nov 2026
  for (let d = 1; d <= 30; d++) {
    const dt = new Date(Date.UTC(2026, 10, d));
    if (dt.getUTCDay() !== 0) { // Not Sunday
      await Attendance.create({
        employee: empFull._id,
        date: dt,
        checkIn: dt,
        status: 'PRESENT',
        workMode: 'Office'
      });
    }
  }

  // 4. Employee with HALF_DAY records (Tech, ₹60,000)
  const userHalf = await User.create({ firstName: 'Half', lastName: 'Day', email: 'half@example.com', password: 'password123', role: 'STAFF', isActive: true });
  const empHalf = await Employee.create({
    employeeId: 'EMP_HALF',
    user: userHalf._id,
    firstName: 'Half',
    lastName: 'DayWorker',
    email: 'half@example.com',
    department: 'Tech',
    designation: 'Developer',
    salary: 60000,
    paidLeaveAllowance: 1,
    status: 'ACTIVE'
  });
  // 2 HALF_DAY records (Nov 3, Nov 4) -> 0.5 + 0.5 = 1.0 day + 1 paid holiday (Nov 12) = 2.0 payable days
  await Attendance.create({
    employee: empHalf._id,
    date: new Date('2026-11-03T00:00:00.000Z'),
    status: 'HALF_DAY',
    workMode: 'Office'
  });
  await Attendance.create({
    employee: empHalf._id,
    date: new Date('2026-11-04T00:00:00.000Z'),
    status: 'HALF_DAY',
    workMode: 'Office'
  });

  // 5. Employee with WFH records (Tech, ₹60,000)
  const userWfh = await User.create({ firstName: 'Wfh', lastName: 'Worker', email: 'wfh@example.com', password: 'password123', role: 'STAFF', isActive: true });
  const empWfh = await Employee.create({
    employeeId: 'EMP_WFH',
    user: userWfh._id,
    firstName: 'Wfh',
    lastName: 'Specialist',
    email: 'wfh@example.com',
    department: 'Tech',
    designation: 'Developer',
    salary: 60000,
    paidLeaveAllowance: 1,
    status: 'ACTIVE'
  });
  // 2 full WFH days (Nov 5, Nov 6) + 1 office present (Nov 9) = 3 attendance days + 1 holiday = 4 payable days
  await Attendance.create({
    employee: empWfh._id,
    date: new Date('2026-11-05T00:00:00.000Z'),
    status: 'PRESENT',
    workMode: 'WFH'
  });
  await Attendance.create({
    employee: empWfh._id,
    date: new Date('2026-11-06T00:00:00.000Z'),
    status: 'PRESENT',
    workMode: 'WORK_FROM_HOME'
  });
  await Attendance.create({
    employee: empWfh._id,
    date: new Date('2026-11-09T00:00:00.000Z'),
    status: 'PRESENT',
    workMode: 'Office'
  });

  // 6. Employee with Paid and Unpaid Leave (Tech, ₹60,000, allowance = 1)
  const userLeave = await User.create({ firstName: 'Leave', lastName: 'Taker', email: 'leave@example.com', password: 'password123', role: 'STAFF', isActive: true });
  const empLeave = await Employee.create({
    employeeId: 'EMP_LEAVE',
    user: userLeave._id,
    firstName: 'Leave',
    lastName: 'Taker',
    email: 'leave@example.com',
    department: 'Tech',
    designation: 'QA Tester',
    salary: 60000,
    paidLeaveAllowance: 1, // 1 paid day
    status: 'ACTIVE'
  });
  // 3-day approved CASUAL leave on Nov 16-18 (Mon, Tue, Wed)
  // 1 day paid (up to allowance), 2 days unpaid
  await Leave.create({
    employee: empLeave._id,
    leaveType: 'CASUAL',
    startDate: new Date('2026-11-16T00:00:00.000Z'),
    endDate: new Date('2026-11-18T00:00:00.000Z'),
    reason: 'Family function',
    status: 'APPROVED'
  });
  // Also 1 explicit UNPAID leave on Nov 19 (Thu) -> must be unpaid regardless of allowance
  await Leave.create({
    employee: empLeave._id,
    leaveType: 'UNPAID',
    startDate: new Date('2026-11-19T00:00:00.000Z'),
    endDate: new Date('2026-11-19T00:00:00.000Z'),
    reason: 'Personal unpaid leave',
    status: 'APPROVED'
  });
  // Pending leave on Nov 20 -> must be IGNORED
  await Leave.create({
    employee: empLeave._id,
    leaveType: 'SICK',
    startDate: new Date('2026-11-20T00:00:00.000Z'),
    endDate: new Date('2026-11-20T00:00:00.000Z'),
    reason: 'Pending request',
    status: 'PENDING'
  });
  // Rejected leave on Nov 23 -> must be IGNORED
  await Leave.create({
    employee: empLeave._id,
    leaveType: 'CASUAL',
    startDate: new Date('2026-11-23T00:00:00.000Z'),
    endDate: new Date('2026-11-23T00:00:00.000Z'),
    reason: 'Rejected request',
    status: 'REJECTED'
  });

  // 7. Employee with Same-Date Attendance + Approved Leave Conflict (Tech, ₹60,000)
  const userConflict = await User.create({ firstName: 'Conflict', lastName: 'User', email: 'conflict@example.com', password: 'password123', role: 'STAFF', isActive: true });
  const empConflict = await Employee.create({
    employeeId: 'EMP_CONFLICT',
    user: userConflict._id,
    firstName: 'Conflict',
    lastName: 'User',
    email: 'conflict@example.com',
    department: 'Tech',
    designation: 'Developer',
    salary: 60000,
    paidLeaveAllowance: 1,
    status: 'ACTIVE'
  });
  // Attendance on Nov 6 (Friday)
  await Attendance.create({
    employee: empConflict._id,
    date: new Date('2026-11-06T00:00:00.000Z'),
    status: 'PRESENT',
    workMode: 'Office'
  });
  // Approved Leave on Nov 6 (Friday)
  await Leave.create({
    employee: empConflict._id,
    leaveType: 'SICK',
    startDate: new Date('2026-11-06T00:00:00.000Z'),
    endDate: new Date('2026-11-06T00:00:00.000Z'),
    reason: 'Doctor appointment',
    status: 'APPROVED'
  });

  // 8. Resigned and Terminated Employees
  const userResigned = await User.create({ firstName: 'Resigned', lastName: 'User', email: 'resigned@example.com', password: 'password123', role: 'STAFF', isActive: false });
  const empResigned = await Employee.create({
    employeeId: 'EMP_RESIGNED',
    user: userResigned._id,
    firstName: 'Resigned',
    lastName: 'Staff',
    email: 'resigned@example.com',
    department: 'Tech',
    designation: 'Developer',
    salary: 60000,
    status: 'RESIGNED',
    resignationDate: new Date('2026-11-15T00:00:00.000Z') // Resigned mid-month
  });
  // Worked Nov 2
  await Attendance.create({
    employee: empResigned._id,
    date: new Date('2026-11-02T00:00:00.000Z'),
    status: 'PRESENT',
    workMode: 'Office'
  });

  const userTerminatedOld = await User.create({ firstName: 'Term', lastName: 'Old', email: 'term_old@example.com', password: 'password123', role: 'STAFF', isActive: false });
  await Employee.create({
    employeeId: 'EMP_TERM_OLD',
    user: userTerminatedOld._id,
    firstName: 'Terminated',
    lastName: 'Old',
    email: 'term_old@example.com',
    department: 'Tech',
    designation: 'Developer',
    salary: 50000,
    status: 'TERMINATED',
    updatedAt: new Date('2026-10-01T00:00:00.000Z') // Terminated before November
  });

  // 9. Employee with Duplicate Attendance on same day (Nov 2)
  const userDup = await User.create({ firstName: 'Dup', lastName: 'Att', email: 'dup@example.com', password: 'password123', role: 'STAFF', isActive: true });
  const empDup = await Employee.create({
    employeeId: 'EMP_DUP',
    user: userDup._id,
    firstName: 'Dup',
    lastName: 'Attendance',
    email: 'dup@example.com',
    department: 'Telecalling',
    designation: 'Caller',
    salary: 25000,
    status: 'ACTIVE'
  });
  // 1st record: HALF_DAY
  await Attendance.create({
    employee: empDup._id,
    date: new Date('2026-11-02T09:00:00.000Z'),
    status: 'HALF_DAY',
    workMode: 'Office'
  });
  // 2nd record on same day: PRESENT (different checkIn timestamp, e.g. re-scanned)
  await Attendance.create({
    employee: empDup._id,
    date: new Date('2026-11-02T14:00:00.000Z'),
    status: 'PRESENT',
    workMode: 'Office'
  });

  // 10. Future-dated leave outside target month (December 2026)
  await Leave.create({
    employee: empZero._id,
    leaveType: 'ANNUAL',
    startDate: new Date('2026-12-05T00:00:00.000Z'),
    endDate: new Date('2026-12-10T00:00:00.000Z'),
    reason: 'December vacation',
    status: 'APPROVED'
  });

  console.log('--- TEST 1: Zero Attendance Salary Calculation ---');
  const resZero = await request(`/api/hr/payroll/employees/${empZero._id}?month=11&year=2026`, {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  assert(resZero.status === 200, 'GET /api/hr/payroll/employees/:id returns 200 OK');
  const dZero = resZero.body.data;
  assert(dZero.scheduledWorkingDays === 20, 'Tech scheduled working days = 20 (21 Mon-Fri minus 1 holiday)');
  assert(dZero.presentDays === 0, 'Zero employee has presentDays = 0');
  assert(dZero.payableDays === 1, 'Only paid holiday (1) counts towards payable days for zero-attendance staff with holiday');
  // Daily rate for ₹60,000 / 20 = ₹3,000
  assert(dZero.dailySalary === 3000, 'Daily salary is ₹3,000 (60000 / 20)');
  assert(dZero.netSalary === 3000, 'Net salary is ₹3,000 (only holiday paid)');
  assert(dZero.deductions === 57000, 'Deductions = ₹57,000 (unpaid absence)');
  assert(dZero.lopDays === 19, 'LOP days = 19 missed working days');

  console.log('\n--- TEST 2: Active Employee with ZERO Attendance and ZERO Holiday -> ₹0 Salary ---');
  // Let's test empZero in a month without holidays or with 0 payable days
  // Calculate for October 2026 where zero has 0 attendance and 0 leave:
  const resZeroOct = await request(`/api/hr/payroll/employees/${empZero._id}?month=10&year=2026`, {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  const dZeroOct = resZeroOct.body.data;
  assert(dZeroOct.presentDays === 0, 'October presentDays = 0');
  assert(dZeroOct.payableDays === 0, 'October payableDays = 0');
  assert(dZeroOct.netSalary === 0, 'Zero payable days strictly yields ₹0 net salary (Zero Attendance Bug FIXED)');
  assert(dZeroOct.deductions === 60000, 'Deductions equals full salary when 0 payable days');

  console.log('\n--- TEST 3: One Payable Day Calculation ---');
  const resOne = await request(`/api/hr/payroll/employees/${empOne._id}?month=11&year=2026`, {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  const dOne = resOne.body.data;
  assert(dOne.presentDays === 1, 'presentDays = 1');
  assert(dOne.payableDays === 2, 'payableDays = 2 (1 present day + 1 paid holiday)');
  // 60000 / 20 * 2 = 6000
  assert(dOne.netSalary === 6000, 'Net salary for 2 payable days = ₹6,000 (2 * ₹3,000)');
  assert(dOne.deductions === 54000, 'Deductions = ₹54,000');

  console.log('\n--- TEST 4: Full Payable Days Calculation ---');
  const resFull = await request(`/api/hr/payroll/employees/${empFull._id}?month=11&year=2026`, {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  const dFull = resFull.body.data;
  assert(dFull.scheduledWorkingDays === 25, 'Telecalling scheduled working days = 25 (Mon-Sat)');
  assert(dFull.presentDays === 25, 'presentDays = 25');
  assert(dFull.payableDays === 25, 'payableDays = 25');
  assert(dFull.netSalary === 25000, 'Full working days yields exact full monthly base salary ₹25,000');
  assert(dFull.deductions === 0, 'Zero deductions for full payable days');
  assert(dFull.lopDays === 0, 'Zero LOP days');

  console.log('\n--- TEST 5: HALF_DAY Attendance (0.5 Day Contribution) ---');
  const resHalf = await request(`/api/hr/payroll/employees/${empHalf._id}?month=11&year=2026`, {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  const dHalf = resHalf.body.data;
  assert(dHalf.halfDays === 2, 'halfDays count = 2');
  assert(dHalf.presentDays === 1, 'presentDays = 1.0 (2 * 0.5)');
  assert(dHalf.payableDays === 2, 'payableDays = 2.0 (1.0 present + 1.0 paid holiday)');
  assert(dHalf.netSalary === 6000, 'Net salary for 2 payable days = ₹6,000');

  console.log('\n--- TEST 6: Work From Home (WFH) Attendance Tracking ---');
  const resWfh = await request(`/api/hr/payroll/employees/${empWfh._id}?month=11&year=2026`, {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  const dWfh = resWfh.body.data;
  assert(dWfh.wfhDays === 2, 'wfhDays tracked separately = 2.0');
  assert(dWfh.presentDays === 1, 'presentDays in office = 1.0');
  assert(dWfh.payableDays === 4, 'payableDays = 4.0 (2 WFH + 1 office + 1 holiday)');
  assert(dWfh.netSalary === 12000, 'Net salary = ₹12,000 (4 * ₹3,000)');

  console.log('\n--- TEST 7: Paid Leave Allowance & Unpaid Leave Breakdown ---');
  const resLeave = await request(`/api/hr/payroll/employees/${empLeave._id}?month=11&year=2026`, {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  const dLeave = resLeave.body.data;
  assert(dLeave.approvedPaidLeaveDays === 1, 'approvedPaidLeaveDays = 1 (capped at allowance = 1)');
  assert(dLeave.approvedUnpaidLeaveDays === 3, 'approvedUnpaidLeaveDays = 3 (2 excess casual + 1 unpaid type)');
  assert(dLeave.payableDays === 2, 'payableDays = 2 (1 paid leave + 1 paid holiday)');
  assert(dLeave.netSalary === 6000, 'Net salary = ₹6,000 (2 * ₹3,000)');

  console.log('\n--- TEST 8: Attendance + Approved Leave Conflict (PAYROLL_CONFLICT) ---');
  const resConflict = await request(`/api/hr/payroll/employees/${empConflict._id}?month=11&year=2026`, {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  const dConflict = resConflict.body.data;
  assert(dConflict.unresolvedConflictCount === 1, 'unresolvedConflictCount = 1 (detected on Nov 6)');
  assert(dConflict.hasUnresolvedConflicts === true, 'hasUnresolvedConflicts is true');
  assert(dConflict.presentDays === 0, 'Unresolved conflict date is NOT counted as present');
  assert(dConflict.approvedPaidLeaveDays === 0, 'Unresolved conflict date is NOT counted as leave');
  assert(dConflict.conflicts.length === 1, 'Conflict details returned in payload');
  assert(dConflict.conflicts[0].date === '2026-11-06', 'Conflict dateKey is 2026-11-06');
  assert(dConflict.conflicts[0].status === 'UNRESOLVED', 'Conflict status is UNRESOLVED');

  const conflictId = dConflict.conflicts[0].conflictId;

  console.log('\n--- TEST 9: HR Conflicts Listing API ---');
  const resConflictList = await request('/api/hr/payroll/conflicts?month=11&year=2026', {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  assert(resConflictList.status === 200, 'GET /api/hr/payroll/conflicts returns 200 OK');
  assert(Array.isArray(resConflictList.body.data), 'Conflicts returned as array');
  assert(resConflictList.body.data.length >= 1, 'At least 1 conflict listed');
  assert(resConflictList.body.pagination.unresolvedTotal >= 1, 'unresolvedTotal reported in pagination');

  console.log('\n--- TEST 10: HR Conflict Resolution API ---');
  // HR resolves conflict: Count as PRESENT
  const resResolve = await request(`/api/hr/payroll/conflicts/${conflictId}/resolve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: {
      decision: 'PRESENT',
      reason: 'Employee was physically present in office and worked full shift'
    }
  });
  assert(resResolve.status === 200, 'POST /api/hr/payroll/conflicts/:id/resolve returns 200 OK');
  assert(resResolve.body.data.status === 'RESOLVED', 'Conflict status updated to RESOLVED');
  assert(resResolve.body.data.resolution.decision === 'PRESENT', 'Resolution decision recorded as PRESENT');
  assert(resResolve.body.data.auditHistory.length >= 1, 'Audit history recorded with HR action');

  console.log('\n--- TEST 11: Payroll Re-calculation with Resolved Conflict ---');
  const resPostResolve = await request(`/api/hr/payroll/employees/${empConflict._id}?month=11&year=2026`, {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  const dPostResolve = resPostResolve.body.data;
  assert(dPostResolve.unresolvedConflictCount === 0, 'unresolvedConflictCount is now 0');
  assert(dPostResolve.hasUnresolvedConflicts === false, 'hasUnresolvedConflicts is now false');
  assert(dPostResolve.presentDays === 1, 'Nov 6 now credited as 1 present day per HR resolution');
  assert(dPostResolve.approvedLeaves === 0, 'Nov 6 leave removed from approvedLeaves count when resolved as PRESENT');
  assert(dPostResolve.payableDays === 2, 'payableDays = 2 (1 present + 1 holiday)');
  assert(dPostResolve.netSalary === 6000, 'Net salary updated to ₹6,000');

  console.log('\n--- TEST 12: Duplicate Attendance Deduplication ---');
  const resDup = await request(`/api/hr/payroll/employees/${empDup._id}?month=11&year=2026`, {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  const dDup = resDup.body.data;
  assert(dDup.presentDays === 1, 'Duplicate check-ins on Nov 2 deduplicated to exactly 1 present day');
  assert(dDup.halfDays === 0, 'Higher status PRESENT superseded HALF_DAY without duplicate count');

  console.log('\n--- TEST 13: Resigned vs Terminated Employee Filtering ---');
  const resEmpList = await request('/api/hr/payroll/employees?month=11&year=2026', {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  assert(resEmpList.status === 200, 'GET /api/hr/payroll/employees returns 200 OK');
  const employeeRecords = resEmpList.body.data;
  const foundResigned = employeeRecords.some(r => r.employee.employeeId === 'EMP_RESIGNED');
  const foundOldTerminated = employeeRecords.some(r => r.employee.employeeId === 'EMP_TERM_OLD');
  assert(foundResigned === true, 'Resigned staff in November is included in November payroll roster');
  assert(foundOldTerminated === false, 'Employee terminated prior to November is properly excluded');

  console.log('\n--- TEST 14: Payroll Summary & Itemized Consistency ---');
  const resSummary = await request('/api/hr/payroll/summary?month=11&year=2026', {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  assert(resSummary.status === 200, 'GET /api/hr/payroll/summary returns 200 OK');
  const summary = resSummary.body.data;
  assert(summary.totalEmployees === employeeRecords.length, 'Summary totalEmployees matches itemized count');

  let sumGross = 0;
  let sumNet = 0;
  let sumDeductions = 0;
  for (const rec of employeeRecords) {
    sumGross += rec.monthlyBaseSalary;
    sumNet += rec.netSalary;
    sumDeductions += rec.deductions;
  }
  sumGross = Math.round(sumGross * 100) / 100;
  sumNet = Math.round(sumNet * 100) / 100;
  sumDeductions = Math.round(sumDeductions * 100) / 100;

  assert(summary.totalMonthlyBaseSalary === sumGross, 'Summary base salary matches sum of employee base salaries');
  assert(summary.totalNetPayout === sumNet, 'Summary net payout matches sum of employee net payouts');
  assert(summary.totalDeductions === sumDeductions, 'Summary deductions match sum of employee deductions');

  console.log('\n--- TEST 15: Future-Dated Leave Isolation ---');
  // empZero has a December leave, check that it did not contaminate November:
  assert(dZero.approvedLeaves === 0, 'December leave does not appear in November approvedLeaves count');

  console.log('\n--- TEST 16: Multi-Conflict Reconciliation (PRESENT, PAID_LEAVE, UNPAID_LEAVE) ---');
  // Replicating Rahul K scenario:
  // 1 clean attendance day (Nov 5)
  // 3 conflicting dates (Nov 6, Nov 9, Nov 10) with both attendance and approved sick leave
  const userMulti = await User.create({ firstName: 'RahulTest', lastName: 'Multi', email: 'rahultest@example.com', password: 'password123', role: 'STAFF', isActive: true });
  const empMulti = await Employee.create({
    employeeId: 'EMP_RAHUL_TEST',
    user: userMulti._id,
    firstName: 'RahulTest',
    lastName: 'Multi',
    email: 'rahultest@example.com',
    department: 'Tech',
    designation: 'Software Engineer',
    salary: 22000,
    paidLeaveAllowance: 1,
    status: 'ACTIVE'
  });

  // Nov 5: Clean attendance (Office, PRESENT)
  await Attendance.create({
    employee: empMulti._id,
    date: new Date('2026-11-05T00:00:00.000Z'),
    status: 'PRESENT',
    workMode: 'Office'
  });

  // Nov 6: Attendance + Approved Leave
  await Attendance.create({
    employee: empMulti._id,
    date: new Date('2026-11-06T00:00:00.000Z'),
    status: 'PRESENT',
    workMode: 'Office'
  });
  await Leave.create({
    employee: empMulti._id,
    leaveType: 'SICK',
    startDate: new Date('2026-11-06T00:00:00.000Z'),
    endDate: new Date('2026-11-06T00:00:00.000Z'),
    reason: 'Vomiting',
    status: 'APPROVED'
  });

  // Nov 9: Attendance + Approved Leave
  await Attendance.create({
    employee: empMulti._id,
    date: new Date('2026-11-09T00:00:00.000Z'),
    status: 'PRESENT',
    workMode: 'Office'
  });
  await Leave.create({
    employee: empMulti._id,
    leaveType: 'SICK',
    startDate: new Date('2026-11-09T00:00:00.000Z'),
    endDate: new Date('2026-11-09T00:00:00.000Z'),
    reason: 'Vomiting',
    status: 'APPROVED'
  });

  // Nov 10: Attendance + Approved Leave
  await Attendance.create({
    employee: empMulti._id,
    date: new Date('2026-11-10T00:00:00.000Z'),
    status: 'PRESENT',
    workMode: 'Office'
  });
  await Leave.create({
    employee: empMulti._id,
    leaveType: 'SICK',
    startDate: new Date('2026-11-10T00:00:00.000Z'),
    endDate: new Date('2026-11-10T00:00:00.000Z'),
    reason: 'Family emergency',
    status: 'APPROVED'
  });

  // Step 1: Initial payroll check - 3 unresolved conflicts
  const resMultiPre = await request(`/api/hr/payroll/employees/${empMulti._id}?month=11&year=2026`, {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  assert(resMultiPre.status === 200, 'Initial payroll calculation for multi-conflict returns 200');
  const dMultiPre = resMultiPre.body.data;
  assert(dMultiPre.unresolvedConflictCount === 3, 'Pre-resolution: 3 unresolved conflicts detected');
  assert(dMultiPre.hasUnresolvedConflicts === true, 'Pre-resolution: hasUnresolvedConflicts is true');
  assert(dMultiPre.presentDays === 1, 'Pre-resolution: Only Nov 5 clean attendance counted (presentDays = 1)');
  assert(dMultiPre.approvedLeaves === 3, 'Pre-resolution: All 3 approved leave requests recorded');
  assert(dMultiPre.approvedPaidLeaveDays === 0, 'Pre-resolution: Conflicted leaves do not consume paid allowance');
  assert(dMultiPre.approvedUnpaidLeaveDays === 0, 'Pre-resolution: Conflicted leaves do not count as unpaid yet');

  // Step 2: HR resolves all 3 conflicts:
  // Nov 6 -> PRESENT
  // Nov 9 -> PAID_LEAVE
  // Nov 10 -> UNPAID_LEAVE
  const conflictNov6 = dMultiPre.conflicts.find(c => c.date === '2026-11-06');
  const conflictNov9 = dMultiPre.conflicts.find(c => c.date === '2026-11-09');
  const conflictNov10 = dMultiPre.conflicts.find(c => c.date === '2026-11-10');

  const resRes6 = await request(`/api/hr/payroll/conflicts/${conflictNov6.conflictId}/resolve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: { decision: 'PRESENT', reason: 'Physically present and worked' }
  });
  assert(resRes6.status === 200, 'Conflict Nov 6 resolved as PRESENT');

  const resRes9 = await request(`/api/hr/payroll/conflicts/${conflictNov9.conflictId}/resolve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: { decision: 'PAID_LEAVE', reason: 'Approved paid medical leave' }
  });
  assert(resRes9.status === 200, 'Conflict Nov 9 resolved as PAID_LEAVE');

  const resRes10 = await request(`/api/hr/payroll/conflicts/${conflictNov10.conflictId}/resolve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hrToken}` },
    body: { decision: 'UNPAID_LEAVE', reason: 'Approved unpaid leave' }
  });
  assert(resRes10.status === 200, 'Conflict Nov 10 resolved as UNPAID_LEAVE');

  // Step 3: Post-resolution payroll recalculation
  const resMultiPost = await request(`/api/hr/payroll/employees/${empMulti._id}?month=11&year=2026`, {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  const dMultiPost = resMultiPost.body.data;
  assert(dMultiPost.unresolvedConflictCount === 0, 'Post-resolution: unresolvedConflictCount is 0');
  assert(dMultiPost.hasUnresolvedConflicts === false, 'Post-resolution: hasUnresolvedConflicts is false');
  assert(dMultiPost.presentDays === 2, 'Post-resolution: presentDays = 2 (1 clean Nov 5 + 1 resolved PRESENT on Nov 6)');
  assert(dMultiPost.approvedLeaves === 2, 'Post-resolution: Remaining approvedLeaves = 2 (Nov 6 removed; Nov 9 + Nov 10 remain)');
  assert(dMultiPost.approvedPaidLeaveDays === 1, 'Post-resolution: approvedPaidLeaveDays = 1 (Nov 9 consumed 1-day allowance)');
  assert(dMultiPost.approvedUnpaidLeaveDays === 1, 'Post-resolution: approvedUnpaidLeaveDays = 1 (Nov 10 unpaid)');
  assert(dMultiPost.paidLeaveDays === 1, 'Post-resolution: paidLeaveDays = 1');
  assert(dMultiPost.unpaidLeaveDays === 1, 'Post-resolution: unpaidLeaveDays = 1');
  assert(dMultiPost.payableDays === 4, 'Post-resolution: payableDays = 4 (2 present + 1 paid leave + 1 holiday)');
  assert(dMultiPost.dailySalary === 1100, 'Post-resolution: dailySalary = ₹1,100 (22000 / 20)');
  assert(dMultiPost.netSalary === 4400, 'Post-resolution: netSalary = ₹4,400 (4 payable * 1100)');
  assert(dMultiPost.deductions === 17600, 'Post-resolution: deductions = ₹17,600');

  console.log('\n--- TEST 17: Scenario A - Half-Day Attendance + Approved Half-Day Leave ---');
  const userA = await User.create({ firstName: 'UserA', lastName: 'HalfAttHalfLeave', email: 'userA@example.com', password: 'password123', role: 'STAFF', isActive: true });
  const empA = await Employee.create({
    employeeId: 'EMP_SCENARIO_A',
    user: userA._id,
    firstName: 'UserA',
    lastName: 'ScenarioA',
    email: 'userA@example.com',
    department: 'Tech',
    designation: 'Developer',
    salary: 60000,
    paidLeaveAllowance: 1,
    status: 'ACTIVE'
  });
  await Attendance.create({
    employee: empA._id,
    date: new Date('2026-11-23T00:00:00.000Z'),
    status: 'HALF_DAY',
    workMode: 'Office'
  });
  await Leave.create({
    employee: empA._id,
    leaveType: 'CASUAL',
    durationType: 'HALF_DAY',
    totalDays: 0.5,
    startDate: new Date('2026-11-23T00:00:00.000Z'),
    endDate: new Date('2026-11-23T00:00:00.000Z'),
    reason: 'Personal afternoon leave',
    status: 'APPROVED'
  });
  const resA = await request(`/api/hr/payroll/employees/${empA._id}?month=11&year=2026`, {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  const dA = resA.body.data;
  assert(dA.unresolvedConflictCount === 0, 'Scenario A: Complementary half-attendance + half-leave is NOT a conflict');
  assert(dA.presentDays === 0.5, 'Scenario A: presentDays = 0.5');
  assert(dA.approvedLeaves === 0.5, 'Scenario A: approvedLeaves = 0.5');
  assert(dA.approvedPaidLeaveDays === 0.5, 'Scenario A: approvedPaidLeaveDays = 0.5');
  assert(dA.payableDays === 2.0, 'Scenario A: payableDays = 2.0 (0.5 present + 0.5 paid leave + 1 holiday)');
  assert(dA.netSalary === 6000, 'Scenario A: netSalary = ₹6,000 (2.0 * ₹3,000)');

  console.log('\n--- TEST 18: Scenario B - Approved Half-Day Leave WITHOUT Attendance ---');
  const userB = await User.create({ firstName: 'UserB', lastName: 'HalfLeaveNoAtt', email: 'userB@example.com', password: 'password123', role: 'STAFF', isActive: true });
  const empB = await Employee.create({
    employeeId: 'EMP_SCENARIO_B',
    user: userB._id,
    firstName: 'UserB',
    lastName: 'ScenarioB',
    email: 'userB@example.com',
    department: 'Tech',
    designation: 'Developer',
    salary: 60000,
    paidLeaveAllowance: 1,
    status: 'ACTIVE'
  });
  await Leave.create({
    employee: empB._id,
    leaveType: 'CASUAL',
    durationType: 'HALF_DAY',
    totalDays: 0.5,
    startDate: new Date('2026-11-24T00:00:00.000Z'),
    endDate: new Date('2026-11-24T00:00:00.000Z'),
    reason: 'Doctor appointment',
    status: 'APPROVED'
  });
  const resB = await request(`/api/hr/payroll/employees/${empB._id}?month=11&year=2026`, {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  const dB = resB.body.data;
  assert(dB.presentDays === 0, 'Scenario B: Zero attendance evidence strictly yields presentDays = 0');
  assert(dB.approvedLeaves === 0.5, 'Scenario B: approvedLeaves = 0.5');
  assert(dB.approvedPaidLeaveDays === 0.5, 'Scenario B: approvedPaidLeaveDays = 0.5');
  assert(dB.payableDays === 1.5, 'Scenario B: payableDays = 1.5 (0.5 paid leave + 1 holiday)');
  assert(dB.lopDays === 18.5, 'Scenario B: lopDays = 18.5 (unworked half day is 0.5 LOP)');
  assert(dB.netSalary === 4500, 'Scenario B: netSalary = ₹4,500 (1.5 * ₹3,000)');

  console.log('\n--- TEST 19: Scenario C - Half-Day Attendance WITHOUT Leave ---');
  const userC = await User.create({ firstName: 'UserC', lastName: 'HalfAttNoLeave', email: 'userC@example.com', password: 'password123', role: 'STAFF', isActive: true });
  const empC = await Employee.create({
    employeeId: 'EMP_SCENARIO_C',
    user: userC._id,
    firstName: 'UserC',
    lastName: 'ScenarioC',
    email: 'userC@example.com',
    department: 'Tech',
    designation: 'Developer',
    salary: 60000,
    paidLeaveAllowance: 1,
    status: 'ACTIVE'
  });
  await Attendance.create({
    employee: empC._id,
    date: new Date('2026-11-25T00:00:00.000Z'),
    status: 'HALF_DAY',
    workMode: 'Office'
  });
  const resC = await request(`/api/hr/payroll/employees/${empC._id}?month=11&year=2026`, {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  const dC = resC.body.data;
  assert(dC.presentDays === 0.5, 'Scenario C: presentDays = 0.5');
  assert(dC.approvedLeaves === 0, 'Scenario C: approvedLeaves = 0');
  assert(dC.approvedPaidLeaveDays === 0, 'Scenario C: No automatic paid leave added (approvedPaidLeaveDays = 0)');
  assert(dC.payableDays === 1.5, 'Scenario C: payableDays = 1.5 (0.5 present + 1 holiday)');
  assert(dC.lopDays === 18.5, 'Scenario C: lopDays = 18.5 (remaining half day is LOP)');
  assert(dC.netSalary === 4500, 'Scenario C: netSalary = ₹4,500 (1.5 * ₹3,000)');

  console.log('\n--- TEST 20: Scenario G & Chronological Paid Leave Allocation ---');
  const userG = await User.create({ firstName: 'UserG', lastName: 'MultiHalfLeaves', email: 'userG@example.com', password: 'password123', role: 'STAFF', isActive: true });
  const empG = await Employee.create({
    employeeId: 'EMP_SCENARIO_G',
    user: userG._id,
    firstName: 'UserG',
    lastName: 'ScenarioG',
    email: 'userG@example.com',
    department: 'Tech',
    designation: 'Developer',
    salary: 60000,
    paidLeaveAllowance: 1,
    status: 'ACTIVE'
  });
  // 3 half-day approved leaves: Nov 16, Nov 17, Nov 18
  await Leave.create({
    employee: empG._id,
    leaveType: 'CASUAL',
    durationType: 'HALF_DAY',
    totalDays: 0.5,
    startDate: new Date('2026-11-16T00:00:00.000Z'),
    endDate: new Date('2026-11-16T00:00:00.000Z'),
    reason: 'Personal 1',
    status: 'APPROVED'
  });
  await Leave.create({
    employee: empG._id,
    leaveType: 'CASUAL',
    durationType: 'HALF_DAY',
    totalDays: 0.5,
    startDate: new Date('2026-11-17T00:00:00.000Z'),
    endDate: new Date('2026-11-17T00:00:00.000Z'),
    reason: 'Personal 2',
    status: 'APPROVED'
  });
  await Leave.create({
    employee: empG._id,
    leaveType: 'CASUAL',
    durationType: 'HALF_DAY',
    totalDays: 0.5,
    startDate: new Date('2026-11-18T00:00:00.000Z'),
    endDate: new Date('2026-11-18T00:00:00.000Z'),
    reason: 'Personal 3',
    status: 'APPROVED'
  });
  const resG = await request(`/api/hr/payroll/employees/${empG._id}?month=11&year=2026`, {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  const dG = resG.body.data;
  assert(dG.presentDays === 0, 'Scenario G: presentDays = 0');
  assert(dG.approvedLeaves === 1.5, 'Scenario G: approvedLeaves = 1.5');
  assert(dG.approvedPaidLeaveDays === 1.0, 'Scenario G: First two 0.5-day leaves consume exactly 1.0 paid leave allowance');
  assert(dG.approvedUnpaidLeaveDays === 0.5, 'Scenario G: Third 0.5-day leave is unpaid (0.5 unpaid)');
  assert(dG.payableDays === 2.0, 'Scenario G: payableDays = 2.0 (1.0 paid leave + 1 holiday)');
  assert(dG.lopDays === 18, 'Scenario G: lopDays = 18');
  assert(dG.netSalary === 6000, 'Scenario G: netSalary = ₹6,000 (2.0 * ₹3,000)');

  console.log('\n--- TEST 21: Scenario F - Full-Day Attendance Conflicting with Half-Day Leave ---');
  const userF = await User.create({ firstName: 'UserF', lastName: 'ConflictHalf', email: 'userF@example.com', password: 'password123', role: 'STAFF', isActive: true });
  const empF = await Employee.create({
    employeeId: 'EMP_SCENARIO_F',
    user: userF._id,
    firstName: 'UserF',
    lastName: 'ScenarioF',
    email: 'userF@example.com',
    department: 'Tech',
    designation: 'Developer',
    salary: 60000,
    paidLeaveAllowance: 1,
    status: 'ACTIVE'
  });
  await Attendance.create({
    employee: empF._id,
    date: new Date('2026-11-26T00:00:00.000Z'),
    status: 'PRESENT',
    workMode: 'Office'
  });
  await Leave.create({
    employee: empF._id,
    leaveType: 'CASUAL',
    durationType: 'HALF_DAY',
    totalDays: 0.5,
    startDate: new Date('2026-11-26T00:00:00.000Z'),
    endDate: new Date('2026-11-26T00:00:00.000Z'),
    reason: 'Conflicting leave',
    status: 'APPROVED'
  });
  const resF = await request(`/api/hr/payroll/employees/${empF._id}?month=11&year=2026`, {
    headers: { Authorization: `Bearer ${hrToken}` }
  });
  const dF = resF.body.data;
  assert(dF.unresolvedConflictCount === 1, 'Scenario F: Full-day attendance + half-day leave triggers conflict');
  assert(dF.hasUnresolvedConflicts === true, 'Scenario F: hasUnresolvedConflicts = true');
  assert(dF.presentDays === 0, 'Scenario F: Neither attendance nor leave counted while unresolved (no double counting)');
  assert(dF.approvedPaidLeaveDays === 0, 'Scenario F: Conflicted leave does not consume paid allowance');

  console.log('\n================================================================');
  console.log('   ALL 21 ATTENDANCE-BASED PAYROLL VERIFICATIONS PASSED!       ');
  console.log('================================================================\n');

  await mongoose.disconnect();
  server.close();
  process.exit(0);
}

runTests().catch(async (err) => {
  console.error('\nVerification failed:', err);
  if (server) server.close();
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  process.exit(1);
});
