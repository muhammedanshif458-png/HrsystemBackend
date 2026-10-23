const mongoose = require('mongoose');

const departmentScheduleSchema = new mongoose.Schema({
  department: { type: String, required: true, trim: true },
  checkInTime: { type: String, required: true, match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Check-in time must use HH:mm'] },
  timeZone: { type: String, required: true, trim: true },
  // No grace period is applied unless HR explicitly configures one.
  gracePeriodMinutes: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

departmentScheduleSchema.index({ department: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

module.exports = mongoose.model('DepartmentSchedule', departmentScheduleSchema);
