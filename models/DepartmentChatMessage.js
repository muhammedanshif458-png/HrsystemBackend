const mongoose = require('mongoose');

const departmentChatMessageSchema = new mongoose.Schema(
  {
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
    }
  },
  {
    timestamps: true
  }
);

// Indexes
departmentChatMessageSchema.index({ departmentKey: 1, timestamp: 1 });
departmentChatMessageSchema.index({ senderId: 1 });

const DepartmentChatMessage = mongoose.model('DepartmentChatMessage', departmentChatMessageSchema);

module.exports = DepartmentChatMessage;
