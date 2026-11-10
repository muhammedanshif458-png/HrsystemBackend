const mongoose = require('mongoose');

const paymentDetailsSchema = new mongoose.Schema(
  {
    paymentMethod: {
      type: String,
      trim: true,
      default: ''
    },
    reference: {
      type: String,
      trim: true,
      default: ''
    },
    remarks: {
      type: String,
      trim: true,
      default: ''
    },
    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  { _id: false }
);

const payrollBatchSchema = new mongoose.Schema(
  {
    year: {
      type: Number,
      required: [true, 'Year is required'],
      min: [2000, 'Year must be at least 2000'],
      max: [2100, 'Year cannot exceed 2100'],
      index: true
    },
    month: {
      type: Number,
      required: [true, 'Month is required'],
      min: [1, 'Month must be between 1 and 12'],
      max: [12, 'Month must be between 1 and 12'],
      index: true
    },
    department: {
      type: String,
      trim: true,
      default: 'all',
      index: true
    },
    status: {
      type: String,
      enum: {
        values: ['DRAFT', 'FINALIZED', 'PAID'],
        message: '{VALUE} is not a valid payroll batch status'
      },
      default: 'DRAFT',
      index: true
    },
    grossSalary: {
      type: Number,
      default: 0,
      min: [0, 'Gross salary cannot be negative']
    },
    totalMonthlyBaseSalary: {
      type: Number,
      default: 0,
      min: [0, 'Total monthly base salary cannot be negative']
    },
    totalDeductions: {
      type: Number,
      default: 0,
      min: [0, 'Total deductions cannot be negative']
    },
    netPay: {
      type: Number,
      default: 0,
      min: [0, 'Net pay cannot be negative']
    },
    totalNetPayout: {
      type: Number,
      default: 0,
      min: [0, 'Total net payout cannot be negative']
    },
    employeeCount: {
      type: Number,
      default: 0,
      min: [0, 'Employee count cannot be negative']
    },
    unresolvedConflictCount: {
      type: Number,
      default: 0,
      min: [0, 'Unresolved conflict count cannot be negative']
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Creator user reference is required']
    },
    finalizedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    finalizedAt: {
      type: Date,
      default: null
    },
    paidAt: {
      type: Date,
      default: null
    },
    paymentDetails: {
      type: paymentDetailsSchema,
      default: () => ({ paymentMethod: '', reference: '', remarks: '', paidBy: null })
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Prevent duplicate batches for the same period and department scope
payrollBatchSchema.index({ year: 1, month: 1, department: 1 }, { unique: true });
payrollBatchSchema.index({ status: 1, year: 1, month: 1 });

const PayrollBatch = mongoose.models.PayrollBatch || mongoose.model('PayrollBatch', payrollBatchSchema);

module.exports = PayrollBatch;

