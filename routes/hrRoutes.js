const express = require('express');
const router = express.Router();
const hrController = require('../controllers/hrController');
const documentController = require('../controllers/documentController');
const payrollController = require('../controllers/payrollController');
const taskController = require('../controllers/taskController');
const chatController = require('../controllers/chatController');
const dailyUpdateController = require('../controllers/dailyUpdateController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const { documentUpload } = require('../middleware/documentUploadMiddleware');
const {
  createEmployeeValidator,
  updateEmployeeValidator,
  rejectLeaveValidator,
  mongoIdParamValidator,
  birthdaysValidator,
  hrDailyUpdatesQueryValidator,
  departmentScheduleValidator
} = require('../validators/hrValidator');


// Protect all HR routes with JWT authentication and HR/SUPER_ADMIN roles
router.use(authMiddleware, roleMiddleware('HR', 'SUPER_ADMIN'));

// Dashboard
router.get('/dashboard', hrController.getDashboard);

// Departments & Schedules
router.get('/departments', hrController.getDepartments);
router.get('/departments/schedules', hrController.getDepartmentSchedules);
router.post('/departments/schedules', departmentScheduleValidator, hrController.createDepartmentSchedule);
router.get('/departments/:deptKey', hrController.getDepartmentByKey);
router.get('/departments/:deptKey/schedule', hrController.getDepartmentSchedule);
router.put('/departments/:deptKey/schedule', hrController.setDepartmentSchedule);
router.post('/departments/:deptKey/schedule', departmentScheduleValidator, hrController.createDepartmentSchedule);
router.get('/department-schedules', hrController.getDepartmentSchedules);
router.post('/department-schedules', departmentScheduleValidator, hrController.createDepartmentSchedule);

// Company-Wide Birthdays (Tech & Telecalling)
router.get('/birthdays', birthdaysValidator, hrController.getBirthdays);

// Employees CRUD
router.get('/employees', hrController.getEmployees);
router.get('/employees/:employeeId/login-history', hrController.getEmployeeLoginHistory);
router.post('/employees', createEmployeeValidator, hrController.createEmployee);
router.get('/employees/:id', hrController.getEmployeeById);
router.put('/employees/:id', updateEmployeeValidator, hrController.updateEmployee);
router.delete('/employees/:id', hrController.deleteEmployee);
router.patch('/employees/:id/status', hrController.updateStatus);
router.post('/employees/:id/deactivate', hrController.deactivateEmployee);
router.post('/employees/:id/reactivate', hrController.reactivateEmployee);
router.post('/employees/:id/resign', hrController.resignEmployee);

// Salary management with history tracking
router.put('/employees/:id/salary', mongoIdParamValidator, hrController.updateSalary);

// HR Document Management endpoints
router.post('/employees/:id/documents', documentUpload.single('file'), documentController.uploadDocument);
router.get('/employees/:id/documents', documentController.getEmployeeDocuments);
router.get('/documents/:docId', documentController.getDocumentById);
router.put('/documents/:docId', documentUpload.single('file'), documentController.replaceDocument);
router.patch('/documents/:docId/archive', documentController.archiveDocument);
router.get('/documents/:docId/download', documentController.downloadDocument);

// Attendance
router.get('/attendance', hrController.getAttendance);
router.post('/attendance/reclassify', hrController.reclassifyHistoricalAttendance);
router.get('/attendance/:employeeId', hrController.getAttendanceByEmployeeId);

// Leaves
router.get('/leaves', hrController.getLeaves);
router.delete('/leaves/all', hrController.clearAllLeaves);
router.post('/leaves/clear-all', hrController.clearAllLeaves);
router.delete('/leaves', hrController.bulkDeleteLeaves);
router.post('/leaves/bulk-delete', hrController.bulkDeleteLeaves);
router.get('/leaves/:id', mongoIdParamValidator, hrController.getLeaveById);
router.delete('/leaves/:id', mongoIdParamValidator, hrController.deleteLeaveById);
router.put('/leaves/:id/approve', mongoIdParamValidator, hrController.approveLeave);
router.put('/leaves/:id/reject', rejectLeaveValidator, hrController.rejectLeave);

// Reports
router.get('/reports/attendance', hrController.getAttendanceReports);
router.get('/reports/leaves', hrController.getLeaveReports);

// Payroll Endpoints
router.get('/payroll/summary', payrollController.getSummary);
router.get('/payroll/employees', payrollController.getEmployeesPayroll);
router.get('/payroll/employees/:employeeId', payrollController.getEmployeePayrollById);

// Task Management Endpoints
router.get('/tasks', taskController.getTasks);
router.post('/tasks', taskController.createTask);
router.get('/tasks/:id', taskController.getTaskById);
router.put('/tasks/:id', taskController.updateTask);
router.delete('/tasks/:id', taskController.deleteTask);

// Department Chat & Messaging Endpoints (Supports both :deptKey and :departmentKey)
router.get('/departments/:deptKey/messages', chatController.getDepartmentMessages);
router.post('/departments/:deptKey/messages', chatController.sendDepartmentMessage);
router.get('/departments/:departmentKey/messages', chatController.getDepartmentMessages);
router.post('/departments/:departmentKey/messages', chatController.sendDepartmentMessage);
router.delete('/departments/:deptKey/messages/:messageId', chatController.deleteMessageForEveryone);
router.patch('/departments/:deptKey/messages/:messageId/delete-for-me', chatController.deleteMessageForMe);
router.delete('/departments/:departmentKey/messages/:messageId', chatController.deleteMessageForEveryone);
router.patch('/departments/:departmentKey/messages/:messageId/delete-for-me', chatController.deleteMessageForMe);

// Staff Daily Work Updates (Authorized HR/Super Admin retrieval & bulk permanent deletion)
router.get('/daily-updates', hrDailyUpdatesQueryValidator, dailyUpdateController.getHRDailyUpdates);
router.delete('/daily-updates/all', dailyUpdateController.clearAllDailyUpdates);
router.post('/daily-updates/clear-all', dailyUpdateController.clearAllDailyUpdates);
router.delete('/daily-updates', dailyUpdateController.bulkDeleteDailyUpdates);
router.post('/daily-updates/bulk-delete', dailyUpdateController.bulkDeleteDailyUpdates);
router.get('/daily-updates/:id', mongoIdParamValidator, dailyUpdateController.getHRDailyUpdateById);
router.get('/employees/:id/daily-updates', dailyUpdateController.getEmployeeDailyUpdates);

module.exports = router;
