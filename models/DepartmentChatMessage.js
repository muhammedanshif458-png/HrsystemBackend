const mongoose = require('mongoose');

const departmentChatMessageSchema = new mongoose.Schema(
  {
    conversationType: {
      type: String,
      enum: ['DEPARTMENT', 'COMPANY'],
      default: 'DEPARTMENT',
      index: true
    },
    departmentKey: {
      type: String,
      required: [true, 'Department key is required'],
      lowercase: true,
      trim: true
    },
    senderId: {
      type: String,
      required: [true, 'Sender ID is required'],
      trim: true
    },
    senderUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    senderEmployee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      default: null
    },
    senderRole: {
      type: String,
      enum: {
        values: ['HR', 'STAFF', 'SUPER_ADMIN'],
        message: '{VALUE} is not a valid sender role'
      },
      default: 'STAFF'
    },
    senderName: {
      type: String,
      required: [true, 'Sender name is required'],
      trim: true
    },
    receiverId: {
      type: String,
      default: ''
    },
    text: {
      type: String,
      required: [true, 'Message text is required'],
      trim: true,
      maxlength: [2000, 'Message cannot exceed 2000 characters']
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    isRead: {
      type: Boolean,
      default: false
    },
    deletedForEveryone: {
      type: Boolean,
      default: false
    },
    deletedByIds: [
      {
        type: String,
        trim: true
      }
    ],
    deletedForEveryoneBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    deletedForEveryoneAt: {
      type: Date,
      default: null
    },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

departmentChatMessageSchema.virtual('id').get(function() {
  return this._id.toString();
});

// Indexes
departmentChatMessageSchema.index({ departmentKey: 1, timestamp: -1 });
departmentChatMessageSchema.index({ conversationType: 1, departmentKey: 1, timestamp: -1 });
departmentChatMessageSchema.index({ departmentKey: 1, timestamp: 1 });
departmentChatMessageSchema.index({ senderId: 1 });

const DepartmentChatMessage = mongoose.model('DepartmentChatMessage', departmentChatMessageSchema);

module.exports = DepartmentChatMessage;
