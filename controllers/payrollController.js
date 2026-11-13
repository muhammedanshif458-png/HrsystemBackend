const payrollService = require('../services/payrollService');
const salaryPaymentService = require('../services/salaryPaymentService');
const { sendSuccess } = require('../utils/response');

class PayrollController {
  /** GET /api/hr/payroll/payments?month=&year= */
  async getSalaryPayments(req, res, next) {
    try {
      const now = new Date();
      const month = req.query.month || now.getMonth() + 1;
      const year = req.query.year || now.getFullYear();
      const result = await salaryPaymentService.list(year, month, req.query);
      return sendSuccess(res, 'Salary payments retrieved successfully', result.payments, 200, { pagination: result.pagination, summary: result.summary });
    } catch (err) { next(err); }
  }

  /** GET /api/hr/payroll/payments/summary?month=&year= */
  async getSalaryPaymentSummary(req, res, next) {
    try {
      const now = new Date();
      const summary = await salaryPaymentService.getSummary(req.query.year || now.getFullYear(), req.query.month || now.getMonth() + 1, req.query);
      return sendSuccess(res, 'Salary payment summary retrieved successfully', summary);
    } catch (err) { next(err); }
  }

  /** GET /api/hr/payroll/payments/history */
  async getSalaryPaymentHistory(req, res, next) {
    try {
      const result = await salaryPaymentService.getHistory(req.query);
      return sendSuccess(res, 'Salary payment history retrieved successfully', result.payments, 200, result.pagination);
    } catch (err) { next(err); }
  }

  /** GET /api/hr/payroll/payments/:paymentId */
  async getSalaryPayment(req, res, next) {
    try {
      const payment = await salaryPaymentService.getPayment(req.params.paymentId);
      return sendSuccess(res, 'Salary payment details retrieved successfully', payment);
    } catch (err) { next(err); }
  }

  /** POST /api/hr/payroll/payments/:paymentId/mark-paid */
  async markSalaryPaymentPaid(req, res, next) {
    try {
      const payment = await salaryPaymentService.markPaid(req.params.paymentId, req.body, req.user);
      return sendSuccess(res, 'Salary payment marked as paid successfully', payment);
    } catch (err) { next(err); }
  }

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
      const { department, search, status, page, limit } = req.query;

      const { payrollRecords, pagination } = await payrollService.getEmployeesPayroll(year, month, {
        department,
        search,
        status,
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

  /**
   * GET /api/hr/payroll/conflicts?month=MM&year=YYYY&department=xxx&status=xxx
   */
  async getConflicts(req, res, next) {
    try {
      const now = new Date();
      const month = parseInt(req.query.month, 10) || now.getMonth() + 1;
      const year = parseInt(req.query.year, 10) || now.getFullYear();
      const { department, status, employeeId, page, limit } = req.query;

      const result = await payrollService.getConflicts(year, month, {
        department,
        status,
        employeeId,
        page,
        limit
      });

      return sendSuccess(res, 'Payroll conflicts retrieved successfully', result.conflicts, 200, result.pagination);
    } catch (err) {
      next(err);
    }
  }

  /** POST /api/hr/payroll/conflicts/archive-resolved */
  async archiveResolvedConflicts(req, res, next) {
    try {
      const archivedCount = await payrollService.archiveResolvedConflicts(req.user);
      return sendSuccess(res, 'Resolved payroll conflicts archived successfully', { archivedCount });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/hr/payroll/conflicts/:conflictId/resolve
   */
  async resolveConflict(req, res, next) {
    try {
      const { conflictId } = req.params;
      const { decision, reason } = req.body;

      const resolved = await payrollService.resolveConflict(
        conflictId,
        { decision, reason },
        req.user
      );

      return sendSuccess(res, 'Payroll conflict resolved successfully', resolved);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/hr/payroll/batches/draft
   * POST /api/hr/payroll/batches
   */
  async createDraftBatch(req, res, next) {
    try {
      const now = new Date();
      const year = parseInt(req.body.year || req.query.year, 10) || now.getFullYear();
      const month = parseInt(req.body.month || req.query.month, 10) || now.getMonth() + 1;
      const department = req.body.department || req.query.department || 'all';
      const notes = req.body.notes || '';

      const result = await payrollService.createOrUpdateDraftBatch(
        year,
        month,
        department,
        req.user,
        notes
      );

      return sendSuccess(res, 'Payroll draft batch created successfully', result, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/hr/payroll/batches/finalize
   * POST /api/hr/payroll/batches/:batchId/finalize
   */
  async finalizeBatch(req, res, next) {
    try {
      let batchId = req.params.batchId || req.body.batchId;

      // If batchId is not directly passed, check if year and month were passed to locate draft
      if (!batchId && (req.body.year && req.body.month)) {
        const year = parseInt(req.body.year, 10);
        const month = parseInt(req.body.month, 10);
        const department = req.body.department || 'all';
        const PayrollBatch = require('../models/PayrollBatch');
        const draft = await PayrollBatch.findOne({
          year,
          month,
          department: new RegExp(`^${department}$`, 'i'),
          status: 'DRAFT'
        });
        if (draft) {
          batchId = draft._id;
        }
      }

      if (!batchId) {
        const { AppError } = require('../middleware/errorMiddleware');
        throw new AppError('batchId is required to finalize payroll', 400);
      }

      const finalized = await payrollService.finalizePayrollBatch(batchId, req.user);
      return sendSuccess(res, 'Payroll batch finalized successfully', finalized);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/hr/payroll/batches/:batchId/pay
   */
  async markBatchAsPaid(req, res, next) {
    try {
      const { batchId } = req.params;
      const { paymentMethod, reference, remarks } = req.body;

      const paidBatch = await payrollService.markBatchAsPaid(
        batchId,
        { paymentMethod, reference, remarks },
        req.user
      );

      return sendSuccess(res, 'Payroll batch marked as paid successfully', paidBatch);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/payroll/batches?year=YYYY&month=MM&department=xxx&status=xxx
   */
  async getBatches(req, res, next) {
    try {
      const { year, month, department, status, page, limit } = req.query;
      const result = await payrollService.getBatches({
        year,
        month,
        department,
        status,
        page,
        limit
      });

      return sendSuccess(res, 'Payroll batches retrieved successfully', result.batches, 200, result.pagination);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/payroll/batches/:batchId?page=1&limit=50&search=xxx
   */
  async getBatchById(req, res, next) {
    try {
      const { batchId } = req.params;
      const { page, limit, search } = req.query;

      const result = await payrollService.getBatchById(batchId, {
        page,
        limit,
        search
      });

      return sendSuccess(res, 'Payroll batch details retrieved successfully', result.batch, 200, {
        records: result.records,
        pagination: result.pagination
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/payroll/batches/:batchId/employees/:employeeId/payslip
   */
  async getEmployeePayslip(req, res, next) {
    try {
      const { batchId, employeeId } = req.params;
      const payslip = await payrollService.getEmployeePayslip(batchId, employeeId);
      return sendSuccess(res, 'Employee payslip retrieved successfully', payslip);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/staff/payslips
   */
  async getStaffPayslips(req, res, next) {
    try {
      const { page, limit } = req.query;
      const result = await payrollService.getStaffPayslips(req.user, { page, limit });
      return sendSuccess(res, 'Staff payslips retrieved successfully', result.payslips, 200, result.pagination);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/staff/payslips/:batchId
   */
  async getStaffPayslipByBatchId(req, res, next) {
    try {
      const { batchId } = req.params;
      const payslip = await payrollService.getStaffPayslipByBatchId(req.user, batchId);
      return sendSuccess(res, 'Staff payslip retrieved successfully', payslip);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new PayrollController();
