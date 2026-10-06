const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
const {
  loginValidator,
  refreshTokenValidator,
  forgotPasswordValidator,
  resetPasswordValidator
} = require('../validators/authValidator');

// Public routes
router.post('/login', loginValidator, authController.login);
router.post('/refresh-token', refreshTokenValidator, authController.refreshToken);
router.post('/forgot-password', forgotPasswordValidator, authController.forgotPassword);
router.post('/reset-password', resetPasswordValidator, authController.resetPassword);

// Authenticated route
router.post('/logout', authMiddleware, authController.logout);

module.exports = router;
