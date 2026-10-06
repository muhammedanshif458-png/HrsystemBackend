/**
 * Standard API Response Utility
 */

const sendSuccess = (res, message = 'Success', data = null, statusCode = 200, pagination = null) => {
  const response = {
    success: true,
    message,
    data: data !== null ? data : []
  };

  if (pagination) {
    response.pagination = pagination;
  }

  return res.status(statusCode).json(response);
};

const sendError = (res, message = 'Something went wrong', error = null, statusCode = 500) => {
  const response = {
    success: false,
    message,
    error: error !== null ? error : null
  };

  return res.status(statusCode).json(response);
};

const sendValidationError = (res, errors = [], message = 'Validation failed') => {
  return res.status(422).json({
    success: false,
    message,
    errors
  });
};

module.exports = {
  sendSuccess,
  sendError,
  sendValidationError
};
