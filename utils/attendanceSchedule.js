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
  let strKey = '';
  if (key instanceof Date) {
    strKey = key.toISOString().slice(0, 10);
  } else if (typeof key === 'string') {
    strKey = key.trim().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(strKey)) throw new Error('Invalid attendance date; expected YYYY-MM-DD');
  const startOfDay = getUtcDateForKey(strKey);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { startOfDay, endOfDay };
};

const isAttendanceForCurrentWorkday = (attendance, now = new Date()) => {
  if (!attendance?.date) return false;
  const timeZone = attendance.scheduleTimeZone || attendance.scheduleSnapshot?.timezone || 'UTC';
  const attDateStr = (attendance.date instanceof Date ? attendance.date.toISOString() : String(attendance.date)).slice(0, 10);
  return attDateStr === getDateKey(now, timeZone);
};

const classifyCheckIn = (checkIn, schedule) => {
  if (!schedule) {
    return {
      late: false,
      isLate: false,
      minutesLate: 0,
      scheduledCheckIn: null,
      scheduledCheckOut: null,
      scheduleTimeZone: null,
      timezone: null,
      gracePeriodMinutes: 0,
      scheduleConfigured: false,
      scheduleStatus: 'UNCONFIGURED',
      scheduleSnapshot: null
    };
  }

  const tz = schedule.timeZone || schedule.timezone || 'Asia/Kolkata';
  const { calculateLateness } = require('./scheduleHelper');
  const lateness = calculateLateness(checkIn, schedule);

  const isLate = Boolean(lateness.isLate);
  const minutesLate = lateness.minutesLate || 0;
  const scheduledCheckIn = schedule.checkInTime || schedule.scheduledCheckIn;
  const scheduledCheckOut = schedule.checkOutTime || schedule.scheduledCheckOut || '18:00';
  const gracePeriodMinutes = Number(schedule.gracePeriodMinutes) || 0;

  return {
    late: isLate,
    isLate,
    minutesLate,
    scheduledCheckIn,
    scheduledCheckOut,
    scheduleTimeZone: tz,
    timezone: tz,
    gracePeriodMinutes,
    scheduleConfigured: true,
    scheduleStatus: 'CONFIGURED',
    scheduleSnapshot: lateness.scheduleSnapshot || {
      scheduleId: schedule._id || schedule.scheduleId || null,
      department: schedule.department || null,
      scheduledCheckIn,
      scheduledCheckOut,
      gracePeriodMinutes,
      timezone: tz
    }
  };
};

const getScheduleForDepartment = async (department, targetDate = new Date()) => {
  if (!department) return null;
  if (DepartmentSchedule.getEffectiveSchedule) {
    const effective = await DepartmentSchedule.getEffectiveSchedule(department, targetDate);
    if (effective) return effective;
  }
  const rawDept = String(department).trim();
  const canonicalDept = DepartmentSchedule.toCanonicalDeptKey ? DepartmentSchedule.toCanonicalDeptKey(rawDept) : rawDept.toUpperCase();
  const escapedRaw = rawDept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedCanonical = canonicalDept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return DepartmentSchedule.findOne({
    $or: [
      { department: new RegExp(`^${escapedCanonical}$`, 'i') },
      { department: new RegExp(`^${escapedRaw}$`, 'i') },
      { departmentDisplay: new RegExp(`^${escapedRaw}$`, 'i') }
    ]
  }).sort({ effectiveDate: -1, createdAt: -1 }).lean();
};

module.exports = {
  getLocalParts,
  getDateKey,
  getUtcDateForKey,
  getDayBoundsForKey,
  isAttendanceForCurrentWorkday,
  classifyCheckIn,
  getScheduleForDepartment
};
