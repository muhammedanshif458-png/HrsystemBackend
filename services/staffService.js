const mongoose = require('mongoose');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const { AppError } = require('../middleware/errorMiddleware');

/**
 * Normalize date to UTC midnight for consistent daily tracking
 */
const getMidnightToday = (date = new Date()) => {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
};

const getEndOfDay = (date = new Date()) => {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
};

class StaffService {
  /**
   * Helper to ensure employee profile exists for user
   */
  async getEmployeeOrThrow(user) {
    let employee = await Employee.findOne({ user: user._id });
    if (!employee && user.email) {
      employee = await Employee.findOne({ email: user.email.toLowerCase().trim() });
      if (employee) {
        employee.user = user._id;
        await employee.save();
      }
    }
    if (!employee) {
      throw new AppError('No employee profile associated with this account. Please contact HR.', 404);
    }
    return employee;
  }

  /**
   * Staff Dashboard stats & information
   */
  async getDashboard(user) {
    const employee = await this.getEmployeeOrThrow(user);
    const todayMidnight = getMidnightToday();
    const todayEnd = getEndOfDay();

    // Check today's attendance
    const todayAttendance = await Attendance.findOne({
      employee: employee._id,
      date: { $gte: todayMidnight, $lte: todayEnd }
    });

    // Attendance summary for current month
    const startOfMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const attendanceStats = await Attendance.aggregate([
      {
        $match: {
          employee: employee._id,
          date: { $gte: startOfMonth }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalHours: { $sum: '$workingHours' }
        }
      }
    ]);

    const attendanceSummary = {
      presentDays: 0,
      halfDays: 0,
      absentDays: 0,
      totalHours: 0
    };

    attendanceStats.forEach((stat) => {
      if (stat._id === 'PRESENT') attendanceSummary.presentDays = stat.count;
      if (stat._id === 'HALF_DAY') attendanceSummary.halfDays = stat.count;
      if (stat._id === 'ABSENT') attendanceSummary.absentDays = stat.count;
      attendanceSummary.totalHours += stat.totalHours;
    });
    attendanceSummary.totalHours = Math.round(attendanceSummary.totalHours * 100) / 100;

    // Leave counts
    const [pendingLeaves, approvedLeaves] = await Promise.all([
      Leave.countDocuments({ employee: employee._id, status: 'PENDING' }),
      Leave.countDocuments({ employee: employee._id, status: 'APPROVED' })
    ]);

    return {
      employee: {
        id: employee._id,
        employeeId: employee.employeeId,
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
        department: employee.department,
        designation: employee.designation,
        status: employee.status,
        profileImage: employee.profileImage
      },
      todayAttendance: todayAttendance || null,
      attendanceSummary,
      pendingLeaves,
      approvedLeaves
    };
  }

  /**
   * Get own employee profile
   */
  async getProfile(user) {
    const employee = await Employee.findOne({ user: user._id }).populate('user', 'role isActive lastLogin');
    if (!employee) {
      throw new AppError('Employee profile not found', 404);
    }
    return employee;
  }

  /**
   * Update own employee profile (restricted fields)
   */
  async updateProfile(user, updateData) {
    const employee = await this.getEmployeeOrThrow(user);

    // Only allow updating safe fields
    const allowedFields = ['phone', 'address', 'city', 'state', 'country', 'profileImage', 'emergencyContact', 'dateOfBirth'];
    const userUpdates = {};

    allowedFields.forEach((field) => {
      if (updateData[field] !== undefined) {
        employee[field] = updateData[field];

        if (field === 'phone') userUpdates.phone = updateData[field];
        if (field === 'profileImage') userUpdates.profileImage = updateData[field];
      }
    });

    await employee.save();

    if (Object.keys(userUpdates).length > 0) {
      await User.findByIdAndUpdate(user._id, userUpdates);
    }

    return await Employee.findById(employee._id).populate('user', 'role isActive');
  }

  /**
   * Attendance check-in
   */
  async checkIn(user, remarks = '') {
    const employee = await this.getEmployeeOrThrow(user);

    if (employee.status !== 'ACTIVE') {
      throw new AppError(`Cannot check in. Employee status is currently: ${employee.status}`, 400);
    }

    const todayMidnight = getMidnightToday();
    const todayEnd = getEndOfDay();

    // Check if attendance already recorded today
    const existingAttendance = await Attendance.findOne({
      employee: employee._id,
      date: { $gte: todayMidnight, $lte: todayEnd }
    });

    if (existingAttendance) {
      throw new AppError('You have already checked in for today', 400);
    }

    const attendance = new Attendance({
      employee: employee._id,
      date: todayMidnight,
      checkIn: new Date(),
      status: 'PRESENT',
      remarks: remarks || ''
    });

    await attendance.save();
    return attendance;
  }

  /**
   * Attendance check-out
   */
  async checkOut(user, remarks = '') {
    const employee = await this.getEmployeeOrThrow(user);

    const todayMidnight = getMidnightToday();
    const todayEnd = getEndOfDay();

    const attendance = await Attendance.findOne({
      employee: employee._id,
      date: { $gte: todayMidnight, $lte: todayEnd }
    });

    if (!attendance || !attendance.checkIn) {
      throw new AppError('Cannot check out before checking in for today', 400);
    }

    if (attendance.checkOut) {
      throw new AppError('You have already checked out for today', 400);
    }

    const checkOutTime = new Date();
    attendance.checkOut = checkOutTime;

    // Calculate working hours
    const diffMs = checkOutTime.getTime() - attendance.checkIn.getTime();
    const hours = Math.max(0, diffMs / (1000 * 60 * 60));
    attendance.workingHours = Math.round(hours * 100) / 100;

    // Optional status update based on hours
    if (attendance.workingHours < 4) {
      attendance.status = 'HALF_DAY';
    }

    if (remarks) {
      attendance.remarks = attendance.remarks ? `${attendance.remarks} | ${remarks}` : remarks;
    }

    await attendance.save();
    return attendance;
  }

  /**
   * View own attendance history
   */
  async getAttendanceHistory(user, { page = 1, limit = 20, startDate, endDate }) {
    const employee = await this.getEmployeeOrThrow(user);

    page = Math.max(1, parseInt(page, 10));
    limit = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (page - 1) * limit;

    const filter = { employee: employee._id };

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    const [attendance, total] = await Promise.all([
      Attendance.find(filter)
        .sort({ date: -1, checkIn: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Attendance.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      attendance,
      pagination: { page, limit, total, totalPages }
    };
  }

  /**
   * Apply for leave
   */
  async applyLeave(user, { leaveType, startDate, endDate, reason }) {
    const employee = await this.getEmployeeOrThrow(user);

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new AppError('Invalid start date or end date format', 400);
    }

    if (end < start) {
      throw new AppError('End date cannot be earlier than start date', 400);
    }

    // Check for overlapping pending or approved leave requests
    const overlapping = await Leave.findOne({
      employee: employee._id,
      status: { $in: ['PENDING', 'APPROVED'] },
      $or: [
        { startDate: { $lte: end }, endDate: { $gte: start } }
      ]
    });

    if (overlapping) {
      throw new AppError(
        `You already have an active leave request (${overlapping.status}) overlapping with this date period`,
        409
      );
    }

    const leave = new Leave({
      employee: employee._id,
      leaveType,
      startDate: start,
      endDate: end,
      reason,
      status: 'PENDING'
    });

    await leave.save();
    return leave;
  }

  /**
   * View own leave requests
   */
  async getLeaves(user, { page = 1, limit = 20, status }) {
    const employee = await this.getEmployeeOrThrow(user);

    page = Math.max(1, parseInt(page, 10));
    limit = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (page - 1) * limit;

    const filter = { employee: employee._id };
    if (status) filter.status = status;

    const [leaves, total] = await Promise.all([
      Leave.find(filter)
        .populate('approvedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Leave.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      leaves,
      pagination: { page, limit, total, totalPages }
    };
  }

  /**
   * View single leave request (restricted to own)
   */
  async getLeaveById(user, leaveId) {
    const employee = await this.getEmployeeOrThrow(user);

    if (!mongoose.Types.ObjectId.isValid(leaveId)) {
      throw new AppError('Invalid leave ID', 400);
    }

    const leave = await Leave.findOne({
      _id: leaveId,
      employee: employee._id
    }).populate('approvedBy', 'firstName lastName email');

    if (!leave) {
      throw new AppError('Leave request not found or access unauthorized', 404);
    }

    return leave;
  }

  /**
   * Cancel pending leave request
   */
  async cancelLeave(user, leaveId) {
    const employee = await this.getEmployeeOrThrow(user);

    if (!mongoose.Types.ObjectId.isValid(leaveId)) {
      throw new AppError('Invalid leave ID', 400);
    }

    const leave = await Leave.findOne({
      _id: leaveId,
      employee: employee._id
    });

    if (!leave) {
      throw new AppError('Leave request not found or access unauthorized', 404);
    }

    if (leave.status !== 'PENDING') {
      throw new AppError(`Cannot cancel leave request that is already ${leave.status}`, 400);
    }

    leave.status = 'CANCELLED';
    await leave.save();

    return leave;
  }
}

module.exports = new StaffService();
