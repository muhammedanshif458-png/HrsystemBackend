const mongoose = require('mongoose');

const leaveSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'Employee reference is required']
    },
    leaveType: {
      type: String,
      enum: {
        values: ['CASUAL', 'SICK', 'ANNUAL', 'MEDICAL', 'EARNED', 'UNPAID', 'OTHER'],
        message: '{VALUE} is not a valid leave type'
      },
      required: [true, 'Leave type is required']
    },
    durationType: {
      type: String,
      enum: {
        values: ['FULL_DAY', 'HALF_DAY'],
        message: '{VALUE} is not a valid duration type'
      },
      default: 'FULL_DAY'
    },
    halfDaySession: {
      type: String,
      enum: {
        values: ['FORENOON', 'AFTERNOON', null],
        message: '{VALUE} is not a valid half-day session'
      },
      default: null
    },
    totalDays: {
      type: Number,
      default: 1,
      min: [0.5, 'Duration cannot be less than 0.5 days']
    },
    duration: {
      type: Number,
      default: 1,
      min: [0.5, 'Duration cannot be less than 0.5 days']
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required']
    },
    endDate: {
      type: Date,
      required: [true, 'End date is required']
    },
    reason: {
      type: String,
      required: [true, 'Reason is required'],
      trim: true
    },
    status: {
      type: String,
      enum: {
        values: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
        message: '{VALUE} is not a valid leave status'
      },
      default: 'PENDING'
    },
    document: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HRDocument',
      default: null
    },
    documentUrl: {
      type: String,
      trim: true,
      default: null
    },
    documentName: {
      type: String,
      trim: true,
      default: null
    },
    attachment: {
      fileName: { type: String, default: null },
      originalName: { type: String, default: null },
      filePath: { type: String, default: null },
      fileType: { type: String, default: null },
      fileSize: { type: Number, default: null },
      fileUrl: { type: String, default: null }
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    approvedAt: {
      type: Date,
      default: null
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Indexes
leaveSchema.index({ employee: 1, status: 1 });
leaveSchema.index({ startDate: 1, endDate: 1 });

const Leave = mongoose.model('Leave', leaveSchema);

module.exports = Leave;
