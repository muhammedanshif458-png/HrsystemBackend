const mongoose = require('mongoose');

const dailyUpdateSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'Employee reference is required']
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required']
    },
    department: {
      type: String,
      required: [true, 'Department is required'],
      trim: true
    },
    date: {
      type: String,
      required: [true, 'Date is required'],
      trim: true,
      default: () => new Date().toISOString().split('T')[0]
    },
    title: {
      type: String,
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
      default: ''
    },
    updateText: {
      type: String,
      required: [true, 'Update text is required'],
      trim: true,
      minlength: [2, 'Update text must be at least 2 characters long'],
      maxlength: [2000, 'Update text cannot exceed 2000 characters']
    },
    tasksCompleted: {
      type: [String],
      default: []
    },
    blockers: {
      type: String,
      trim: true,
      default: ''
    },
    hoursWorked: {
      type: Number,
      min: [0, 'Hours worked cannot be negative'],
      max: [24, 'Hours worked cannot exceed 24'],
      default: null
    },
    isDeleted: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

// Compound and single field indexes for efficient querying
dailyUpdateSchema.index({ employee: 1, date: -1 });
dailyUpdateSchema.index({ department: 1, date: -1 });
dailyUpdateSchema.index({ date: -1 });
dailyUpdateSchema.index({ isDeleted: 1 });
dailyUpdateSchema.index({ createdAt: -1 });

const DailyUpdate = mongoose.model('DailyUpdate', dailyUpdateSchema);

module.exports = DailyUpdate;
