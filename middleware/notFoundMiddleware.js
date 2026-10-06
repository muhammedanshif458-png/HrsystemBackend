const { sendError } = require('../utils/response');

/**
 * 404 Not Found Middleware
 */
const notFoundMiddleware = (req, res, next) => {
  return sendError(res, `Cannot find route '${req.method} ${req.originalUrl}' on this server.`, null, 404);
};

module.exports = notFoundMiddleware;
