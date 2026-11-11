const mongoose = require('mongoose');
const SalaryPayment = require('../models/SalaryPayment');
const PayrollBatch = require('../models/PayrollBatch');
const PayrollRecord = require('../models/PayrollRecord');
const PayrollConflict = require('../models/PayrollConflict');
const { AppError } = require('../middleware/errorMiddleware');

function validatePeriod(year, month) {
  year = Number.parseInt(year, 10);
  month = Number.parseInt(month, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new AppError('Valid payroll year (2000-2100) and month (1-12) are required', 400);
  }
  return { year, month };
}

function mapSnapshot(batch, record) {
  const breakdown = record.calculationBreakdown || {};
  return {
    employee: record.employee,
    employeeId: record.employeeId,
    employeeName: record.employeeName,
    department: record.department,
    payrollBatch: batch._id,
    payrollRecord: record._id,
    payrollMonth: batch.month,
    payrollYear: batch.year,
    legacyBatchStatus: batch.status,
    monthlyBaseSalary: record.monthlyBaseSalary,
    totalPresentDays: Number(record.presentDays || 0) + Number(record.wfhDays || 0),
    paidLeaveDays: Number(record.paidLeaveDays || 0),
    lopDays: Number(record.lopDays || 0),
    payableDays: Number(record.payableDays || 0),
    netSalary: record.netPay,
    // Retain calculation snapshot-derived values only; no salary is recalculated here.
    calculationBreakdown: breakdown
  };
}

class SalaryPaymentService {
  async loadPeriodSnapshots(year, month) {
    ({ year, month } = validatePeriod(year, month));
    const batches = await PayrollBatch.find({ year, month, status: { $in: ['FINALIZED', 'PAID'] } }).sort({ createdAt: -1 }).lean();
    if (!batches.length) return { year, month, snapshots: [] };
    const records = await PayrollRecord.find({ batchId: { $in: batches.map(batch => batch._id) } }).lean();
    const batchById = new Map(batches.map(batch => [String(batch._id), batch]));
    const seen = new Set();
    const snapshots = [];
    for (const record of records) {
      const batch = batchById.get(String(record.batchId));
      if (!batch) continue;
      const employeeKey = String(record.employee);
      if (seen.has(employeeKey)) {
        throw new AppError(`Multiple finalized payroll snapshots found for employee ${record.employeeId} in ${month}/${year}`, 409);
      }
      seen.add(employeeKey);
      snapshots.push(mapSnapshot(batch, record));
    }
    return { year, month, snapshots };
  }

  async getPayments(year, month, filters = {}) {
    const loaded = await this.loadPeriodSnapshots(year, month);
    // Materialize one PENDING row per finalized snapshot so each list item has a stable payment ID.
    const ensured = await Promise.all(loaded.snapshots.map(snapshot => this.ensurePending(snapshot)));
    const stored = ensured.filter(Boolean).map(item => item.toObject ? item.toObject() : item);
    if (stored.length) await SalaryPayment.populate(stored, { path: 'confirmedBy', select: 'firstName lastName email' });
    const storedByRecord = new Map(stored.map(item => [String(item.payrollRecord), item]));
    let payments = loaded.snapshots.map(snapshot => {
      const payment = storedByRecord.get(String(snapshot.payrollRecord));
      const status = payment?.status || 'PENDING';
      return {
        ...snapshot,
        ...payment,
        status,
        // A legacy batch status is not evidence of an employee-level salary transfer.
        paymentStatusEvidence: status === 'PAID' ? 'EMPLOYEE_PAYMENT_CONFIRMED' : 'NO_EMPLOYEE_PAYMENT_CONFIRMATION'
      };
    });
    if (filters.department && filters.department !== 'all') {
      const exact = String(filters.department).trim().toLowerCase();
      payments = payments.filter(item => item.department.toLowerCase() === exact);
    }
    if (filters.search) {
      const search = String(filters.search).trim().toLowerCase();
      payments = payments.filter(item => `${item.employeeId} ${item.employeeName}`.toLowerCase().includes(search));
    }
    if (filters.employeeId) payments = payments.filter(item => item.employeeId.toLowerCase() === String(filters.employeeId).toLowerCase());
    if (filters.status && filters.status !== 'all') payments = payments.filter(item => item.status === String(filters.status).toUpperCase());
    payments.sort((a, b) => a.department.localeCompare(b.department) || a.employeeName.localeCompare(b.employeeName));
    return payments;
  }

  summarize(payments, year, month) {
    const paid = payments.filter(item => item.status === 'PAID');
    const pending = payments.filter(item => item.status === 'PENDING');
    const sum = rows => Math.round(rows.reduce((total, row) => total + Number(row.netSalary || 0), 0) * 100) / 100;
    return { year, month, totalEmployees: payments.length, totalSalary: sum(payments), paidEmployees: paid.length, pendingEmployees: pending.length, paidAmount: sum(paid), pendingAmount: sum(pending) };
  }

  async list(year, month, filters = {}) {
    const payments = await this.getPayments(year, month, filters);
    const page = Math.max(1, Number.parseInt(filters.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(filters.limit, 10) || 50));
    const start = (page - 1) * limit;
    return { payments: payments.slice(start, start + limit), pagination: { page, limit, total: payments.length, totalPages: Math.ceil(payments.length / limit) || 1 }, summary: this.summarize(payments, Number(year), Number(month)) };
  }

  async getSummary(year, month, filters = {}) {
    const payments = await this.getPayments(year, month, filters);
    return this.summarize(payments, Number(year), Number(month));
  }

  async ensurePending(snapshot) {
    try {
      return await SalaryPayment.findOneAndUpdate(
        { employee: snapshot.employee, payrollYear: snapshot.payrollYear, payrollMonth: snapshot.payrollMonth },
        { $setOnInsert: snapshot },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (error) {
      if (error.code === 11000) {
        return SalaryPayment.findOne({ employee: snapshot.employee, payrollYear: snapshot.payrollYear, payrollMonth: snapshot.payrollMonth });
      }
      throw error;
    }
  }

  async markPaid(paymentId, input, confirmedBy) {
    if (!mongoose.Types.ObjectId.isValid(paymentId)) throw new AppError('Invalid salary payment ID', 400);
    const paymentDate = new Date(input.paymentDate);
    if (!input.paymentDate || Number.isNaN(paymentDate.getTime())) throw new AppError('A valid paymentDate is required', 400);
    const paymentMethod = String(input.paymentMethod || '').trim().toUpperCase();
    if (!['CASH', 'BANK_TRANSFER', 'UPI'].includes(paymentMethod)) throw new AppError('paymentMethod must be CASH, BANK_TRANSFER, or UPI', 400);
    const transactionReference = String(input.transactionReference || '').trim();
    if (['BANK_TRANSFER', 'UPI'].includes(paymentMethod) && !transactionReference) throw new AppError('transactionReference is required for Bank Transfer and UPI payments', 400);

    const existing = await SalaryPayment.findById(paymentId);
    if (!existing) throw new AppError('Salary payment not found', 404);
    if (existing.status === 'PAID') throw new AppError('Salary payment has already been confirmed as PAID', 409);
    const batch = await PayrollBatch.findById(existing.payrollBatch).lean();
    const record = await PayrollRecord.findOne({ _id: existing.payrollRecord, batchId: existing.payrollBatch }).lean();
    if (!batch || !['FINALIZED', 'PAID'].includes(batch.status) || !record || !record.employee || record.netPay == null) {
      throw new AppError('Payment requires a valid finalized payroll snapshot', 409);
    }
    const conflicts = await PayrollConflict.countDocuments({ employee: existing.employee, year: existing.payrollYear, month: existing.payrollMonth, status: 'UNRESOLVED' });
    if (conflicts > 0 || Number(batch.unresolvedConflictCount || 0) > 0) throw new AppError('Cannot confirm payment while unresolved payroll conflicts exist', 409);

    const updated = await SalaryPayment.findOneAndUpdate(
      { _id: paymentId, status: 'PENDING' },
      { $set: { status: 'PAID', paymentDate, paymentMethod, transactionReference, remarks: String(input.remarks || '').trim(), confirmedBy: confirmedBy?._id || confirmedBy, confirmedAt: new Date() } },
      { new: true, runValidators: true }
    ).populate('confirmedBy', 'firstName lastName email');
    if (!updated) throw new AppError('Salary payment has already been confirmed as PAID', 409);
    return updated;
  }

  async getPayment(paymentId) {
    if (!mongoose.Types.ObjectId.isValid(paymentId)) throw new AppError('Invalid salary payment ID', 400);
    const payment = await SalaryPayment.findById(paymentId).populate('confirmedBy', 'firstName lastName email').lean();
    if (!payment) throw new AppError('Salary payment not found', 404);
    return payment;
  }

  async getHistory(filters = {}) {
    const query = {};
    const year = filters.year ? Number.parseInt(filters.year, 10) : null;
    const month = filters.month ? Number.parseInt(filters.month, 10) : null;
    if (filters.year && (!Number.isInteger(year) || year < 2000 || year > 2100)) throw new AppError('Invalid year filter', 400);
    if (filters.month && (!Number.isInteger(month) || month < 1 || month > 12)) throw new AppError('Invalid month filter', 400);
    if (year) query.payrollYear = year;
    if (month) query.payrollMonth = month;
    if (filters.employeeId) query.employeeId = new RegExp(`^${String(filters.employeeId).trim()}$`, 'i');
    if (filters.department && filters.department !== 'all') query.department = new RegExp(`^${String(filters.department).trim()}$`, 'i');
    if (filters.status && filters.status !== 'all') {
      const status = String(filters.status).toUpperCase();
      if (!['PENDING', 'PAID'].includes(status)) throw new AppError('status must be PENDING or PAID', 400);
      query.status = status;
    }
    if (filters.search) {
      const regex = new RegExp(String(filters.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ employeeName: regex }, { employeeId: regex }];
    }
    const page = Math.max(1, Number.parseInt(filters.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(filters.limit, 10) || 50));
    const [payments, total] = await Promise.all([
      SalaryPayment.find(query).populate('confirmedBy', 'firstName lastName email').sort({ payrollYear: -1, payrollMonth: -1, paymentDate: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      SalaryPayment.countDocuments(query)
    ]);
    return { payments, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 } };
  }
}

module.exports = new SalaryPaymentService();
