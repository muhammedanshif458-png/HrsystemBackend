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

/**
 * Normalizes frontend leave types ('Casual Leave', 'Sick Leave', 'Earned Leave', 'Medical Leave', etc.)
 * to canonical uppercase enum values understood across backend models and services.
 */
const normalizeLeaveType = (type) => {
  if (!type || typeof type !== 'string') return type;
  const upper = type.trim().toUpperCase();
  switch (upper) {
    case 'CASUAL':
    case 'CASUAL LEAVE':
      return 'CASUAL';
    case 'SICK':
    case 'SICK LEAVE':
      return 'SICK';
    case 'ANNUAL':
    case 'ANNUAL LEAVE':
    case 'EARNED':
    case 'EARNED LEAVE':
      return 'ANNUAL';
    case 'MEDICAL':
    case 'MEDICAL LEAVE':
      return 'MEDICAL';
    case 'UNPAID':
    case 'UNPAID LEAVE':
      return 'UNPAID';
    case 'OTHER':
    case 'OTHER LEAVE':
      return 'OTHER';
    default:
      return upper;
  }
};

const applyLeaveValidator = [
  (req, res, next) => {
    if (req.body) {
      if (!req.body.startDate && req.body.fromDate) {
        req.body.startDate = req.body.fromDate;
      }
      if (!req.body.endDate && req.body.toDate) {
        req.body.endDate = req.body.toDate;
      }
      if (req.body.leaveType) {
        req.body.leaveType = normalizeLeaveType(req.body.leaveType);
      }
    }
    next();
  },
  body('leaveType')
    .trim()
    .notEmpty().withMessage('Leave type is required')
    .isIn(['CASUAL', 'SICK', 'ANNUAL', 'MEDICAL', 'EARNED', 'UNPAID', 'OTHER'])
    .withMessage('Leave type must be CASUAL, SICK, ANNUAL, MEDICAL, UNPAID, or OTHER'),
  body('startDate')
    .notEmpty().withMessage('Start date is required')
    .isISO8601().withMessage('Start date must be a valid date (YYYY-MM-DD)')
    .custom((val) => {
      const d = new Date(val);
      if (isNaN(d.getTime())) {
        throw new Error('Start date must be a valid date (YYYY-MM-DD)');
      }
      return true;
    }),
  body('endDate')
    .notEmpty().withMessage('End date is required')
    .isISO8601().withMessage('End date must be a valid date (YYYY-MM-DD)')
    .custom((endDate, { req }) => {
      const start = new Date(req.body.startDate);
      const end = new Date(endDate);
      if (isNaN(end.getTime())) {
        throw new Error('End date must be a valid date (YYYY-MM-DD)');
      }
      if (end < start) {
        throw new Error('End date cannot be earlier than start date');
      }
      return true;
    }),
  body('reason')
    .trim()
    .notEmpty().withMessage('Reason for leave is required')
    .isLength({ min: 2, max: 500 }).withMessage('Reason must be between 2 and 500 characters'),
  body('documentId')
    .optional({ nullable: true })
    .isMongoId().withMessage('Invalid document ID format'),
  body('documentUrl')
    .optional({ nullable: true })
    .custom((val) => {
      if (!val) return true;
      if (typeof val !== 'string') throw new Error('Document URL must be a string');
      if (/^[a-zA-Z]:[\\\/]/.test(val) || /^file:\/\//i.test(val) || /^content:\/\//i.test(val)) {
        throw new Error('Local client paths are not valid server document URLs');
      }
      return true;
    }),
  body('documentName')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 255 }).withMessage('Document name must be under 255 characters'),
  validate
];

const leaveIdParamValidator = [
  param('id')
    .isMongoId().withMessage('Invalid leave ID format'),
  validate
];

const dailyUpdateValidator = [
  (req, res, next) => {
    if (req.body) {
      if (!req.body.updateText) {
        if (req.body.workUpdate) req.body.updateText = req.body.workUpdate;
        else if (req.body.text) req.body.updateText = req.body.text;
        else if (req.body.description) req.body.updateText = req.body.description;
      }
    }
    next();
  },
  body('updateText')
    .trim()
    .notEmpty().withMessage('Update text is required')
    .isLength({ min: 2, max: 2000 }).withMessage('Update text must be between 2 and 2000 characters'),
  body('date')
    .optional({ nullable: true })
    .trim()
    .custom((val) => {
      if (!val) return true;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(val) && isNaN(new Date(val).getTime())) {
        throw new Error('Date must be a valid date (YYYY-MM-DD)');
      }
      return true;
    }),
  body('tasksCompleted')
    .optional()
    .isArray().withMessage('Tasks completed must be an array of strings'),
  body('tasksCompleted.*')
    .optional()
    .trim()
    .isString().withMessage('Each completed task item must be a string'),
  body('blockers')
    .optional()
    .trim()
    .isLength({ max: 1000 }).withMessage('Blockers text must be under 1000 characters'),
  body('hoursWorked')
    .optional({ nullable: true })
    .isFloat({ min: 0, max: 24 }).withMessage('Hours worked must be a number between 0 and 24'),
  validate
];

const dailyUpdateIdParamValidator = [
  param('id')
    .isMongoId().withMessage('Invalid daily update ID format'),
  validate
];

module.exports = {
  normalizeLeaveType,
  updateProfileValidator,
  checkInValidator,
  checkOutValidator,
  applyLeaveValidator,
  leaveIdParamValidator,
  dailyUpdateValidator,
  dailyUpdateIdParamValidator
};

