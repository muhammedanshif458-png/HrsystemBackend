process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'dedicated-birthday-test-secret-at-least-32-chars';
process.env.JWT_REFRESH_SECRET = 'dedicated-birthday-refresh-test-secret-at-least-32-chars';

const assert = require('assert');
const http = require('http');
const mongoose = require('mongoose');
const { app } = require('../server');
const { connectTestDatabase } = require('./testDatabase');
const User = require('../models/User');
const Employee = require('../models/Employee');
const { generateAccessToken } = require('../utils/jwt');
const { getDateParts, isBirthdayToday, getTodaysBirthdays } = require('../services/birthdayTodayService');
const env = require('../config/env');

const request = (server, method, path, token) => new Promise((resolve, reject) => {
  const req = http.request({ hostname: '127.0.0.1', port: server.address().port, method, path,
    headers: token ? { Authorization: `Bearer ${token}` } : {} }, (res) => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
  });
  req.on('error', reject);
  req.end();
});

async function run() {
  let server;
  try {
    await connectTestDatabase();
    const users = {};
    for (const role of ['STAFF', 'HR', 'SUPER_ADMIN']) {
      users[role] = await User.create({ firstName: role, lastName: 'Test', email: `${role.toLowerCase()}@birthday.com`, password: 'TestPass123!', role, isActive: true });
    }
    users.UNSUPPORTED = await User.create({ firstName: 'Unsupported', lastName: 'Test', email: 'unsupported@birthday.com', password: 'TestPass123!', role: 'STAFF', isActive: true });
    await User.updateOne({ _id: users.UNSUPPORTED._id }, { $set: { role: 'UNSUPPORTED' } });
    const now = new Date();
    const today = getDateParts(now, env.birthdayTimeZone);
    const dob = (month, day) => new Date(Date.UTC(month === 2 && day === 29 ? 1992 : 1990, month - 1, day));
    async function addEmployee(label, status, birthday, extra = {}) {
      return Employee.create({ employeeId: `BD${label.toUpperCase()}`, user: users.STAFF._id, firstName: label,
        lastName: 'Birthday', email: `${label.toLowerCase()}@employee.com`, department: 'Engineering',
        designation: 'Developer', status, dateOfBirth: birthday, user: extra.user || new mongoose.Types.ObjectId(), ...extra });
    }
    // Own birthday and two same-day colleagues are included; only allowed statuses survive.
    await addEmployee('Own', 'ACTIVE', dob(today.month, today.day), { user: users.STAFF._id });
    await addEmployee('OnLeave', 'ON_LEAVE', dob(today.month, today.day));
    await addEmployee('Second', 'ACTIVE', dob(today.month, today.day));
    await addEmployee('Inactive', 'INACTIVE', dob(today.month, today.day));
    await addEmployee('Deleted', 'ACTIVE', dob(today.month, today.day), { isDeleted: true });
    await addEmployee('NoDob', 'ACTIVE', null);

    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    assert.strictEqual((await request(server, 'GET', '/api/birthdays/today')).status, 401, 'missing JWT rejected');
    for (const role of ['STAFF', 'HR', 'SUPER_ADMIN']) {
      const result = await request(server, 'GET', '/api/birthdays/today', generateAccessToken(users[role]));
      assert.strictEqual(result.status, 200, `${role} may access shared endpoint`);
      assert.strictEqual(result.body.message, "Today's birthdays fetched successfully");
      assert.strictEqual(result.body.data.timeZone, env.birthdayTimeZone);
      assert.strictEqual(result.body.data.date, `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`);
      assert.strictEqual(result.body.data.total, result.body.data.birthdays.length);
      assert(result.body.data.birthdays.some(person => person.name === 'Own Birthday'), 'employee birthday is included regardless of which employee logs in');
      assert(result.body.data.birthdays.some(person => person.name === 'OnLeave Birthday'), 'ON_LEAVE included');
      assert(result.body.data.birthdays.some(person => person.name === 'Second Birthday'), 'multiple birthdays included');
      assert(!result.body.data.birthdays.some(person => ['Inactive Birthday', 'Deleted Birthday', 'NoDob Birthday'].includes(person.name)), 'inactive, deleted, and null DOB excluded');
      assert(!JSON.stringify(result.body.data).match(/dateOfBirth|\bage\b|phone|email/i), 'response excludes DOB, age, phone, and email');
      assert.strictEqual(result.body.data.birthdays[0].dob, undefined);
    }
    assert.strictEqual((await request(server, 'GET', '/api/birthdays/today?daysAhead=20', generateAccessToken(users.STAFF))).status, 200, 'query parameters do not expand results');
    assert.strictEqual((await request(server, 'GET', '/api/birthdays/today', generateAccessToken(users.UNSUPPORTED))).status, 403, 'unsupported role rejected');
    assert.strictEqual((await request(server, 'GET', '/api/birthdays/today', 'invalid')).status, 401, 'invalid JWT rejected');

    assert.strictEqual(isBirthdayToday(dob(2, 29), { year: 2028, month: 2, day: 29 }), true, 'Feb 29 birthday matches on leap day');
    assert.strictEqual(isBirthdayToday(dob(2, 29), { year: 2026, month: 2, day: 28 }), true, 'Feb 29 celebrated Feb 28 in non-leap year');
    assert.strictEqual(isBirthdayToday(dob(2, 29), { year: 2026, month: 3, day: 1 }), false, 'Feb 29 not celebrated March 1');
    assert.deepStrictEqual(getDateParts(new Date('2026-11-13T18:45:00.000Z'), 'Asia/Kolkata'), { year: 2026, month: 11, day: 14 }, 'timezone date-boundary case uses configured company date');
    const otherMonth = today.month === 12 ? 1 : today.month + 1;
    const noToday = await getTodaysBirthdays({ now: new Date(Date.UTC(today.year, otherMonth - 1, 1, 12)), timeZone: env.birthdayTimeZone });
    assert.deepStrictEqual(noToday.birthdays, [], 'employees with birthdays on a different date are excluded');
    await Employee.deleteMany({});
    const empty = await getTodaysBirthdays({ now, timeZone: env.birthdayTimeZone });
    assert.deepStrictEqual(empty.birthdays, [], 'empty dataset returns no birthdays');
    assert.strictEqual(empty.total, 0, 'empty dataset total is zero');
    console.log('Birthday today API tests passed.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.readyState) await mongoose.disconnect();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
