const { body, validationResult } = require('express-validator');
const { sendValidationError } = require('../utils/response');
const { validatePasswordPolicy } = require('../utils/passwordPolicy');

// Middleware to check validation results
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map((err) => ({
      field: err.path || err.param,
      message: err.msg,
      // Do not echo precise location values in validation responses.
      ...(String(err.path || '').startsWith('location') ? {} : { value: err.value })
    }));
    return sendValidationError(res, formattedErrors, 'Validation failed');
  }
  next();
};

const isLocationObject = (value, { req }) =>
  req.body &&
  req.body.location != null &&
  typeof req.body.location === 'object' &&
  !Array.isArray(req.body.location);

const loginValidator = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required'),
  body('workMode').optional({ nullable: true }).isIn(['OFFICE', 'WORK_FROM_HOME'])
    .withMessage('Work mode must be OFFICE or WORK_FROM_HOME'),
  body('location').optional({ nullable: true }).isObject().withMessage('Location must be an object'),
  body('location.latitude').if(isLocationObject).exists({ checkFalsy: false }).withMessage('Latitude is required when location is supplied')
    .bail().isFloat({ min: -90, max: 90 }).withMessage('Latitude must be between -90 and 90'),
  body('location.longitude').if(isLocationObject).exists({ checkFalsy: false }).withMessage('Longitude is required when location is supplied')
    .bail().isFloat({ min: -180, max: 180 }).withMessage('Longitude must be between -180 and 180'),
  body('location.accuracy').if(isLocationObject).exists({ checkFalsy: false }).withMessage('Accuracy is required when location is supplied')
    .bail().isFloat({ min: 0 }).withMessage('Accuracy must be a non-negative number'),
  body('location.capturedAt').if(isLocationObject).exists({ checkFalsy: false }).withMessage('Capture timestamp is required when location is supplied')
    .bail().isISO8601().withMessage('Capture timestamp must be a valid ISO 8601 date'),
  validate
];

const refreshTokenValidator = [
  body('refreshToken')
    .trim()
    .notEmpty().withMessage('Refresh token is required'),
  validate
];

const forgotPasswordValidator = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email address')
    .normalizeEmail(),
  validate
];

const resetPasswordValidator = [
  body('token')
    .trim()
    .notEmpty().withMessage('Reset token is required'),
  body('newPassword')
    .notEmpty().withMessage('New password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  validate
];

const changePasswordValidator = [
  body('newPassword')
    .notEmpty().withMessage('New password is required')
    .custom((val) => {
      const result = validatePasswordPolicy(val);
      if (!result.isValid) {
        throw new Error(result.message);
      }
      return true;
    }),
  validate
];

module.exports = {
  validate,
  loginValidator,
  refreshTokenValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  changePasswordValidator
};
