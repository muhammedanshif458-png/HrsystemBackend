const { body, param } = require('express-validator');
const { validate } = require('./authValidator');

const updateProfileValidator = [
  body('phone')
    .optional()
    .trim(),
  body('address')
    .optional()
    .trim(),
  body('city')
    .optional()
    .trim(),
  body('state')
    .optional()
    .trim(),
  body('country')
    .optional()
    .trim(),
  body('profileImage')
    .optional()
    .trim(),
  body('dateOfBirth')
    .optional({ nullable: true })
    .custom((value) => {
      if (value === null || value === '' || value === undefined) return true;
      if (typeof value === 'boolean') throw new Error('Date of birth must be a valid date');
      const d = new Date(value);
      if (isNaN(d.getTime())) {
        throw new Error('Date of birth must be a valid date');
      }
      if (d > new Date()) {
        throw new Error('Date of birth cannot be in the future');
      }
      return true;
    }),
  body('emergencyContact')
    .optional()
    .isObject().withMessage('Emergency contact must be an object'),
  body('emergencyContact.name')
    .optional()
    .trim(),
  body('emergencyContact.relationship')
    .optional()
    .trim(),
  body('emergencyContact.phone')
    .optional()
    .trim(),
  validate
];

const checkInValidator = [
  body('remarks')
    .optional()
    .trim()
    .isLength({ max: 255 }).withMessage('Remarks must be under 255 characters'),
  validate
];

const checkOutValidator = [
  body('remarks')
    .optional()
    .trim()
    .isLength({ max: 255 }).withMessage('Remarks must be under 255 characters'),
  validate
];

const applyLeaveValidator = [
  body('leaveType')
    .trim()
    .notEmpty().withMessage('Leave type is required')
    .isIn(['CASUAL', 'SICK', 'ANNUAL', 'UNPAID', 'OTHER'])
    .withMessage('Leave type must be CASUAL, SICK, ANNUAL, UNPAID, or OTHER'),
  body('startDate')
    .notEmpty().withMessage('Start date is required')
    .isISO8601().withMessage('Start date must be a valid date (YYYY-MM-DD)'),
  body('endDate')
    .notEmpty().withMessage('End date is required')
    .isISO8601().withMessage('End date must be a valid date (YYYY-MM-DD)')
    .custom((endDate, { req }) => {
      const start = new Date(req.body.startDate);
      const end = new Date(endDate);
      if (end < start) {
        throw new Error('End date cannot be earlier than start date');
      }
      return true;
    }),
  body('reason')
    .trim()
    .notEmpty().withMessage('Reason for leave is required')
    .isLength({ min: 5, max: 500 }).withMessage('Reason must be between 5 and 500 characters'),
  validate
];

const leaveIdParamValidator = [
  param('id')
    .isMongoId().withMessage('Invalid leave ID format'),
  validate
];

module.exports = {
  updateProfileValidator,
  checkInValidator,
  checkOutValidator,
  applyLeaveValidator,
  leaveIdParamValidator
};
