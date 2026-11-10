# LY SOFTWARE HR Management Portal - Backend API Coverage Matrix

## Overview
This document provides an audit and coverage matrix comparing the LY SOFTWARE HR Management system requirements and frontend screen capabilities against the backend APIs implemented in the Node.js/Express/MongoDB repository (`c:\Users\Admin\Downloads\HrsystemBackend`).

---

## 1. System Technology Stack
- **Runtime & Framework:** Node.js (v18+) with Express 4.x
- **Database & ODM:** MongoDB with Mongoose 8.x
- **Authentication & Security:** JWT (Access + Refresh tokens), bcryptjs password hashing, Helmet, CORS, Morgan logging
- **Validation:** express-validator
- **File Uploads:** Multer with mime-type validation and isolated local storage (`/uploads/documents`)
- **Testing:** In-memory MongoDB (`mongodb-memory-server`) automated verification test suite

---

## 2. API Coverage Matrix

| Area / Feature | Endpoint | Method | Role | Status | Notes & Response Contracts |
|---|---|---|---|---|---|
| **Health** | `/api/health` | GET | Public | Implemented | Health check probe |
| **Auth** | `/api/auth/login` | POST | Public | Implemented | Validates credentials, issues access & refresh tokens |
| **Auth** | `/api/auth/refresh-token` | POST | Public | Implemented | Validates refresh token & issues new access token |
| **Auth** | `/api/auth/forgot-password` | POST | Public | Implemented | Generates reset token & expiry |
| **Auth** | `/api/auth/reset-password` | POST | Public | Implemented | Resets password using valid reset token |
| **Auth** | `/api/auth/logout` | POST | Authenticated | Implemented | Invalidates stored refresh token |
| **HR Dashboard** | `/api/hr/dashboard` | GET | HR | Implemented | Active/Inactive/Total staff, Today attendance, pending/approved leaves |
| **Birthdays (HR)** | `/api/hr/birthdays` | GET | HR | Implemented | Company-wide today & upcoming birthdays with daysAhead validation & privacy protection |
| **Birthdays (Staff)** | `/api/staff/birthdays` | GET | STAFF | Implemented | Shared company-wide birthday celebrations for staff portal with privacy protection |
| **Departments** | `/api/hr/departments` | GET | HR | Implemented | Headcounts, active status, and division leads for Tech & Telecalling |
| **Departments** | `/api/hr/departments/:deptKey` | GET | HR | Implemented | Single department details and members |
| **Employees** | `/api/hr/employees` | GET | HR | Implemented | Query filters (`search`, `department`, `designation`, `status`, `page`, `limit`) |
| **Employees** | `/api/hr/employees` | POST | HR | Implemented | Atomically creates User + Employee records safely |
| **Employees** | `/api/hr/employees/:id` | GET | HR | Implemented | Employee profile by Mongo ID or string Employee ID (e.g. EMP1001) |
| **Employees** | `/api/hr/employees/:id` | PUT | HR / SUPER_ADMIN | Implemented | Updates employee profile; Super Admin can securely replace staff password |
| **Employees** | `/api/hr/employees/:id` | DELETE | HR | Implemented | Soft deactivates employee and user |
| **Employees** | `/api/hr/employees/:id/status` | PATCH | HR | Implemented | Changes employee status (`ACTIVE`, `INACTIVE`, `ON_LEAVE`, `TERMINATED`) |
| **Salary Management** | `/api/hr/employees/:id/salary` | PUT | HR | Implemented | Updates monthly salary and records audit salary history |
| **HR Documents** | `/api/hr/employees/:id/documents` | POST | HR | Implemented | Uploads document (PDF, PNG, JPG), records version 1 & history |
| **HR Documents** | `/api/hr/employees/:id/documents` | GET | HR | Implemented | Fetches all documents of employee |
| **HR Documents** | `/api/hr/documents/:docId` | GET | HR | Implemented | Retrieves document metadata |
| **HR Documents** | `/api/hr/documents/:docId` | PUT | HR | Implemented | Replaces document file, increments version, logs history |
| **HR Documents** | `/api/hr/documents/:docId/archive` | PATCH | HR | Implemented | Soft archives document |
| **HR Documents** | `/api/hr/documents/:docId/download`| GET | HR | Implemented | Secure stream/download of file |
| **Staff Documents**| `/api/staff/documents` | GET | STAFF | Implemented | Fetches authenticated staff's own documents only |
| **Staff Documents**| `/api/staff/documents/:docId` | GET | STAFF | Implemented | Fetches single document metadata (strictly scoped to staff) |
| **Staff Documents**| `/api/staff/documents/:docId/download`| GET | STAFF | Implemented | Authorized file download for own documents |
| **Attendance** | `/api/hr/attendance` | GET | HR | Implemented | Filter by date range, department, status, employeeId |
| **Attendance** | `/api/hr/attendance/:employeeId` | GET | HR | Implemented | Filter attendance records of specific employee |
| **Attendance** | `/api/staff/attendance` | GET | STAFF | Implemented | History scoped to authenticated staff user |
| **Attendance** | `/api/staff/attendance/check-in` | POST | STAFF | Implemented | Records daily check-in; prevents duplicate check-in same day |
| **Attendance** | `/api/staff/attendance/check-out`| POST | STAFF | Implemented | Computes working hours, validates check-in exists |
| **Leave Management**| `/api/staff/leaves` | POST | STAFF | Implemented | Validates dates, prevents overlapping requests |
| **Leave Management**| `/api/staff/leaves` | GET | STAFF | Implemented | Scoped to authenticated staff user |
| **Leave Management**| `/api/staff/leaves/:id` | GET | STAFF | Implemented | Single leave request scoped to employee |
| **Leave Management**| `/api/staff/leaves/:id` | DELETE | STAFF | Implemented | Cancels leave request if still PENDING |
| **Leave Management**| `/api/hr/leaves` | GET | HR | Implemented | Filter by status, employeeId, leaveType, date range |
| **Leave Management**| `/api/hr/leaves/:id` | GET | HR | Implemented | Fetches single leave request |
| **Leave Management**| `/api/hr/leaves/:id/approve` | PUT | HR | Implemented | Approves leave, sets approvedBy and approvedAt |
| **Leave Management**| `/api/hr/leaves/:id/reject` | PUT | HR | Implemented | Rejects leave, sets rejectionReason |
| **Reports** | `/api/hr/reports/attendance` | GET | HR | Implemented | Attendance summary and department breakdown |
| **Reports** | `/api/hr/reports/leaves` | GET | HR | Implemented | Leave status and type breakdown |
| **Payroll** | `/api/hr/payroll/summary` | GET | HR | Implemented | Aggregated expenditure, deductions, net payout by month & year |
| **Payroll** | `/api/hr/payroll/employees` | GET | HR | Implemented | Itemized payroll list with attendance-based payable days, daily rate, deductions |
| **Payroll** | `/api/hr/payroll/employees/:employeeId` | GET | HR | Implemented | Single employee detailed payroll calculation with complete calendar breakdown |
| **Payroll** | `/api/hr/payroll/conflicts` | GET | HR | Implemented | List attendance and approved leave same-date conflicts for a month |
| **Payroll** | `/api/hr/payroll/conflicts/:conflictId/resolve` | POST | HR | Implemented | Resolve payroll conflict (PRESENT, PAID_LEAVE, UNPAID_LEAVE) with audit trail |
| **Payroll Batches** | `/api/hr/payroll/batches` | POST | HR | Implemented | Safe creation and update of DRAFT payroll batches with calculation snapshots |
| **Payroll Batches** | `/api/hr/payroll/batches` | GET | HR | Implemented | List historical payroll batches with month/year/status filtering and pagination |
| **Payroll Batches** | `/api/hr/payroll/batches/:batchId` | GET | HR | Implemented | Retrieve single payroll batch details with itemized employee records |
| **Payroll Finalization** | `/api/hr/payroll/batches/finalize` | POST | HR | Implemented | Locks payroll batch as FINALIZED, verifies totals, strictly blocks if unresolved conflicts |
| **Payroll Payment** | `/api/hr/payroll/batches/:batchId/pay` | POST | HR | Implemented | Confirms payout and marks finalized batch as PAID with payment metadata |
| **Payslip (HR)** | `/api/hr/payroll/batches/:batchId/employees/:employeeId/payslip` | GET | HR | Implemented | Detailed payslip payload generated from immutable PayrollRecord snapshot |
| **Payslips (Staff)** | `/api/staff/payslips` | GET | STAFF | Implemented | Authenticated staff list of finalized and paid payslips (DRAFT hidden) |
| **Payslip (Staff)** | `/api/staff/payslips/:batchId` | GET | STAFF | Implemented | Authenticated staff single payslip view (strictly scoped to self and finalized batches) |
| **Tasks** | `/api/hr/tasks` | GET | HR | Implemented | Lists tasks with filters (`status`, `department`, `employeeId`) |
| **Tasks** | `/api/hr/tasks` | POST | HR | Implemented | Assigns new task to employee with due date |
| **Tasks** | `/api/hr/tasks/:id` | GET | HR | Implemented | Gets single task details |
| **Tasks** | `/api/hr/tasks/:id` | PUT | HR | Implemented | Updates task details, assignment, or status |
| **Tasks** | `/api/hr/tasks/:id` | DELETE | HR | Implemented | Soft deactivates/deletes task |
| **Staff Tasks** | `/api/staff/tasks` | GET | STAFF | Implemented | Lists tasks assigned to the authenticated staff member |
| **Staff Tasks** | `/api/staff/tasks/:id` | GET | STAFF | Implemented | Gets details of own task |
| **Staff Tasks** | `/api/staff/tasks/:id/status` | PATCH | STAFF | Implemented | Updates status (`pending`, `in-progress`, `done`) |
| **Department Chat**| `/api/hr/departments/:deptKey/messages` | GET | HR | Implemented | Chronological messages for department |
| **Department Chat**| `/api/hr/departments/:deptKey/messages` | POST | HR | Implemented | Sends department chat message as HR |
| **Department Chat**| `/api/hr/departments/:deptKey/messages/:messageId` | DELETE | HR | Implemented | Delete for everyone (soft delete tombstone) |
| **Department Chat**| `/api/hr/departments/:deptKey/messages/:messageId/delete-for-me` | PATCH | HR | Implemented | Hides message for current user |
| **Staff Dept Chat**| `/api/staff/departments/:deptKey/messages` | GET | STAFF | Implemented | Chronological messages for staff member's department |
| **Staff Dept Chat**| `/api/staff/departments/:deptKey/messages` | POST | STAFF | Implemented | Sends message in staff member's department |
| **Staff Dept Chat**| `/api/staff/departments/:deptKey/messages/:messageId` | DELETE | STAFF | Implemented | Delete for everyone if sender |
| **Staff Dept Chat**| `/api/staff/departments/:deptKey/messages/:messageId/delete-for-me` | PATCH | STAFF | Implemented | Hides message for staff user |
