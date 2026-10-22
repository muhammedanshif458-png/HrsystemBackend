const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      trim: true,
      default: ''
    },
    description: {
      type: String,
      required: [true, 'Task description is required'],
      trim: true
    },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'Assigned employee is required']
    },
    department: {
      type: String,
      required: [true, 'Department is required'],
      trim: true
    },
    dueDate: {
      type: String,
      required: [true, 'Due date is required'],
      trim: true
    },
    date: {
      type: String,
      default: () => new Date().toISOString().split('T')[0]
    },
    status: {
      type: String,
      enum: {
        values: ['pending', 'in-progress', 'done', 'cancelled'],
        message: '{VALUE} is not a valid task status'
      },
      default: 'pending'
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
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

// Indexes
taskSchema.index({ employee: 1, status: 1 });
taskSchema.index({ department: 1 });
taskSchema.index({ isDeleted: 1 });

const Task = mongoose.model('Task', taskSchema);

module.exports = Task;
