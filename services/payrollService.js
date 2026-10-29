const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const { AppError } = require('../middleware/errorMiddleware');

class PayrollService {
  /**
   * Helper to compute standard working days in a given month and year
   * Tech: Mon-Fri (1..5)
   * Telecalling / Others: Mon-Sat (1..6)
   */
  getStandardWorkingDays(year, month, department = '') {
    const isTech = department.trim().toLowerCase() === 'tech' || department.trim().toLowerCase().includes('engineering');
    const daysInMonth = new Date(year, month, 0).getDate();
    let workingDays = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const dt = new Date(year, month - 1, day);
      const dayOfWeek = dt.getDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday
      if (isTech) {
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          workingDays++;
        }
      } else {
        if (dayOfWeek >= 1 && dayOfWeek <= 6) {
          workingDays++;
        }
      }
    }

    return workingDays;
  }

  /**
   * Calculate single employee payroll record for a given month and year
   */
  async calculateEmployeePayroll(employee, year, month) {
    const isTech = employee.department.toLowerCase() === 'tech' || employee.department.toLowerCase().includes('engineering');
    const standardWorkingDays = this.getStandardWorkingDays(year, month, employee.department);

    // Month boundary
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    // Find attendance records for the month
    const attendanceRecords = await Attendance.find({
      employee: employee._id,
      date: { $gte: startOfMonth, $lte: endOfMonth }
    }).lean();

    const actualPresentDays = attendanceRecords.filter((a) => {
      const status = (a.status || '').toUpperCase();
      return status === 'PRESENT' || status === 'HALF_DAY';
    }).length;

    // Find approved leaves overlapping with the month
    const approvedLeaves = await Leave.find({
      employee: employee._id,
      status: 'APPROVED',
      startDate: { $lte: endOfMonth },
      endDate: { $gte: startOfMonth }
    }).lean();

    // Calculate approved leave days strictly inside the target month
    let totalApprovedLeaveDays = 0;
    approvedLeaves.forEach((leave) => {
      const start = new Date(Math.max(new Date(leave.startDate).getTime(), startOfMonth.getTime()));
      const end = new Date(Math.min(new Date(leave.endDate).getTime(), endOfMonth.getTime()));
      const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
      totalApprovedLeaveDays += Math.max(0, diffDays);
    });

    const paidLeaveAllowance = typeof employee.paidLeaveAllowance === 'number' ? employee.paidLeaveAllowance : 1;
    const paidLeaveDays = totalApprovedLeaveDays > paidLeaveAllowance ? paidLeaveAllowance : totalApprovedLeaveDays;
    const unpaidLeaveDays = totalApprovedLeaveDays > paidLeaveAllowance ? totalApprovedLeaveDays - paidLeaveAllowance : 0;

    // If staff has no attendance records recorded yet (e.g. active default policy),
    // calculate effective present as standard working days minus leaves
    let effectivePresent = actualPresentDays > 0
      ? actualPresentDays
      : (employee.status === 'ACTIVE' ? Math.max(0, standardWorkingDays - totalApprovedLeaveDays) : 0);

    const payableDays = effectivePresent + paidLeaveDays;
    const grossSalary = employee.salary || 0;
    const dailyRate = standardWorkingDays > 0 ? grossSalary / standardWorkingDays : 0;
    const deductions = Math.round(unpaidLeaveDays * dailyRate * 100) / 100;
    const netPay = Math.max(0, Math.round((grossSalary - deductions) * 100) / 100);

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
        salaryCurrency: employee.salaryCurrency || 'INR'
      },
      year,
      month,
      standardWorkingDays,
      presentDays: effectivePresent,
      approvedLeaves: totalApprovedLeaveDays,
      paidLeaveDays,
      unpaidLeaveDays,
      payableDays,
      grossSalary,
      dailyRate: Math.round(dailyRate * 100) / 100,
      deductions,
      netPay
    };
  }

  /**
   * Get Payroll Summary for a specific month and year
   */
  async getPayrollSummary(year, month, departmentFilter = '') {
    const filter = { status: { $ne: 'TERMINATED' }, isDeleted: { $ne: true } };
    if (departmentFilter && departmentFilter !== 'all') {
      filter.department = new RegExp(`^${departmentFilter.trim()}$`, 'i');
    }

    const employees = await Employee.find(filter).lean();

    let totalPayrollExpenditure = 0;
    let totalDeductions = 0;
    let totalNetPayout = 0;

    for (const emp of employees) {
      const calc = await this.calculateEmployeePayroll(emp, year, month);
      totalPayrollExpenditure += calc.grossSalary;
      totalDeductions += calc.deductions;
      totalNetPayout += calc.netPay;
    }

    return {
      year,
      month,
      department: departmentFilter || 'all',
      totalEmployees: employees.length,
      totalPayrollExpenditure: Math.round(totalPayrollExpenditure * 100) / 100,
      totalDeductions: Math.round(totalDeductions * 100) / 100,
      totalNetPayout: Math.round(totalNetPayout * 100) / 100
    };
  }

  /**
   * Get itemized payroll calculations for all employees
   */
  async getEmployeesPayroll(year, month, { department, search, page = 1, limit = 50 } = {}) {
    const filter = { isDeleted: { $ne: true } };
    if (department && department !== 'all') {
      filter.department = new RegExp(`^${department.trim()}$`, 'i');
    }

    if (search && search.trim() !== '') {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { employeeId: regex },
        { designation: regex }
      ];
    }

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
    const mongoose = require('mongoose');
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
}

module.exports = new PayrollService();
