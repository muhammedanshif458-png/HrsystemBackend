const mongoose = require('mongoose');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const { AppError } = require('../middleware/errorMiddleware');

/**
 * Helper to normalize date to UTC midnight
 */
const getDayBounds = (dateStr = null) => {
  const date = dateStr ? new Date(dateStr) : new Date();
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  return { startOfDay, endOfDay };
};

class HRService {
  /**
   * Get HR Dashboard statistics
   */
  async getDashboardStats() {
    const { startOfDay, endOfDay } = getDayBounds();

    const [
      totalEmployees,
      activeEmployees,
      inactiveEmployees,
      todayAttendanceCounts,
      pendingLeaves,
      approvedLeaves
    ] = await Promise.all([
      Employee.countDocuments(),
      Employee.countDocuments({ status: 'ACTIVE' }),
      Employee.countDocuments({ status: { $in: ['INACTIVE', 'TERMINATED'] } }),
      Attendance.aggregate([
        {
          $match: {
            date: { $gte: startOfDay, $lte: endOfDay }
          }
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),
      Leave.countDocuments({ status: 'PENDING' }),
      Leave.countDocuments({ status: 'APPROVED' })
    ]);

    let todayPresent = 0;
    let todayAbsent = 0;

    todayAttendanceCounts.forEach((group) => {
      if (group._id === 'PRESENT' || group._id === 'HALF_DAY') {
        todayPresent += group.count;
      } else if (group._id === 'ABSENT') {
        todayAbsent += group.count;
      }
    });

    return {
      totalEmployees,
      activeEmployees,
      inactiveEmployees,
      todayPresent,
      todayAbsent,
      pendingLeaves,
      approvedLeaves
    };
  }

  /**
   * Get list of employees with search, filter, and pagination
   */
  async getEmployees({ page = 1, limit = 20, search = '', department, designation, status, employmentType }) {
    page = Math.max(1, parseInt(page, 10));
    limit = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (page - 1) * limit;

    const filter = {};

    if (search && search.trim() !== '') {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { employeeId: regex },
        { department: regex },
        { designation: regex }
      ];
    }

    if (department) filter.department = new RegExp(`^${department.trim()}$`, 'i');
    if (designation) filter.designation = new RegExp(`^${designation.trim()}$`, 'i');
    if (status) filter.status = status;
    if (employmentType) filter.employmentType = employmentType;

    const [employees, total] = await Promise.all([
      Employee.find(filter)
        .populate('user', 'role isActive lastLogin')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Employee.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      employees,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    };
  }

  /**
   * Create new employee and corresponding User account
   */
  async createEmployee(data) {
    const {
      firstName,
      lastName,
      email,
      phone,
      password = 'Password@123',
      department,
      designation,
      employmentType = 'FULL_TIME',
      salary = 0,
      dateOfBirth,
      gender,
      address,
      city,
      state,
      country,
      profileImage,
      emergencyContact,
      status = 'ACTIVE'
    } = data;

    // Check if user with email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      throw new AppError('An account with this email address already exists', 409);
    }

    // Auto-generate employeeId if not provided
    let employeeId = data.employeeId ? data.employeeId.toUpperCase().trim() : null;
    if (!employeeId) {
      const count = await Employee.countDocuments();
      employeeId = `EMP${String(count + 1001).padStart(4, '0')}`;
    }

    const existingEmpId = await Employee.findOne({ employeeId });
    if (existingEmpId) {
      throw new AppError(`Employee ID '${employeeId}' is already in use`, 409);
    }

    // Create user with STAFF role
    const newUser = new User({
      firstName,
      lastName,
      email: email.toLowerCase(),
      phone: phone || '',
      password,
      role: 'STAFF',
      profileImage: profileImage || null,
      isActive: status === 'ACTIVE'
    });

    await newUser.save();

    // Create employee profile linked to user
    const newEmployee = new Employee({
      employeeId,
      user: newUser._id,
      firstName,
      lastName,
      email: email.toLowerCase(),
      phone: phone || '',
      dateOfBirth: dateOfBirth || null,
      gender: gender || 'OTHER',
      department,
      designation,
      joiningDate: data.joiningDate || new Date(),
      employmentType,
      salary,
      address: address || '',
      city: city || '',
      state: state || '',
      country: country || '',
      profileImage: profileImage || null,
      emergencyContact: emergencyContact || { name: '', relationship: '', phone: '' },
      status
    });

    await newEmployee.save();

    const populatedEmployee = await Employee.findById(newEmployee._id).populate('user', 'role isActive');
    return populatedEmployee;
  }

  /**
   * Get employee by ID
   */
  async getEmployeeById(id) {
    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { $or: [{ _id: id }, { employeeId: id.toUpperCase() }] };
    } else {
      query = { employeeId: id.toUpperCase() };
    }

    const employee = await Employee.findOne(query).populate('user', 'role isActive lastLogin');
    if (!employee) {
      throw new AppError('Employee not found', 404);
    }
    return employee;
  }

  /**
   * Update employee and synchronize User account
   */
  async updateEmployee(id, updateData) {
    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { $or: [{ _id: id }, { employeeId: id.toUpperCase() }] };
    } else {
      query = { employeeId: id.toUpperCase() };
    }

    const employee = await Employee.findOne(query);
    if (!employee) {
      throw new AppError('Employee not found', 404);
    }

    // Check if new email is in use by another user
    if (updateData.email && updateData.email.toLowerCase() !== employee.email) {
      const existingUser = await User.findOne({
        email: updateData.email.toLowerCase(),
        _id: { $ne: employee.user }
      });
      if (existingUser) {
        throw new AppError('Email address is already in use by another account', 409);
      }
    }

    // Update Employee document fields
    Object.keys(updateData).forEach((key) => {
      if (key !== 'user' && key !== '_id' && updateData[key] !== undefined) {
        employee[key] = updateData[key];
      }
    });

    await employee.save();

    // Synchronize linked User account
    const userUpdate = {};
    if (updateData.firstName) userUpdate.firstName = updateData.firstName;
    if (updateData.lastName) userUpdate.lastName = updateData.lastName;
    if (updateData.email) userUpdate.email = updateData.email.toLowerCase();
    if (updateData.phone !== undefined) userUpdate.phone = updateData.phone;
    if (updateData.profileImage !== undefined) userUpdate.profileImage = updateData.profileImage;
    if (updateData.status) {
      userUpdate.isActive = updateData.status === 'ACTIVE';
    }

    if (Object.keys(userUpdate).length > 0) {
      await User.findByIdAndUpdate(employee.user, userUpdate);
    }

    return await Employee.findById(employee._id).populate('user', 'role isActive lastLogin');
  }

  /**
   * Delete or deactivate employee
   */
  async deleteEmployee(id) {
    const employee = await this.getEmployeeById(id);

    employee.status = 'INACTIVE';
    await employee.save();

    // Deactivate linked User account
    await User.findByIdAndUpdate(employee.user, { isActive: false });

    return { message: 'Employee deactivated successfully' };
  }

  /**
   * Get attendance records for HR
   */
  async getAttendance({ page = 1, limit = 20, employeeId, startDate, endDate, status }) {
    page = Math.max(1, parseInt(page, 10));
    limit = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (page - 1) * limit;

    const filter = {};

    if (employeeId) {
      let emp;
      if (mongoose.Types.ObjectId.isValid(employeeId)) {
        emp = await Employee.findOne({ $or: [{ _id: employeeId }, { employeeId: employeeId.toUpperCase() }] });
      } else {
        emp = await Employee.findOne({ employeeId: employeeId.toUpperCase() });
      }

      if (emp) {
        filter.employee = emp._id;
      } else {
        return { attendance: [], pagination: { page, limit, total: 0, totalPages: 0 } };
      }
    }

    if (status) {
      filter.status = status;
    }

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
        .populate('employee', 'employeeId firstName lastName department designation')
        .sort({ date: -1, createdAt: -1 })
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
   * Get attendance for a specific employee
   */
  async getAttendanceByEmployeeId(empIdentifier, { page = 1, limit = 20, startDate, endDate }) {
    let emp;
    if (mongoose.Types.ObjectId.isValid(empIdentifier)) {
      emp = await Employee.findOne({ $or: [{ _id: empIdentifier }, { employeeId: empIdentifier.toUpperCase() }] });
    } else {
      emp = await Employee.findOne({ employeeId: empIdentifier.toUpperCase() });
    }

    if (!emp) {
      throw new AppError('Employee not found', 404);
    }

    return this.getAttendance({ page, limit, employeeId: emp._id.toString(), startDate, endDate });
  }

  /**
   * Get leaves for HR
   */
  async getLeaves({ page = 1, limit = 20, employeeId, status, leaveType, startDate, endDate }) {
    page = Math.max(1, parseInt(page, 10));
    limit = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (page - 1) * limit;

    const filter = {};

    if (employeeId) {
      let emp;
      if (mongoose.Types.ObjectId.isValid(employeeId)) {
        emp = await Employee.findOne({ $or: [{ _id: employeeId }, { employeeId: employeeId.toUpperCase() }] });
      } else {
        emp = await Employee.findOne({ employeeId: employeeId.toUpperCase() });
      }

      if (emp) {
        filter.employee = emp._id;
      } else {
        return { leaves: [], pagination: { page, limit, total: 0, totalPages: 0 } };
      }
    }

    if (status) filter.status = status;
    if (leaveType) filter.leaveType = leaveType;

    if (startDate || endDate) {
      if (startDate && endDate) {
        filter.startDate = { $gte: new Date(startDate) };
        filter.endDate = { $lte: new Date(endDate) };
      } else if (startDate) {
        filter.startDate = { $gte: new Date(startDate) };
      } else if (endDate) {
        filter.endDate = { $lte: new Date(endDate) };
      }
    }

    const [leaves, total] = await Promise.all([
      Leave.find(filter)
        .populate('employee', 'employeeId firstName lastName department designation email')
        .populate('approvedBy', 'firstName lastName email role')
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
   * Get single leave by ID
   */
  async getLeaveById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid leave ID', 400);
    }

    const leave = await Leave.findById(id)
      .populate('employee', 'employeeId firstName lastName department designation email')
      .populate('approvedBy', 'firstName lastName email role');

    if (!leave) {
      throw new AppError('Leave request not found', 404);
    }

    return leave;
  }

  /**
   * Approve leave request
   */
  async approveLeave(id, adminUserId) {
    const leave = await this.getLeaveById(id);

    if (leave.status !== 'PENDING') {
      throw new AppError(`Cannot approve leave request with status: ${leave.status}`, 400);
    }

    leave.status = 'APPROVED';
    leave.approvedBy = adminUserId;
    leave.approvedAt = new Date();
    leave.rejectionReason = null;
    await leave.save();

    return await Leave.findById(leave._id)
      .populate('employee', 'employeeId firstName lastName department designation')
      .populate('approvedBy', 'firstName lastName email');
  }

  /**
   * Reject leave request
   */
  async rejectLeave(id, adminUserId, rejectionReason = '') {
    const leave = await this.getLeaveById(id);

    if (leave.status !== 'PENDING') {
      throw new AppError(`Cannot reject leave request with status: ${leave.status}`, 400);
    }

    leave.status = 'REJECTED';
    leave.approvedBy = adminUserId;
    leave.approvedAt = new Date();
    leave.rejectionReason = rejectionReason || 'Leave request was not approved by HR.';
    await leave.save();

    return await Leave.findById(leave._id)
      .populate('employee', 'employeeId firstName lastName department designation')
      .populate('approvedBy', 'firstName lastName email');
  }

  /**
   * HR Attendance Reports
   */
  async getAttendanceReports({ startDate, endDate, department }) {
    const matchFilter = {};

    if (startDate || endDate) {
      matchFilter.date = {};
      if (startDate) matchFilter.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        matchFilter.date.$lte = end;
      }
    }

    const summaryPipeline = [
      { $match: matchFilter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          avgWorkingHours: { $avg: '$workingHours' }
        }
      }
    ];

    const departmentPipeline = [
      { $match: matchFilter },
      {
        $lookup: {
          from: 'employees',
          localField: 'employee',
          foreignField: '_id',
          as: 'employeeDoc'
        }
      },
      { $unwind: '$employeeDoc' },
      ...(department ? [{ $match: { 'employeeDoc.department': new RegExp(`^${department}$`, 'i') } }] : []),
      {
        $group: {
          _id: {
            department: '$employeeDoc.department',
            status: '$status'
          },
          count: { $sum: 1 },
          totalHours: { $sum: '$workingHours' }
        }
      },
      {
        $project: {
          _id: 0,
          department: '$_id.department',
          status: '$_id.status',
          count: 1,
          totalHours: { $round: ['$totalHours', 2] }
        }
      }
    ];

    const [statusSummary, departmentSummary] = await Promise.all([
      Attendance.aggregate(summaryPipeline),
      Attendance.aggregate(departmentPipeline)
    ]);

    return {
      statusSummary,
      departmentSummary
    };
  }

  /**
   * HR Leave Reports
   */
  async getLeaveReports({ startDate, endDate }) {
    const matchFilter = {};

    if (startDate || endDate) {
      matchFilter.startDate = {};
      if (startDate) matchFilter.startDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        matchFilter.startDate.$lte = end;
      }
    }

    const [statusCounts, typeCounts] = await Promise.all([
      Leave.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),
      Leave.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: '$leaveType',
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    return {
      statusSummary: statusCounts,
      typeSummary: typeCounts
    };
  }
}

module.exports = new HRService();
