const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staffController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const {
  updateProfileValidator,
  checkInValidator,
  checkOutValidator,
  applyLeaveValidator,
  leaveIdParamValidator
} = require('../validators/staffValidator');

// Protect all Staff routes with JWT authentication and STAFF role
router.use(authMiddleware, roleMiddleware('STAFF'));

// Dashboard
router.get('/dashboard', staffController.getDashboard);

// Profile
router.get('/profile', staffController.getProfile);
router.put('/profile', updateProfileValidator, staffController.updateProfile);

// Attendance
router.post('/attendance/check-in', checkInValidator, staffController.checkIn);
router.post('/attendance/check-out', checkOutValidator, staffController.checkOut);
router.get('/attendance', staffController.getAttendance);

// Leaves
router.post('/leaves', applyLeaveValidator, staffController.applyLeave);
router.get('/leaves', staffController.getLeaves);
router.get('/leaves/:id', leaveIdParamValidator, staffController.getLeaveById);
router.delete('/leaves/:id', leaveIdParamValidator, staffController.cancelLeave);

module.exports = router;
