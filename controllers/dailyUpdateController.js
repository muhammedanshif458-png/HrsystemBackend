const dailyUpdateService = require('../services/dailyUpdateService');
const { sendSuccess } = require('../utils/response');

class DailyUpdateController {
  /**
   * STAFF: Submit daily work update
   * POST /api/staff/daily-updates
   */
  async submitDailyUpdate(req, res, next) {
    try {
      const update = await dailyUpdateService.submitDailyUpdate(req.user, req.body);
      return sendSuccess(res, 'Daily work update submitted successfully', update, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * STAFF: Get own daily updates
   * GET /api/staff/daily-updates
   */
  async getStaffDailyUpdates(req, res, next) {
    try {
      const { updates, pagination } = await dailyUpdateService.getStaffDailyUpdates(req.user, req.query);
      return sendSuccess(res, 'Daily work updates fetched successfully', updates, 200, pagination);
    } catch (err) {
      next(err);
    }
  }

  /**
   * STAFF: Get single own daily update by ID
   * GET /api/staff/daily-updates/:id
   */
  async getStaffDailyUpdateById(req, res, next) {
    try {
      const update = await dailyUpdateService.getStaffDailyUpdateById(req.user, req.params.id);
      return sendSuccess(res, 'Daily work update fetched successfully', update);
    } catch (err) {
      next(err);
    }
  }

  /**
   * HR / Super Admin: Get company-wide daily work updates with filters & pagination
   * GET /api/hr/daily-updates
   */
  async getHRDailyUpdates(req, res, next) {
    try {
      const { updates, pagination } = await dailyUpdateService.getHRDailyUpdates(req.query);
      return sendSuccess(res, 'Daily work updates retrieved successfully', updates, 200, pagination);
    } catch (err) {
      next(err);
    }
  }

  /**
   * HR / Super Admin: Get single daily work update by ID
   * GET /api/hr/daily-updates/:id
   */
  async getHRDailyUpdateById(req, res, next) {
    try {
      const update = await dailyUpdateService.getHRDailyUpdateById(req.params.id);
      return sendSuccess(res, 'Daily work update retrieved successfully', update);
    } catch (err) {
      next(err);
    }
  }

  /**
   * HR / Super Admin: Get all daily work updates for a specific employee
   * GET /api/hr/employees/:id/daily-updates
   */
  async getEmployeeDailyUpdates(req, res, next) {
    try {
      const { updates, pagination } = await dailyUpdateService.getEmployeeDailyUpdates(req.params.id, req.query);
      return sendSuccess(res, 'Employee daily work updates retrieved successfully', updates, 200, pagination);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new DailyUpdateController();
