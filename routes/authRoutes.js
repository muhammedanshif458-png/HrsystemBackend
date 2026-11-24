const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
const passwordChangeAuthMiddleware = require('../middleware/passwordChangeAuthMiddleware');
const {
  loginValidator,
  refreshTokenValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  changePasswordValidator
} = require('../validators/authValidator');

// Public routes
router.post('/login', loginValidator, authController.login);
router.post('/refresh-token', refreshTokenValidator, authController.refreshToken);
router.post('/forgot-password', forgotPasswordValidator, authController.forgotPassword);
router.post('/reset-password', resetPasswordValidator, authController.resetPassword);

// Password change endpoint (accessible with temporary token or normal token)
router.post('/change-password', passwordChangeAuthMiddleware, changePasswordValidator, authController.changePassword);

// Authenticated route (requires full normal access token)
router.post('/logout', authMiddleware, authController.logout);

module.exports = router;
