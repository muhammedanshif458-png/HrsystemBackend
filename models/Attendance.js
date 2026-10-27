const mongoose = require('mongoose');

const breakItemSchema = new mongoose.Schema(
  {
    breakType: {
      type: String,
      enum: {
        values: [
          'Tea Break 1',
          'Lunch Break',
          'Tea Break 2',
          'Morning Break',
          'Afternoon Break'
        ],
        message: '{VALUE} is not a valid break type'
      },
      required: [true, 'Break type is required']
    },
    startTime: {
      type: Date,
      required: [true, 'Break start time is required']
    },
    endTime: {
      type: Date,
      default: null
    },
    durationMinutes: {
      type: Number,
      default: 0,
      min: [0, 'Duration minutes cannot be negative']
    },
    remarks: {
      type: String,
      trim: true,
      default: ''
    }
  },
  {
    _id: true,
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

breakItemSchema.virtual('duration').get(function() {
  return typeof this.durationMinutes === 'number' ? this.durationMinutes : 0;
});

const attendanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'Employee reference is required']
    },
    date: {
      type: Date,
      required: [true, 'Attendance date is required']
    },
    checkIn: {
      type: Date,
      default: null
    },
    late: { type: Boolean, default: false },
    workMode: { type: String, trim: true, default: null },
    scheduleConfigured: { type: Boolean, default: false },
    scheduledCheckIn: { type: String, default: null },
    scheduleTimeZone: { type: String, default: null },
    checkOut: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      enum: {
        values: ['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'LATE'],
        message: '{VALUE} is not a valid attendance status'
      },
      default: 'PRESENT'
    },
    workingHours: {
      type: Number,
      default: 0,
      min: [0, 'Working hours cannot be negative']
    },
    breaks: {
      type: [breakItemSchema],
      default: []
    },
    totalBreakMinutes: {
      type: Number,
      default: 0,
      min: [0, 'Total break minutes cannot be negative']
    },
    activeBreak: {
      type: {
        breakType: {
          type: String,
          enum: [
            'Tea Break 1',
            'Lunch Break',
            'Tea Break 2',
            'Morning Break',
            'Afternoon Break'
          ]
        },
        startTime: Date,
        breakId: mongoose.Schema.Types.ObjectId
      },
      default: null
    },
    breakStartedAt: {
      type: Date,
      default: null
    },
    isLate: {
      type: Boolean,
      default: false,
      index: true
    },
    minutesLate: {
      type: Number,
      default: 0,
      min: [0, 'Minutes late cannot be negative']
    },
    scheduleStatus: {
      type: String,
      enum: ['CONFIGURED', 'UNCONFIGURED'],
      default: 'CONFIGURED'
    },
    scheduleSnapshot: {
      scheduleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'DepartmentSchedule',
        default: null
      },
      department: {
        type: String,
        default: null
      },
      scheduledCheckIn: {
        type: String,
        default: null
      },
      scheduledCheckOut: {
        type: String,
        default: null
      },
      gracePeriodMinutes: {
        type: Number,
        default: 0
      },
      timezone: {
        type: String,
        default: null
      }
    },
    remarks: {
      type: String,
      trim: true,
      default: ''
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes for query performance and preventing duplicates
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1, status: 1 });
attendanceSchema.index({ date: 1, isLate: 1 });

// Virtual getters for backward compatibility with existing consumers (e.g. Flutter HR Dashboard)
attendanceSchema.virtual('scheduledCheckOut').get(function() {
  return this.scheduleSnapshot?.scheduledCheckOut || null;
});

attendanceSchema.virtual('timezone').get(function() {
  return this.scheduleTimeZone || this.scheduleSnapshot?.timezone || null;
});

attendanceSchema.virtual('department').get(function() {
  return this.scheduleSnapshot?.department || (this.employee && this.employee.department) || null;
});

attendanceSchema.virtual('staffId').get(function() {
  if (this.employee) {
    return this.employee._id ? this.employee._id.toString() : this.employee.toString();
  }
  return '';
});

attendanceSchema.virtual('checkInTime').get(function() {
  return this.checkIn ? this.checkIn.toISOString() : null;
});

attendanceSchema.virtual('checkOutTime').get(function() {
  return this.checkOut ? this.checkOut.toISOString() : null;
});

attendanceSchema.virtual('checkInAt').get(function() {
  return this.checkIn ? this.checkIn.toISOString() : null;
});

attendanceSchema.virtual('workedDuration').get(function() {
  if (!this.workingHours) return '0h';
  const hours = Math.floor(this.workingHours);
  const mins = Math.round((this.workingHours - hours) * 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
});

attendanceSchema.virtual('breakDuration').get(function() {
  let totalMins = typeof this.totalBreakMinutes === 'number' ? this.totalBreakMinutes : 0;
  if (!totalMins && Array.isArray(this.breaks) && this.breaks.length > 0) {
    totalMins = this.breaks.reduce((acc, b) => acc + (b.durationMinutes || 0), 0);
  }
  if (!totalMins) return '0m';
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
});

attendanceSchema.virtual('gracePeriodMinutes').get(function() {
  return typeof this.scheduleSnapshot?.gracePeriodMinutes === 'number'
    ? this.scheduleSnapshot.gracePeriodMinutes
    : 0;
});

const Attendance = mongoose.model('Attendance', attendanceSchema);

module.exports = Attendance;
