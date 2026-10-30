const mongoose = require('mongoose');

const staffLoginHistorySchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  workMode: { type: String, enum: ['OFFICE', 'WORK_FROM_HOME'], default: null },
  locationStatus: { type: String, enum: ['CAPTURED', 'NOT_PROVIDED'], required: true },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  accuracy: { type: Number, min: 0, default: null },
  capturedAt: { type: Date, default: null },
  loginAt: { type: Date, required: true, default: Date.now },
  metadata: {
    ip: { type: String, default: null },
    userAgent: { type: String, default: null }
  }
}, { timestamps: true });

staffLoginHistorySchema.index({ employeeId: 1, loginAt: -1 });

module.exports = mongoose.model('StaffLoginHistory', staffLoginHistorySchema);
