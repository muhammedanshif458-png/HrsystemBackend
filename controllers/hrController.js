const hrService = require('../services/hrService');
const { sendSuccess } = require('../utils/response');

/**
 * HR Controller
 */
class HRController {
  async getEmployeeLoginHistory(req, res, next) {
    try {
      const { records, pagination } = await hrService.getEmployeeLoginHistory(req.params.employeeId, req.query);
      return sendSuccess(res, 'Employee login history fetched successfully', records, 200, pagination);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/dashboard
   */
  async getDashboard(req, res, next) {
    try {
      const stats = await hrService.getDashboardStats(req.query.date);
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
      const result = await hrService.deleteEmployee(req.params.id, {
        force: req.query.force === 'true' || req.body?.force === true,
        hard: req.query.hard === 'true' || req.body?.hard === true,
        currentUser: req.user
      });
      return sendSuccess(res, result.message, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/hr/employees/:id/deactivate
   */
  async deactivateEmployee(req, res, next) {
    try {
      const employee = await hrService.deactivateEmployee(req.params.id, {
        ...req.body,
        currentUser: req.user
      });
      return sendSuccess(res, 'Employee deactivated successfully', employee);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/hr/employees/:id/reactivate
   */
  async reactivateEmployee(req, res, next) {
    try {
      const employee = await hrService.reactivateEmployee(req.params.id);
      return sendSuccess(res, 'Employee reactivated successfully', employee);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/hr/employees/:id/restore
   */
  async restoreEmployee(req, res, next) {
    try {
      const employee = await hrService.restoreEmployee(req.params.id);
      return sendSuccess(res, 'Employee restored and reactivated successfully', employee);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/hr/employees/:id/resign
   */
  async resignEmployee(req, res, next) {
    try {
      const employee = await hrService.resignEmployee(req.params.id, {
        ...req.body,
        currentUser: req.user
      });
      return sendSuccess(res, 'Employee marked as resigned successfully', employee);
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
   * HR / Super Admin: Bulk delete selected leave requests (only APPROVED or REJECTED)
   * DELETE /api/hr/leaves
   * POST /api/hr/leaves/bulk-delete
   */
  async bulkDeleteLeaves(req, res, next) {
    try {
      if (req.body && (req.body.all === true || req.body.clearAll === true)) {
        const filters = {
          ...req.query,
          ...req.body
        };
        const result = await hrService.clearAllLeaves(filters);
        return sendSuccess(res, `Successfully cleared all ${result.deletedCount} ${result.status.toLowerCase()} leave request(s)`, result, 200);
      }
      let ids = (req.body && (req.body.ids || req.body.leaveIds || req.body.selectedIds)) ||
                (req.query && (req.query.ids || req.query.leaveIds || req.query.selectedIds)) ||
                (req.body && req.body.id ? [req.body.id] : null) ||
                (req.query && req.query.id ? [req.query.id] : null);
      if (typeof ids === 'string') {
        ids = ids.split(',').map(s => s.trim()).filter(Boolean);
      }
      const status = (req.body && req.body.status) || (req.query && req.query.status);
      const result = await hrService.bulkDeleteLeaves(ids, { status });
      return sendSuccess(res, `Successfully deleted ${result.deletedCount} leave request(s)`, result, 200);
    } catch (err) {
      next(err);
    }
  }

  /**
   * HR / Super Admin: Clear all eligible leave requests for an explicitly specified status (APPROVED or REJECTED)
   * DELETE /api/hr/leaves/all
   * POST /api/hr/leaves/clear-all
   */
  async clearAllLeaves(req, res, next) {
    try {
      const filters = {
        ...req.query,
        ...req.body
      };
      const result = await hrService.clearAllLeaves(filters);
      return sendSuccess(res, `Successfully cleared all ${result.deletedCount} ${result.status.toLowerCase()} leave request(s)`, result, 200);
    } catch (err) {
      next(err);
    }
  }

  /**
   * HR / Super Admin: Delete single leave request by ID (only APPROVED or REJECTED)
   * DELETE /api/hr/leaves/:id
   */
  async deleteLeaveById(req, res, next) {
    try {
      const result = await hrService.deleteLeaveById(req.params.id);
      return sendSuccess(res, 'Successfully deleted leave request', result, 200);
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
      const employee = await hrService.updateEmployeeStatus(req.params.id, req.body.status, {
        ...req.body,
        currentUser: req.user
      });
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

  async setDepartmentSchedule(req, res, next) {
    try {
      const schedule = await hrService.setDepartmentSchedule(req.params.deptKey, req.body);
      return sendSuccess(res, 'Department attendance schedule saved successfully', schedule);
    } catch (err) { next(err); }
  }

  async getDepartmentSchedule(req, res, next) {
    try {
      if (req.query.detailed === 'true' || req.query.date) {
        const scheduleInfo = await hrService.getDepartmentScheduleByKey(req.params.deptKey, req.query.date);
        return sendSuccess(res, 'Department schedule details retrieved successfully', scheduleInfo);
      }
      const schedule = await hrService.getDepartmentSchedule(req.params.deptKey);
      return sendSuccess(res, 'Department attendance schedule retrieved successfully', schedule);
    } catch (err) { next(err); }
  }

  /**
   * POST /api/hr/departments/schedules or /api/hr/departments/:deptKey/schedule
   */
  async createDepartmentSchedule(req, res, next) {
    try {
      const scheduleData = {
        department: req.body.department || req.params.deptKey,
        checkInTime: req.body.checkInTime,
        checkOutTime: req.body.checkOutTime,
        gracePeriodMinutes: req.body.gracePeriodMinutes,
        timezone: req.body.timezone,
        effectiveDate: req.body.effectiveDate,
        description: req.body.description,
        user: req.user
      };
      const schedule = await hrService.createDepartmentSchedule(scheduleData);
      return sendSuccess(res, 'Department schedule configured successfully', schedule, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/departments/schedules
   */
  async getDepartmentSchedules(req, res, next) {
    try {
      const schedules = await hrService.getDepartmentSchedules(req.query);
      return sendSuccess(res, 'Department schedules retrieved successfully', schedules);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/departments/:deptKey/schedule
   */
  async getDepartmentScheduleByKey(req, res, next) {
    try {
      const scheduleInfo = await hrService.getDepartmentScheduleByKey(req.params.deptKey, req.query.date);
      return sendSuccess(res, 'Department schedule details retrieved successfully', scheduleInfo);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/hr/attendance/reclassify
   */
  async reclassifyHistoricalAttendance(req, res, next) {
    try {
      const result = await hrService.reclassifyHistoricalAttendance({
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        department: req.body.department,
        dryRun: req.body.dryRun !== false,
        user: req.user
      });
      return sendSuccess(res, 'Attendance reclassification evaluation completed', result);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new HRController();

