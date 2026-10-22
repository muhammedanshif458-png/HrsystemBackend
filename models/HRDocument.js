const mongoose = require('mongoose');

const hrDocumentSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: [true, 'Employee reference is required']
    },
    employeeIdString: {
      type: String,
      trim: true,
      default: ''
    },
    title: {
      type: String,
      required: [true, 'Document title is required'],
      trim: true
    },
    category: {
      type: String,
      required: [true, 'Document category is required'],
      enum: {
        values: [
          'Resume',
          'Identity Proof',
          'Educational Certificates',
          'Offer Letter',
          'Appointment Letter',
          'Employment Agreement',
          'Experience Certificate',
          'Medical Certificate',
          'Other'
        ],
        message: '{VALUE} is not a valid document category'
      }
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    fileName: {
      type: String,
      required: [true, 'File name is required']
    },
    originalName: {
      type: String,
      required: [true, 'Original file name is required']
    },
    filePath: {
      type: String,
      required: [true, 'File path is required']
    },
    fileType: {
      type: String,
      required: [true, 'File MIME type is required']
    },
    fileSize: {
      type: Number,
      required: [true, 'File size is required']
    },
    issueDate: {
      type: String,
      trim: true,
      default: ''
    },
    expiryDate: {
      type: String,
      trim: true,
      default: ''
    },
    uploadedBy: {
      type: String,
      default: 'HR Admin'
    },
    uploadedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'ARCHIVED', 'REPLACED'],
      default: 'ACTIVE'
    },
    version: {
      type: Number,
      default: 1
    },
    history: [
      {
        action: { type: String, required: true },
        performedBy: { type: String, default: 'HR Admin' },
        timestamp: { type: Date, default: Date.now },
        notes: { type: String, default: '' },
        previousFileName: { type: String, default: '' },
        _id: false
      }
    ]
  },
  {
    timestamps: true
  }
);

hrDocumentSchema.index({ employee: 1, status: 1 });
hrDocumentSchema.index({ category: 1 });

const HRDocument = mongoose.model('HRDocument', hrDocumentSchema);

module.exports = HRDocument;
