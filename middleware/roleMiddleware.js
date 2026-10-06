const { sendError } = require('../utils/response');

/**
 * Role-Based Access Control Middleware
 * @param  {...string} allowedRoles Roles allowed to access the route
 */
const roleMiddleware = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, 'Authentication required before role check.', null, 401);
    }

    // Flatten in case an array is passed
    const roles = allowedRoles.flat();

    if (!roles.includes(req.user.role)) {
      return sendError(
        res,
        `Forbidden: Access restricted to [${roles.join(', ')}] role(s). Your role: ${req.user.role}`,
        null,
        403
      );
    }

    next();
  };
};

module.exports = roleMiddleware;
