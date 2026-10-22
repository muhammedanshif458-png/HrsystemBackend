const taskService = require('../services/taskService');
const { sendSuccess } = require('../utils/response');

class TaskController {
  /**
   * HR: GET /api/hr/tasks
   */
  async getTasks(req, res, next) {
    try {
      const { tasks, pagination } = await taskService.getTasks(req.query);
      return sendSuccess(res, 'Tasks retrieved successfully', tasks, 200, pagination);
    } catch (err) {
      next(err);
    }
  }

  /**
   * HR: POST /api/hr/tasks
   */
  async createTask(req, res, next) {
    try {
      const task = await taskService.createTask({
        ...req.body,
        user: req.user
      });
      return sendSuccess(res, 'Task assigned successfully', task, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * HR: GET /api/hr/tasks/:id
   */
  async getTaskById(req, res, next) {
    try {
      const task = await taskService.getTaskById(req.params.id);
      return sendSuccess(res, 'Task retrieved successfully', task);
    } catch (err) {
      next(err);
    }
  }

  /**
   * HR: PUT /api/hr/tasks/:id
   */
  async updateTask(req, res, next) {
    try {
      const task = await taskService.updateTask(req.params.id, req.body);
      return sendSuccess(res, 'Task updated successfully', task);
    } catch (err) {
      next(err);
    }
  }

  /**
   * HR: DELETE /api/hr/tasks/:id
   */
  async deleteTask(req, res, next) {
    try {
      const result = await taskService.deleteTask(req.params.id);
      return sendSuccess(res, result.message, null);
    } catch (err) {
      next(err);
    }
  }

  /**
   * STAFF: GET /api/staff/tasks
   */
  async getStaffTasks(req, res, next) {
    try {
      const { tasks, pagination } = await taskService.getStaffTasks(req.user, req.query);
      return sendSuccess(res, 'Assigned tasks retrieved successfully', tasks, 200, pagination);
    } catch (err) {
      next(err);
    }
  }

  /**
   * STAFF: PATCH /api/staff/tasks/:id/status
   */
  async updateStaffTaskStatus(req, res, next) {
    try {
      const task = await taskService.updateStaffTaskStatus(req.user, req.params.id, req.body.status);
      return sendSuccess(res, 'Task status updated successfully', task);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new TaskController();
