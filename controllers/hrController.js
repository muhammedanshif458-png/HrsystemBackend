const hrService = require('../services/hrService');
const { sendSuccess } = require('../utils/response');

/**
 * HR Controller
 */
class HRController {
  /**
   * GET /api/hr/dashboard
   */
  async getDashboard(req, res, next) {
    try {
      const stats = await hrService.getDashboardStats();
      return sendSuccess(res, 'HR dashboard statistics fetched successfully', stats);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/employees
   */
  async getEmployees(req, res, next) {
    try {
      const { employees, pagination } = await hrService.getEmployees(req.query);
      return sendSuccess(res, 'Employees fetched successfully', employees, 200, pagination);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/hr/employees
   */
  async createEmployee(req, res, next) {
    try {
      const employee = await hrService.createEmployee(req.body, req.user);
      return sendSuccess(res, 'Employee created successfully', employee, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/employees/:id
   */
  async getEmployeeById(req, res, next) {
    try {
      const employee = await hrService.getEmployeeById(req.params.id);
      return sendSuccess(res, 'Employee fetched successfully', employee);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/hr/employees/:id
   */
  async updateEmployee(req, res, next) {
    try {
      const updated = await hrService.updateEmployee(req.params.id, req.body, req.user);
      return sendSuccess(res, 'Employee updated successfully', updated);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/hr/employees/:id/salary
   * Update employee salary with history tracking
   */
  async updateSalary(req, res, next) {
    try {
      const employee = await hrService.updateSalary(req.params.id, {
        ...req.body,
        changedBy: req.user ? `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'HR Admin' : 'HR Admin'
      });
      return sendSuccess(res, 'Salary updated successfully', employee);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/hr/employees/:id
   */
  async deleteEmployee(req, res, next) {
    try {
      const result = await hrService.deleteEmployee(req.params.id);
      return sendSuccess(res, result.message, null);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/attendance
   */
  async getAttendance(req, res, next) {
    try {
      const { attendance, pagination } = await hrService.getAttendance(req.query);
      return sendSuccess(res, 'Attendance records fetched successfully', attendance, 200, pagination);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/attendance/:employeeId
   */
  async getAttendanceByEmployeeId(req, res, next) {
    try {
      const { attendance, pagination } = await hrService.getAttendanceByEmployeeId(req.params.employeeId, req.query);
      return sendSuccess(res, 'Employee attendance records fetched successfully', attendance, 200, pagination);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/leaves
   */
  async getLeaves(req, res, next) {
    try {
      const { leaves, pagination } = await hrService.getLeaves(req.query);
      return sendSuccess(res, 'Leave requests fetched successfully', leaves, 200, pagination);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/leaves/:id
   */
  async getLeaveById(req, res, next) {
    try {
      const leave = await hrService.getLeaveById(req.params.id);
      return sendSuccess(res, 'Leave request fetched successfully', leave);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/hr/leaves/:id/approve
   */
  async approveLeave(req, res, next) {
    try {
      const leave = await hrService.approveLeave(req.params.id, req.user._id);
      return sendSuccess(res, 'Leave request approved successfully', leave);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/hr/leaves/:id/reject
   */
  async rejectLeave(req, res, next) {
    try {
      const leave = await hrService.rejectLeave(req.params.id, req.user._id, req.body.rejectionReason);
      return sendSuccess(res, 'Leave request rejected successfully', leave);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/reports/attendance
   */
  async getAttendanceReports(req, res, next) {
    try {
      const reports = await hrService.getAttendanceReports(req.query);
      return sendSuccess(res, 'Attendance report generated successfully', reports);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/reports/leaves
   */
  async getLeaveReports(req, res, next) {
    try {
      const reports = await hrService.getLeaveReports(req.query);
      return sendSuccess(res, 'Leave report generated successfully', reports);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/hr/employees/:id/status
   */
  async updateStatus(req, res, next) {
    try {
      const employee = await hrService.updateEmployeeStatus(req.params.id, req.body.status);
      return sendSuccess(res, 'Employee status updated successfully', employee);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/departments
   */
  async getDepartments(req, res, next) {
    try {
      const departments = await hrService.getDepartments();
      return sendSuccess(res, 'Departments retrieved successfully', departments);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/departments/:deptKey
   */
  async getDepartmentByKey(req, res, next) {
    try {
      const dept = await hrService.getDepartmentByKey(req.params.deptKey);
      return sendSuccess(res, 'Department retrieved successfully', dept);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/birthdays
   */
  async getBirthdays(req, res, next) {
    try {
      const daysAhead = req.query.daysAhead !== undefined ? parseInt(req.query.daysAhead, 10) : 30;
      const birthdays = await hrService.getCompanyBirthdays(daysAhead);
      return sendSuccess(res, 'Company birthdays fetched successfully', birthdays);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new HRController();

