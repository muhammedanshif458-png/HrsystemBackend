const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
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
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false
    },
    role: {
      type: String,
      enum: {
        values: ['HR', 'STAFF', 'SUPER_ADMIN'],
        message: '{VALUE} is not a valid role. Allowed roles: HR, STAFF, SUPER_ADMIN'
      },
      required: [true, 'Role is required']
    },
    profileImage: {
      type: String,
      default: null
    },
    isActive: {
      type: Boolean,
      default: true
    },
    mustChangePassword: {
      type: Boolean,
      default: false
    },
    lastLogin: {
      type: Date,
      default: null
    },
    refreshToken: {
      type: String,
      select: false,
      default: null
    },
    resetPasswordToken: {
      type: String,
      select: false,
      default: null
    },
    resetPasswordExpires: {
      type: Date,
      select: false,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }

  try {
    // If password is already a valid bcrypt hash, do not hash it again (prevents double-hashing)
    if (typeof this.password === 'string' && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(this.password)) {
      return next();
    }

    // Safety: Enforce 72-byte max limit so bcrypt never silently truncates passwords
    if (typeof this.password === 'string' && Buffer.byteLength(this.password, 'utf8') > 72) {
      return next(new Error('Password must not exceed 72 bytes'));
    }

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Instance method to compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!candidatePassword || !this.password) return false;
  const isMatch = await bcrypt.compare(candidatePassword, this.password);
  if (!isMatch && typeof candidatePassword === 'string') {
    return await bcrypt.compare(candidatePassword.trim(), this.password);
  }
  return isMatch;
};

// Transform to remove sensitive information on JSON serialization
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshToken;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpires;
  delete obj.__v;
  return obj;
};

const User = mongoose.model('User', userSchema);

module.exports = User;
