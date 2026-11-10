const mongoose = require('mongoose');

const payrollRecordSchema = new mongoose.Schema(
  {
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PayrollBatch',
      required: [true, 'Batch reference is required'],
      index: true
    },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'Employee reference is required'],
      index: true
    },
    employeeId: {
      type: String,
      required: [true, 'Employee ID snapshot is required'],
      trim: true,
      uppercase: true
    },
    employeeName: {
      type: String,
      required: [true, 'Employee name snapshot is required'],
      trim: true
    },
    department: {
      type: String,
      required: [true, 'Department snapshot is required'],
      trim: true
    },
    designation: {
      type: String,
      trim: true,
      default: ''
    },
    monthlyBaseSalary: {
      type: Number,
      required: true,
      min: [0, 'Monthly base salary cannot be negative']
    },
    salaryCurrency: {
      type: String,
      trim: true,
      default: 'INR'
    },
    scheduledWorkingDays: {
      type: Number,
      required: true,
      min: [0, 'Scheduled working days cannot be negative']
    },
    presentDays: {
      type: Number,
      default: 0,
      min: 0
    },
    halfDays: {
      type: Number,
      default: 0,
      min: 0
    },
    wfhDays: {
      type: Number,
      default: 0,
      min: 0
    },
    weeklyOffs: {
      type: Number,
      default: 0,
      min: 0
    },
    holidays: {
      type: Number,
      default: 0,
      min: 0
    },
    paidLeaveDays: {
      type: Number,
      default: 0,
      min: 0
    },
    unpaidLeaveDays: {
      type: Number,
      default: 0,
      min: 0
    },
    lopDays: {
      type: Number,
      default: 0,
      min: 0
    },
    payableDays: {
      type: Number,
      required: true,
      min: 0
    },
    dailySalary: {
      type: Number,
      required: true,
      min: 0
    },
    grossPay: {
      type: Number,
      required: true,
      min: 0
    },
    deductions: {
      type: Number,
      default: 0,
      min: 0
    },
    netPay: {
      type: Number,
      required: true,
      min: 0
    },
    calculationBreakdown: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Prevent duplicate employee records in the same payroll batch
payrollRecordSchema.index({ batchId: 1, employee: 1 }, { unique: true });
payrollRecordSchema.index({ employee: 1, createdAt: -1 });

const PayrollRecord = mongoose.models.PayrollRecord || mongoose.model('PayrollRecord', payrollRecordSchema);

module.exports = PayrollRecord;

