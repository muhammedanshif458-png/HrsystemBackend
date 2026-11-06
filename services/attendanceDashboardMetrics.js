const PRESENT_STATUSES = new Set(['PRESENT', 'HALF_DAY']);

function isWfhWorkMode(workMode) {
  if (!workMode || typeof workMode !== 'string') return false;
  const normalized = workMode.trim().toUpperCase().replace(/[\s_-]+/g, '');
  return normalized === 'WFH' || normalized === 'WORKFROMHOME';
}

function isOfficeWorkMode(workMode) {
  if (!workMode || typeof workMode !== 'string') return false;
  const normalized = workMode.trim().toUpperCase().replace(/[\s_-]+/g, '');
  return normalized === 'OFFICE';
}

function isPresentAttendance(row) {
  if (!row) return false;
  if (PRESENT_STATUSES.has(row.status)) return true;
  if (row.status === 'LATE' && row.checkIn != null) return true;
  return false;
}

function getStoredAttendanceWorkMode(row) {
  if (!row) return null;
  // Use actual stored Attendance.workMode as the primary source of truth
  if (typeof row.workMode === 'string') return row.workMode;
  // Backward compatibility for unhydrated mock fixtures where workMode was attached to employee
  if (row.workMode === undefined && row.employee && typeof row.employee.workMode === 'string') {
    return row.employee.workMode;
  }
  return null;
}

function summarizeAttendanceDay({ activeEmployeeIds, attendanceRows, approvedLeaveRows, dateKey }) {
  const activeIds = new Set([...activeEmployeeIds].map(String));
  const byEmployee = new Map();
  const orderedRows = [...attendanceRows].sort((a, b) => new Date(b.checkIn || b.createdAt || 0) - new Date(a.checkIn || a.createdAt || 0));
  for (const row of orderedRows) {
    const id = row.employee?._id ? String(row.employee._id) : String(row.employee);
    if (activeIds.has(id) && !byEmployee.has(id)) byEmployee.set(id, row);
  }
  const uniqueRows = [...byEmployee.values()];
  const presentRows = uniqueRows.filter(row => isPresentAttendance(row));
  const onLeaveIds = new Set(approvedLeaveRows.map(row => String(row.employee?._id || row.employee)));
  const todayWfhCount = presentRows.filter(row => isWfhWorkMode(getStoredAttendanceWorkMode(row))).length;

  return {
    date: dateKey,
    todayPresent: presentRows.length,
    todayAbsent: uniqueRows.filter(row => row.status === 'ABSENT').length,
    lateArrivals: uniqueRows.filter(row => (row.late === true || row.isLate === true || row.status === 'LATE') && row.checkIn != null).length,
    onLeaveToday: [...onLeaveIds].filter(id => activeIds.has(id)).length,
    todayWfh: todayWfhCount,
    wfhToday: todayWfhCount,
    wfh: todayWfhCount
  };
}

module.exports = {
  summarizeAttendanceDay,
  isWfhWorkMode,
  isOfficeWorkMode,
  getStoredAttendanceWorkMode
};
