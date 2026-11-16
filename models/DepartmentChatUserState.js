const mongoose = require('mongoose');

const departmentChatUserStateSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  departmentKey: { type: String, required: true, lowercase: true, trim: true },
  clearedAt: { type: Date, default: null },
  clearedThroughTimestamp: { type: Date, default: null },
  clearedThroughMessageId: { type: mongoose.Schema.Types.ObjectId, default: null }
}, { timestamps: true });

departmentChatUserStateSchema.index({ userId: 1, departmentKey: 1 }, { unique: true });

module.exports = mongoose.model('DepartmentChatUserState', departmentChatUserStateSchema);
