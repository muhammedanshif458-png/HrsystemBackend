const PRESENT_STATUSES = new Set(['PRESENT', 'HALF_DAY']);

function summarizeAttendanceDay({ activeEmployeeIds, attendanceRows, approvedLeaveRows, dateKey }) {
  const activeIds = new Set([...activeEmployeeIds].map(String));
  const byEmployee = new Map();
  const orderedRows = [...attendanceRows].sort((a, b) => new Date(b.checkIn || b.createdAt || 0) - new Date(a.checkIn || a.createdAt || 0));
  for (const row of orderedRows) {
    const id = row.employee?._id ? String(row.employee._id) : String(row.employee);
    if (activeIds.has(id) && !byEmployee.has(id)) byEmployee.set(id, row);
  }
  const uniqueRows = [...byEmployee.values()];
  const presentRows = uniqueRows.filter(row => PRESENT_STATUSES.has(row.status));
  const onLeaveIds = new Set(approvedLeaveRows.map(row => String(row.employee?._id || row.employee)));
  return {
    date: dateKey,
    todayPresent: presentRows.length,
    todayAbsent: uniqueRows.filter(row => row.status === 'ABSENT').length,
    lateArrivals: uniqueRows.filter(row => (row.late === true || row.isLate === true || row.status === 'LATE') && row.checkIn != null).length,
    onLeaveToday: [...onLeaveIds].filter(id => activeIds.has(id)).length,
    todayWfh: presentRows.filter(row => (row.workMode || row.employee?.workMode || '').toUpperCase() === 'WFH').length
  };
}

module.exports = { summarizeAttendanceDay };
