const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staffController');
const documentController = require('../controllers/documentController');
const taskController = require('../controllers/taskController');
const chatController = require('../controllers/chatController');
const dailyUpdateController = require('../controllers/dailyUpdateController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const { leaveAttachmentUpload } = require('../middleware/documentUploadMiddleware');
const {
  updateProfileValidator,
  checkInValidator,
  checkOutValidator,
  breakStartValidator,
  breakEndValidator,
  applyLeaveValidator,
  leaveIdParamValidator,
  dailyUpdateValidator,
  dailyUpdateIdParamValidator
} = require('../validators/staffValidator');

// Protect all Staff routes with JWT authentication and STAFF role
router.use(authMiddleware, roleMiddleware('STAFF'));


// Dashboard
router.get('/dashboard', staffController.getDashboard);

// Company-Wide Birthdays for Staff View (Tech & Telecalling)
const { birthdaysValidator } = require('../validators/hrValidator');
router.get('/birthdays', birthdaysValidator, staffController.getBirthdays);

// Profile
router.get('/profile', staffController.getProfile);
router.put('/profile', updateProfileValidator, staffController.updateProfile);

// Documents (Staff can only view/download their own documents)
router.get('/documents', documentController.getMyDocuments);
router.get('/documents/:docId', documentController.getStaffDocumentById);
router.get('/documents/:docId/download', documentController.downloadDocument);

// Attendance
router.post('/attendance/check-in', checkInValidator, staffController.checkIn);
router.post('/attendance/check-out', checkOutValidator, staffController.checkOut);
router.post('/attendance/break-start', breakStartValidator, staffController.startBreak);
router.post('/attendance/break-end', breakEndValidator, staffController.endBreak);
router.post('/attendance/break/start', breakStartValidator, staffController.startBreak);
router.post('/attendance/break/end', breakEndValidator, staffController.endBreak);
router.post('/attendance/breaks/start', breakStartValidator, staffController.startBreak);
router.post('/attendance/breaks/end', breakEndValidator, staffController.endBreak);
router.post('/attendance/:attendanceId/breaks/start', breakStartValidator, staffController.startBreak);
router.post('/attendance/:attendanceId/breaks/end', breakEndValidator, staffController.endBreak);
router.get('/attendance', staffController.getAttendance);

// Leaves
router.post('/leaves', leaveAttachmentUpload, applyLeaveValidator, staffController.applyLeave);
router.get('/leaves', staffController.getLeaves);
router.get('/leaves/:id', leaveIdParamValidator, staffController.getLeaveById);
router.delete('/leaves/:id', leaveIdParamValidator, staffController.cancelLeave);

// Tasks (Staff view and manage own tasks)
router.get('/tasks', taskController.getStaffTasks);
router.get('/tasks/:id', taskController.getTaskById);
router.patch('/tasks/:id/status', taskController.updateStaffTaskStatus);

// Daily Work Updates (Staff submits and views own daily updates)
router.post('/daily-updates', dailyUpdateValidator, dailyUpdateController.submitDailyUpdate);
router.get('/daily-updates', dailyUpdateController.getStaffDailyUpdates);
router.get('/daily-updates/:id', dailyUpdateIdParamValidator, dailyUpdateController.getStaffDailyUpdateById);

// Department Chat & Messaging
// Primary StaffHub conversation endpoints
router.get('/chat/messages', chatController.getStaffMessages);
router.post('/chat/messages', chatController.sendStaffMessage);
router.delete('/chat/messages/:messageId', chatController.deleteMessageForEveryone);
router.patch('/chat/messages/:messageId/delete-for-me', chatController.deleteMessageForMe);

// Department-specific routes (verifies staff authorized department)
router.get('/departments/:deptKey/messages', chatController.getDepartmentMessages);
router.post('/departments/:deptKey/messages', chatController.sendDepartmentMessage);
router.get('/departments/:departmentKey/messages', chatController.getDepartmentMessages);
router.post('/departments/:departmentKey/messages', chatController.sendDepartmentMessage);
router.delete('/departments/:deptKey/messages/:messageId', chatController.deleteMessageForEveryone);
router.patch('/departments/:deptKey/messages/:messageId/delete-for-me', chatController.deleteMessageForMe);
router.delete('/departments/:departmentKey/messages/:messageId', chatController.deleteMessageForEveryone);
router.patch('/departments/:departmentKey/messages/:messageId/delete-for-me', chatController.deleteMessageForMe);

module.exports = router;

