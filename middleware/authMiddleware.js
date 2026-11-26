const User = require('../models/User');
const Employee = require('../models/Employee');
const { verifyAccessToken, getTokenRejection } = require('../utils/jwt');
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

    const rejection = getTokenRejection(decoded, user);
    if (rejection) {
      return sendError(res, rejection.message, null, rejection.status);
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
