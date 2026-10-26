/**
 * Schedule & Lateness Calculation Helper
 */

/**
 * Computes scheduled cutoff time and lateness in the schedule's timezone
 *
 * @param {Date} actualCheckIn - Check-in timestamp
 * @param {Object|null} schedule - Effective DepartmentSchedule document or plain object
 * @returns {Object} { isLate, minutesLate, scheduleStatus, scheduleSnapshot }
 */
function calculateLateness(actualCheckIn, schedule) {
  const checkInTime = schedule?.checkInTime || schedule?.scheduledCheckIn;
  if (!schedule || !checkInTime) {
    return {
      isLate: false,
      minutesLate: 0,
      scheduleStatus: 'UNCONFIGURED',
      scheduleSnapshot: null
    };
  }

  const tz = schedule.timezone || 'Asia/Kolkata';

  // Format check-in date to YYYY-MM-DD in the schedule's timezone
  const dateInTz = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(actualCheckIn);

  // Construct target local scheduled time and resolve UTC equivalent for this timezone
  const approx = new Date(`${dateInTz}T${checkInTime}:00Z`);
  const formattedInTz = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(approx);

  const [fDate, fTime] = formattedInTz.split(', ');
  const tzAsDate = new Date(`${fDate}T${fTime}Z`);
  const offsetMs = tzAsDate.getTime() - approx.getTime();
  const scheduledTime = new Date(approx.getTime() - offsetMs);

  const graceMs = (Number(schedule.gracePeriodMinutes) || 0) * 60 * 1000;
  const cutoffTime = new Date(scheduledTime.getTime() + graceMs);

  const diffMs = actualCheckIn.getTime() - cutoffTime.getTime();
  const isLate = diffMs > 0;
  // Calculate minutesLate = max(0, actualCheckIn - (scheduledCheckIn + gracePeriod)), rounded consistently to whole minutes
  const minutesLate = isLate ? Math.max(1, Math.round(diffMs / (60 * 1000))) : 0;

  const scheduleSnapshot = {
    scheduleId: schedule._id || schedule.scheduleId || null,
    department: schedule.department || null,
    scheduledCheckIn: checkInTime,
    scheduledCheckOut: schedule.checkOutTime || schedule.scheduledCheckOut || '18:00',
    gracePeriodMinutes: Number(schedule.gracePeriodMinutes) || 0,
    timezone: tz
  };

  return {
    isLate,
    minutesLate,
    scheduledTime,
    cutoffTime,
    scheduleStatus: 'CONFIGURED',
    scheduleSnapshot
  };
}

module.exports = {
  calculateLateness
};
