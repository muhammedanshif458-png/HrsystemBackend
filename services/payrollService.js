const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const DepartmentSchedule = require('../models/DepartmentSchedule');
const PayrollConflict = require('../models/PayrollConflict');
const PayrollBatch = require('../models/PayrollBatch');
const PayrollRecord = require('../models/PayrollRecord');
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
        if (!leavesByDate.has(dKey)) {
          leavesByDate.set(dKey, []);
        }
        leavesByDate.get(dKey).push(leave);
      }
    }

    // 4. Reconcile Attendance & Leave: Detect Conflicts
    let unresolvedConflictCount = 0;
    const conflictsList = [];
    const conflictDateKeys = new Set();

    for (const [dKey, attRecord] of attendanceByDate.entries()) {
      if (leavesByDate.has(dKey)) {
        const leavesList = leavesByDate.get(dKey);
        const totalLeaveWeight = leavesList.reduce((sum, l) => sum + ((l.durationType === 'HALF_DAY' || l.totalDays === 0.5) ? 0.5 : 1.0), 0);
        const isAttHalf = (attRecord.status || '').toUpperCase() === 'HALF_DAY';

        // An attendance and leave on the same date is a conflict UNLESS:
        // Attendance is HALF_DAY and total leave on that date is 0.5 (HALF_DAY), which complement each other into a full day.
        const isComplementary = isAttHalf && totalLeaveWeight === 0.5;
        if (isComplementary) {
          continue;
        }

        conflictDateKeys.add(dKey);
        const leaveRecord = leavesList[0];

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

    for (const [dKey, leavesList] of leavesByDate.entries()) {
      const parts = dKey.split('-').map(Number);
      const dt = new Date(parts[0], parts[1] - 1, parts[2]);
      const dayOfWeek = dt.getDay();

      // Only evaluate leaves on scheduled working days (weekly offs are not working days)
      const isWorkingDay = workingDaysOfWeek.includes(dayOfWeek) && !holidaysList.includes(dKey);
      if (!isWorkingDay) continue;

      for (const leaveRecord of leavesList) {
        const leaveDayWeight = (leaveRecord.durationType === 'HALF_DAY' || Number(leaveRecord.totalDays) === 0.5) ? 0.5 : 1.0;

        if (conflictDateKeys.has(dKey)) {
          const conflict = conflictsList.find(c => c.date === dKey);

          // If conflict is resolved as PRESENT:
          // - Counted under attendance (presentDays)
          // - Excluded from approved leave count (removed from remaining leaves)
          // - Must NOT consume paid leave allowance
          // - Must NOT be counted as a separate leave day
          if (conflict && conflict.status === 'RESOLVED' && conflict.resolution?.decision === 'PRESENT') {
            continue;
          }

          // Only count towards paid/unpaid leave breakdown if resolved as leave
          if (conflict && conflict.status === 'RESOLVED') {
            totalApprovedLeaveDays += leaveDayWeight;
            if (conflict.resolution?.decision === 'PAID_LEAVE') {
              const remainingPaidAllowance = Math.max(0, paidLeaveAllowance - eligiblePaidLeaveDaysCount);
              const paidPortion = Math.min(leaveDayWeight, remainingPaidAllowance);
              const unpaidPortion = leaveDayWeight - paidPortion;

              approvedPaidLeaveDays += paidPortion;
              approvedUnpaidLeaveDays += unpaidPortion;
              eligiblePaidLeaveDaysCount += leaveDayWeight;
            } else if (conflict.resolution?.decision === 'UNPAID_LEAVE') {
              approvedUnpaidLeaveDays += leaveDayWeight;
            }
            continue;
          }

          // Unresolved conflicts: excluded from payable leave breakdown until resolved by HR,
          // but counted in totalApprovedLeaveDays as an approved leave request pending resolution
          totalApprovedLeaveDays += leaveDayWeight;
          continue;
        }

        totalApprovedLeaveDays += leaveDayWeight;

        if ((leaveRecord.leaveType || '').toUpperCase() === 'UNPAID') {
          approvedUnpaidLeaveDays += leaveDayWeight;
        } else {
          const remainingPaidAllowance = Math.max(0, paidLeaveAllowance - eligiblePaidLeaveDaysCount);
          const paidPortion = Math.min(leaveDayWeight, remainingPaidAllowance);
          const unpaidPortion = leaveDayWeight - paidPortion;

          approvedPaidLeaveDays += paidPortion;
          approvedUnpaidLeaveDays += unpaidPortion;
          eligiblePaidLeaveDaysCount += leaveDayWeight;
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
    const query = { year, month, archivedAt: null };
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
      PayrollConflict.countDocuments({ year, month, status: 'UNRESOLVED', archivedAt: null })
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

  /** Archive every active resolved conflict without removing its history. */
  async archiveResolvedConflicts(archivedByUser = null) {
    const result = await PayrollConflict.updateMany(
      { status: 'RESOLVED', archivedAt: null },
      { $set: { archivedAt: new Date(), archivedBy: archivedByUser?._id || null } }
    );
    return result.modifiedCount || 0;
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

  /**
   * Safe Draft Payroll Batch Creation
   * 1. Validates year and month.
   * 2. Prevents overlapping all-department and department-specific batches.
   * 3. Prevents modifying already FINALIZED or PAID batches.
   * 4. Runs calculation engine and saves snapshot into PayrollBatch and PayrollRecord.
   */
  async createOrUpdateDraftBatch(year, month, department = 'all', creatorUser = null, notes = '') {
    year = parseInt(year, 10);
    month = parseInt(month, 10);
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      throw new AppError('Valid year (e.g. 2026) and month (1-12) are required', 400);
    }
    department = String(department || 'all').trim();

    // Check for overlapping all-department vs specific-department batches
    if (department.toLowerCase() === 'all') {
      const specificBatch = await PayrollBatch.findOne({
        year,
        month,
        department: { $ne: 'all' }
      }).lean();
      if (specificBatch) {
        throw new AppError(
          `Cannot create an all-department batch: a department-specific batch for "${specificBatch.department}" already exists for ${month}/${year}. Complete or delete individual department batches first.`,
          400
        );
      }
    } else {
      const allBatch = await PayrollBatch.findOne({
        year,
        month,
        department: 'all'
      }).lean();
      if (allBatch) {
        throw new AppError(
          `Cannot create a department-specific batch: an all-department batch already exists for ${month}/${year}.`,
          400
        );
      }
    }

    // Check if a batch for this exact scope already exists
    const existingBatch = await PayrollBatch.findOne({
      year,
      month,
      department: new RegExp(`^${department}$`, 'i')
    });

    if (existingBatch && (existingBatch.status === 'FINALIZED' || existingBatch.status === 'PAID')) {
      throw new AppError(
        `Payroll batch for ${department} (${month}/${year}) is already ${existingBatch.status} and cannot be modified.`,
        400
      );
    }

    // Run calculation for all eligible employees
    const { payrollRecords } = await this.getEmployeesPayroll(year, month, {
      department,
      limit: 5000
    });

    let totalMonthlyBaseSalary = 0;
    let totalDeductions = 0;
    let totalNetPayout = 0;
    let totalUnresolvedConflicts = 0;

    for (const rec of payrollRecords) {
      totalMonthlyBaseSalary += rec.monthlyBaseSalary;
      totalDeductions += rec.deductions;
      totalNetPayout += rec.netSalary;
      totalUnresolvedConflicts += rec.unresolvedConflictCount;
    }

    totalMonthlyBaseSalary = Math.round(totalMonthlyBaseSalary * 100) / 100;
    totalDeductions = Math.round(totalDeductions * 100) / 100;
    totalNetPayout = Math.round(totalNetPayout * 100) / 100;

    let batch;
    if (existingBatch) {
      existingBatch.grossSalary = totalMonthlyBaseSalary;
      existingBatch.totalMonthlyBaseSalary = totalMonthlyBaseSalary;
      existingBatch.totalDeductions = totalDeductions;
      existingBatch.netPay = totalNetPayout;
      existingBatch.totalNetPayout = totalNetPayout;
      existingBatch.employeeCount = payrollRecords.length;
      existingBatch.unresolvedConflictCount = totalUnresolvedConflicts;
      if (notes) existingBatch.notes = notes;
      if (creatorUser) existingBatch.createdBy = creatorUser._id;
      await existingBatch.save();
      await PayrollRecord.deleteMany({ batchId: existingBatch._id });
      batch = existingBatch;
    } else {
      batch = await PayrollBatch.create({
        year,
        month,
        department,
        status: 'DRAFT',
        grossSalary: totalMonthlyBaseSalary,
        totalMonthlyBaseSalary,
        totalDeductions,
        netPay: totalNetPayout,
        totalNetPayout,
        employeeCount: payrollRecords.length,
        unresolvedConflictCount: totalUnresolvedConflicts,
        createdBy: creatorUser?._id,
        notes
      });
    }

    // Persist immutable snapshots in PayrollRecord
    const recordDocs = payrollRecords.map((item) => ({
      batchId: batch._id,
      employee: item.employee.id,
      employeeId: item.employee.employeeId,
      employeeName: item.employee.name,
      department: item.employee.department,
      designation: item.employee.designation || '',
      monthlyBaseSalary: item.monthlyBaseSalary,
      salaryCurrency: item.employee.salaryCurrency || 'INR',
      scheduledWorkingDays: item.scheduledWorkingDays,
      presentDays: item.presentDays,
      halfDays: item.halfDays,
      wfhDays: item.wfhDays,
      weeklyOffs: item.weeklyOffs,
      holidays: item.holidays,
      paidLeaveDays: item.approvedPaidLeaveDays,
      unpaidLeaveDays: item.approvedUnpaidLeaveDays,
      lopDays: item.lopDays,
      payableDays: item.payableDays,
      dailySalary: item.dailySalary,
      grossPay: item.monthlyBaseSalary,
      deductions: item.deductions,
      netPay: item.netSalary,
      calculationBreakdown: item
    }));

    if (recordDocs.length > 0) {
      await PayrollRecord.insertMany(recordDocs);
    }

    return {
      batch,
      summary: {
        batchId: batch._id,
        year,
        month,
        department,
        status: batch.status,
        employeeCount: batch.employeeCount,
        totalMonthlyBaseSalary,
        totalDeductions,
        totalNetPayout,
        unresolvedConflictCount: totalUnresolvedConflicts,
        hasUnresolvedConflicts: totalUnresolvedConflicts > 0
      }
    };
  }

  /**
   * Finalize Payroll Batch
   * Requirements:
   * - Authorized HR/Super Admin
   * - Existing valid DRAFT batch
   * - Revalidate unresolved conflicts; strictly block if any unresolved conflict exists
   * - Verify totals against saved records
   * - Prevent duplicate finalization
   * - Mark status FINALIZED, record finalizedBy and finalizedAt
   */
  async finalizePayrollBatch(batchId, finalizedByUser = null) {
    if (!mongoose.Types.ObjectId.isValid(batchId)) {
      throw new AppError('Invalid payroll batch ID format', 400);
    }

    const batch = await PayrollBatch.findById(batchId);
    if (!batch) {
      throw new AppError('Payroll batch not found', 404);
    }

    if (batch.status === 'FINALIZED') {
      throw new AppError('Payroll batch is already finalized', 400);
    }
    if (batch.status === 'PAID') {
      throw new AppError('Payroll batch is already paid', 400);
    }

    // Revalidate unresolved conflicts
    const unresolvedConflicts = await PayrollConflict.countDocuments({
      year: batch.year,
      month: batch.month,
      status: 'UNRESOLVED'
    });

    if (unresolvedConflicts > 0 || batch.unresolvedConflictCount > 0) {
      throw new AppError(
        `Cannot finalize payroll batch: ${unresolvedConflicts} unresolved attendance/leave conflict(s) exist for ${batch.month}/${batch.year}. Resolve all conflicts before finalization.`,
        400
      );
    }

    // Verify against saved PayrollRecord snapshots
    const records = await PayrollRecord.find({ batchId: batch._id });
    if (records.length === 0 && batch.employeeCount > 0) {
      throw new AppError('Cannot finalize payroll batch: saved payroll records are missing.', 400);
    }

    const sumGross = Math.round(records.reduce((acc, r) => acc + r.monthlyBaseSalary, 0) * 100) / 100;
    const sumDeductions = Math.round(records.reduce((acc, r) => acc + r.deductions, 0) * 100) / 100;
    const sumNet = Math.round(records.reduce((acc, r) => acc + r.netPay, 0) * 100) / 100;

    batch.grossSalary = sumGross;
    batch.totalMonthlyBaseSalary = sumGross;
    batch.totalDeductions = sumDeductions;
    batch.netPay = sumNet;
    batch.totalNetPayout = sumNet;
    batch.employeeCount = records.length;
    batch.status = 'FINALIZED';
    batch.finalizedBy = finalizedByUser?._id || null;
    batch.finalizedAt = new Date();

    await batch.save();

    return batch;
  }

  /**
   * Mark a Finalized Payroll Batch as Paid
   */
  async markBatchAsPaid(batchId, { paymentMethod = 'BANK_TRANSFER', reference = '', remarks = '' } = {}, paidByUser = null) {
    if (!mongoose.Types.ObjectId.isValid(batchId)) {
      throw new AppError('Invalid payroll batch ID format', 400);
    }

    const batch = await PayrollBatch.findById(batchId);
    if (!batch) {
      throw new AppError('Payroll batch not found', 404);
    }

    if (batch.status === 'DRAFT') {
      throw new AppError('Cannot pay an unfinalized payroll batch. Finalize the batch first.', 400);
    }
    if (batch.status === 'PAID') {
      throw new AppError('Payroll batch has already been marked as paid.', 400);
    }

    batch.status = 'PAID';
    batch.paidAt = new Date();
    batch.paymentDetails = {
      paymentMethod: String(paymentMethod || 'BANK_TRANSFER').trim(),
      reference: String(reference || '').trim(),
      remarks: String(remarks || '').trim(),
      paidBy: paidByUser?._id || null
    };

    await batch.save();

    return batch;
  }

  /**
   * Get list of historical payroll batches
   */
  async getBatches({ year, month, department, status, page = 1, limit = 20 } = {}) {
    const query = {};
    if (year) query.year = parseInt(year, 10);
    if (month) query.month = parseInt(month, 10);
    if (department && department !== 'all') {
      query.department = new RegExp(`^${department.trim()}$`, 'i');
    }
    if (status && status !== 'all') {
      query.status = status.toUpperCase();
    }

    page = Math.max(1, parseInt(page, 10));
    limit = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (page - 1) * limit;

    const [batches, total] = await Promise.all([
      PayrollBatch.find(query)
        .populate('createdBy', 'firstName lastName email')
        .populate('finalizedBy', 'firstName lastName email')
        .populate('paymentDetails.paidBy', 'firstName lastName email')
        .sort({ year: -1, month: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PayrollBatch.countDocuments(query)
    ]);

    return {
      batches,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    };
  }

  /**
   * Get single payroll batch details with records
   */
  async getBatchById(batchId, { page = 1, limit = 50, search = '' } = {}) {
    if (!mongoose.Types.ObjectId.isValid(batchId)) {
      throw new AppError('Invalid payroll batch ID format', 400);
    }

    const batch = await PayrollBatch.findById(batchId)
      .populate('createdBy', 'firstName lastName email')
      .populate('finalizedBy', 'firstName lastName email')
      .populate('paymentDetails.paidBy', 'firstName lastName email')
      .lean();

    if (!batch) {
      throw new AppError('Payroll batch not found', 404);
    }

    const recordQuery = { batchId: batch._id };
    if (search && search.trim() !== '') {
      const regex = new RegExp(search.trim(), 'i');
      recordQuery.$or = [
        { employeeName: regex },
        { employeeId: regex },
        { department: regex },
        { designation: regex }
      ];
    }

    page = Math.max(1, parseInt(page, 10));
    limit = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      PayrollRecord.find(recordQuery)
        .sort({ department: 1, employeeName: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PayrollRecord.countDocuments(recordQuery)
    ]);

    return {
      batch,
      records,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    };
  }

  /**
   * Generate structured payslip payload from saved PayrollRecord snapshot
   */
  async getEmployeePayslip(batchId, employeeIdentifier) {
    if (!mongoose.Types.ObjectId.isValid(batchId)) {
      throw new AppError('Invalid payroll batch ID format', 400);
    }

    const batch = await PayrollBatch.findById(batchId).lean();
    if (!batch) {
      throw new AppError('Payroll batch not found', 404);
    }

    const query = { batchId: batch._id };
    if (mongoose.Types.ObjectId.isValid(employeeIdentifier)) {
      query.$or = [{ employee: employeeIdentifier }, { employeeId: employeeIdentifier.toUpperCase() }];
    } else {
      query.employeeId = employeeIdentifier.toUpperCase();
    }

    const record = await PayrollRecord.findOne(query).lean();
    if (!record) {
      throw new AppError('Payroll record not found for this employee in the specified batch', 404);
    }

    return {
      company: {
        name: 'LY Software',
        division: 'HR Management Operations',
        currency: record.salaryCurrency || 'INR'
      },
      payslip: {
        batchId: batch._id,
        year: batch.year,
        month: batch.month,
        period: `${batch.year}-${String(batch.month).padStart(2, '0')}`,
        batchStatus: batch.status,
        finalizedAt: batch.finalizedAt,
        paidAt: batch.paidAt,
        employee: {
          id: record.employee,
          employeeId: record.employeeId,
          name: record.employeeName,
          department: record.department,
          designation: record.designation
        },
        calendar: {
          scheduledWorkingDays: record.scheduledWorkingDays,
          weeklyOffs: record.weeklyOffs,
          holidays: record.holidays,
          presentDays: record.presentDays,
          halfDays: record.halfDays,
          wfhDays: record.wfhDays,
          paidLeaveDays: record.paidLeaveDays,
          unpaidLeaveDays: record.unpaidLeaveDays,
          lopDays: record.lopDays,
          payableDays: record.payableDays
        },
        earnings: [
          { title: 'Monthly Base Salary', amount: record.monthlyBaseSalary },
          { title: 'Payable Salary', amount: record.grossPay }
        ],
        deductions: [
          { title: 'Unpaid Leave & Loss of Pay', amount: record.deductions }
        ],
        summary: {
          dailySalary: record.dailySalary,
          grossPay: record.grossPay,
          totalDeductions: record.deductions,
          netPay: record.netPay
        },
        calculationBreakdown: record.calculationBreakdown,
        pdfExportSupported: false,
        pdfExportNote: 'Structured payslip payload ready for client-side rendering or PDF export'
      }
    };
  }

  /**
   * Staff-Facing: Get all finalized payslips for the authenticated staff user
   */
  async getStaffPayslips(user, { page = 1, limit = 20 } = {}) {
    const employee = await Employee.findOne({ user: user._id }).lean();
    if (!employee) {
      throw new AppError('Staff employee record not found for authenticated user', 404);
    }

    page = Math.max(1, parseInt(page, 10));
    limit = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (page - 1) * limit;

    // Only return records from batches that are FINALIZED or PAID (never DRAFT)
    const finalizedBatches = await PayrollBatch.find({
      status: { $in: ['FINALIZED', 'PAID'] }
    }).select('_id year month status finalizedAt paidAt').lean();

    const finalizedBatchIds = finalizedBatches.map(b => b._id);

    const [records, total] = await Promise.all([
      PayrollRecord.find({
        employee: employee._id,
        batchId: { $in: finalizedBatchIds }
      })
        .populate('batchId', 'year month department status finalizedAt paidAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PayrollRecord.countDocuments({
        employee: employee._id,
        batchId: { $in: finalizedBatchIds }
      })
    ]);

    const payslips = records.map(r => ({
      payslipId: r._id,
      batchId: r.batchId?._id,
      year: r.batchId?.year,
      month: r.batchId?.month,
      period: r.batchId ? `${r.batchId.year}-${String(r.batchId.month).padStart(2, '0')}` : '',
      department: r.department,
      designation: r.designation,
      monthlyBaseSalary: r.monthlyBaseSalary,
      payableDays: r.payableDays,
      scheduledWorkingDays: r.scheduledWorkingDays,
      grossPay: r.grossPay,
      deductions: r.deductions,
      netPay: r.netPay,
      status: r.batchId?.status,
      finalizedAt: r.batchId?.finalizedAt,
      paidAt: r.batchId?.paidAt
    }));

    return {
      payslips,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    };
  }

  /**
   * Staff-Facing: Get single detailed payslip strictly scoped to authenticated user
   */
  async getStaffPayslipByBatchId(user, batchId) {
    if (!mongoose.Types.ObjectId.isValid(batchId)) {
      throw new AppError('Invalid payroll batch ID format', 400);
    }

    const employee = await Employee.findOne({ user: user._id }).lean();
    if (!employee) {
      throw new AppError('Staff employee record not found for authenticated user', 404);
    }

    const batch = await PayrollBatch.findById(batchId).lean();
    if (!batch) {
      throw new AppError('Payroll batch not found', 404);
    }

    if (batch.status === 'DRAFT') {
      throw new AppError('Payslip is not yet available for unfinalized payroll', 403);
    }

    return await this.getEmployeePayslip(batchId, employee._id.toString());
  }
}

module.exports = new PayrollService();
