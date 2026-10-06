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

    // Attach user to request
    req.user = user;

    // If STAFF, attach employee record to request for convenience and security
    if (user.role === 'STAFF') {
      const employee = await Employee.findOne({ user: user._id });
      req.employee = employee; // can be null if not yet linked
    }

    next();
  } catch (error) {
    return sendError(res, 'Authentication failed.', error.message, 401);
  }
};

module.exports = authMiddleware;
