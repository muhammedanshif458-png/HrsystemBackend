const payrollService = require('../services/payrollService');
const { sendSuccess } = require('../utils/response');

class PayrollController {
  /**
   * GET /api/hr/payroll/summary?month=MM&year=YYYY&department=xxx
   */
  async getSummary(req, res, next) {
    try {
      const now = new Date();
      const month = parseInt(req.query.month, 10) || now.getMonth() + 1;
      const year = parseInt(req.query.year, 10) || now.getFullYear();
      const department = req.query.department || 'all';

      const summary = await payrollService.getPayrollSummary(year, month, department);
      return sendSuccess(res, 'Payroll summary retrieved successfully', summary);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/payroll/employees?month=MM&year=YYYY&department=xxx&page=1&limit=50
   */
  async getEmployeesPayroll(req, res, next) {
    try {
      const now = new Date();
      const month = parseInt(req.query.month, 10) || now.getMonth() + 1;
      const year = parseInt(req.query.year, 10) || now.getFullYear();
      const { department, search, page, limit } = req.query;

      const { payrollRecords, pagination } = await payrollService.getEmployeesPayroll(year, month, {
        department,
        search,
        page,
        limit
      });

      return sendSuccess(res, 'Employee payroll records retrieved successfully', payrollRecords, 200, pagination);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/payroll/employees/:employeeId?month=MM&year=YYYY
   */
  async getEmployeePayrollById(req, res, next) {
    try {
      const now = new Date();
      const month = parseInt(req.query.month, 10) || now.getMonth() + 1;
      const year = parseInt(req.query.year, 10) || now.getFullYear();

      const payroll = await payrollService.getSingleEmployeePayroll(req.params.employeeId, year, month);
      return sendSuccess(res, 'Employee payroll details retrieved successfully', payroll);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new PayrollController();
