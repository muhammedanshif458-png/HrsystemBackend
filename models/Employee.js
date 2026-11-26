const mongoose = require('mongoose');
const { EMAIL_REGEX } = require('../utils/email');

const emergencyContactSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: ''
    },
    relationship: {
      type: String,
      trim: true,
      default: ''
    },
    phone: {
      type: String,
      trim: true,
      default: ''
    }
  },
  { _id: false }
);

const employeeSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      required: [true, 'Employee ID is required'],
      unique: true,
      uppercase: true,
      trim: true
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      unique: true
    },
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [EMAIL_REGEX, 'Please provide a valid email']
    },
    phone: {
      type: String,
      trim: true,
      default: ''
    },
    dateOfBirth: {
      type: Date,
      default: null
    },
    gender: {
      type: String,
      enum: {
        values: ['MALE', 'FEMALE', 'OTHER'],
        message: '{VALUE} is not a valid gender (MALE, FEMALE, OTHER)'
      },
      default: 'OTHER'
    },
    department: {
      type: String,
      required: [true, 'Department is required'],
      trim: true
    },
    designation: {
      type: String,
      required: [true, 'Designation is required'],
      trim: true
    },
    joiningDate: {
      type: Date,
      default: Date.now
    },
    employmentType: {
      type: String,
      enum: {
        values: ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'],
        message: '{VALUE} is not a valid employment type'
      },
      default: 'FULL_TIME'
    },
    workMode: {
      type: String,
      trim: true,
      default: 'Office'
    },
    salary: {
      type: Number,
      default: 0,
      min: [0, 'Salary cannot be negative']
    },
    salaryCurrency: {
      type: String,
      trim: true,
      default: 'INR'
    },
    salaryEffectiveDate: {
      type: String,
      trim: true,
      default: ''
    },
    paidLeaveAllowance: {
      type: Number,
      default: 1,
      min: [0, 'Paid leave allowance cannot be negative']
    },
    salaryHistory: [
      {
        amount: { type: Number, required: true },
        currency: { type: String, default: 'INR' },
        effectiveDate: { type: String, default: '' },
        changedBy: { type: String, default: 'HR Admin' },
        reason: { type: String, default: '' },
        timestamp: { type: String, default: '' },
        _id: false
      }
    ],
    address: {
      type: String,
      trim: true,
      default: ''
    },
    city: {
      type: String,
      trim: true,
      default: ''
    },
    state: {
      type: String,
      trim: true,
      default: ''
    },
    country: {
      type: String,
      trim: true,
      default: ''
    },
    profileImage: {
      type: String,
      default: null
    },
    emergencyContact: {
      type: emergencyContactSchema,
      default: () => ({ name: '', relationship: '', phone: '' })
    },
    status: {
      type: String,
      enum: {
        values: ['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED', 'RESIGNED'],
        message: '{VALUE} is not a valid employee status'
      },
      default: 'ACTIVE'
    },
    resignationDate: {
      type: Date,
      default: null
    },
    resignationReason: {
      type: String,
      trim: true,
      default: ''
    },
    isDeleted: {
      type: Boolean,
      default: false
    },
    deletedAt: {
      type: Date,
      default: null
    },
    /**
     * Per-employee attendance history visibility cutoff.
     * Records with Attendance.date < this value are hidden from the
     * staff's own StaffHub history view only.  HR/admin queries are
     * unaffected.  Attendance documents are NEVER deleted.
     */
    attendanceHistoryCutoff: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

employeeSchema.virtual('name').get(function() {
  return `${this.firstName || ''} ${this.lastName || ''}`.trim();
});

employeeSchema.virtual('phoneNumber').get(function() {
  return this.phone || '';
});

employeeSchema.virtual('role').get(function() {
  return this.designation || (this.user?.role === 'HR' ? 'HR' : 'Staff');
});

employeeSchema.virtual('isResigned').get(function() {
  return this.status === 'RESIGNED';
});

employeeSchema.virtual('isDeactivated').get(function() {
  return this.status === 'INACTIVE';
});

// Indexes for faster lookups and search
employeeSchema.index({ department: 1 });
employeeSchema.index({ status: 1 });
employeeSchema.index({ isDeleted: 1 });
employeeSchema.index({ firstName: 'text', lastName: 'text', email: 'text', department: 'text', designation: 'text' });

const Employee = mongoose.model('Employee', employeeSchema);

module.exports = Employee;
