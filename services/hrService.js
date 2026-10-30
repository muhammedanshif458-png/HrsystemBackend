const mongoose = require('mongoose');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const DepartmentSchedule = require('../models/DepartmentSchedule');
const { isAttendanceForCurrentWorkday, getDateKey, getDayBoundsForKey } = require('../utils/attendanceSchedule');
const Leave = require('../models/Leave');
const Task = require('../models/Task');
const HRDocument = require('../models/HRDocument');
const DailyUpdate = require('../models/DailyUpdate');
const { calculateLateness } = require('../utils/scheduleHelper');
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
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [
      totalEmployees,
      activeEmployees,
      inactiveEmployees,
      active,
      todayRows,
      approvedTodayLeaves,
      pendingLeaves,
      approvedLeaves,
      openTasks,
      resignedLast30Days
    ] = await Promise.all([
      Employee.countDocuments({ isDeleted: { $ne: true } }),
      Employee.countDocuments({ status: 'ACTIVE', isDeleted: { $ne: true } }),
      Employee.countDocuments({ status: 'INACTIVE', isDeleted: { $ne: true } }),
      Employee.find({ status: 'ACTIVE', isDeleted: { $ne: true } }).select('_id').lean(),
      Attendance.find({ date: { $gte: startOfDay, $lte: endOfDay } })
        .select('employee status late isLate checkIn workMode createdAt date scheduledCheckIn scheduleSnapshot')
        .populate('employee', 'status workMode department')
        .sort({ checkIn: -1, createdAt: -1 })
        .lean(),
      Leave.find({ status: 'APPROVED', startDate: { $lte: endOfDay }, endDate: { $gte: startOfDay } }).select('employee').lean(),
      Leave.countDocuments({ status: 'PENDING' }),
      Leave.countDocuments({ status: 'APPROVED' }),
      Task.countDocuments({ status: { $in: ['pending', 'in-progress'] }, isDeleted: { $ne: true } }),
      Employee.countDocuments({ status: { $in: ['TERMINATED', 'RESIGNED'] }, isDeleted: { $ne: true }, updatedAt: { $gte: thirtyDaysAgo } })
    ]);
    const metrics = summarizeAttendanceDay({
      activeEmployeeIds: active.map(employee => employee._id),
      attendanceRows: todayRows,
      approvedLeaveRows: approvedTodayLeaves,
      dateKey: dateKey || getDateKey(new Date(), 'Asia/Kolkata')
    });
    const eligibleEmployees = Math.max(0, activeEmployees - (metrics.onLeaveToday || 0));
    const notCheckedIn = Math.max(0, eligibleEmployees - (metrics.todayPresent || 0));
    return {
      totalEmployees,
      activeEmployees,
      inactiveEmployees,
      resignedEmployees: await Employee.countDocuments({ status: 'RESIGNED', isDeleted: { $ne: true } }),
      eligibleEmployees,
      notCheckedIn,
      openTasks,
      resignedLast30Days,
      ...metrics,
      todayLate: metrics.lateArrivals,
      pendingLeaves,
      approvedLeaves
    };
  }

  /**
   * Get list of employees with search, filter, and pagination
   */
  async getEmployees({ page = 1, limit = 20, search = '', department, designation, status, employmentType, includeDeleted = false }) {
        page = Math.max(1, parseInt(page, 10));
        limit = Math.max(1, Math.min(100, parseInt(limit, 10)));
        const skip = (page - 1) * limit;

        const filter = {};

        if (includeDeleted === true || includeDeleted === 'true') {
          filter.isDeleted = true;
        } else {
          filter.isDeleted = { $ne: true };
        }

        if(search && search.trim() !== '') {
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

  if(department) filter.department = new RegExp(`^${department.trim()}$`, 'i');
  if(designation) filter.designation = new RegExp(`^${designation.trim()}$`, 'i');
  if(status && status.trim() !== '') {
    const s = status.trim().toUpperCase();
    if (s === 'DELETED') {
      filter.isDeleted = true;
    } else if (s !== 'ALL') {
      filter.status = s;
    }
  }
  if(employmentType) filter.employmentType = employmentType;

  const[employees, total] = await Promise.all([
    Employee.find(filter)
      .populate('user', 'role isActive lastLogin')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Employee.countDocuments(filter)
  ]);

const totalPages = Math.ceil(total / limit) || 1;

const enrichedEmployees = employees.map(emp => ({
  ...emp,
  id: emp._id ? emp._id.toString() : '',
  name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
  phoneNumber: emp.phone || '',
  role: emp.designation || (emp.user?.role === 'HR' ? 'HR' : 'Staff'),
  employmentStatus: emp.status,
  isResigned: emp.status === 'RESIGNED',
  isDeactivated: emp.status === 'INACTIVE',
  resignationDate: emp.resignationDate || null,
  resignationReason: emp.resignationReason || ''
}));

return {
  employees: enrichedEmployees,
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
      } catch (_) { }
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
    const validStatuses = ['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED', 'RESIGNED'];
    if (!validStatuses.includes(updateData.status)) {
      throw new AppError(`Invalid status '${updateData.status}'. Allowed: ${validStatuses.join(', ')}`, 400);
    }
    if (employee.status === 'RESIGNED' && updateData.status !== 'RESIGNED') {
      throw new AppError('Cannot change status of a resigned employee. Formal resignation cannot be altered via employee update.', 400);
    }
    if (updateData.status === 'RESIGNED') {
      employee.resignationDate = updateData.resignationDate ? new Date(updateData.resignationDate) : (employee.resignationDate || new Date());
      employee.resignationReason = (updateData.resignationReason || updateData.reason || employee.resignationReason || '').trim();
    }
    user.isActive = (updateData.status === 'ACTIVE' || updateData.status === 'ON_LEAVE');
    if (!user.isActive) {
      user.refreshToken = null;
    }
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
   * Delete employee safely preserving referential integrity
   */
  async deleteEmployee(id, { force = false, hard = false } = {}) {
    const employee = await this.getEmployeeById(id);

    const [attendanceCount, leaveCount, taskCount, documentCount, updateCount] = await Promise.all([
      Attendance.countDocuments({ employee: employee._id }),
      Leave.countDocuments({ employee: employee._id }),
      Task.countDocuments({ $or: [{ employee: employee._id }, { assignedTo: employee._id }] }),
      HRDocument.countDocuments({ employee: employee._id }),
      DailyUpdate.countDocuments({ employee: employee._id })
    ]);
    const totalRelations = attendanceCount + leaveCount + taskCount + documentCount + updateCount;

    if (hard) {
      if (totalRelations > 0 && !force) {
        throw new AppError(
          `Cannot permanently delete employee with ${totalRelations} related records across Attendance, Leaves, Tasks, Documents or Daily Updates. Permanent deletion would violate data integrity. Specify force=true if authorized, or use standard safe deletion.`,
          409
        );
      }
      await Employee.findByIdAndDelete(employee._id);
      if (employee.user) {
        const userId = employee.user._id || employee.user;
        await User.findByIdAndDelete(userId);
      }
      return {
        message: 'Employee permanently deleted successfully',
        employeeId: employee.employeeId,
        hardDeleted: true,
        historicalRecordsPreserved: false
      };
    }

    // Standard safe deletion: soft-delete employee and deactivate user
    employee.isDeleted = true;
    employee.deletedAt = new Date();
    if (employee.status === 'ACTIVE') {
      employee.status = 'INACTIVE';
    }
    await employee.save();

    if (employee.user) {
      const userId = employee.user._id || employee.user;
      await User.findByIdAndUpdate(userId, { isActive: false, refreshToken: null });
    }

    return {
      message: 'Employee deleted successfully. Historical records preserved.',
      employeeId: employee.employeeId,
      softDeleted: true,
      historicalRecordsPreserved: true,
      relatedRecordsCount: totalRelations
    };
  }

  /**
   * Deactivate an employee (POST /api/hr/employees/:id/deactivate)
   */
  async deactivateEmployee(id, { reason = '' } = {}) {
    const employee = await this.getEmployeeById(id);

    if (employee.isDeleted) {
      throw new AppError('Cannot deactivate a deleted employee', 400);
    }
    if (employee.status === 'RESIGNED') {
      throw new AppError('Cannot deactivate a resigned employee. Employee is already formally marked as resigned.', 400);
    }
    if (employee.status === 'INACTIVE') {
      throw new AppError('Employee is already inactive', 400);
    }

    employee.status = 'INACTIVE';
    await employee.save();

    if (employee.user) {
      const userId = employee.user._id || employee.user;
      await User.findByIdAndUpdate(userId, { isActive: false, refreshToken: null });
    }

    return await Employee.findById(employee._id).populate('user', 'role isActive lastLogin');
  }

  /**
   * Reactivate a deactivated employee (POST /api/hr/employees/:id/reactivate)
   */
  async reactivateEmployee(id) {
    const employee = await this.getEmployeeById(id);

    if (employee.isDeleted) {
      throw new AppError('Cannot reactivate a deleted employee', 400);
    }
    if (employee.status === 'RESIGNED') {
      throw new AppError('Cannot reactivate a formally resigned employee. Resignation cannot be reversed through standard reactivation.', 400);
    }
    if (employee.status === 'ACTIVE') {
      throw new AppError('Employee is already active', 400);
    }

    employee.status = 'ACTIVE';
    await employee.save();

    if (employee.user) {
      const userId = employee.user._id || employee.user;
      await User.findByIdAndUpdate(userId, { isActive: true });
    }

    return await Employee.findById(employee._id).populate('user', 'role isActive lastLogin');
  }

  /**
   * Formally mark an employee as resigned (POST /api/hr/employees/:id/resign)
   */
  async resignEmployee(id, { resignationDate, reason = '' } = {}) {
    const employee = await this.getEmployeeById(id);

    if (employee.isDeleted) {
      throw new AppError('Cannot mark a deleted employee as resigned', 400);
    }
    if (employee.status === 'RESIGNED') {
      throw new AppError('Employee has already resigned', 400);
    }

    let parsedDate = new Date();
    if (resignationDate) {
      parsedDate = new Date(resignationDate);
      if (isNaN(parsedDate.getTime())) {
        throw new AppError('Invalid resignation date provided', 400);
      }
    }

    employee.status = 'RESIGNED';
    employee.resignationDate = parsedDate;
    employee.resignationReason = (reason || '').trim();
    await employee.save();

    if (employee.user) {
      const userId = employee.user._id || employee.user;
      await User.findByIdAndUpdate(userId, { isActive: false, refreshToken: null });
    }

    return await Employee.findById(employee._id).populate('user', 'role isActive lastLogin');
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
  async getAttendance({ page = 1, limit = 20, employeeId, startDate, endDate, date, status, department, search, workMode }) {
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

  if (department && department.trim() !== '') {
    const dept = department.trim();
    const escaped = dept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const canonicalKey = DepartmentSchedule.toCanonicalDeptKey ? DepartmentSchedule.toCanonicalDeptKey(dept) : dept.toUpperCase();
    const patterns = [
      new RegExp(`^${escaped}$`, 'i'),
      new RegExp(`^${canonicalKey}$`, 'i')
    ];
    if (canonicalKey === 'TECH') {
      patterns.push(/tech/i, /engineering/i);
    } else if (canonicalKey === 'TELECALLING') {
      patterns.push(/tele/i, /calling/i, /client/i);
    }

    const matchingEmps = await Employee.find({
      $or: patterns.map(p => ({ department: p }))
    }).select('_id');

    const empIds = matchingEmps.map(e => e._id);
    if (filter.employee) {
      if (!empIds.some(id => id.equals(filter.employee))) {
        return { attendance: [], pagination: { page, limit, total: 0, totalPages: 0 } };
      }
    } else {
      filter.employee = { $in: empIds };
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

  const effectiveStartDate = startDate || date;
  const effectiveEndDate = endDate || date;

  if (effectiveStartDate || effectiveEndDate) {
    filter.date = {};
    if (effectiveStartDate) filter.date.$gte = getDayBounds(effectiveStartDate).startOfDay;
    if (effectiveEndDate) filter.date.$lte = getDayBounds(effectiveEndDate).endOfDay;
  }

  let rawAttendance;
  let total;

  if (status && status.toUpperCase() === 'LATE') {
    const lateQuery = {
      ...filter,
      checkIn: { $ne: null },
      $or: [{ late: true }, { isLate: true }, { status: 'LATE' }]
    };
    const lateRows = await Attendance.find(lateQuery)
      .populate('employee', 'employeeId firstName lastName department designation status workMode')
      .sort({ date: -1, createdAt: -1 })
      .lean();

    // If no explicit date range was supplied, restrict to current workday per schedule timezone
    const currentWorkdayRows = (!effectiveStartDate && !effectiveEndDate)
      ? lateRows.filter(row => isAttendanceForCurrentWorkday(row))
      : lateRows;

    total = currentWorkdayRows.length;
    rawAttendance = currentWorkdayRows.slice(skip, skip + limit);
  } else {
    if (status) {
      filter.status = status.toUpperCase();
    }
    [rawAttendance, total] = await Promise.all([
      Attendance.find(filter)
        .populate('employee', 'employeeId firstName lastName department designation status workMode')
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Attendance.countDocuments(filter)
    ]);
  }

    const attendance = await Promise.all(
      rawAttendance.map(async (rec) => {
        const isCurrent = isAttendanceForCurrentWorkday(rec);
        let snapshot = rec.scheduleSnapshot;
        let effSched = null;

        if (isCurrent && rec.employee?.department) {
          effSched = await DepartmentSchedule.getEffectiveSchedule(rec.employee.department, new Date());
          if (effSched) {
            snapshot = {
              scheduleId: effSched._id,
              department: effSched.department,
              scheduledCheckIn: effSched.checkInTime,
              scheduledCheckOut: effSched.checkOutTime || '18:00',
              gracePeriodMinutes: typeof effSched.gracePeriodMinutes === 'number' ? effSched.gracePeriodMinutes : 0,
              timezone: effSched.timezone || effSched.timeZone || 'Asia/Kolkata'
            };
          }
        } else if (!snapshot && rec.employee?.department) {
          effSched = await DepartmentSchedule.getEffectiveSchedule(rec.employee.department, rec.date || rec.checkIn || new Date());
          if (effSched) {
            snapshot = {
              scheduleId: effSched._id,
              department: effSched.department,
              scheduledCheckIn: effSched.checkInTime,
              scheduledCheckOut: effSched.checkOutTime || '18:00',
              gracePeriodMinutes: typeof effSched.gracePeriodMinutes === 'number' ? effSched.gracePeriodMinutes : 0,
              timezone: effSched.timezone || effSched.timeZone || 'Asia/Kolkata'
            };
          }
        }

        let isLateRec = Boolean(rec.late || rec.isLate || rec.status === 'LATE');
        let minutesLate = Number(rec.minutesLate) || 0;

        if (isCurrent && rec.checkIn && snapshot?.scheduledCheckIn) {
          const calc = calculateLateness(new Date(rec.checkIn), snapshot);
          isLateRec = calc.isLate;
          minutesLate = calc.minutesLate;
        } else if (isLateRec && minutesLate === 0 && rec.checkIn && snapshot?.scheduledCheckIn) {
          const calc = calculateLateness(new Date(rec.checkIn), snapshot);
          minutesLate = calc.minutesLate;
        }

        const scheduledCheckIn = isCurrent
          ? (snapshot?.scheduledCheckIn || snapshot?.checkInTime || rec.scheduledCheckIn || null)
          : (rec.scheduledCheckIn || snapshot?.scheduledCheckIn || snapshot?.checkInTime || null);

        const scheduledCheckOut = isCurrent
          ? (snapshot?.scheduledCheckOut || snapshot?.checkOutTime || rec.scheduledCheckOut || '18:00')
          : (rec.scheduledCheckOut || snapshot?.scheduledCheckOut || snapshot?.checkOutTime || '18:00');

        const scheduleTimeZone = rec.scheduleTimeZone || snapshot?.timezone || snapshot?.timeZone || 'Asia/Kolkata';
        const scheduleConfigured = Boolean(rec.scheduleConfigured || rec.scheduleStatus === 'CONFIGURED' || scheduledCheckIn || snapshot);
        const gracePeriodMinutes = typeof snapshot?.gracePeriodMinutes === 'number'
          ? snapshot.gracePeriodMinutes
          : (typeof rec.gracePeriodMinutes === 'number' ? rec.gracePeriodMinutes : 0);

        const workingHoursNum = Number(rec.workingHours) || 0;
        const workedHoursInt = Math.floor(workingHoursNum);
        const workedMinsInt = Math.round((workingHoursNum - workedHoursInt) * 60);
        const workedDuration = workingHoursNum > 0
          ? (workedMinsInt > 0 ? `${workedHoursInt}h ${workedMinsInt}m` : `${workedHoursInt}h`)
          : '0h';

        const totalBreakMins = Number(rec.totalBreakMinutes) || (Array.isArray(rec.breaks) ? rec.breaks.reduce((s, b) => s + (b.durationMinutes || 0), 0) : 0);
        const formatBreakDurationStr = (mins = 0) => {
          const m = Number(mins) || 0;
          if (!m) return '0m';
          const hours = Math.floor(m / 60);
          const rem = m % 60;
          if (hours > 0 && rem > 0) return `${hours}h ${rem}m`;
          if (hours > 0) return `${hours}h`;
          return `${rem}m`;
        };

        const enrichedBreaks = (rec.breaks || []).map(b => {
          const bObj = typeof b.toObject === 'function' ? b.toObject() : { ...b };
          const startMs = b.startTime ? new Date(b.startTime).getTime() : 0;
          const endMs = b.endTime ? new Date(b.endTime).getTime() : 0;
          const durationSeconds = endMs && startMs ? Math.max(0, Math.round((endMs - startMs) / 1000)) : 0;
          const durationMins = typeof b.durationMinutes === 'number'
            ? b.durationMinutes
            : (durationSeconds ? Math.max(1, Math.round(durationSeconds / 60)) : 0);
          return {
            ...bObj,
            id: b._id ? b._id.toString() : (b.id ? b.id.toString() : ''),
            breakId: b._id ? b._id.toString() : (b.id ? b.id.toString() : ''),
            attendanceId: rec._id ? rec._id.toString() : '',
            breakType: b.breakType,
            type: b.breakType,
            startTime: b.startTime ? new Date(b.startTime).toISOString() : null,
            endTime: b.endTime ? new Date(b.endTime).toISOString() : null,
            durationMinutes: durationMins,
            durationSeconds,
            isActive: !b.endTime,
            isCompleted: Boolean(b.endTime),
            remarks: b.remarks || ''
          };
        });

        return {
          ...rec,
          id: rec._id ? rec._id.toString() : '',
          staffId: rec.employee?._id ? rec.employee._id.toString() : (rec.employee ? rec.employee.toString() : ''),
          employeeId: rec.employee?.employeeId || '',
          checkInTime: rec.checkIn ? new Date(rec.checkIn).toISOString() : null,
          checkOutTime: rec.checkOut ? new Date(rec.checkOut).toISOString() : null,
          checkInAt: rec.checkIn ? new Date(rec.checkIn).toISOString() : null,
          workedDuration,
          breakDuration: formatBreakDurationStr(totalBreakMins),
          totalBreakMinutes: totalBreakMins,
          totalBreakSeconds: totalBreakMins * 60,
          breaks: enrichedBreaks,
          activeBreak: rec.activeBreak || null,
          breakStartedAt: rec.breakStartedAt ? new Date(rec.breakStartedAt).toISOString() : (rec.activeBreak?.startTime ? new Date(rec.activeBreak.startTime).toISOString() : null),
          isLate: isLateRec,
          late: isLateRec,
          minutesLate,
          scheduleConfigured,
          scheduleStatus: scheduleConfigured ? 'CONFIGURED' : (rec.scheduleStatus || 'UNCONFIGURED'),
          scheduledCheckIn,
          scheduledCheckOut,
          scheduleTimeZone,
          timezone: scheduleTimeZone,
          gracePeriodMinutes,
          scheduleSnapshot: snapshot || rec.scheduleSnapshot || null,
          department: rec.employee?.department || rec.scheduleSnapshot?.department || null
        };
      })
    );

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
   * HR / Super Admin: Bulk delete selected leave requests.
   * Only allows permanent deletion of requests with status APPROVED or REJECTED.
   * Rejects entire operation if any selected ID is missing, invalid, or has an ineligible status (e.g. PENDING or CANCELLED).
   *
   * @param {Array<string>} ids Array of MongoDB ObjectId strings
   * @param {Object} options Optional options, e.g. { status: 'APPROVED' | 'REJECTED' }
   * @returns {Promise<{ deletedCount: number, requestedCount: number, validCount: number }>} 
   */
  async bulkDeleteLeaves(ids, options = {}) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError('Please provide a non-empty array of leave request IDs to delete', 400);
    }

    const cleanIds = ids.map(id => (id ? String(id).trim() : '')).filter(Boolean);
    if (cleanIds.length === 0) {
      throw new AppError('Please provide a non-empty array of leave request IDs to delete', 400);
    }

    // 1. Validate ID format for every ID
    const invalidFormatIds = cleanIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidFormatIds.length > 0) {
      throw new AppError('Invalid leave ID format: all IDs must be valid MongoDB ObjectIds. Invalid: ' + invalidFormatIds.slice(0, 3).join(', '), 400);
    }

    const uniqueIds = [...new Set(cleanIds)];
    const objectIds = uniqueIds.map(id => new mongoose.Types.ObjectId(id));

    // 2. Fetch all requested records
    const existingLeaves = await Leave.find({ _id: { $in: objectIds } });

    // 3. Verify that every requested ID exists
    if (existingLeaves.length !== objectIds.length) {
      const foundIdSet = new Set(existingLeaves.map(l => l._id.toString()));
      const missingIds = uniqueIds.filter(id => !foundIdSet.has(id));
      throw new AppError('Leave request(s) not found: ' + missingIds.join(', '), 404);
    }

    // 4. Verify status eligibility for EVERY selected record
    const eligibleStatuses = ['APPROVED', 'REJECTED'];
    const ineligibleLeaves = existingLeaves.filter(l => !eligibleStatuses.includes(l.status));
    if (ineligibleLeaves.length > 0) {
      const ineligibleSummary = [...new Set(ineligibleLeaves.map(l => l.status))].join(', ');
      throw new AppError(
        'Cannot delete leave request(s) with ineligible status (' + ineligibleSummary + '). Only APPROVED and REJECTED leave requests can be deleted. Pending and cancelled requests are strictly protected.',
        400
      );
    }

    // 5. If options.status was specified, verify that all records match that expected status
    const targetStatuses = options.status
      ? [String(options.status).trim().toUpperCase()]
      : eligibleStatuses;

    if (options.status) {
      const targetStatus = targetStatuses[0];
      if (!eligibleStatuses.includes(targetStatus)) {
        throw new AppError('Invalid status filter "' + options.status + '". Only APPROVED and REJECTED leave requests can be deleted.', 400);
      }
      const statusMismatches = existingLeaves.filter(l => l.status !== targetStatus);
      if (statusMismatches.length > 0) {
        const foundStatuses = [...new Set(statusMismatches.map(l => l.status))].join(', ');
        throw new AppError(
          'Selected leave request(s) do not match the expected status "' + targetStatus + '". Found status: ' + foundStatuses,
          400
        );
      }
    }

    // 6. Safe permanent deletion (scoped strictly to the validated IDs and target status)
    const result = await Leave.deleteMany({
      _id: { $in: objectIds },
      status: { $in: targetStatuses }
    });

    return {
      deletedCount: result.deletedCount,
      requestedCount: ids.length,
      validCount: objectIds.length
    };
  }

  /**
   * HR / Super Admin: Clear all eligible leave requests for an explicitly specified status.
   * Only allows clearing status APPROVED or REJECTED.
   * Requires status to be explicitly provided. Indiscriminate deletion of all leaves is strictly rejected.
   * Scopes deletion to status and any explicitly provided filters (employeeId, department, leaveType, date range).
   *
   * @param {Object} filters
   * @returns {Promise<{ deletedCount: number, status: string, filtersApplied: Object }>} 
   */
  async clearAllLeaves(filters = {}) {
    if (!filters.status || typeof filters.status !== 'string' || !filters.status.trim()) {
      throw new AppError(
        'A status of APPROVED or REJECTED is required when clearing leave requests. Indiscriminate deletion of all leave requests is strictly forbidden.',
        400
      );
    }

    const eligibleStatuses = ['APPROVED', 'REJECTED'];
    const normalizedStatus = filters.status.trim().toUpperCase();
    if (!eligibleStatuses.includes(normalizedStatus)) {
      throw new AppError(
        'Cannot clear leave requests with status "' + filters.status + '". Only APPROVED and REJECTED leave requests can be cleared. Pending requests must not be cleared.',
        400
      );
    }

    const deleteFilter = { status: normalizedStatus };

    // Filter by employee (Mongo ID or string employeeId like EMP1001)
    const empIdentifier = (filters.employeeId || filters.employee || filters.staffId || '').toString().trim();
    if (empIdentifier) {
      const Employee = require('../models/Employee');
      let employeeDoc = null;
      if (mongoose.Types.ObjectId.isValid(empIdentifier)) {
        employeeDoc = await Employee.findById(empIdentifier);
      }
      if (!employeeDoc) {
        employeeDoc = await Employee.findOne({ employeeId: empIdentifier.toUpperCase() });
      }
      if (employeeDoc) {
        deleteFilter.employee = employeeDoc._id;
      } else {
        return {
          deletedCount: 0,
          status: normalizedStatus,
          filtersApplied: { employeeId: empIdentifier }
        };
      }
    }

    // Filter by department
    if (filters.department && typeof filters.department === 'string' && filters.department.trim()) {
      const Employee = require('../models/Employee');
      const deptTrim = filters.department.trim();
      const deptEmployees = await Employee.find({
        $or: [
          { department: new RegExp('^' + deptTrim + '$', 'i') },
          { department: new RegExp(deptTrim, 'i') }
        ],
        isDeleted: { $ne: true }
      }).select('_id');
      const empIds = deptEmployees.map(e => e._id);
      if (deleteFilter.employee) {
        const isMatch = empIds.some(id => id.toString() === deleteFilter.employee.toString());
        if (!isMatch) {
          return {
            deletedCount: 0,
            status: normalizedStatus,
            filtersApplied: { department: filters.department, employeeId: empIdentifier }
          };
        }
      } else {
        deleteFilter.employee = { $in: empIds };
      }
    }

    // Filter by leaveType
    if (filters.leaveType && typeof filters.leaveType === 'string' && filters.leaveType.trim()) {
      const rawType = filters.leaveType.trim().toUpperCase();
      deleteFilter.leaveType = rawType.replace(/\s+LEAVE$/, '');
    }

    // Filter by date range (startDate, endDate)
    if (filters.startDate || filters.endDate) {
      deleteFilter.startDate = {};
      if (filters.startDate) deleteFilter.startDate.$gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        deleteFilter.startDate.$lte = end;
      }
    }

    // Execute permanent deletion scoped strictly to target status and filters
    const result = await Leave.deleteMany(deleteFilter);

    return {
      deletedCount: result.deletedCount,
      status: normalizedStatus,
      filtersApplied: {
        employeeId: filters.employeeId || null,
        department: filters.department || null,
        leaveType: filters.leaveType || null,
        startDate: filters.startDate || null,
        endDate: filters.endDate || null
      }
    };
  }

  /**
   * Delete single leave request by ID (only APPROVED or REJECTED)
   */
  async deleteLeaveById(id) {
    return await this.bulkDeleteLeaves([id]);
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
  async updateEmployeeStatus(id, newStatus, body = {}) {
    const validStatuses = ['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED', 'RESIGNED'];
    if (!validStatuses.includes(newStatus)) {
      throw new AppError(`Invalid status '${newStatus}'. Allowed: ${validStatuses.join(', ')}`, 400);
    }

    const employee = await this.getEmployeeById(id);

    if (employee.isDeleted) {
      throw new AppError('Cannot update status of a deleted employee', 400);
    }

    if (newStatus === 'RESIGNED') {
      return await this.resignEmployee(id, {
        resignationDate: body.resignationDate,
        reason: body.resignationReason || body.reason || ''
      });
    }

    if (employee.status === 'RESIGNED') {
      throw new AppError('Cannot change status of a resigned employee. Formal resignation cannot be altered via status update.', 400);
    }

    if (newStatus === 'ACTIVE' && employee.status === 'INACTIVE') {
      return await this.reactivateEmployee(id);
    }

    if (newStatus === 'INACTIVE' && employee.status === 'ACTIVE') {
      return await this.deactivateEmployee(id, { reason: body.reason });
    }

    employee.status = newStatus;
    await employee.save();

    // Sync user active flag
    if (employee.user) {
      const userId = employee.user._id || employee.user;
      if (newStatus === 'ACTIVE' || newStatus === 'ON_LEAVE') {
        await User.findByIdAndUpdate(userId, { isActive: true });
      } else {
        await User.findByIdAndUpdate(userId, { isActive: false, refreshToken: null });
      }
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

  async setDepartmentSchedule(department, { checkInTime, checkOutTime = '18:00', timeZone, timezone, gracePeriodMinutes = 0 } = {}) {
    const name = String(department || '').trim();
    if (!name || name.length > 100) throw new AppError('A valid department key is required', 400);
    if (typeof checkInTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(checkInTime)) {
      throw new AppError('Check-in time must use 24-hour HH:mm format', 400);
    }
    if (checkOutTime && (typeof checkOutTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(checkOutTime))) {
      throw new AppError('Check-out time must use 24-hour HH:mm format', 400);
    }
    const tz = timeZone || timezone || 'Asia/Kolkata';
    if (typeof tz !== 'string' || !tz.trim()) throw new AppError('IANA time zone is required', 400);
    if (!Number.isSafeInteger(gracePeriodMinutes) || gracePeriodMinutes < 0) {
      throw new AppError('Grace period must be a non-negative integer', 400);
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    } catch (_) {
      throw new AppError('Invalid time zone', 400);
    }
    const canonicalDept = DepartmentSchedule.toCanonicalDeptKey ? DepartmentSchedule.toCanonicalDeptKey(name) : name.toUpperCase();
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exists = await Employee.exists({
      $or: [
        { department: new RegExp(`^${escaped}$`, 'i') },
        { department: new RegExp(`^${canonicalDept}$`, 'i') }
      ]
    });
    if (!exists) throw new AppError('Department not found', 404);
    const effectiveCheckOut = checkOutTime || '18:00';
    return DepartmentSchedule.findOneAndUpdate(
      {
        $or: [
          { department: canonicalDept },
          { department: new RegExp(`^${escaped}$`, 'i') }
        ]
      },
      {
        $set: {
          department: name,
          departmentDisplay: name,
          checkInTime,
          checkOutTime: effectiveCheckOut,
          timeZone: tz,
          timezone: tz,
          gracePeriodMinutes
        }
      },
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

  /**
   * Create or update a department schedule (effective-date versioned)
   */
  async createDepartmentSchedule({ department, checkInTime, checkOutTime = '18:00', gracePeriodMinutes = 0, timezone = 'Asia/Kolkata', effectiveDate, description = '', user = null }) {
    if (!department) {
      throw new AppError('Department is required', 400);
    }
    if (!checkInTime) {
      throw new AppError('Check-in time is required', 400);
    }

    const effDate = effectiveDate ? new Date(effectiveDate) : new Date();
    if (isNaN(effDate.getTime())) {
      throw new AppError('Invalid effective date format', 400);
    }

    const canonicalDept = DepartmentSchedule.toCanonicalDeptKey ? DepartmentSchedule.toCanonicalDeptKey(department) : department.trim().toUpperCase();

    const schedule = new DepartmentSchedule({
      department: canonicalDept,
      departmentDisplay: department.trim(),
      checkInTime: checkInTime.trim(),
      checkOutTime: (checkOutTime || '18:00').trim(),
      gracePeriodMinutes: Number(gracePeriodMinutes) || 0,
      timezone: timezone.trim() || 'Asia/Kolkata',
      timeZone: timezone.trim() || 'Asia/Kolkata',
      effectiveDate: effDate,
      description: description ? description.trim() : '',
      createdBy: user ? user._id : null,
      updatedBy: user ? user._id : null
    });

    await schedule.save();
    return schedule;
  }

  /**
   * Get all schedule versions, optionally filtered by department
   */
  async getDepartmentSchedules({ department } = {}) {
    const filter = {};
    if (department) {
      filter.department = department.trim().toUpperCase();
    }
    return await DepartmentSchedule.find(filter)
      .sort({ department: 1, effectiveDate: -1, createdAt: -1 })
      .populate('createdBy', 'firstName lastName email')
      .populate('updatedBy', 'firstName lastName email')
      .lean();
  }

  /**
   * Get effective schedule for a department key (along with historical versions)
   */
  async getDepartmentScheduleByKey(deptKey, targetDate = new Date()) {
    const key = (deptKey || '').trim().toUpperCase();
    const effectiveSchedule = await DepartmentSchedule.getEffectiveSchedule(key, targetDate);
    const history = await DepartmentSchedule.find({ department: key })
      .sort({ effectiveDate: -1, createdAt: -1 })
      .populate('createdBy', 'firstName lastName email')
      .lean();

    return {
      department: key,
      effectiveSchedule,
      history
    };
  }

  /**
   * Safe, auditable historical reclassification of attendance records
   */
  async reclassifyHistoricalAttendance({ startDate, endDate, department, dryRun = true, user = null }) {
    const filter = {};
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    if (department && department.trim() !== '') {
      const canonical = DepartmentSchedule.toCanonicalDeptKey ? DepartmentSchedule.toCanonicalDeptKey(department) : department.trim().toUpperCase();
      const emps = await Employee.find({
        $or: [
          { department: new RegExp(`^${department.trim()}$`, 'i') },
          { department: new RegExp(`^${canonical}$`, 'i') }
        ]
      }).select('_id');
      filter.employee = { $in: emps.map(e => e._id) };
    }

    const records = await Attendance.find(filter).populate('employee');
    const modifications = [];

    for (const record of records) {
      if (!record.checkIn || !record.employee?.department) continue;

      const schedule = await DepartmentSchedule.getEffectiveSchedule(record.employee.department, record.date);
      const latenessResult = calculateLateness(record.checkIn, schedule);

      const isChanged = record.isLate !== latenessResult.isLate ||
        record.minutesLate !== latenessResult.minutesLate ||
        (latenessResult.isLate && record.status !== 'LATE');

      const plan = {
        attendanceId: record._id,
        employeeId: record.employee.employeeId,
        employeeName: `${record.employee.firstName} ${record.employee.lastName}`,
        department: record.employee.department,
        date: record.date,
        checkIn: record.checkIn,
        current: {
          status: record.status,
          isLate: record.isLate,
          minutesLate: record.minutesLate
        },
        proposed: {
          status: latenessResult.isLate ? 'LATE' : record.status,
          isLate: latenessResult.isLate,
          minutesLate: latenessResult.minutesLate,
          scheduleStatus: latenessResult.scheduleStatus,
          scheduleSnapshot: latenessResult.scheduleSnapshot
        },
        isChanged
      };

      modifications.push(plan);

      if (!dryRun && isChanged) {
        record.isLate = latenessResult.isLate;
        record.minutesLate = latenessResult.minutesLate;
        record.scheduleStatus = latenessResult.scheduleStatus;
        record.scheduleSnapshot = latenessResult.scheduleSnapshot;
        if (latenessResult.isLate) {
          record.status = 'LATE';
        }
        await record.save();
      }
    }

    return {
      dryRun,
      totalScanned: records.length,
      changedCount: modifications.filter(m => m.isChanged).length,
      modifications
    };
  }
}

module.exports = new HRService();

