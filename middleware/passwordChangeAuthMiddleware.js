const User = require('../models/User');
const { verifyAccessToken, getTokenRejection } = require('../utils/jwt');
const { sendError } = require('../utils/response');

/**
 * Password Change Auth Middleware
 * Accepts both full access tokens and scoped temporary tokens ('password_change_only')
 * to allow users requiring a mandatory password change to reach the change-password endpoint.
 */
const passwordChangeAuthMiddleware = async (req, res, next) => {
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

    const rejection = getTokenRejection(decoded, user, { allowPasswordChangeOnly: true });
    if (rejection) {
      return sendError(res, rejection.message, null, rejection.status);
    }

    // Attach user and decoded token info to request
    req.user = user;
    req.tokenScope = decoded.scope || 'normal';

    next();
  } catch (error) {
    return sendError(res, 'Authentication failed.', error.message, 401);
  }
};

module.exports = passwordChangeAuthMiddleware;
