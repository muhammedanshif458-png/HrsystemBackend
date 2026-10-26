const staffService = require('../services/staffService');
const { sendSuccess } = require('../utils/response');

/**
 * Staff Controller
 */
class StaffController {
  /**
   * GET /api/staff/dashboard
   */
  async getDashboard(req, res, next) {
    try {
      const data = await staffService.getDashboard(req.user);
      return sendSuccess(res, 'Staff dashboard fetched successfully', data);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/staff/profile
   */
  async getProfile(req, res, next) {
    try {
      const profile = await staffService.getProfile(req.user);
      return sendSuccess(res, 'Profile fetched successfully', profile);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/staff/profile
   */
  async updateProfile(req, res, next) {
    try {
      const updated = await staffService.updateProfile(req.user, req.body);
      return sendSuccess(res, 'Profile updated successfully', updated);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/staff/attendance/check-in
   */
  async checkIn(req, res, next) {
    try {
      const attendance = await staffService.checkIn(req.user, req.body.remarks);
      return sendSuccess(res, 'Checked in successfully', attendance, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/staff/attendance/check-out
   */
  async checkOut(req, res, next) {
    try {
      const attendance = await staffService.checkOut(req.user, req.body.remarks);
      return sendSuccess(res, 'Checked out successfully', attendance);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/staff/attendance/break-start
   */
  async startBreak(req, res, next) {
    try {
      const attendance = await staffService.startBreak(req.user, req.body);
      return sendSuccess(res, 'Break started successfully', attendance, 200);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/staff/attendance/break-end
   */
  async endBreak(req, res, next) {
    try {
      const attendance = await staffService.endBreak(req.user, req.body);
      return sendSuccess(res, 'Break ended successfully', attendance, 200);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/staff/attendance
   */
  async getAttendance(req, res, next) {
    try {
      const { attendance, pagination } = await staffService.getAttendanceHistory(req.user, req.query);
      return sendSuccess(res, 'Attendance history fetched successfully', attendance, 200, pagination);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/staff/leaves
   */
  async applyLeave(req, res, next) {
    try {
      const leave = await staffService.applyLeave(req.user, req.body, req.file);
      return sendSuccess(res, 'Leave request submitted successfully', leave, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/staff/leaves
   */
  async getLeaves(req, res, next) {
    try {
      const { leaves, pagination } = await staffService.getLeaves(req.user, req.query);
      return sendSuccess(res, 'Leave requests fetched successfully', leaves, 200, pagination);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/staff/leaves/:id
   */
  async getLeaveById(req, res, next) {
    try {
      const leave = await staffService.getLeaveById(req.user, req.params.id);
      return sendSuccess(res, 'Leave request details fetched successfully', leave);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/staff/leaves/:id
   */
  async cancelLeave(req, res, next) {
    try {
      const leave = await staffService.cancelLeave(req.user, req.params.id);
      return sendSuccess(res, 'Leave request cancelled successfully', leave);
    } catch (err) {
      next(err);
    }
  }
  /**
   * GET /api/staff/birthdays
   * Company-wide birthdays for staff view
   */
  async getBirthdays(req, res, next) {
    try {
      const hrService = require('../services/hrService');
      const daysAhead = req.query.daysAhead !== undefined ? parseInt(req.query.daysAhead, 10) : 30;
      const birthdays = await hrService.getCompanyBirthdays(daysAhead);
      return sendSuccess(res, 'Company birthdays fetched successfully', birthdays);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new StaffController();