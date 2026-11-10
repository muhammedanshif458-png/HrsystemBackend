const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const DepartmentSchedule = require('../models/DepartmentSchedule');
const PayrollConflict = require('../models/PayrollConflict');
const { AppError } = require('../middleware/errorMiddleware');

/**
 * Checks if workMode string indicates Work From Home
 */
function isWfhWorkMode(workMode) {
  if (!workMode || typeof workMode !== 'string') return false;
  const normalized = workMode.trim().toUpperCase().replace(/[\s_-]+/g, '');
  return normalized === 'WFH' || normalized === 'WORKFROMHOME';
}

/**
 * Normalizes date to 'YYYY-MM-DD' in Asia/Kolkata timezone or UTC
 */
function toDateKey(date, timeZone = 'Asia/Kolkata') {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  // If exact midnight UTC, ISO slice is already the date:
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) {
    return d.toISOString().slice(0, 10);
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(d);
}

class PayrollService {
  /**
   * Builds consistent eligibility filter for payroll across summary and listing.
   * Documented rules:
   * 1. Soft-deleted employees (isDeleted: true) are always excluded.
   * 2. Terminated employees who were terminated before this month are excluded.
   * 3. Resigned employees who resigned before this month are excluded.
   * 4. Inactive employees with zero work in the month are excluded by default from active list.
   */
  buildPayrollEmployeeFilter(year, month, options = {}) {
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const filter = {
      isDeleted: { $ne: true }
    };

    const andConditions = [];

    // Exclude TERMINATED employees and employees who resigned prior to target month
    andConditions.push({
      status: { $ne: 'TERMINATED' },
      $or: [
        { status: { $ne: 'RESIGNED' } },
        { status: 'RESIGNED', $or: [{ resignationDate: { $gte: startOfMonth } }, { resignationDate: null }] }
      ]
    });

    if (options.department && options.department !== 'all') {
      andConditions.push({
        department: new RegExp(`^${options.department.trim()}$`, 'i')
      });
    }

    if (options.status && options.status !== 'all') {
      andConditions.push({
        status: options.status.toUpperCase()
      });
    }

    if (options.search && options.search.trim() !== '') {
      const regex = new RegExp(options.search.trim(), 'i');
      andConditions.push({
        $or: [
          { firstName: regex },
          { lastName: regex },
          { email: regex },
          { employeeId: regex },
          { designation: regex }
        ]
      });
    }

    if (andConditions.length > 0) {
      filter.$and = andConditions;
    }

    return filter;
  }

  /**
   * Helper to compute standard working days in a given month and year
   * Tech: Mon-Fri (1..5)
   * Telecalling / Others: Mon-Sat (1..6)
   */
  getStandardWorkingDays(year, month, department = '', schedule = null) {
    const cal = this.getDepartmentMonthCalendar(year, month, department, schedule);
    return cal.scheduledWorkingDays;
  }

  /**
   * Computes full calendar breakdown for a department and month:
   * - scheduledWorkingDays (working days excluding weekly offs and configured paid holidays)
   * - weeklyOffs
   * - holidays
   * - workingDaysOfWeek
   * - holidaysList
   */
  getDepartmentMonthCalendar(year, month, department = '', schedule = null) {
    const workingDaysOfWeek = DepartmentSchedule.getWorkingDaysForSchedule
      ? DepartmentSchedule.getWorkingDaysForSchedule(schedule, department)
      : (schedule?.workingDays || [1, 2, 3, 4, 5, 6]);

    const holidaysList = (DepartmentSchedule.getHolidaysForSchedule
      ? DepartmentSchedule.getHolidaysForSchedule(schedule)
      : (schedule?.holidays || [])).map(h => String(h).slice(0, 10));

    const daysInMonth = new Date(year, month, 0).getDate();
    let scheduledWorkingDays = 0;
    let weeklyOffs = 0;
    let holidaysCount = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const dt = new Date(year, month - 1, day);
      const dayOfWeek = dt.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
      const monthPadded = String(month).padStart(2, '0');
      const dayPadded = String(day).padStart(2, '0');
      const dateKey = `${year}-${monthPadded}-${dayPadded}`;

      const isWeeklyOff = !workingDaysOfWeek.includes(dayOfWeek);
      const isHoliday = holidaysList.includes(dateKey);

      if (isWeeklyOff) {
        weeklyOffs++;
      } else if (isHoliday) {
        holidaysCount++;
      } else {
        scheduledWorkingDays++;
      }
    }

    return {
      daysInMonth,
      scheduledWorkingDays,
      weeklyOffs,
      holidays: holidaysCount,
      workingDaysOfWeek,
      holidaysList
    };
  }

  /**
   * Calculate single employee payroll record for a given month and year
   */
  async calculateEmployeePayroll(employee, year, month) {
    const monthDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    const daysInMonth = new Date(year, month, 0).getDate();

    // 1. Resolve actual DepartmentSchedule from database
    let schedule = null;
    if (DepartmentSchedule.getEffectiveSchedule) {
      schedule = await DepartmentSchedule.getEffectiveSchedule(employee.department, monthDate);
    } else {
      schedule = await DepartmentSchedule.findOne({
        department: new RegExp(`^${employee.department.trim()}$`, 'i')
      }).lean();
    }

    const calendar = this.getDepartmentMonthCalendar(year, month, employee.department, schedule);
    const { scheduledWorkingDays, weeklyOffs, holidays, workingDaysOfWeek, holidaysList } = calendar;

    // 2. Query attendance records for the month
    const attendanceRecords = await Attendance.find({
      employee: employee._id,
      date: { $gte: startOfMonth, $lte: endOfMonth }
    }).lean();

    // Deduplicate attendance by dateKey (most favorable status wins)
    const attendanceByDate = new Map();
    for (const record of attendanceRecords) {
      const dKey = toDateKey(record.date);
      if (!dKey) continue;
      const status = (record.status || '').toUpperCase();
      const isPresentOrHalf = status === 'PRESENT' || status === 'HALF_DAY' || (status === 'LATE' && record.checkIn != null);
      if (!isPresentOrHalf) continue;

      if (!attendanceByDate.has(dKey)) {
        attendanceByDate.set(dKey, record);
      } else {
        // If multiple records on same day, prioritize PRESENT over HALF_DAY
        const existing = attendanceByDate.get(dKey);
        if (existing.status !== 'PRESENT' && status === 'PRESENT') {
          attendanceByDate.set(dKey, record);
        }
      }
    }

    // 3. Query approved leaves overlapping the month
    const approvedLeaves = await Leave.find({
      employee: employee._id,
      status: 'APPROVED',
      startDate: { $lte: endOfMonth },
      endDate: { $gte: startOfMonth }
    }).lean();

    // Map approved leaves by dateKey
    const leavesByDate = new Map();
    for (const leave of approvedLeaves) {
      const lStart = new Date(Math.max(new Date(leave.startDate).getTime(), startOfMonth.getTime()));
      const lEnd = new Date(Math.min(new Date(leave.endDate).getTime(), endOfMonth.getTime()));
      const lStartDay = lStart.getUTCDate ? lStart.getUTCDate() : lStart.getDate();
      const lEndDay = lEnd.getUTCDate ? lEnd.getUTCDate() : lEnd.getDate();

      for (let day = lStartDay; day <= lEndDay; day++) {
        const monthPadded = String(month).padStart(2, '0');
        const dayPadded = String(day).padStart(2, '0');
        const dKey = `${year}-${monthPadded}-${dayPadded}`;
        leavesByDate.set(dKey, leave);
      }
    }

    // 4. Reconcile Attendance & Leave: Detect Conflicts
    let unresolvedConflictCount = 0;
    const conflictsList = [];
    const conflictDateKeys = new Set();

    for (const [dKey, attRecord] of attendanceByDate.entries()) {
      if (leavesByDate.has(dKey)) {
        conflictDateKeys.add(dKey);
        const leaveRecord = leavesByDate.get(dKey);

        // Find or create PayrollConflict document
        let conflictDoc = await PayrollConflict.findOne({
          employee: employee._id,
          dateKey: dKey
        });

        if (!conflictDoc) {
          const parts = dKey.split('-').map(Number);
          const cDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 0, 0, 0));
          conflictDoc = await PayrollConflict.create({
            employee: employee._id,
            employeeId: employee.employeeId,
            dateKey: dKey,
            conflictDate: cDate,
            year,
            month,
            conflictType: 'ATTENDANCE_AND_APPROVED_LEAVE',
            attendance: attRecord._id,
            attendanceStatus: attRecord.status,
            attendanceWorkMode: attRecord.workMode || 'Office',
            leave: leaveRecord._id,
            leaveType: leaveRecord.leaveType,
            status: 'UNRESOLVED'
          });
        }

        conflictsList.push({
          conflictId: conflictDoc._id,
          date: dKey,
          status: conflictDoc.status,
          attendanceStatus: conflictDoc.attendanceStatus,
          leaveType: conflictDoc.leaveType,
          resolution: conflictDoc.resolution || null
        });

        if (conflictDoc.status === 'UNRESOLVED') {
          unresolvedConflictCount++;
        }
      }
    }

    // 5. Calculate Attendance Breakdown
    let presentDays = 0;
    let halfDays = 0;
    let wfhDays = 0;

    for (const [dKey, attRecord] of attendanceByDate.entries()) {
      if (conflictDateKeys.has(dKey)) {
        // Only count if resolved as PRESENT
        const conflict = conflictsList.find(c => c.date === dKey);
        if (conflict && conflict.status === 'RESOLVED' && conflict.resolution?.decision === 'PRESENT') {
          const isWfh = isWfhWorkMode(attRecord.workMode);
          const status = (attRecord.status || '').toUpperCase();
          if (status === 'HALF_DAY') {
            halfDays++;
            if (isWfh) wfhDays += 0.5;
            else presentDays += 0.5;
          } else {
            if (isWfh) wfhDays += 1;
            else presentDays += 1;
          }
        }
        continue;
      }

      const isWfh = isWfhWorkMode(attRecord.workMode);
      const status = (attRecord.status || '').toUpperCase();
      if (status === 'HALF_DAY') {
        halfDays++;
        if (isWfh) wfhDays += 0.5;
        else presentDays += 0.5;
      } else {
        if (isWfh) wfhDays += 1;
        else presentDays += 1;
      }
    }

    // 6. Calculate Approved Leave Breakdown
    const paidLeaveAllowance = typeof employee.paidLeaveAllowance === 'number' ? employee.paidLeaveAllowance : 1;
    let eligiblePaidLeaveDaysCount = 0;
    let approvedPaidLeaveDays = 0;
    let approvedUnpaidLeaveDays = 0;
    let totalApprovedLeaveDays = 0;

    for (const [dKey, leaveRecord] of leavesByDate.entries()) {
      const parts = dKey.split('-').map(Number);
      const dt = new Date(parts[0], parts[1] - 1, parts[2]);
      const dayOfWeek = dt.getDay();

      // Only evaluate leaves on scheduled working days (weekly offs are not working days)
      const isWorkingDay = workingDaysOfWeek.includes(dayOfWeek) && !holidaysList.includes(dKey);
      if (!isWorkingDay) continue;

      totalApprovedLeaveDays++;

      if (conflictDateKeys.has(dKey)) {
        // Only count if resolved as leave
        const conflict = conflictsList.find(c => c.date === dKey);
        if (conflict && conflict.status === 'RESOLVED') {
          if (conflict.resolution?.decision === 'PAID_LEAVE') {
            eligiblePaidLeaveDaysCount++;
            if (eligiblePaidLeaveDaysCount <= paidLeaveAllowance) {
              approvedPaidLeaveDays++;
            } else {
              approvedUnpaidLeaveDays++;
            }
          } else if (conflict.resolution?.decision === 'UNPAID_LEAVE') {
            approvedUnpaidLeaveDays++;
          }
        }
        continue;
      }

      if ((leaveRecord.leaveType || '').toUpperCase() === 'UNPAID') {
        approvedUnpaidLeaveDays++;
      } else {
        eligiblePaidLeaveDaysCount++;
        if (eligiblePaidLeaveDaysCount <= paidLeaveAllowance) {
          approvedPaidLeaveDays++;
        } else {
          approvedUnpaidLeaveDays++;
        }
      }
    }

    // 7. Salary Calculations
    // Formula: Daily Salary = Monthly Base Salary / Scheduled Working Days
    // Net Salary = Daily Salary * Payable Days
    // 0 payable days = ₹0 salary!
    const grossSalary = employee.salary || 0;
    const payableDays = presentDays + wfhDays + approvedPaidLeaveDays + holidays;
    const dailyRatePrecise = scheduledWorkingDays > 0 ? (grossSalary / scheduledWorkingDays) : 0;
    const dailySalary = Math.round(dailyRatePrecise * 100) / 100;

    let netPay = 0;
    if (payableDays <= 0 || grossSalary <= 0 || scheduledWorkingDays <= 0) {
      netPay = 0;
    } else if (payableDays >= scheduledWorkingDays) {
      // Full working days worked/eligible -> exact full monthly base salary
      netPay = grossSalary;
    } else {
      netPay = Math.round(dailyRatePrecise * payableDays * 100) / 100;
    }

    const deductions = Math.max(0, Math.round((grossSalary - netPay) * 100) / 100);
    const lopDays = Math.max(0, scheduledWorkingDays - payableDays - unresolvedConflictCount);

    return {
      employee: {
        id: employee._id,
        employeeId: employee.employeeId,
        firstName: employee.firstName,
        lastName: employee.lastName,
        name: `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
        department: employee.department,
        designation: employee.designation,
        status: employee.status,
        salary: grossSalary,
        monthlyBaseSalary: grossSalary,
        salaryCurrency: employee.salaryCurrency || 'INR'
      },
      year,
      month,
      // Calendar breakdown
      scheduledWorkingDays,
      standardWorkingDays: scheduledWorkingDays, // backward compatibility
      weeklyOffs,
      holidays,
      // Attendance breakdown
      presentDays,
      halfDays,
      wfhDays,
      // Leave breakdown
      approvedLeaves: totalApprovedLeaveDays, // backward compatibility
      approvedPaidLeaveDays,
      paidLeaveDays: approvedPaidLeaveDays, // backward compatibility
      approvedUnpaidLeaveDays,
      unpaidLeaveDays: approvedUnpaidLeaveDays, // backward compatibility
      // Loss of pay & Conflict breakdown
      lopDays,
      unresolvedConflictCount,
      hasUnresolvedConflicts: unresolvedConflictCount > 0,
      conflicts: conflictsList,
      // Financial calculations
      payableDays,
      monthlyBaseSalary: grossSalary,
      grossSalary, // backward compatibility
      grossPayableSalary: grossSalary,
      dailySalary,
      dailyRate: dailySalary, // backward compatibility
      deductions,
      netSalary: netPay,
      netPay // backward compatibility
    };
  }

  /**
   * Get Payroll Summary for a specific month and year
   */
  async getPayrollSummary(year, month, departmentFilter = '') {
    const filter = this.buildPayrollEmployeeFilter(year, month, {
      department: departmentFilter
    });

    const employees = await Employee.find(filter).lean();

    let totalMonthlyBaseSalary = 0;
    let totalDeductions = 0;
    let totalNetPayout = 0;
    let totalUnresolvedConflicts = 0;

    for (const emp of employees) {
      const calc = await this.calculateEmployeePayroll(emp, year, month);
      totalMonthlyBaseSalary += calc.monthlyBaseSalary;
      totalDeductions += calc.deductions;
      totalNetPayout += calc.netSalary;
      totalUnresolvedConflicts += calc.unresolvedConflictCount;
    }

    return {
      year,
      month,
      department: departmentFilter || 'all',
      totalEmployees: employees.length,
      totalMonthlyBaseSalary: Math.round(totalMonthlyBaseSalary * 100) / 100,
      totalPayrollExpenditure: Math.round(totalMonthlyBaseSalary * 100) / 100,
      totalDeductions: Math.round(totalDeductions * 100) / 100,
      totalNetPayout: Math.round(totalNetPayout * 100) / 100,
      totalUnresolvedConflicts,
      hasUnresolvedConflicts: totalUnresolvedConflicts > 0
    };
  }

  /**
   * Get itemized payroll calculations for all employees
   */
  async getEmployeesPayroll(year, month, { department, search, status, page = 1, limit = 50 } = {}) {
    const filter = this.buildPayrollEmployeeFilter(year, month, {
      department,
      search,
      status
    });

    const employees = await Employee.find(filter).sort({ department: 1, firstName: 1 }).lean();

    const items = [];
    for (const emp of employees) {
      const item = await this.calculateEmployeePayroll(emp, year, month);
      items.push(item);
    }

    page = Math.max(1, parseInt(page, 10));
    limit = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (page - 1) * limit;
    const paginatedItems = items.slice(skip, skip + limit);

    return {
      payrollRecords: paginatedItems,
      pagination: {
        page,
        limit,
        total: items.length,
        totalPages: Math.ceil(items.length / limit) || 1
      }
    };
  }

  /**
   * Get single employee payroll details
   */
  async getSingleEmployeePayroll(empIdentifier, year, month) {
    let emp;
    if (mongoose.Types.ObjectId.isValid(empIdentifier)) {
      emp = await Employee.findOne({ $or: [{ _id: empIdentifier }, { employeeId: empIdentifier.toUpperCase() }] });
    } else {
      emp = await Employee.findOne({ employeeId: empIdentifier.toUpperCase() });
    }

    if (!emp) {
      throw new AppError('Employee not found', 404);
    }

    return await this.calculateEmployeePayroll(emp, year, month);
  }

  /**
   * Get list of payroll conflicts for a month
   */
  async getConflicts(year, month, { department, status, employeeId, page = 1, limit = 50 } = {}) {
    const query = { year, month };
    if (status && status !== 'all') {
      query.status = status.toUpperCase();
    }
    if (employeeId) {
      if (mongoose.Types.ObjectId.isValid(employeeId)) {
        query.employee = employeeId;
      } else {
        query.employeeId = employeeId.toUpperCase();
      }
    }

    page = Math.max(1, parseInt(page, 10));
    limit = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (page - 1) * limit;

    const [conflicts, total, unresolvedTotal] = await Promise.all([
      PayrollConflict.find(query)
        .populate('employee', 'firstName lastName department employeeId')
        .populate('attendance', 'status workMode checkIn')
        .populate('leave', 'leaveType reason startDate endDate')
        .populate('resolution.resolvedBy', 'firstName lastName email')
        .sort({ conflictDate: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PayrollConflict.countDocuments(query),
      PayrollConflict.countDocuments({ year, month, status: 'UNRESOLVED' })
    ]);

    return {
      conflicts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        unresolvedTotal
      }
    };
  }

  /**
   * Resolve an attendance and leave conflict
   * HR resolution options:
   * - PRESENT: Count as Present
   * - PAID_LEAVE: Count as Approved Paid Leave (subject to paid leave allowance)
   * - UNPAID_LEAVE: Count as Unpaid Leave
   */
  async resolveConflict(conflictId, { decision, reason = '' }, resolvedByUser = null) {
    const validDecisions = ['PRESENT', 'PAID_LEAVE', 'UNPAID_LEAVE'];
    const normalizedDecision = (decision || '').toUpperCase();

    if (!validDecisions.includes(normalizedDecision)) {
      throw new AppError(`Invalid resolution decision. Must be one of: ${validDecisions.join(', ')}`, 400);
    }

    const conflict = await PayrollConflict.findById(conflictId);
    if (!conflict) {
      throw new AppError('Payroll conflict record not found', 404);
    }

    conflict.status = 'RESOLVED';
    conflict.resolution = {
      decision: normalizedDecision,
      resolvedBy: resolvedByUser?._id || null,
      resolvedAt: new Date(),
      reason: String(reason || '').trim()
    };

    conflict.auditHistory.push({
      action: 'RESOLVED_BY_HR',
      performedBy: resolvedByUser?._id || null,
      timestamp: new Date(),
      details: {
        previousStatus: conflict.status,
        decision: normalizedDecision,
        reason
      }
    });

    await conflict.save();

    return conflict;
  }
}

module.exports = new PayrollService();
