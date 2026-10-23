const mongoose = require('mongoose');

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
        values: ['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE'],
        message: '{VALUE} is not a valid attendance status'
      },
      default: 'PRESENT'
    },
    workingHours: {
      type: Number,
      default: 0,
      min: [0, 'Working hours cannot be negative']
    },
    remarks: {
      type: String,
      trim: true,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

// Compound index to prevent duplicate attendance records for the same employee on the same date
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

const Attendance = mongoose.model('Attendance', attendanceSchema);

module.exports = Attendance;
