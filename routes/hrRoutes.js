const express = require('express');
const router = express.Router();
const hrController = require('../controllers/hrController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const {
  createEmployeeValidator,
  updateEmployeeValidator,
  rejectLeaveValidator,
  mongoIdParamValidator
} = require('../validators/hrValidator');

// Protect all HR routes with JWT authentication and HR role
router.use(authMiddleware, roleMiddleware('HR'));

// Dashboard
router.get('/dashboard', hrController.getDashboard);

// Employees CRUD
router.get('/employees', hrController.getEmployees);
router.post('/employees', createEmployeeValidator, hrController.createEmployee);
router.get('/employees/:id', hrController.getEmployeeById);
router.put('/employees/:id', updateEmployeeValidator, hrController.updateEmployee);
router.delete('/employees/:id', hrController.deleteEmployee);

// Attendance
router.get('/attendance', hrController.getAttendance);
router.get('/attendance/:employeeId', hrController.getAttendanceByEmployeeId);

// Leaves
router.get('/leaves', hrController.getLeaves);
router.get('/leaves/:id', mongoIdParamValidator, hrController.getLeaveById);
router.put('/leaves/:id/approve', mongoIdParamValidator, hrController.approveLeave);
router.put('/leaves/:id/reject', rejectLeaveValidator, hrController.rejectLeave);

// Reports
router.get('/reports/attendance', hrController.getAttendanceReports);
router.get('/reports/leaves', hrController.getLeaveReports);

module.exports = router;
