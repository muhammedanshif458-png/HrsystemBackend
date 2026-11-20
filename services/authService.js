const User = require('../models/User');
const Employee = require('../models/Employee');
const StaffLoginHistory = require('../models/StaffLoginHistory');
const env = require('../config/env');
const logger = require('../utils/logger');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken, generateResetToken, hashToken } = require('../utils/jwt');
const { AppError } = require('../middleware/errorMiddleware');

/**
 * Authentication Service
 */
class AuthService {
  /**
   * Login user with email and password
   */
  async login(email, password, loginContext = {}) {
    // Explicitly select password field as it is marked select: false
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!env.isProduction) {
      logger.debug(`[Auth-Dev] Login attempt initiated for email: "${normalizedEmail}"`);
    }

    const user = await User.findOne({ email: normalizedEmail }).select('+password');

    if (!user) {
      if (!env.isProduction) {
        logger.warn(`[Auth-Dev] Login 401: No user found matching email "${normalizedEmail}". Check that the user exists in the database.`);
      }
      throw new AppError('Invalid email or password', 401);
    }

    if (!user.isActive) {
      if (!env.isProduction) {
        logger.warn(`[Auth-Dev] Login 403: User account "${normalizedEmail}" is deactivated (isActive = false).`);
      }
      throw new AppError('Your account has been deactivated. Please contact HR.', 403);
    }

    // Defensive check: Verify linked Employee profile status if exists
    let employeeData = await Employee.findOne({
      $or: [{ user: user._id }, { email: normalizedEmail }]
    });

    if (employeeData) {
      if (employeeData.isDeleted || employeeData.status === 'INACTIVE' || employeeData.status === 'TERMINATED' || employeeData.status === 'RESIGNED') {
        if (user.isActive) {
          user.isActive = false;
          user.refreshToken = null;
          await user.save();
        }
        if (!env.isProduction) {
          logger.warn(`[Auth-Dev] Login 403: Linked employee profile for "${normalizedEmail}" is inactive, terminated, or deleted.`);
        }
        throw new AppError('Your account has been deactivated. Please contact HR.', 403);
      }
    }

    if (!user.password) {
      if (!env.isProduction) {
        logger.error(`[Auth-Dev] Login 401: Stored user "${normalizedEmail}" has no password hash.`);
      }
      throw new AppError('Invalid email or password', 401);
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      if (!env.isProduction) {
        logger.warn(`[Auth-Dev] Login 401: Password mismatch for user "${normalizedEmail}".`);
      }
      throw new AppError('Invalid email or password', 401);
    }

    const location = loginContext.location;
    const workMode = loginContext.workMode || null;

    // Validate workMode if provided
    if (workMode && !['OFFICE', 'WORK_FROM_HOME'].includes(workMode)) {
      throw new AppError('Work mode must be OFFICE or WORK_FROM_HOME', 400);
    }

    // Location is optional for both OFFICE and WORK_FROM_HOME modes.
    // STAFF_LOGIN_REQUIRE_LOCATION must never block OFFICE or WORK_FROM_HOME logins.
    if (user.role === 'STAFF' && !workMode && env.staffLoginRequireLocation && !location) {
      throw new AppError('Location is required to login. Enable location permission and try again.', 400);
    }

    // Update last login
    user.lastLogin = new Date();

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // If non-STAFF, do not attach employee profile to the returned user object
    if (user.role !== 'STAFF') {
      employeeData = null;
    }

    const hasValidLocation = Boolean(
      location &&
      typeof location === 'object' &&
      location.latitude != null &&
      location.longitude != null &&
      !isNaN(Number(location.latitude)) &&
      !isNaN(Number(location.longitude))
    );

    const loginAt = new Date();
    const loginHistory = await StaffLoginHistory.create({
      employeeId: employeeData?._id || null,
      userId: user._id,
      workMode,
      locationStatus: hasValidLocation ? 'CAPTURED' : 'NOT_PROVIDED',
      latitude: hasValidLocation ? Number(location.latitude) : null,
      longitude: hasValidLocation ? Number(location.longitude) : null,
      accuracy: hasValidLocation && location.accuracy != null && !isNaN(Number(location.accuracy)) ? Number(location.accuracy) : null,
      capturedAt: hasValidLocation && location.capturedAt ? new Date(location.capturedAt) : null,
      loginAt,
      metadata: loginContext.metadata || {}
    });

    user.refreshToken = refreshToken;
    await user.save();

    const userObj = user.toJSON();
    if (employeeData) {
      userObj.employee = employeeData;
    }

    if (!userObj.id && userObj._id) {
      userObj.id = userObj._id.toString();
    }
    if (!userObj.name) {
      userObj.name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    }

    return {
      token: accessToken,
      accessToken,
      refreshToken,
      workMode: loginHistory.workMode,
      loginAt: loginHistory.loginAt,
      user: userObj
    };
  }

  /**
   * Refresh Access Token
   */
  async refreshToken(token) {
    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch (err) {
      throw new AppError('Invalid or expired refresh token', 401);
    }

    const user = await User.findById(decoded.id).select('+refreshToken');
    if (!user || user.refreshToken !== token) {
      throw new AppError('Invalid refresh token or user session expired', 401);
    }

    if (!user.isActive) {
      throw new AppError('User account is inactive', 403);
    }

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    user.refreshToken = newRefreshToken;
    await user.save();

    return {
      token: newAccessToken,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    };
  }

  /**
   * Logout user by invalidating refresh token
   */
  async logout(userId) {
    if (userId) {
      await User.findByIdAndUpdate(userId, { refreshToken: null });
    }
    return true;
  }

  /**
   * Request password reset token
   */
  async forgotPassword(email) {
    const user = await User.findOne({ email });
    if (!user) {
      // Return success-like response to avoid email enumeration attacks
      return { message: 'If an account with that email exists, reset instructions have been generated.' };
    }

    const { token, hashedToken, expires } = generateResetToken();

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = expires;
    await user.save();

    return {
      message: 'Password reset token generated successfully.',
      // Providing resetToken in development mode so client/test can consume it
      resetToken: process.env.NODE_ENV !== 'production' ? token : undefined
    };
  }

  /**
   * Reset password using provided reset token
   */
  async resetPassword(token, newPassword) {
    const hashedToken = hashToken(token);

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() }
    }).select('+resetPasswordToken +resetPasswordExpires');

    if (!user) {
      throw new AppError('Password reset token is invalid or has expired', 400);
    }

    user.password = newPassword;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    user.refreshToken = null; // Invalidate current session
    await user.save();

    return { message: 'Password has been reset successfully. Please login with your new password.' };
  }
}

module.exports = new AuthService();
