const mongoose = require('mongoose');
const DailyUpdate = require('../models/DailyUpdate');
const Employee = require('../models/Employee');
const { AppError } = require('../middleware/errorMiddleware');

/**
 * Format a daily update document into a clean, frontend-friendly object.
 * Perfectly compatible with Flutter HR Dashboard (DailyUpdate model: id, staffId, date, updateText)
 * and rich REST consumers (employee details, timestamps, department).
 */
const formatDailyUpdate = (doc) => {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };

  const emp = obj.employee && typeof obj.employee === 'object' && obj.employee._id ? obj.employee : null;
  const empId = emp ? String(emp._id) : (obj.employee ? String(obj.employee) : null);
  const employeeStringId = emp ? emp.employeeId : null;
  const firstName = emp ? emp.firstName || '' : '';
  const lastName = emp ? emp.lastName || '' : '';
  const fullName = emp
    ? (`${firstName} ${lastName}`.trim() || emp.name || '')
    : '';
  const department = obj.department || (emp ? emp.department : '');

  return {
    id: String(obj._id),
    _id: obj._id,
    staffId: empId, // Corresponds to Flutter staff.id in staff_profile_view
    employeeId: employeeStringId || empId,
    employeeName: fullName,
    department,
    date: obj.date,
    updateText: obj.updateText,
    tasksCompleted: Array.isArray(obj.tasksCompleted) ? obj.tasksCompleted : [],
    blockers: obj.blockers || '',
    hoursWorked: obj.hoursWorked !== undefined ? obj.hoursWorked : null,
    employee: emp
      ? {
          id: String(emp._id),
          _id: emp._id,
          employeeId: emp.employeeId,
          name: fullName,
          firstName: emp.firstName,
          lastName: emp.lastName,
          email: emp.email,
          department: emp.department,
          designation: emp.designation,
          profileImage: emp.profileImage || null
        }
      : obj.employee,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt
  };
};

class DailyUpdateService {
  /**
   * Helper to resolve the authenticated staff member's Employee record
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
   * Staff: Submit a daily work update.
   * Resolves the employee identity strictly from the authenticated JWT user.
   */
  async submitDailyUpdate(user, updateData) {
    const employee = await this.getEmployeeOrThrow(user);

    // Normalize date (YYYY-MM-DD)
    let dateStr = new Date().toISOString().split('T')[0];
    if (updateData.date && typeof updateData.date === 'string' && updateData.date.trim()) {
      const raw = updateData.date.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        dateStr = raw;
      } else {
        const parsed = new Date(raw);
        if (!isNaN(parsed.getTime())) {
          dateStr = parsed.toISOString().split('T')[0];
        }
      }
    }

    // Support updateText or fallback aliases
    const text = (updateData.updateText || updateData.workUpdate || updateData.text || updateData.description || '').trim();
    if (!text) {
      throw new AppError('Update text is required', 422);
    }

    const dailyUpdate = new DailyUpdate({
      employee: employee._id,
      user: user._id,
      department: employee.department || 'General',
      date: dateStr,
      updateText: text,
      tasksCompleted: Array.isArray(updateData.tasksCompleted)
        ? updateData.tasksCompleted.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
        : [],
      blockers: typeof updateData.blockers === 'string' ? updateData.blockers.trim() : '',
      hoursWorked: updateData.hoursWorked !== undefined && updateData.hoursWorked !== null && updateData.hoursWorked !== ''
        ? parseFloat(updateData.hoursWorked)
        : null
    });

    await dailyUpdate.save();

    await dailyUpdate.populate('employee', 'firstName lastName employeeId email department designation profileImage');

    return formatDailyUpdate(dailyUpdate);
  }

  /**
   * Staff: Retrieve authenticated staff's own daily updates with pagination and date filter.
   */
  async getStaffDailyUpdates(user, query = {}) {
    const employee = await this.getEmployeeOrThrow(user);

    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const filter = {
      employee: employee._id,
      isDeleted: false
    };

    if (query.date && typeof query.date === 'string' && query.date.trim()) {
      filter.date = query.date.trim().split('T')[0];
    } else if (query.startDate && query.endDate) {
      filter.date = {
        $gte: query.startDate.trim().split('T')[0],
        $lte: query.endDate.trim().split('T')[0]
      };
    } else if (query.startDate) {
      filter.date = { $gte: query.startDate.trim().split('T')[0] };
    } else if (query.endDate) {
      filter.date = { $lte: query.endDate.trim().split('T')[0] };
    }

    const [items, total] = await Promise.all([
      DailyUpdate.find(filter)
        .populate('employee', 'firstName lastName employeeId email department designation profileImage')
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DailyUpdate.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      updates: items.map(formatDailyUpdate),
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    };
  }

  /**
   * Staff: Retrieve single daily update by ID (only if owned by staff).
   */
  async getStaffDailyUpdateById(user, id) {
    const employee = await this.getEmployeeOrThrow(user);

    const update = await DailyUpdate.findOne({ _id: id, isDeleted: false })
      .populate('employee', 'firstName lastName employeeId email department designation profileImage');

    if (!update) {
      throw new AppError('Daily update not found', 404);
    }

    const updateEmpId = update.employee && update.employee._id ? String(update.employee._id) : String(update.employee);
    if (updateEmpId !== String(employee._id)) {
      throw new AppError('Forbidden: You can only view your own daily work updates', 403);
    }

    return formatDailyUpdate(update);
  }

  /**
   * HR / Super Admin: Retrieve company-wide daily work updates with filters & pagination.
   */
  async getHRDailyUpdates(query = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const filter = { isDeleted: false };

    // Filter by employee (Mongo ID, string employeeId e.g. EMP1001, or staffId)
    const empIdentifier = (query.employeeId || query.employee || query.staffId || '').toString().trim();
    if (empIdentifier) {
      if (mongoose.Types.ObjectId.isValid(empIdentifier)) {
        filter.employee = new mongoose.Types.ObjectId(empIdentifier);
      } else {
        const emp = await Employee.findOne({ employeeId: empIdentifier.toUpperCase() });
        if (emp) {
          filter.employee = emp._id;
        } else {
          // No such employee exists, return empty result cleanly
          return {
            updates: [],
            pagination: { page, limit, total: 0, totalPages: 1 }
          };
        }
      }
    }

    // Filter by department
    if (query.department && query.department.trim()) {
      filter.department = new RegExp(`^${query.department.trim()}$`, 'i');
    }

    // Filter by date or date range
    if (query.date && typeof query.date === 'string' && query.date.trim()) {
      filter.date = query.date.trim().split('T')[0];
    } else if (query.startDate && query.endDate) {
      filter.date = {
        $gte: query.startDate.trim().split('T')[0],
        $lte: query.endDate.trim().split('T')[0]
      };
    } else if (query.startDate) {
      filter.date = { $gte: query.startDate.trim().split('T')[0] };
    } else if (query.endDate) {
      filter.date = { $lte: query.endDate.trim().split('T')[0] };
    }

    // Search text within updateText or employee name
    if (query.search && query.search.trim()) {
      const searchRegex = new RegExp(query.search.trim(), 'i');
      const matchedEmployees = await Employee.find({
        $or: [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { employeeId: searchRegex }
        ]
      }).select('_id');

      const matchedEmpIds = matchedEmployees.map((e) => e._id);
      filter.$or = [
        { updateText: searchRegex },
        { department: searchRegex },
        { employee: { $in: matchedEmpIds } }
      ];
    }

    const [items, total] = await Promise.all([
      DailyUpdate.find(filter)
        .populate('employee', 'firstName lastName employeeId email department designation profileImage')
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DailyUpdate.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      updates: items.map(formatDailyUpdate),
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    };
  }

  /**
   * HR / Super Admin: Retrieve single daily update by ID.
   */
  async getHRDailyUpdateById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid daily update ID format', 400);
    }

    const update = await DailyUpdate.findOne({ _id: id, isDeleted: false })
      .populate('employee', 'firstName lastName employeeId email department designation profileImage');

    if (!update) {
      throw new AppError('Daily update not found', 404);
    }

    return formatDailyUpdate(update);
  }

  /**
   * HR / Super Admin: Retrieve updates for a specific employee.
   */
  async getEmployeeDailyUpdates(employeeIdentifier, query = {}) {
    let employee;
    if (mongoose.Types.ObjectId.isValid(employeeIdentifier)) {
      employee = await Employee.findById(employeeIdentifier);
    }
    if (!employee) {
      employee = await Employee.findOne({ employeeId: employeeIdentifier.toUpperCase().trim() });
    }
    if (!employee) {
      throw new AppError('Employee not found', 404);
    }

    return await this.getHRDailyUpdates({ ...query, employeeId: employee._id.toString() });
  }
}

module.exports = new DailyUpdateService();
