const logger = require('../utils/logger');
const env = require('../config/env');
const { sendError, sendValidationError } = require('../utils/response');

/**
 * Custom Application Error class with status code
 */
class AppError extends Error {
  constructor(message, statusCode = 500, errors = null) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.errors = errors;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Centralized Error Handling Middleware
 */
const errorMiddleware = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.name = err.name;
  error.stack = err.stack;

  const statusCode = err.statusCode || 500;

  // Log error details for diagnostics
  if (statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} - ${err.message}`, env.isProduction ? '' : err.stack);
  } else {
    logger.warn(`${req.method} ${req.originalUrl} - [${statusCode}] ${err.message}`);
  }

  // 0. Database temporarily unreachable (Atlas blip, reconnecting): tell the
  //    client to retry instead of returning an internal 500.
  const dbUnavailable =
    ['MongooseServerSelectionError', 'MongoServerSelectionError', 'MongoNetworkError', 'MongoNetworkTimeoutError']
      .includes(err.name) ||
    /buffering timed out|Client must be connected|connection .* closed/i.test(err.message || '');
  if (dbUnavailable) {
    return sendError(res, 'Database is temporarily unavailable. Please try again in a few seconds.', null, 503);
  }

  // 1. Mongoose Bad ObjectId / CastError
  if (err.name === 'CastError') {
    const message = `Invalid resource identifier: ${err.value}`;
    return sendError(res, message, null, 400);
  }

  // 2. Mongoose Duplicate Key Error (Code 11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || err.keyPattern || {})[0] || 'unknown';
    const value = err.keyValue ? err.keyValue[field] : '';
    let message = `Duplicate value '${value}' entered for field: ${field}.`;

    if (field === 'email') {
      message = `An account or employee with email '${value || ''}' already exists (field: email).`;
    } else if (field === 'employeeId') {
      message = `An employee with Employee ID '${value || ''}' already exists (field: employeeId).`;
    } else if (field === 'user') {
      message = 'This user account is already linked to another employee profile (field: user).';
    } else if (field === 'employee' || (err.keyPattern && err.keyPattern.employee && err.keyPattern.date)) {
      message = 'Attendance record already exists for this employee on this date (field: employee).';
    }

    return sendError(res, message, null, 409);
  }

  // 3. Mongoose Validation Error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((el) => ({
      field: el.path,
      message: el.message
    }));
    return sendValidationError(res, errors, 'Database validation failed');
  }

  // 4. JWT Errors
  if (err.name === 'JsonWebTokenError') {
    return sendError(res, 'Invalid authorization token.', null, 401);
  }

  if (err.name === 'TokenExpiredError') {
    return sendError(res, 'Authorization token has expired. Please login again.', null, 401);
  }

  // 5. Express-Validator or AppError with errors array
  if (err.errors && Array.isArray(err.errors)) {
    return sendValidationError(res, err.errors, err.message || 'Validation failed');
  }

  // 6. Multer Errors
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return sendError(res, 'File size exceeds 15MB limit', null, 400);
    }
    return sendError(res, err.message || 'File upload failed', null, 400);
  }

  // 7. Operational AppError with specified status code
  const message = err.message || 'Internal Server Error';

  // In production, do not leak internal system details for 500 errors
  if (statusCode === 500 && env.isProduction) {
    return sendError(res, 'Internal server error occurred.', null, 500);
  }

  return sendError(res, message, null, statusCode);
};

module.exports = {
  AppError,
  errorMiddleware
};
