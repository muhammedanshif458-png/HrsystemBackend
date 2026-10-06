const { body, param, query } = require('express-validator');
const { validate } = require('./authValidator');

const createEmployeeValidator = [
  body('firstName')
    .trim()
    .notEmpty().withMessage('First name is required')
    .isLength({ max: 50 }).withMessage('First name must be under 50 characters'),
  body('lastName')
    .trim()
    .notEmpty().withMessage('Last name is required')
    .isLength({ max: 50 }).withMessage('Last name must be under 50 characters'),
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('password')
    .optional()
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  body('employeeId')
    .optional()
    .trim()
    .isLength({ min: 2, max: 20 }).withMessage('Employee ID must be between 2 and 20 characters'),
  body('phone')
    .optional()
    .trim(),
  body('department')
    .trim()
    .notEmpty().withMessage('Department is required'),
  body('designation')
    .trim()
    .notEmpty().withMessage('Designation is required'),
  body('employmentType')
    .optional()
    .isIn(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'])
    .withMessage('Employment type must be FULL_TIME, PART_TIME, CONTRACT, or INTERN'),
  body('salary')
    .optional()
    .isFloat({ min: 0 }).withMessage('Salary must be a non-negative number'),
  body('status')
    .optional()
    .isIn(['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED'])
    .withMessage('Status must be ACTIVE, INACTIVE, ON_LEAVE, or TERMINATED'),
  body('gender')
    .optional()
    .isIn(['MALE', 'FEMALE', 'OTHER'])
    .withMessage('Gender must be MALE, FEMALE, or OTHER'),
  validate
];

const updateEmployeeValidator = [
  param('id')
    .isMongoId().withMessage('Invalid employee ID format'),
  body('firstName')
    .optional()
    .trim()
    .notEmpty().withMessage('First name cannot be empty'),
  body('lastName')
    .optional()
    .trim()
    .notEmpty().withMessage('Last name cannot be empty'),
  body('email')
    .optional()
    .trim()
    .isEmail().withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('department')
    .optional()
    .trim()
    .notEmpty().withMessage('Department cannot be empty'),
  body('designation')
    .optional()
    .trim()
    .notEmpty().withMessage('Designation cannot be empty'),
  body('employmentType')
    .optional()
    .isIn(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'])
    .withMessage('Employment type must be FULL_TIME, PART_TIME, CONTRACT, or INTERN'),
  body('salary')
    .optional()
    .isFloat({ min: 0 }).withMessage('Salary must be a non-negative number'),
  body('status')
    .optional()
    .isIn(['ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED'])
    .withMessage('Status must be ACTIVE, INACTIVE, ON_LEAVE, or TERMINATED'),
  validate
];

const rejectLeaveValidator = [
  param('id')
    .isMongoId().withMessage('Invalid leave ID format'),
  body('rejectionReason')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Rejection reason must be under 500 characters'),
  validate
];

const mongoIdParamValidator = [
  param('id')
    .isMongoId().withMessage('Invalid ID format'),
  validate
];

module.exports = {
  createEmployeeValidator,
  updateEmployeeValidator,
  rejectLeaveValidator,
  mongoIdParamValidator
};
