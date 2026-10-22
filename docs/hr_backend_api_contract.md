# LY SOFTWARE HR Backend - API Contract & Endpoint Documentation

## 1. Overview
All requests and responses use JSON formatting (`Content-Type: application/json`). Multipart form data is used for document file uploads.
Standard response format:
```json
{
  "success": true,
  "message": "Operation completed",
  "data": {},
  "pagination": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 }
}
```

Error format:
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [{ "field": "email", "message": "Please provide a valid email" }]
}
```

---

## 2. Authentication APIs

### `POST /api/auth/login`
- **Auth:** Public
- **Body:** `{ "email": "...", "password": "..." }`
- **Success (200):** Returns user details, role (`SUPER_ADMIN`, `HR`, or `STAFF`), `accessToken`, and `refreshToken`.

### `POST /api/auth/refresh-token`
- **Auth:** Public
- **Body:** `{ "refreshToken": "..." }`
- **Success (200):** Returns new `accessToken`.

### `POST /api/auth/forgot-password`
- **Auth:** Public
- **Body:** `{ "email": "..." }`
- **Success (200):** Dispatches reset token.

### `POST /api/auth/reset-password`
- **Auth:** Public
- **Body:** `{ "token": "...", "newPassword": "..." }`
- **Success (200):** Password updated successfully.

### `POST /api/auth/logout`
- **Auth:** Authenticated (`Bearer <token>`)
- **Success (200):** Session invalidated.

---

## 3. HR Dashboard & Organizational Structure

### `GET /api/hr/dashboard`
- **Auth:** HR
- **Success (200):** Returns `totalEmployees`, `activeEmployees`, `inactiveEmployees`, `todayPresent`, `todayAbsent`, `pendingLeaves`, `approvedLeaves`.

### `GET /api/hr/departments`
- **Auth:** HR
- **Success (200):** Returns department cards with headcounts, active counts, and division leads for `Tech & Engineering` and `Telecalling & Client Relations`.

### `GET /api/hr/departments/:deptKey`
- **Auth:** HR
- **Params:** `deptKey` ('tech', 'telecalling')
- **Success (200):** Returns single department metadata and breakdown.

### `GET /api/hr/birthdays?daysAhead=30`
- **Auth:** Bearer JWT, Role: `HR`
- **Query:** `daysAhead` (optional integer between 0 and 365, defaults to 30).
- **Validation (422):** Rejects negative integers, non-integer strings, or values exceeding 365.
- **Success (200):**
```json
{
  "success": true,
  "message": "Company birthdays fetched successfully",
  "data": {
    "today": [
      {
        "id": "6ad1...",
        "employeeId": "EMP001",
        "name": "Anita Rao",
        "department": "Tech",
        "designation": "Frontend Dev",
        "profileImage": null,
        "birthdayFormatted": "Oct 16",
        "birthdayMonth": 10,
        "birthdayDay": 16,
        "daysUntil": 0,
        "isToday": true
      }
    ],
    "upcoming": [
      {
        "id": "6ad2...",
        "employeeId": "EMP002",
        "name": "Arjun Desai",
        "department": "Telecalling",
        "designation": "Telecaller",
        "profileImage": null,
        "birthdayFormatted": "Oct 21",
        "birthdayMonth": 10,
        "birthdayDay": 21,
        "daysUntil": 5,
        "isToday": false
      }
    ],
    "totalToday": 1,
    "totalUpcoming": 1
  }
}
```
- **Privacy Guarantees:** Strictly excludes `dateOfBirth`, full birth year, calculated age, salary, phone, email, and address.
- **Business Rules:**
  - Includes eligible active statuses (`ACTIVE`, `ON_LEAVE`, `PROBATION`). Excludes `INACTIVE` and `TERMINATED`.
  - Excludes employees with null or missing DOB.
  - Company-wide across all departments (including Tech and Telecalling).
  - Handles February 29: In non-leap years (e.g. 2026), celebrated on February 28; in leap years (e.g. 2028), celebrated on February 29.
  - Correctly calculates `daysUntil` across December-to-January year boundaries.
  - Sorted ascending by `daysUntil`.

### `GET /api/staff/birthdays?daysAhead=30`
- **Auth:** Bearer JWT, Role: `STAFF`
- **Query:** `daysAhead` (optional integer between 0 and 365, defaults to 30).
- **Validation (422):** Rejects negative integers, non-integer strings, or values exceeding 365.
- **Success (200):** Produces identical company-wide birthday data and schema as the HR endpoint, allowing staff to celebrate colleagues across all departments without leaking sensitive private data.

---

## 4. Employee Directory CRUD

### `GET /api/hr/employees`
- **Auth:** HR
- **Query:** `page`, `limit`, `search`, `department`, `designation`, `status`, `employmentType`
- **Success (200):** Returns paginated list of employees.

### `POST /api/hr/employees`
- **Auth:** HR
- **Body:** `firstName`, `lastName` (or `name`), `email`, `phone`, `password`, `department`, `designation`, `employmentType`, `salary`, `salaryCurrency`, `paidLeaveAllowance`, `dateOfBirth`, `gender`, `address`, `city`, `state`, `country`, `status`.
- **Success (201):** Atomically creates User with `STAFF` role and linked `Employee` document.

### `GET /api/hr/employees/:id`
- **Auth:** HR
- **Params:** `:id` (MongoDB ObjectId or Employee ID string like `EMP1001`)
- **Success (200):** Returns full employee profile with user details.

### `PUT /api/hr/employees/:id`
- **Auth:** HR / SUPER_ADMIN
- **Body:**
  - `name` / `fullName` (or `firstName` & `lastName`): Employee's full name.
  - `email`: Employee and login user email address (must be globally unique across users and employees).
  - `phone` / `phoneNumber`: Phone number.
  - `department`: Department name (e.g. 'Tech', 'Telecalling').
  - `designation`: Job designation.
  - `workMode`: Work mode ('Office', 'WFH', etc.).
  - `password`: Optional string (minimum 6 characters).
  - `dateOfBirth`: Optional YYYY-MM-DD date string.
  - `salary`, `salaryCurrency`, `salaryEffectiveDate`: Optional compensation fields.
  - `status`: 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE' | 'TERMINATED'.
- **Credential Security & Authorization:**
  - When `password` is supplied, it updates the linked User account's password with a secure bcrypt hash (10 salt rounds) and invalidates prior session refresh tokens.
  - Credential updates require Super Admin authorization (`SUPER_ADMIN` role). Non-SuperAdmin accounts attempting to update credentials receive `403 Forbidden`.
  - Leaving the password field empty or omitting it preserves the existing password without overwriting or re-hashing it.
  - Passwords and password hashes are never exposed in responses, returned in serialized profiles, or logged.
- **Email Synchronization:**
  - Updating the email verifies uniqueness against both User and Employee collections.
  - On update, both the Employee record and the associated login User identity are synchronized consistently.
  - Duplicate emails are rejected with `409 Conflict` without corrupting records.
- **Success (200):** Returns updated employee record with populated user details.

### `DELETE /api/hr/employees/:id`
- **Auth:** HR
- **Success (200):** Soft-deactivates employee (`status = INACTIVE`) and sets user `isActive = false`.

### `PATCH /api/hr/employees/:id/status`
- **Auth:** HR
- **Body:** `{ "status": "ACTIVE" | "INACTIVE" | "ON_LEAVE" | "TERMINATED" }`
- **Success (200):** Updates employment status and synchronizes user active state.

### `PUT /api/hr/employees/:id/salary`
- **Auth:** HR
- **Body:** `{ "salary": 95000, "salaryCurrency": "INR", "salaryEffectiveDate": "YYYY-MM-DD", "reason": "..." }`
- **Success (200):** Updates current salary and prepends audit entry to `salaryHistory` with acting HR user and timestamp.

---

## 5. Document Management

### `POST /api/hr/employees/:id/documents`
- **Auth:** HR (Multipart form)
- **Fields:** `title`, `category`, `description`, `issueDate`, `expiryDate`, file attachment (`file`)
- **Success (201):** Returns metadata for uploaded document (Version 1).

### `GET /api/hr/employees/:id/documents`
- **Auth:** HR
- **Query:** `includeArchived` (boolean)
- **Success (200):** Lists all documents of specified employee.

### `GET /api/hr/documents/:docId`
- **Auth:** HR
- **Success (200):** Retrieves document metadata.

### `PUT /api/hr/documents/:docId`
- **Auth:** HR (Multipart form)
- **Fields:** `file` (required), `title`, `description`, `issueDate`, `expiryDate`
- **Success (200):** Replaces physical file, increments version number, appends entry to history log.

### `PATCH /api/hr/documents/:docId/archive`
- **Auth:** HR
- **Success (200):** Soft archives document (`status = 'ARCHIVED'`).

### `GET /api/hr/documents/:docId/download`
- **Auth:** HR / STAFF (Authorized)
- **Success (200):** Streams binary document file (`inline` Content-Disposition with original filename).

### `GET /api/staff/documents`
- **Auth:** STAFF
- **Success (200):** Retrieves active documents belonging strictly to the authenticated staff member.

### `GET /api/staff/documents/:docId`
- **Auth:** STAFF
- **Success (200):** Retrieves single document metadata strictly scoped to the authenticated staff member.

---

## 6. Attendance CRUD & Tracking

### `GET /api/hr/attendance`
- **Auth:** HR
- **Query:** `page`, `limit`, `employeeId`, `startDate`, `endDate`, `status`
- **Success (200):** Paginated attendance list.

### `GET /api/hr/attendance/:employeeId`
- **Auth:** HR
- **Success (200):** Attendance records for specific employee.

### `GET /api/staff/attendance`
- **Auth:** STAFF
- **Query:** `page`, `limit`, `startDate`, `endDate`
- **Success (200):** Returns attendance history for authenticated employee.

### `POST /api/staff/attendance/check-in`
- **Auth:** STAFF
- **Body:** `{ "remarks": "..." }`
- **Success (201):** Records check-in; rejects duplicate check-in for the same day with `400 Bad Request`.

### `POST /api/staff/attendance/check-out`
- **Auth:** STAFF
- **Body:** `{ "remarks": "..." }`
- **Success (200):** Records check-out, calculates working hours, adjusts status for half-days. Rejects check-out before check-in.

---

## 7. Leave Management

### `POST /api/staff/leaves`
- **Auth:** STAFF (Resolved strictly from JWT, never client-supplied employee ID)
- **Content-Type:** `application/json` or `multipart/form-data`
- **Body / Fields:**
  - `leaveType` (string, required): `CASUAL`, `SICK`, `ANNUAL`, `MEDICAL`, `UNPAID`, `OTHER` (accepts Flutter/client variations e.g. `Casual Leave`, `Sick Leave`, `Earned Leave`, `Medical Leave`, `Annual Leave` and normalizes automatically)
  - `startDate` or `fromDate` (ISO date string, required): `YYYY-MM-DD`
  - `endDate` or `toDate` (ISO date string, required): `YYYY-MM-DD` (must not be earlier than `startDate`)
  - `reason` (string, required): 2 to 500 characters
  - `file` / `document` / `medicalProof` (file, optional): PDF, JPG, JPEG, PNG up to 15MB. Automatically stored securely in `uploads/documents/`, registered as an `HRDocument` (category `Medical Certificate`), and linked to the leave.
  - `documentId` (ObjectId, optional): Reference to an existing staff HRDocument.
  - `documentUrl` (string, optional): Valid server-accessible document URL.
  - `documentName` (string, optional): Document display name label.
- **Success (201):** Returns created Leave object with `status: 'PENDING'`, normalized `leaveType`, and optional `document` / `attachment` metadata.
- **Error (422):** Structured field-level validation errors.
- **Error (409):** Overlapping active leave period conflict.
- **Error (400):** Invalid date order or disallowed file type/size.

### `GET /api/staff/leaves`
- **Auth:** STAFF
- **Query:** `status`, `page`, `limit`
- **Success (200):** Paginated leave requests for authenticated staff member.

### `GET /api/staff/leaves/:id`
- **Auth:** STAFF
- **Success (200):** Single leave request details (scoped to employee).

### `DELETE /api/staff/leaves/:id`
- **Auth:** STAFF
- **Success (200):** Cancels leave if status is `PENDING`. Rejects cancellation of approved/rejected leaves.

### `GET /api/hr/leaves`
- **Auth:** HR
- **Query:** `status`, `leaveType`, `employeeId`, `startDate`, `endDate`, `page`, `limit`
- **Success (200):** Paginated leave requests with populated employee details.

### `GET /api/hr/leaves/:id`
- **Auth:** HR
- **Success (200):** Single leave request details.

### `PUT /api/hr/leaves/:id/approve`
- **Auth:** HR
- **Success (200):** Marks leave as `APPROVED`, logs `approvedBy` and `approvedAt`.

### `PUT /api/hr/leaves/:id/reject`
- **Auth:** HR
- **Body:** `{ "rejectionReason": "..." }`
- **Success (200):** Marks leave as `REJECTED` and records reason.

---

## 8. Payroll Processing

### `GET /api/hr/payroll/summary`
- **Auth:** HR
- **Query:** `month=MM`, `year=YYYY`, `department=xxx`
- **Success (200):** Returns total payroll expenditure, total deductions, and net payout.

### `GET /api/hr/payroll/employees`
- **Auth:** HR
- **Query:** `month=MM`, `year=YYYY`, `department=xxx`, `search=xxx`, `page`, `limit`
- **Success (200):** Itemized breakdown per employee:
  - Standard working days (Tech: Mon-Fri; Telecalling: Mon-Sat).
  - Effective present days.
  - Approved leave days.
  - Paid leave allowance (1 day/month).
  - Unpaid leave days.
  - Daily rate (`grossSalary / standardWorkingDays`).
  - Salary deductions (`unpaidLeaveDays * dailyRate`).
  - Net payout (`grossSalary - deductions`).

### `GET /api/hr/payroll/employees/:employeeId`
- **Auth:** HR
- **Query:** `month=MM`, `year=YYYY`
- **Success (200):** Individual payroll computation details for the given employee.

---

## 9. Task Management

### `GET /api/hr/tasks`
- **Auth:** HR
- **Query:** `status`, `department`, `employeeId`, `page`, `limit`
- **Success (200):** Paginated task list.

### `POST /api/hr/tasks`
- **Auth:** HR
- **Body:** `{ "staffId": "...", "description": "...", "dueDate": "YYYY-MM-DD", "title": "..." }`
- **Success (201):** Creates task assigned to employee.

### `GET /api/hr/tasks/:id`
- **Auth:** HR
- **Success (200):** Task details.

### `PUT /api/hr/tasks/:id`
- **Auth:** HR
- **Body:** Editable task fields (`description`, `title`, `dueDate`, `status`, `department`, `staffId`).
- **Success (200):** Updated task.

### `DELETE /api/hr/tasks/:id`
- **Auth:** HR
- **Success (200):** Soft-deletes task (`isDeleted = true`).

### `GET /api/staff/tasks`
- **Auth:** STAFF
- **Query:** `status`, `page`, `limit`
- **Success (200):** Paginated list of tasks assigned strictly to the authenticated staff user.

### `GET /api/staff/tasks/:id`
- **Auth:** STAFF
- **Success (200):** Details of assigned task.

### `PATCH /api/staff/tasks/:id/status`
- **Auth:** STAFF
- **Body:** `{ "status": "pending" | "in-progress" | "done" }`
- **Success (200):** Updates task status.

---

## 10. Department Chat & Messaging

### `GET /api/hr/departments/:deptKey/messages` & `GET /api/staff/departments/:deptKey/messages`
- **Auth:** HR or STAFF
- **Params:** `deptKey` ('tech', 'telecalling')
- **Success (200):** Chronologically sorted messages filtered so that messages marked `deletedForEveryone` or hidden via `delete-for-me` by the caller are excluded.

### `POST /api/hr/departments/:deptKey/messages` & `POST /api/staff/departments/:deptKey/messages`
- **Auth:** HR or STAFF
- **Params:** `deptKey`
- **Body:** `{ "text": "...", "senderName": "..." }`
- **Success (201):** Message dispatched and persisted with verified sender identity.

### `PATCH /api/hr/departments/:deptKey/messages/:messageId/delete-for-me` & `PATCH /api/staff/departments/:deptKey/messages/:messageId/delete-for-me`
- **Auth:** HR or STAFF
- **Success (200):** Appends caller's ID to `deletedByIds` array. Message becomes invisible to this caller while remaining visible to peers.

### `DELETE /api/hr/departments/:deptKey/messages/:messageId` & `DELETE /api/staff/departments/:deptKey/messages/:messageId`
- **Auth:** HR, SUPER_ADMIN, or STAFF (Only sender, HR admin, or Super Admin permitted)
- **Success (200):** Soft tombstone applied (`deletedForEveryone = true`). Forbidden `403` returned if a non-admin staff member attempts to delete a peer's message.

---

## 11. Role-Based Access Control (RBAC) & Super Admin

### Roles Definition
1. **`SUPER_ADMIN`**:
   - Master administrative account.
   - Authorized for all administrative endpoints (`/api/hr/*`), including dashboard, departments, birthdays, employees CRUD, salary management, document archiving/downloads, attendance reports, leave approvals/rejections, payroll summary/details, tasks management, and chat moderation (delete-for-everyone).
   - Prohibited from staff self-service endpoints (`/api/staff/*`) to ensure role isolation and prevent corrupting staff attendance/leave records.
2. **`HR`**:
   - Administrative personnel. Full access to `/api/hr/*`.
3. **`STAFF`**:
   - Organization employees. Access restricted to personal self-service `/api/staff/*` and department chats.

### Super Admin Account Seeding
- **Script:** `npm run seed:superadmin` (`node scripts/seedSuperAdmin.js`)
- **Environment Configuration:**
  - `SEED_SUPER_ADMIN_EMAIL`: Account email (e.g. `lysoftware@gmail.com`)
  - `SEED_SUPER_ADMIN_PASSWORD`: Secure temporary password (e.g. `hrAdmin`)
- **Idempotency Guarantee:**
  - If the user does not exist, it creates the account with role `SUPER_ADMIN`, active status, and an associated employee profile (`SA0001`).
  - If the account already exists, the script safely skips modification to avoid silent overwrites.
  - To explicitly reset credentials, run with `--reset-password` or set `RESET_SUPER_ADMIN_PASSWORD=true`.

