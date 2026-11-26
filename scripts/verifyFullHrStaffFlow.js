/**
 * End-to-end check of the real HR -> Staff flow against a fresh MongoDB database:
 *   seed Super Admin + HR -> HR login -> HR creates staff (email + password)
 *   -> staff login -> check-in / break / check-out -> daily update -> leave
 *   -> HR sees everything (employees, attendance, daily updates, leaves) -> HR approves leave
 *   -> staff changes password -> old token revoked -> new password works.
 *
 * Usage (local MongoDB on 127.0.0.1:27017 required):
 *   node scripts/verifyFullHrStaffFlow.js
 * Uses its own database "hr_management_e2e" and drops it first. Never touches hr_management.
 */
process.env.NODE_ENV = 'test';
const E2E_URI = process.env.E2E_MONGODB_URI || 'mongodb://127.0.0.1:27017/hr_management_e2e';
const parsed = new URL(E2E_URI);
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.pathname.endsWith('_e2e')) {
  throw new Error('Refusing to run: E2E database must be local and end with "_e2e".');
}
process.env.MONGODB_URI = E2E_URI;
process.env.SEED_SUPER_ADMIN_EMAIL = 'owner.admin@gmail.com';
process.env.SEED_SUPER_ADMIN_PASSWORD = 'OwnerPass2026';
process.env.SEED_ADMIN_EMAIL = 'hr.manager@gmail.com';
process.env.SEED_ADMIN_PASSWORD = 'HrManager2026';

const http = require('http');
const mongoose = require('mongoose');
const { execFileSync } = require('child_process');
const path = require('path');

let passed = 0;
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  [PASS] ${name}`); } else { failed++; console.log(`  [FAIL] ${name} ${detail}`); }
};

(async () => {
  // 1. Fresh database + seed scripts exactly as the user runs them
  await mongoose.connect(E2E_URI);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  const seedEnv = { ...process.env, NODE_ENV: 'development' };
  for (const script of ['seedSuperAdmin.js', 'seedAdmin.js', 'correctDepartmentSchedules.js']) {
    execFileSync('node', [path.join(__dirname, script)], { env: seedEnv, stdio: 'pipe' });
  }
  console.log('Seeded Super Admin, HR and department schedules into a fresh database.\n');

  const { connectDB } = require('../config/db');
  await connectDB(E2E_URI);
  const { app } = require('../server');
  const server = app.listen(0);
  const port = server.address().port;

  const call = (method, url, body, token) => new Promise((resolve) => {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const req = http.request({ port, path: url, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) { /* non-JSON */ }
        resolve({ code: res.statusCode, body: json });
      });
    });
    req.end(body ? JSON.stringify(body) : undefined);
  });
  const msg = (r) => `(${r.code} ${r.body?.message || ''} ${r.body?.errors ? JSON.stringify(r.body.errors) : ''})`;

  console.log('--- Admin logins ---');
  let r;
  r = await call('GET', '/api/health');
  check('Health: database ready', r.code === 200 && r.body.database.ready, msg(r));
  r = await call('POST', '/api/auth/login', { email: 'owner.admin@gmail.com', password: 'OwnerPass2026' });
  check('Super Admin login', r.code === 200, msg(r));
  const superToken = r.body?.data?.accessToken;
  r = await call('POST', '/api/auth/login', { email: 'HR.Manager@gmail.com ', password: 'HrManager2026' });
  check('HR login (mixed case + space, dotted Gmail)', r.code === 200, msg(r));
  const hrToken = r.body?.data?.accessToken;
  r = await call('GET', '/api/hr/dashboard', null, hrToken);
  check('HR dashboard loads', r.code === 200, msg(r));
  r = await call('GET', '/api/hr/dashboard', null, superToken);
  check('Super Admin can open HR dashboard', r.code === 200, msg(r));

  console.log('\n--- HR creates staff ---');
  r = await call('POST', '/api/hr/employees', {
    fullName: 'Ravi Kumar', email: 'ravi.kumar@gmail.com', department: 'Tech', designation: 'Developer',
    gender: 'Male', employmentType: 'Full Time', status: 'Active'
  }, hrToken);
  check('Create staff WITHOUT password is rejected', r.code === 422 || r.code === 400, msg(r));
  r = await call('POST', '/api/hr/employees', {
    fullName: 'Ravi Kumar', email: 'Ravi.Kumar@gmail.com', password: 'RaviPass2026', phone: '9876543210',
    department: 'Tech', designation: 'Developer', gender: 'Male', employmentType: 'Full Time',
    status: 'Active', salary: 30000, dateOfBirth: '1998-05-10'
  }, hrToken);
  check('HR creates staff with email + password (fullName, "Male", "Full Time")', r.code === 201, msg(r));
  const staffEmployeeId = r.body?.data?._id;
  check('Staff email saved exactly (dots kept)', r.body?.data?.email === 'ravi.kumar@gmail.com', r.body?.data?.email);
  r = await call('POST', '/api/hr/employees', {
    name: 'Priya S', email: 'priya.s@gmail.com', password: 'PriyaPass2026', department: 'Telecalling', designation: 'Executive'
  }, hrToken);
  check('HR creates second staff (Telecalling)', r.code === 201, msg(r));
  r = await call('POST', '/api/hr/employees', {
    name: 'Dup', email: 'ravi.kumar@gmail.com', password: 'Another2026', department: 'Tech', designation: 'Dev'
  }, hrToken);
  check('Duplicate staff email rejected', r.code === 409, msg(r));
  r = await call('GET', '/api/hr/employees', null, hrToken);
  const list = r.body?.data || [];
  check('Employee list shows new staff', r.code === 200 && JSON.stringify(list).includes('ravi.kumar@gmail.com'), msg(r));

  console.log('\n--- Staff login + daily work ---');
  r = await call('POST', '/api/auth/login', { email: 'ravi.kumar@gmail.com', password: 'WrongPass1' });
  check('Staff wrong password -> 401', r.code === 401, msg(r));
  r = await call('POST', '/api/auth/login', { email: 'ravi.kumar@gmail.com', password: 'RaviPass2026', workMode: 'OFFICE' });
  check('Staff login with HR-given password', r.code === 200, msg(r));
  let staffToken = r.body?.data?.accessToken;
  r = await call('GET', '/api/staff/profile', null, staffToken);
  check('Staff profile loads', r.code === 200, msg(r));
  r = await call('POST', '/api/hr/employees', { name: 'x' }, staffToken);
  check('Staff cannot call HR APIs (403)', r.code === 403, msg(r));
  r = await call('POST', '/api/staff/attendance/check-in', { remarks: 'Morning' }, staffToken);
  check('Check-in saved', r.code === 200 || r.code === 201, msg(r));
  r = await call('POST', '/api/staff/attendance/break-start', { breakType: 'Lunch' }, staffToken);
  check('Break start saved', r.code === 200 || r.code === 201, msg(r));
  r = await call('POST', '/api/staff/attendance/break-end', {}, staffToken);
  check('Break end saved', r.code === 200 || r.code === 201, msg(r));
  r = await call('POST', '/api/staff/attendance/check-out', { remarks: 'Done' }, staffToken);
  check('Check-out saved', r.code === 200 || r.code === 201, msg(r));
  r = await call('GET', '/api/staff/attendance', null, staffToken);
  check('Staff sees own attendance', r.code === 200, msg(r));
  r = await call('POST', '/api/staff/daily-updates', {
    title: 'API work', updateText: 'Built login and attendance screens', tasksCompleted: ['Login', 'Attendance'], hoursWorked: 8
  }, staffToken);
  check('Daily update saved', r.code === 200 || r.code === 201, msg(r));
  const today = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  r = await call('POST', '/api/staff/leaves', { leaveType: 'Casual', startDate: today, endDate: today, reason: 'Family function' }, staffToken);
  check('Leave applied', r.code === 200 || r.code === 201, msg(r));
  const leaveId = r.body?.data?._id || r.body?.data?.id || r.body?.data?.leave?._id;

  console.log('\n--- HR sees staff data (saved in DB) ---');
  r = await call('GET', '/api/hr/attendance', null, hrToken);
  check('HR attendance list includes staff check-in', r.code === 200 && JSON.stringify(r.body).includes('Ravi'), msg(r));
  r = await call('GET', '/api/hr/daily-updates', null, hrToken);
  check('HR sees staff daily update', r.code === 200 && JSON.stringify(r.body).includes('attendance screens'), msg(r));
  r = await call('GET', '/api/hr/leaves', null, hrToken);
  check('HR sees leave request', r.code === 200 && JSON.stringify(r.body).includes('Family function'), msg(r));
  if (leaveId) {
    r = await call('PUT', `/api/hr/leaves/${leaveId}/approve`, {}, hrToken);
    check('HR approves leave', r.code === 200, msg(r));
  } else {
    check('Leave id returned to approve', false);
  }
  r = await call('GET', `/api/hr/employees/${staffEmployeeId}/login-history`, null, hrToken);
  check('HR sees staff login history', r.code === 200, msg(r));

  // Persistence check directly in MongoDB
  const db = mongoose.connection.db;
  const counts = {};
  for (const c of ['users', 'employees', 'attendances', 'dailyupdates', 'leaves', 'staffloginhistories']) {
    counts[c] = await db.collection(c).countDocuments();
  }
  console.log('  DB documents:', JSON.stringify(counts));
  check('Everything persisted in MongoDB', counts.users >= 4 && counts.employees >= 4 && counts.attendances >= 1 &&
    counts.dailyupdates >= 1 && counts.leaves >= 1 && counts.staffloginhistories >= 1);

  console.log('\n--- Staff password change ---');
  r = await call('POST', '/api/auth/change-password', { currentPassword: 'RaviPass2026', newPassword: 'Ravi#NewSecure2026' }, staffToken);
  check('Staff changes password (with current password)', r.code === 200, msg(r));
  r = await call('GET', '/api/staff/profile', null, staffToken);
  check('Old token revoked after password change', r.code === 401, msg(r));
  r = await call('POST', '/api/auth/login', { email: 'ravi.kumar@gmail.com', password: 'Ravi#NewSecure2026' });
  check('Login with new password', r.code === 200, msg(r));

  console.log('\n--- HR deactivates staff ---');
  r = await call('POST', `/api/hr/employees/${staffEmployeeId}/deactivate`, { reason: 'Test' }, hrToken);
  check('HR deactivates staff', r.code === 200, msg(r));
  r = await call('POST', '/api/auth/login', { email: 'ravi.kumar@gmail.com', password: 'Ravi#NewSecure2026' });
  check('Deactivated staff cannot log in (403)', r.code === 403, msg(r));

  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(async (err) => {
  console.error('E2E crashed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
