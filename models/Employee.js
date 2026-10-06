const mongoose = require('mongoose');

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
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
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
    salary: {
      type: Number,
      default: 0,
      min: [0, 'Salary cannot be negative']
    },
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
        values: ['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED'],
        message: '{VALUE} is not a valid employee status'
      },
      default: 'ACTIVE'
    }
  },
  {
    timestamps: true
  }
);

// Indexes for faster lookups and search
employeeSchema.index({ department: 1 });
employeeSchema.index({ status: 1 });
employeeSchema.index({ firstName: 'text', lastName: 'text', email: 'text', department: 'text', designation: 'text' });

const Employee = mongoose.model('Employee', employeeSchema);

module.exports = Employee;
