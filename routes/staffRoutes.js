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

// Protect all Staff routes with JWT authentication
router.use(authMiddleware);

// Middleware for routes strictly reserved for STAFF role
const staffOnly = roleMiddleware('STAFF');

// Middleware for department chat routes (accessible to STAFF, HR, and SUPER_ADMIN)
const departmentChatAuth = roleMiddleware('STAFF', 'HR', 'SUPER_ADMIN');

// Dashboard
router.get('/dashboard', staffOnly, staffController.getDashboard);

// Company-Wide Birthdays for Staff View (Tech & Telecalling)
const { birthdaysValidator } = require('../validators/hrValidator');
router.get('/birthdays', staffOnly, birthdaysValidator, staffController.getBirthdays);

// Profile
router.get('/profile', staffOnly, staffController.getProfile);
router.put('/profile', staffOnly, updateProfileValidator, staffController.updateProfile);

// Documents (Staff can only view/download their own documents)
router.get('/documents', staffOnly, documentController.getMyDocuments);
router.get('/documents/:docId', staffOnly, documentController.getStaffDocumentById);
router.get('/documents/:docId/download', staffOnly, documentController.downloadDocument);

// Attendance
router.post('/attendance/check-in', staffOnly, checkInValidator, staffController.checkIn);
router.post('/attendance/check-out', staffOnly, checkOutValidator, staffController.checkOut);
router.post('/attendance/break-start', staffOnly, breakStartValidator, staffController.startBreak);
router.post('/attendance/break-end', staffOnly, breakEndValidator, staffController.endBreak);
router.post('/attendance/break/start', staffOnly, breakStartValidator, staffController.startBreak);
router.post('/attendance/break/end', staffOnly, breakEndValidator, staffController.endBreak);
router.post('/attendance/breaks/start', staffOnly, breakStartValidator, staffController.startBreak);
router.post('/attendance/breaks/end', staffOnly, breakEndValidator, staffController.endBreak);
router.post('/attendance/:attendanceId/breaks/start', staffOnly, breakStartValidator, staffController.startBreak);
router.post('/attendance/:attendanceId/breaks/end', staffOnly, breakEndValidator, staffController.endBreak);
router.get('/attendance', staffOnly, staffController.getAttendance);

// Leaves
router.post('/leaves', staffOnly, leaveAttachmentUpload, applyLeaveValidator, staffController.applyLeave);
router.get('/leaves', staffOnly, staffController.getLeaves);
router.get('/leaves/:id', staffOnly, leaveIdParamValidator, staffController.getLeaveById);
router.delete('/leaves/:id', staffOnly, leaveIdParamValidator, staffController.cancelLeave);

// Tasks (Staff view and manage own tasks)
router.get('/tasks', staffOnly, taskController.getStaffTasks);
router.get('/tasks/:id', staffOnly, taskController.getTaskById);
router.patch('/tasks/:id/status', staffOnly, taskController.updateStaffTaskStatus);

// Daily Work Updates (Staff submits and views own daily updates)
router.post('/daily-updates', staffOnly, dailyUpdateValidator, dailyUpdateController.submitDailyUpdate);
router.get('/daily-updates', staffOnly, dailyUpdateController.getStaffDailyUpdates);
router.get('/daily-updates/:id', staffOnly, dailyUpdateIdParamValidator, dailyUpdateController.getStaffDailyUpdateById);

// Department Chat & Messaging
// Primary StaffHub conversation endpoints
router.get('/chat/messages', staffOnly, chatController.getStaffMessages);
router.post('/chat/messages', staffOnly, chatController.sendStaffMessage);
router.delete('/chat/messages/:messageId', staffOnly, chatController.deleteMessageForEveryone);
router.patch('/chat/messages/:messageId/delete-for-me', staffOnly, chatController.deleteMessageForMe);

// Department-specific routes (accessible to STAFF, HR, and SUPER_ADMIN)
router.get('/departments/:deptKey/messages', departmentChatAuth, chatController.getDepartmentMessages);
router.post('/departments/:deptKey/messages', departmentChatAuth, chatController.sendDepartmentMessage);
router.get('/departments/:departmentKey/messages', departmentChatAuth, chatController.getDepartmentMessages);
router.post('/departments/:departmentKey/messages', departmentChatAuth, chatController.sendDepartmentMessage);
router.delete('/departments/:deptKey/messages/:messageId', departmentChatAuth, chatController.deleteMessageForEveryone);
router.patch('/departments/:deptKey/messages/:messageId/delete-for-me', departmentChatAuth, chatController.deleteMessageForMe);
router.delete('/departments/:departmentKey/messages/:messageId', departmentChatAuth, chatController.deleteMessageForEveryone);
router.patch('/departments/:departmentKey/messages/:messageId/delete-for-me', departmentChatAuth, chatController.deleteMessageForMe);

module.exports = router;
