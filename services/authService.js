const User = require('../models/User');
const Employee = require('../models/Employee');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken, generateResetToken, hashToken } = require('../utils/jwt');
const { AppError } = require('../middleware/errorMiddleware');

/**
 * Authentication Service
 */
class AuthService {
  /**
   * Login user with email and password
   */
  async login(email, password) {
    // Explicitly select password field as it is marked select: false
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail }).select('+password');

    if (!user) {
      throw new AppError('Invalid email or password', 401);
    }

    if (!user.isActive) {
      throw new AppError('Your account has been deactivated. Please contact HR.', 403);
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw new AppError('Invalid email or password', 401);
    }

    // Update last login
    user.lastLogin = new Date();

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    user.refreshToken = refreshToken;
    await user.save();

    // Fetch linked employee profile if user is STAFF
    let employeeData = null;
    if (user.role === 'STAFF') {
      employeeData = (await Employee.findOne({ user: user._id })) || (await Employee.findOne({ email: user.email }));
    }

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
