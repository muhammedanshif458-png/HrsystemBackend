const authService = require('../services/authService');
const { sendSuccess } = require('../utils/response');

/**
 * Auth Controller
 */
class AuthController {
  /**
   * POST /api/auth/login
   */
  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const data = await authService.login(email, password);
      return sendSuccess(res, 'Login successful', data);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/logout
   */
  async logout(req, res, next) {
    try {
      await authService.logout(req.user?._id || req.user?.id);
      return sendSuccess(res, 'Logout successful', null);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/refresh-token
   */
  async refreshToken(req, res, next) {
    try {
      const { refreshToken } = req.body;
      const data = await authService.refreshToken(refreshToken);
      return sendSuccess(res, 'Access token refreshed successfully', data);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/forgot-password
   */
  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;
      const result = await authService.forgotPassword(email);
      return sendSuccess(res, result.message, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/reset-password
   */
  async resetPassword(req, res, next) {
    try {
      const { token, newPassword } = req.body;
      const result = await authService.resetPassword(token, newPassword);
      return sendSuccess(res, result.message, null);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AuthController();
