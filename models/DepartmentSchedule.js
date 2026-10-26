const mongoose = require('mongoose');

const departmentScheduleSchema = new mongoose.Schema(
  {
    department: {
      type: String,
      required: [true, 'Department is required'],
      trim: true,
      uppercase: true // Canonical uppercase index (e.g. 'TECH', 'TELECALLING')
    },
    departmentDisplay: {
      type: String,
      trim: true,
      default: ''
    },
    checkInTime: {
      type: String,
      required: [true, 'Check-in time is required (format HH:mm)'],
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'Check-in time must be in 24-hour HH:mm format']
    },
    checkOutTime: {
      type: String,
      default: '18:00',
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'Check-out time must be in 24-hour HH:mm format']
    },
    gracePeriodMinutes: {
      type: Number,
      default: 0,
      min: [0, 'Grace period cannot be negative']
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata',
      required: [true, 'Timezone is required']
    },
    effectiveDate: {
      type: Date,
      required: [true, 'Effective date is required']
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Compound index for fast effective-date lookups per department
departmentScheduleSchema.index({ department: 1, effectiveDate: -1, createdAt: -1 });

/**
 * Normalizes input department name to canonical department key
 */
departmentScheduleSchema.statics.toCanonicalDeptKey = function(deptName) {
  if (!deptName) return '';
  const d = deptName.trim().toUpperCase();
  if (d.includes('TECH') || d.includes('ENGINEERING')) return 'TECH';
  if (d.includes('TELE') || d.includes('CALLING') || d.includes('CLIENT')) return 'TELECALLING';
  return d;
};

/**
 * Static method to fetch the active schedule effective on a specific date
 * Resolves the latest versioned schedule with effectiveDate <= targetDate
 */
departmentScheduleSchema.statics.getEffectiveSchedule = async function(departmentName, targetDate = new Date()) {
  if (!departmentName) return null;
  const rawDept = departmentName.trim().toUpperCase();
  const canonicalDept = this.toCanonicalDeptKey(departmentName);

  const dateObj = new Date(targetDate);

  // Normalize end of day to include schedules effective on this date
  const endOfTargetDate = new Date(dateObj);
  endOfTargetDate.setUTCHours(23, 59, 59, 999);

  return this.findOne({
    department: { $in: [canonicalDept, rawDept] },
    effectiveDate: { $lte: endOfTargetDate }
  })
    .sort({ effectiveDate: -1, createdAt: -1 })
    .lean();
};

const DepartmentSchedule = mongoose.model('DepartmentSchedule', departmentScheduleSchema);

module.exports = DepartmentSchedule;
