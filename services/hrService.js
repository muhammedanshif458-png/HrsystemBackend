const mongoose = require('mongoose');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const DepartmentSchedule = require('../models/DepartmentSchedule');
const { isAttendanceForCurrentWorkday, getDateKey, getDayBoundsForKey } = require('../utils/attendanceSchedule');
const Leave = require('../models/Leave');
const { summarizeAttendanceDay } = require('./attendanceDashboardMetrics');
const { AppError } = require('../middleware/errorMiddleware');
const { enrichLeaveResponse, enrichLeaveResponses } = require('../utils/leaveResponseHelper');

const getDayBounds = (dateStr = null) => getDayBoundsForKey(dateStr || getDateKey(new Date(), 'Asia/Kolkata'));

class HRService {
  /**
   * Get HR Dashboard statistics
   */
  async getDashboardStats(dateKey = null) {
    const { startOfDay, endOfDay } = getDayBounds(dateKey);
    const [totalEmployees, activeEmployees, inactiveEmployees, active, todayRows, approvedTodayLeaves, pendingLeaves, approvedLeaves] = await Promise.all([
      Employee.countDocuments(),
      Employee.countDocuments({ status: 'ACTIVE' }),
      Employee.countDocuments({ status: { $in: ['INACTIVE', 'TERMINATED'] } }),
      Employee.find({ status: 'ACTIVE' }).select('_id').lean(),
      Attendance.find({ date: { $gte: startOfDay, $lte: endOfDay } }).select('employee status late checkIn workMode createdAt').populate('employee', 'status workMode').sort({ checkIn: -1, createdAt: -1 }).lean(),
      Leave.find({ status: 'APPROVED', startDate: { $lte: endOfDay }, endDate: { $gte: startOfDay } }).select('employee').lean(),
      Leave.countDocuments({ status: 'PENDING' }),
      Leave.countDocuments({ status: 'APPROVED' })
    ]);
    const metrics = summarizeAttendanceDay({
      activeEmployeeIds: active.map(employee => employee._id),
      attendanceRows: todayRows,
      approvedLeaveRows: approvedTodayLeaves,
      dateKey: dateKey || getDateKey(new Date(), 'Asia/Kolkata')
    });
    return {
      totalEmployees, activeEmployees, inactiveEmployees, ...metrics,
      pendingLeaves, approvedLeaves
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
  async createEmployee(data, currentUser = null) {
    // Support both 'name' (full name from Flutter) and firstName/lastName separately
    if (!data.firstName && data.name) {
      const parts = data.name.trim().split(' ');
      data.firstName = parts[0];
      data.lastName = parts.slice(1).join(' ') || parts[0];
    }
    if (!data.lastName) data.lastName = data.firstName;
    // Support 'phoneNumber' field from Flutter in addition to 'phone'
    if (!data.phone && data.phoneNumber) data.phone = data.phoneNumber;

    const {
      firstName,
      lastName,
      email,
      phone,
      password,
      department,
      designation,
      employmentType = 'FULL_TIME',
      workMode = 'Office',
      salary = 0,
      salaryCurrency = 'INR',
      salaryEffectiveDate = '',
      paidLeaveAllowance = 1,
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

    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) {
      throw new AppError('Email is required', 400);
    }

    // Check if user or employee with email already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    const existingEmployee = await Employee.findOne({ email: normalizedEmail });
    if (existingEmployee) {
      throw new AppError('An employee with this email address already exists', 409);
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

    const finalPassword = (password && String(password).trim().length >= 6)
      ? String(password).trim()
      : 'Password@123';

    let newUser;
    try {
      if (existingUser) {
        const linkedEmp = await Employee.findOne({ user: existingUser._id });
        if (linkedEmp) {
          throw new AppError('An account with this email address already exists', 409);
        }
        newUser = existingUser;
        newUser.firstName = firstName;
        newUser.lastName = lastName;
        newUser.phone = phone || '';
        newUser.role = 'STAFF';
        newUser.isActive = status === 'ACTIVE';
        if (password && String(password).trim().length >= 6) {
          newUser.password = String(password).trim();
        }
        await newUser.save();
      } else {
      // Create user with STAFF role
      newUser = new User({
        firstName,
        lastName,
        email: normalizedEmail,
        phone: phone || '',
        password: finalPassword,
        role: 'STAFF',
        profileImage: profileImage || null,
        isActive: status === 'ACTIVE'
      });

      await newUser.save();
      }

      // Create employee profile linked to user
      const newEmployee = new Employee({
        employeeId,
        user: newUser._id,
        firstName,
        lastName,
        email: normalizedEmail,
        phone: phone || '',
        dateOfBirth: (dateOfBirth && dateOfBirth !== '') ? new Date(dateOfBirth) : null,
        gender: gender || 'OTHER',
        department,
        designation,
        joiningDate: data.joiningDate || new Date(),
        employmentType,
        salary,
        salaryCurrency: salaryCurrency || 'INR',
        salaryEffectiveDate: salaryEffectiveDate || new Date().toISOString().substring(0, 10),
        paidLeaveAllowance: paidLeaveAllowance || 1,
        salaryHistory: salary > 0 ? [{
          amount: salary,
          currency: salaryCurrency || 'INR',
          effectiveDate: salaryEffectiveDate || new Date().toISOString().substring(0, 10),
          changedBy: currentUser ? `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || 'HR Admin' : 'HR Admin',
          reason: 'Initial Salary on joining',
          timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19)
        }] : [],
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
    } catch (err) {
      if (newUser && newUser._id) {
        try {
          await User.findByIdAndDelete(newUser._id);
        } catch (_) {}
      }
      throw err;
    }
  }

  /**
   * Get employee by ID
   */
  
  async getEmployeeById(id) {
    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { $or: [{ _id: id }, { employeeId: id.toUpperCase() }, { user: id }] };
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
  async updateEmployee(id, updateData, currentUser = null) {
    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query = { $or: [{ _id: id }, { employeeId: id.toUpperCase() }, { user: id }] };
    } else {
      query = { employeeId: id.toUpperCase() };
    }

    const employee = await Employee.findOne(query);
    if (!employee) {
      throw new AppError('Employee not found', 404);
    }

    // Support name/fullName (split into firstName and lastName)
    const rawName = (updateData.name || updateData.fullName || '').trim();
    if (rawName) {
      const parts = rawName.split(/\s+/);
      updateData.firstName = parts[0];
      updateData.lastName = parts.slice(1).join(' ') || parts[0];
    } else if (updateData.firstName && updateData.lastName === undefined) {
      // If only firstName is provided, preserve existing lastName or fallback
      if (!employee.lastName) {
        updateData.lastName = updateData.firstName;
      }
    } else if (updateData.firstName && updateData.lastName !== undefined && !String(updateData.lastName).trim()) {
      updateData.lastName = updateData.firstName;
    }

    // Support phoneNumber field from Flutter in addition to phone
    if (!updateData.phone && updateData.phoneNumber !== undefined) {
      updateData.phone = updateData.phoneNumber;
    }

    // Check if new email is in use by another user or employee
    let normalizedEmail = null;
    if (updateData.email) {
      normalizedEmail = updateData.email.toLowerCase().trim();
      if (normalizedEmail !== employee.email) {
        const existingUser = await User.findOne({
          email: normalizedEmail,
          _id: { $ne: employee.user }
        });
        if (existingUser) {
          throw new AppError('Email address is already in use by another account', 409);
        }
        const existingEmp = await Employee.findOne({
          email: normalizedEmail,
          _id: { $ne: employee._id }
        });
        if (existingEmp) {
          throw new AppError('Email address is already in use by another employee', 409);
        }
      } else {
        normalizedEmail = employee.email;
      }
    }

    // Handle password credential update (Super Admin authorization check)
    let passwordToUpdate = null;
    if (updateData.password !== undefined && updateData.password !== null) {
      const trimmedPwd = String(updateData.password).trim();
      if (trimmedPwd.length > 0) {
        // Enforce Super Admin authorization
        const role = currentUser?.role ? String(currentUser.role).toUpperCase() : '';
        if (role !== 'SUPER_ADMIN' && role !== 'SUPERADMIN') {
          throw new AppError('Only Super Admin is authorized to change employee credentials', 403);
        }
        if (trimmedPwd.length < 6) {
          throw new AppError('Password must be at least 6 characters long', 400);
        }
        passwordToUpdate = trimmedPwd;
      }
    }

    // Synchronize linked User account
    const userId = (employee.user && employee.user._id) ? employee.user._id : employee.user;
    let user = null;
    if (userId) {
      user = await User.findById(userId);
    }
    if (!user && employee.email) {
      user = await User.findOne({ email: employee.email.toLowerCase().trim() });
      if (user) {
        employee.user = user._id;
      }
    }
    if (!user && normalizedEmail) {
      user = await User.findOne({ email: normalizedEmail });
      if (user) {
        employee.user = user._id;
      }
    }

    if (!user) {
      if (passwordToUpdate) {
        user = new User({
          firstName: updateData.firstName || employee.firstName,
          lastName: updateData.lastName || employee.lastName,
          email: normalizedEmail || employee.email,
          phone: updateData.phone || employee.phone || '',
          password: passwordToUpdate,
          role: 'STAFF',
          profileImage: updateData.profileImage || employee.profileImage || null,
          isActive: employee.status === 'ACTIVE'
        });
        await user.save();
        employee.user = user._id;
      } else {
        throw new AppError('Linked user login account not found for this employee', 404);
      }
    }

    if (updateData.firstName) user.firstName = updateData.firstName;
    if (updateData.lastName) user.lastName = updateData.lastName;
    if (normalizedEmail && normalizedEmail !== user.email) {
      user.email = normalizedEmail;
    }
    if (updateData.phone !== undefined) user.phone = updateData.phone;
    if (updateData.profileImage !== undefined) user.profileImage = updateData.profileImage;
    if (updateData.status) {
      user.isActive = updateData.status === 'ACTIVE';
    }
    if (passwordToUpdate) {
      user.password = passwordToUpdate; // triggers pre('save') bcrypt hashing
      user.refreshToken = null; // Invalidate current session tokens
    }
    await user.save();

    // Update Employee document fields
    if (normalizedEmail) {
      employee.email = normalizedEmail;
    }
    if (updateData.dateOfBirth !== undefined) {
      employee.dateOfBirth = (updateData.dateOfBirth && updateData.dateOfBirth !== '') ? new Date(updateData.dateOfBirth) : null;
    }
    Object.keys(updateData).forEach((key) => {
      if (
        key !== 'user' &&
        key !== '_id' &&
        key !== 'password' &&
        key !== 'email' &&
        key !== 'dateOfBirth' &&
        key !== 'name' &&
        key !== 'fullName' &&
        key !== 'phoneNumber' &&
        updateData[key] !== undefined
      ) {
        employee[key] = updateData[key];
      }
    });

    await employee.save();

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
   * Update employee salary with history tracking
   */
  async updateSalary(id, salaryData) {
    const employee = await this.getEmployeeById(id);
    const {
      salary,
      salaryCurrency = 'INR',
      salaryEffectiveDate = '',
      changedBy = 'HR Admin',
      reason = 'Salary Adjustment'
    } = salaryData;

    if (salary === undefined || salary === null) {
      throw new AppError('New salary amount is required', 400);
    }
    if (salary < 0) {
      throw new AppError('Salary cannot be negative', 400);
    }

    const effectiveDateStr = salaryEffectiveDate || new Date().toISOString().substring(0, 10);
    const historyEntry = {
      amount: salary,
      currency: salaryCurrency,
      effectiveDate: effectiveDateStr,
      changedBy,
      reason,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19)
    };

    employee.salary = salary;
    employee.salaryCurrency = salaryCurrency;
    employee.salaryEffectiveDate = effectiveDateStr;
    employee.salaryHistory = [historyEntry, ...(employee.salaryHistory || [])];

    await employee.save();
    return await Employee.findById(employee._id).populate('user', 'role isActive');
  }


  /**
   * Get attendance records for HR
   */
  async getAttendance({ page = 1, limit = 20, employeeId, startDate, endDate, status, department, search, workMode }) {
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

    if (department) {
      const employees = await Employee.find({ department: new RegExp(`^${String(department).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).select('_id').lean();
      const departmentEmployeeIds = employees.map(e => e._id);
      if (filter.employee) {
        if (!departmentEmployeeIds.some(id => id.equals(filter.employee))) {
          return { attendance: [], pagination: { page, limit, total: 0, totalPages: 0 } };
        }
      } else {
        filter.employee = { $in: departmentEmployeeIds };
      }
    }

    if (search && search.trim()) {
      const searchText = search.trim().replace(/[^a-z0-9@ _.-]/gi, '');
      if (!searchText) return { attendance: [], pagination: { page, limit, total: 0, totalPages: 0 } };
      const terms = searchText.split(/\s+/).filter(Boolean);
      const matches = await Employee.find({ $and: terms.map(term => { const regex = new RegExp(term, 'i'); return { $or: [{ employeeId: regex }, { firstName: regex }, { lastName: regex }, { email: regex }] }; }) }).select('_id').lean();
      const matchingIds = matches.map(employee => String(employee._id));
      if (!matchingIds.length) return { attendance: [], pagination: { page, limit, total: 0, totalPages: 0 } };
      if (filter.employee) {
        const currentIds = filter.employee.$in ? filter.employee.$in.map(String) : [String(filter.employee)];
        const intersection = currentIds.filter(id => matchingIds.includes(id));
        if (!intersection.length) return { attendance: [], pagination: { page, limit, total: 0, totalPages: 0 } };
        filter.employee = { $in: intersection };
      } else {
        filter.employee = { $in: matchingIds };
      }
    }

    if (workMode && workMode.toLowerCase() !== 'all') {
      const modeRegex = new RegExp('^' + workMode.trim() + '$', 'i');
      const modeEmployees = await Employee.find({ workMode: modeRegex }).select('_id').lean();
      const modeIds = modeEmployees.map(employee => employee._id);
      const modeMatch = [{ workMode: modeRegex }];
      if (modeIds.length) modeMatch.push({ employee: { $in: modeIds }, workMode: { $in: [null, ''] } });
      filter.$and = [...(filter.$and || []), { $or: modeMatch }];
    }

    if (status === 'LATE') {
      filter.late = true;
      filter.checkIn = { $ne: null };
    } else if (status) {
      filter.status = status;
    }

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = getDayBounds(startDate).startOfDay;
      if (endDate) filter.date.$lte = getDayBounds(endDate).endOfDay;
    }

    let attendance;
    let total;
    if (status === 'LATE') {
      const lateFilter = { ...filter };
      delete lateFilter.late;
      delete lateFilter.checkIn;
      const lateRows = await Attendance.find({ ...lateFilter, late: true, checkIn: { $ne: null } })
        .populate('employee', 'employeeId firstName lastName department designation status workMode')
        .sort({ date: -1, createdAt: -1 })
        .lean();
      const currentWorkdayRows = (startDate || endDate) ? lateRows : lateRows.filter(row => isAttendanceForCurrentWorkday(row));
      total = currentWorkdayRows.length;
      attendance = currentWorkdayRows.slice(skip, skip + limit);
    } else {
      [attendance, total] = await Promise.all([
        Attendance.find(filter)
          .populate('employee', 'employeeId firstName lastName department designation status workMode')
          .sort({ date: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Attendance.countDocuments(filter)
      ]);
    }

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      attendance,
      pagination: { page, limit, total, totalPages }
    };
  }

  /**
   * Get attendance for a specific employee
   */
  async getAttendanceByEmployeeId(empIdentifier, { page = 1, limit = 20, startDate, endDate, status }) {
    let emp;
    if (mongoose.Types.ObjectId.isValid(empIdentifier)) {
      emp = await Employee.findOne({ $or: [{ _id: empIdentifier }, { employeeId: empIdentifier.toUpperCase() }] });
    } else {
      emp = await Employee.findOne({ employeeId: empIdentifier.toUpperCase() });
    }

    if (!emp) {
      throw new AppError('Employee not found', 404);
    }

    return this.getAttendance({ page, limit, employeeId: emp._id.toString(), startDate, endDate, status });
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
        .populate('document')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Leave.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      leaves: enrichLeaveResponses(leaves, 'hr'),
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
      .populate('approvedBy', 'firstName lastName email role')
      .populate('document');

    if (!leave) {
      throw new AppError('Leave request not found', 404);
    }

    return enrichLeaveResponse(leave, 'hr');
  }

  /**
   * Approve leave request
   */
  async approveLeave(id, adminUserId) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid leave ID', 400);
    }

    const leave = await Leave.findById(id);
    if (!leave) {
      throw new AppError('Leave request not found', 404);
    }

    if (leave.status !== 'PENDING') {
      throw new AppError(`Cannot approve leave request with status: ${leave.status}`, 400);
    }

    leave.status = 'APPROVED';
    leave.approvedBy = adminUserId;
    leave.approvedAt = new Date();
    leave.rejectionReason = null;
    await leave.save();

    const updated = await Leave.findById(leave._id)
      .populate('employee', 'employeeId firstName lastName department designation status workMode')
      .populate('approvedBy', 'firstName lastName email')
      .populate('document');

    return enrichLeaveResponse(updated, 'hr');
  }

  /**
   * Reject leave request
   */
  async rejectLeave(id, adminUserId, rejectionReason = '') {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid leave ID', 400);
    }

    const leave = await Leave.findById(id);
    if (!leave) {
      throw new AppError('Leave request not found', 404);
    }

    if (leave.status !== 'PENDING') {
      throw new AppError(`Cannot reject leave request with status: ${leave.status}`, 400);
    }

    leave.status = 'REJECTED';
    leave.approvedBy = adminUserId;
    leave.approvedAt = new Date();
    leave.rejectionReason = rejectionReason || 'Leave request was not approved by HR.';
    await leave.save();

    const updated = await Leave.findById(leave._id)
      .populate('employee', 'employeeId firstName lastName department designation status workMode')
      .populate('approvedBy', 'firstName lastName email')
      .populate('document');

    return enrichLeaveResponse(updated, 'hr');
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

  /**
   * Get Company-Wide Birthdays (Today & Upcoming within specified days)
   * Across BOTH Tech & Telecalling departments.
   * Excludes birth year and sensitive employee data from public staff viewing.
   */
  async getCompanyBirthdays(daysAhead = 30, referenceDate = new Date()) {
    const Employee = require('../models/Employee');
    const employees = await Employee.find({
      status: { $in: ['ACTIVE', 'ON_LEAVE', 'PROBATION', 'active', 'on_leave', 'probation'] },
      dateOfBirth: { $ne: null }
    }).select('firstName lastName department designation profileImage dateOfBirth employeeId').lean();

    const ref = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    const currentYear = ref.getFullYear();
    const currentMonth = ref.getMonth() + 1; // 1-12
    const currentDay = ref.getDate(); // 1-31

    const isLeapYear = (year) => (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);

    const todayBirthdays = [];
    const upcomingBirthdays = [];
    const seenIds = new Set();

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Midnight of reference date in local calendar context
    const todayMidnight = new Date(currentYear, currentMonth - 1, currentDay, 0, 0, 0, 0);

    for (const emp of employees) {
      if (!emp.dateOfBirth) continue;
      const empIdStr = (emp._id || emp.employeeId || '').toString();
      if (seenIds.has(empIdStr)) continue;
      seenIds.add(empIdStr);

      let bMonth, bDay;
      if (emp.dateOfBirth instanceof Date) {
        bMonth = emp.dateOfBirth.getUTCMonth() + 1;
        bDay = emp.dateOfBirth.getUTCDate();
      } else if (typeof emp.dateOfBirth === 'string') {
        const parts = emp.dateOfBirth.split('T')[0].split('-');
        if (parts.length >= 3) {
          bMonth = parseInt(parts[1], 10);
          bDay = parseInt(parts[2], 10);
        } else {
          const d = new Date(emp.dateOfBirth);
          if (isNaN(d.getTime())) continue;
          bMonth = d.getUTCMonth() + 1;
          bDay = d.getUTCDate();
        }
      } else {
        const d = new Date(emp.dateOfBirth);
        if (isNaN(d.getTime())) continue;
        bMonth = d.getUTCMonth() + 1;
        bDay = d.getUTCDate();
      }

      if (!bMonth || !bDay || isNaN(bMonth) || isNaN(bDay)) continue;

      // Determine celebrated day in current year:
      // If born on Feb 29 and current year is non-leap, celebrate on Feb 28
      let celebratedDayThisYear = bDay;
      if (bMonth === 2 && bDay === 29 && !isLeapYear(currentYear)) {
        celebratedDayThisYear = 28;
      }

      const celebrationDateThisYear = new Date(currentYear, bMonth - 1, celebratedDayThisYear, 0, 0, 0, 0);

      let targetCelebrationDate;
      let effectiveDay = celebratedDayThisYear;

      if (celebrationDateThisYear.getTime() === todayMidnight.getTime()) {
        targetCelebrationDate = celebrationDateThisYear;
        effectiveDay = celebratedDayThisYear;
      } else if (celebrationDateThisYear > todayMidnight) {
        targetCelebrationDate = celebrationDateThisYear;
        effectiveDay = celebratedDayThisYear;
      } else {
        // Celebration in current year has passed; next celebration is in currentYear + 1
        const nextYear = currentYear + 1;
        let celebratedDayNextYear = bDay;
        if (bMonth === 2 && bDay === 29 && !isLeapYear(nextYear)) {
          celebratedDayNextYear = 28;
        }
        targetCelebrationDate = new Date(nextYear, bMonth - 1, celebratedDayNextYear, 0, 0, 0, 0);
        effectiveDay = celebratedDayNextYear;
      }

      const diffMs = targetCelebrationDate.getTime() - todayMidnight.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      const isToday = (diffDays === 0);

      const fullName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Employee';

      const birthdayRecord = {
        id: (emp._id || emp.employeeId).toString(),
        employeeId: emp.employeeId || '',
        name: fullName,
        department: emp.department || 'Unassigned',
        designation: emp.designation || '',
        profileImage: emp.profileImage || null,
        birthdayFormatted: `${monthNames[bMonth - 1]} ${effectiveDay}`,
        birthdayMonth: bMonth,
        birthdayDay: effectiveDay,
        daysUntil: diffDays,
        isToday: isToday
      };

      if (isToday) {
        todayBirthdays.push(birthdayRecord);
      } else if (diffDays > 0 && diffDays <= daysAhead) {
        upcomingBirthdays.push(birthdayRecord);
      }
    }

    // Sort upcoming birthdays by daysUntil ascending
    upcomingBirthdays.sort((a, b) => a.daysUntil - b.daysUntil);
    // Sort today's birthdays by name
    todayBirthdays.sort((a, b) => a.name.localeCompare(b.name));

    return {
      today: todayBirthdays,
      upcoming: upcomingBirthdays,
      totalToday: todayBirthdays.length,
      totalUpcoming: upcomingBirthdays.length
    };
  }

  /**
   * Update employee status (PATCH /api/hr/employees/:id/status)
   */
  async updateEmployeeStatus(id, newStatus) {
    const validStatuses = ['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED'];
    if (!validStatuses.includes(newStatus)) {
      throw new AppError(`Invalid status '${newStatus}'. Allowed: ${validStatuses.join(', ')}`, 400);
    }

    const employee = await this.getEmployeeById(id);
    employee.status = newStatus;
    await employee.save();

    // Sync user active flag
    if (newStatus === 'ACTIVE') {
      await User.findByIdAndUpdate(employee.user, { isActive: true });
    } else {
      await User.findByIdAndUpdate(employee.user, { isActive: false });
    }

    return await Employee.findById(employee._id).populate('user', 'role isActive lastLogin');
  }

  /**
   * Get Departments & Headcounts (GET /api/hr/departments)
   */
  async getDepartments() {
    const employees = await Employee.find({ status: { $ne: 'TERMINATED' } }).lean();

    const techStaff = employees.filter(e => (e.department || '').toLowerCase().includes('tech') || (e.department || '').toLowerCase().includes('engineering'));
    const teleStaff = employees.filter(e => (e.department || '').toLowerCase().includes('tele') || (e.department || '').toLowerCase().includes('client'));

    const schedules = await DepartmentSchedule.find().lean();
    const scheduleFor = (departmentNames) => schedules.find(s => departmentNames.some(n => n.toLowerCase() === s.department.toLowerCase())) || null;
    return [
      {
        deptKey: 'tech',
        title: 'Tech & Engineering',
        subtitle: 'Frontend, Backend, Infrastructure & QA',
        staffCount: techStaff.length,
        activeCount: techStaff.filter(s => s.status === 'ACTIVE').length,
        leadName: 'Anita Rao (Lead HR / Tech Ops)',
        icon: 'computer',
        color: '#2563EB',
        schedule: scheduleFor([...new Set(techStaff.map(e => e.department))])
      },
      {
        deptKey: 'telecalling',
        title: 'Telecalling & Client Relations',
        subtitle: 'Candidate Outreach, Lead Calling & Customer Support',
        staffCount: teleStaff.length,
        activeCount: teleStaff.filter(s => s.status === 'ACTIVE').length,
        leadName: 'Neha Sharma (Operations Senior)',
        icon: 'headset_mic',
        color: '#DB2777',
        schedule: scheduleFor([...new Set(teleStaff.map(e => e.department))])
      }
    ];
  }

  /**
   * Get Single Department details (GET /api/hr/departments/:deptKey)
   */
  async getDepartmentByKey(deptKey) {
    const departments = await this.getDepartments();
    const key = (deptKey || '').toLowerCase();
    const dept = departments.find(d => d.deptKey === key || d.title.toLowerCase().includes(key));
    if (!dept) {
      throw new AppError(`Department '${deptKey}' not found`, 404);
    }
    return dept;
  }

  async setDepartmentSchedule(department, { checkInTime, timeZone, gracePeriodMinutes = 0 } = {}) {
    const name = String(department || '').trim();
    if (!name || name.length > 100) throw new AppError('A valid department key is required', 400);
    if (typeof checkInTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(checkInTime)) {
      throw new AppError('Check-in time must use 24-hour HH:mm format', 400);
    }
    if (typeof timeZone !== 'string' || !timeZone.trim()) throw new AppError('IANA time zone is required', 400);
    if (!Number.isSafeInteger(gracePeriodMinutes) || gracePeriodMinutes < 0) {
      throw new AppError('Grace period must be a non-negative integer', 400);
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    } catch (_) {
      throw new AppError('Invalid time zone', 400);
    }
    const exists = await Employee.exists({ department: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    if (!exists) throw new AppError('Department not found', 404);
    return DepartmentSchedule.findOneAndUpdate(
      { department: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      { $set: { department: name, checkInTime, timeZone, gracePeriodMinutes } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
  }

  async getDepartmentSchedule(department) {
    const name = String(department || '').trim();
    if (!name || name.length > 100) throw new AppError('A valid department key is required', 400);
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const employeeExists = await Employee.exists({ department: new RegExp(`^${escaped}$`, 'i') });
    if (!employeeExists) throw new AppError('Department not found', 404);
    return DepartmentSchedule.findOne({ department: new RegExp(`^${escaped}$`, 'i') }).lean();
  }
}

module.exports = new HRService();

