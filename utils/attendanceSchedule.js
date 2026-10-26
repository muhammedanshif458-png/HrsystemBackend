const DepartmentSchedule = require('../models/DepartmentSchedule');

const getLocalParts = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  return parts;
};

const getDateKey = (date, timeZone) => {
  const p = getLocalParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
};

const getUtcDateForKey = (key) => new Date(`${key}T00:00:00.000Z`);

const getDayBoundsForKey = (key) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Invalid attendance date; expected YYYY-MM-DD');
  const startOfDay = getUtcDateForKey(key);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { startOfDay, endOfDay };
};

const isAttendanceForCurrentWorkday = (attendance, now = new Date()) => {
  if (!attendance?.date) return false;
  const timeZone = attendance.scheduleTimeZone || 'UTC';
  return attendance.date.toISOString().slice(0, 10) === getDateKey(now, timeZone);
};

const classifyCheckIn = (checkIn, schedule) => {
  if (!schedule) return { late: false, scheduledCheckIn: null, scheduleTimeZone: null, scheduleConfigured: false };
  const local = getLocalParts(checkIn, schedule.timeZone);
  const actualMinutes = Number(local.hour) * 60 + Number(local.minute);
  const [hour, minute] = schedule.checkInTime.split(':').map(Number);
  return {
    late: actualMinutes > hour * 60 + minute + (schedule.gracePeriodMinutes || 0),
    scheduledCheckIn: schedule.checkInTime,
    scheduleTimeZone: schedule.timeZone,
    scheduleConfigured: true
  };
};

const getScheduleForDepartment = (department) => DepartmentSchedule.findOne({
  department: new RegExp(`^${String(department).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
}).lean();

module.exports = { getLocalParts, getDateKey, getUtcDateForKey, getDayBoundsForKey, isAttendanceForCurrentWorkday, classifyCheckIn, getScheduleForDepartment };
