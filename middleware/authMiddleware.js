const User = require('../models/User');
const Employee = require('../models/Employee');
const { verifyAccessToken } = require('../utils/jwt');
const { sendError } = require('../utils/response');

/**
 * Authentication Middleware
 * Validates JWT access token and attaches authenticated user (and employee profile if STAFF) to req
 */
const authMiddleware = async (req, res, next) => {
  try {
    let token;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    if (!token) {
      return sendError(res, 'Access denied. No authorization token provided.', null, 401);
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return sendError(res, 'Authorization token expired. Please login again.', null, 401);
      }
      return sendError(res, 'Invalid authorization token.', null, 401);
    }

    const user = await User.findById(decoded.id);

    if (!user) {
      return sendError(res, 'User belonging to this token no longer exists.', null, 401);
    }

    if (!user.isActive) {
      return sendError(res, 'Your account has been deactivated. Please contact HR.', null, 403);
    }

    // Security Gate: Restrict temporary password_change_only tokens from accessing normal endpoints
    if (decoded.scope === 'password_change_only') {
      return sendError(
        res,
        'Temporary session: you must change your password before accessing system resources.',
        null,
        403
      );
    }

    // Also block normal access if mustChangePassword flag is true on user document
    if (user.mustChangePassword) {
      return sendError(
        res,
        'Password change required. Please change your password to continue.',
        null,
        403
      );
    }

    // Attach user to request
    req.user = user;

    // If STAFF, attach employee record to request for convenience and security
    if (user.role === 'STAFF') {
      let employee = await Employee.findOne({ user: user._id });
      if (!employee && user.email) {
        employee = await Employee.findOne({ email: user.email.toLowerCase().trim() });
        if (employee) {
          employee.user = user._id;
          await employee.save();
        }
      }
      req.employee = employee;
    }

    next();
  } catch (error) {
    return sendError(res, 'Authentication failed.', error.message, 401);
  }
};

module.exports = authMiddleware;
