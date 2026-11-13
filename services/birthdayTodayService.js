const Employee = require('../models/Employee');
const env = require('../config/env');

const isLeapYear = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

function getDateParts(date, timeZone = env.birthdayTimeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function isBirthdayToday(dateOfBirth, today) {
  if (!dateOfBirth) return false;
  const dob = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return false;

  const dobMonth = dob.getUTCMonth() + 1;
  const dobDay = dob.getUTCDate();
  const celebratedMonth = dobMonth;
  const celebratedDay = dobMonth === 2 && dobDay === 29 && !isLeapYear(today.year) ? 28 : dobDay;
  return today.month === celebratedMonth && today.day === celebratedDay;
}

async function getTodaysBirthdays({ now = new Date(), timeZone = env.birthdayTimeZone } = {}) {
  // Validate the configured IANA timezone explicitly; Intl throws for invalid values.
  const today = getDateParts(now, timeZone);
  const employees = await Employee.find({
    status: { $in: ['ACTIVE', 'ON_LEAVE'] },
    isDeleted: { $ne: true },
    dateOfBirth: { $ne: null }
  }).select('firstName lastName department designation profileImage employeeId dateOfBirth').lean();

  const birthdays = employees
    .filter((employee) => isBirthdayToday(employee.dateOfBirth, today))
    .map((employee) => ({
      id: employee._id.toString(),
      employeeId: employee.employeeId || '',
      name: `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
      department: employee.department || 'Unassigned',
      designation: employee.designation || '',
      profileImage: employee.profileImage || null
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const date = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
  return { date, timeZone, birthdays, total: birthdays.length };
}

module.exports = { getTodaysBirthdays, getDateParts, isBirthdayToday, isLeapYear };
