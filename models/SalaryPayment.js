const mongoose = require('mongoose');

const salaryPaymentSchema = new mongoose.Schema({
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  employeeId: { type: String, required: true, trim: true, uppercase: true },
  employeeName: { type: String, required: true, trim: true },
  department: { type: String, required: true, trim: true, index: true },
  payrollBatch: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollBatch', required: true },
  payrollRecord: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollRecord', required: true },
  payrollMonth: { type: Number, required: true, min: 1, max: 12 },
  payrollYear: { type: Number, required: true, min: 2000, max: 2100 },
  monthlyBaseSalary: { type: Number, required: true, min: 0 },
  totalPresentDays: { type: Number, required: true, min: 0 },
  paidLeaveDays: { type: Number, required: true, min: 0 },
  lopDays: { type: Number, required: true, min: 0 },
  payableDays: { type: Number, required: true, min: 0 },
  netSalary: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['PENDING', 'PAID'], default: 'PENDING', required: true, index: true },
  paymentDate: { type: Date, default: null },
  paymentMethod: { type: String, enum: ['CASH', 'BANK_TRANSFER', 'UPI', null], default: null },
  transactionReference: { type: String, trim: true, default: '' },
  remarks: { type: String, trim: true, default: '' },
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  confirmedAt: { type: Date, default: null }
}, { timestamps: true });

salaryPaymentSchema.index({ employee: 1, payrollYear: 1, payrollMonth: 1 }, { unique: true });
salaryPaymentSchema.index({ payrollYear: -1, payrollMonth: -1, status: 1 });
salaryPaymentSchema.index({ department: 1, payrollYear: -1, payrollMonth: -1 });

module.exports = mongoose.models.SalaryPayment || mongoose.model('SalaryPayment', salaryPaymentSchema);
