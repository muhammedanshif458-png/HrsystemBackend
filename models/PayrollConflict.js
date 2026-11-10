const mongoose = require('mongoose');

const conflictAuditSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { _id: false }
);

const payrollConflictSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'Employee reference is required'],
      index: true
    },
    employeeId: {
      type: String,
      trim: true,
      default: ''
    },
    dateKey: {
      type: String, // 'YYYY-MM-DD'
      required: [true, 'Date key is required'],
      trim: true
    },
    conflictDate: {
      type: Date,
      required: [true, 'Conflict date is required']
    },
    year: {
      type: Number,
      required: true,
      index: true
    },
    month: {
      type: Number,
      required: true,
      index: true
    },
    conflictType: {
      type: String,
      enum: ['ATTENDANCE_AND_APPROVED_LEAVE', 'DUPLICATE_ATTENDANCE', 'OTHER'],
      default: 'ATTENDANCE_AND_APPROVED_LEAVE'
    },
    attendance: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Attendance',
      default: null
    },
    attendanceStatus: {
      type: String,
      default: ''
    },
    attendanceWorkMode: {
      type: String,
      default: 'Office'
    },
    leave: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Leave',
      default: null
    },
    leaveType: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['UNRESOLVED', 'RESOLVED'],
      default: 'UNRESOLVED',
      index: true
    },
    resolution: {
      decision: {
        type: String,
        enum: ['PRESENT', 'PAID_LEAVE', 'UNPAID_LEAVE', null],
        default: null
      },
      resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
      },
      resolvedAt: {
        type: Date,
        default: null
      },
      reason: {
        type: String,
        trim: true,
        default: ''
      }
    },
    auditHistory: {
      type: [conflictAuditSchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);

payrollConflictSchema.index({ employee: 1, dateKey: 1 }, { unique: true });
payrollConflictSchema.index({ year: 1, month: 1, status: 1 });

const PayrollConflict = mongoose.models.PayrollConflict || mongoose.model('PayrollConflict', payrollConflictSchema);

module.exports = PayrollConflict;

