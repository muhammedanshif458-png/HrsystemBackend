const mongoose = require('mongoose');
const Task = require('../models/Task');
const Employee = require('../models/Employee');
const { AppError } = require('../middleware/errorMiddleware');

class TaskService {
  /**
   * Helper to resolve employee by ID or employeeId string
   */
  async resolveEmployee(idOrEmpId) {
    let query = {};
    if (mongoose.Types.ObjectId.isValid(idOrEmpId)) {
      query = { $or: [{ _id: idOrEmpId }, { employeeId: idOrEmpId.toUpperCase() }] };
    } else {
      query = { employeeId: idOrEmpId.toUpperCase() };
    }
    const emp = await Employee.findOne(query);
    if (!emp) {
      throw new AppError('Assigned employee not found', 404);
    }
    return emp;
  }

  /**
   * HR: Create and assign a task
   */
  async createTask({ staffId, employeeId, description, department, dueDate, title, user }) {
    const targetId = staffId || employeeId;
    if (!targetId) {
      throw new AppError('Employee ID is required to assign task', 400);
    }

    const employee = await this.resolveEmployee(targetId);

    const task = new Task({
      title: title ? title.trim() : (description ? description.slice(0, 50) : ''),
      description: description.trim(),
      employee: employee._id,
      department: department || employee.department,
      dueDate,
      status: 'pending',
      createdBy: user ? user._id : null
    });

    await task.save();
    return await Task.findById(task._id).populate('employee', 'employeeId firstName lastName department designation profileImage');
  }

  /**
   * HR: List all tasks
   */
  async getTasks({ status, department, employeeId, page = 1, limit = 50 }) {
    page = Math.max(1, parseInt(page, 10));
    limit = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (page - 1) * limit;

    const filter = { isDeleted: false };
    if (status && status !== 'all') {
      filter.status = status.toLowerCase();
    }
    if (department && department !== 'all') {
      filter.department = new RegExp(`^${department.trim()}$`, 'i');
    }
    if (employeeId) {
      const emp = await this.resolveEmployee(employeeId);
      filter.employee = emp._id;
    }

    const [tasks, total] = await Promise.all([
      Task.find(filter)
        .populate('employee', 'employeeId firstName lastName department designation profileImage')
        .populate('createdBy', 'firstName lastName role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Task.countDocuments(filter)
    ]);

    // Format fields for frontend compatibility
    const formatted = tasks.map((t) => ({
      id: t._id,
      _id: t._id,
      staffId: t.employee ? t.employee._id : '',
      employeeId: t.employee ? t.employee.employeeId : '',
      employeeName: t.employee ? `${t.employee.firstName || ''} ${t.employee.lastName || ''}`.trim() : '',
      department: t.department,
      description: t.description,
      title: t.title,
      status: t.status,
      date: t.date || (t.createdAt ? t.createdAt.toISOString().split('T')[0] : ''),
      dueDate: t.dueDate,
      createdAt: t.createdAt
    }));

    return {
      tasks: formatted,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    };
  }

  /**
   * HR: Get single task by ID
   */
  async getTaskById(taskId) {
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      throw new AppError('Invalid task ID', 400);
    }

    const task = await Task.findOne({ _id: taskId, isDeleted: false })
      .populate('employee', 'employeeId firstName lastName department designation profileImage')
      .populate('createdBy', 'firstName lastName role');

    if (!task) {
      throw new AppError('Task not found', 404);
    }

    return task;
  }

  /**
   * HR: Update task
   */
  async updateTask(taskId, updateData) {
    const task = await this.getTaskById(taskId);

    if (updateData.description !== undefined) task.description = updateData.description.trim();
    if (updateData.title !== undefined) task.title = updateData.title.trim();
    if (updateData.dueDate !== undefined) task.dueDate = updateData.dueDate;
    if (updateData.status !== undefined) task.status = updateData.status.toLowerCase();
    if (updateData.department !== undefined) task.department = updateData.department;
    if (updateData.staffId || updateData.employeeId) {
      const emp = await this.resolveEmployee(updateData.staffId || updateData.employeeId);
      task.employee = emp._id;
    }

    await task.save();
    return await Task.findById(task._id).populate('employee', 'employeeId firstName lastName department designation profileImage');
  }

  /**
   * HR: Soft delete task
   */
  async deleteTask(taskId) {
    const task = await this.getTaskById(taskId);
    task.isDeleted = true;
    await task.save();
    return { message: 'Task deleted successfully' };
  }

  /**
   * Staff: Get tasks assigned to self
   */
  async getStaffTasks(user, { status, page = 1, limit = 50 }) {
    const emp = await Employee.findOne({ user: user._id });
    if (!emp) {
      return { tasks: [], pagination: { page: 1, limit, total: 0, totalPages: 0 } };
    }

    page = Math.max(1, parseInt(page, 10));
    limit = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (page - 1) * limit;

    const filter = { employee: emp._id, isDeleted: false };
    if (status && status !== 'all') {
      filter.status = status.toLowerCase();
    }

    const [tasks, total] = await Promise.all([
      Task.find(filter)
        .populate('createdBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Task.countDocuments(filter)
    ]);

    const formatted = tasks.map((t) => ({
      id: t._id,
      _id: t._id,
      staffId: emp._id,
      department: t.department,
      description: t.description,
      title: t.title,
      status: t.status,
      date: t.date || (t.createdAt ? t.createdAt.toISOString().split('T')[0] : ''),
      dueDate: t.dueDate,
      createdAt: t.createdAt
    }));

    return {
      tasks: formatted,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1
      }
    };
  }

  /**
   * Staff: Update task status
   */
  async updateStaffTaskStatus(user, taskId, status) {
    const emp = await Employee.findOne({ user: user._id });
    if (!emp) {
      throw new AppError('Employee profile not found', 404);
    }

    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      throw new AppError('Invalid task ID', 400);
    }

    const task = await Task.findOne({ _id: taskId, employee: emp._id, isDeleted: false });
    if (!task) {
      throw new AppError('Task not found or access denied', 404);
    }

    const validStatuses = ['pending', 'in-progress', 'done'];
    if (!validStatuses.includes(status.toLowerCase())) {
      throw new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
    }

    task.status = status.toLowerCase();
    await task.save();
    return task;
  }
}

module.exports = new TaskService();
