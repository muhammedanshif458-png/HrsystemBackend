# Staff Daily Work Updates API for HR Dashboard

## 1. Executive Summary & Audit Findings

### 1.1 Existing System Audit
An audit was conducted across the backend repository (`HrsystemBackend` / `LY-hr_management_backend`) and frontend projects (`HR-dashboard/flutter_src` / `LY-HR_dashboard_flutter`):

- **Database & Persistence**: Daily updates were **not** previously persisted in MongoDB. No Mongoose schema, controller, or route existed for daily work updates.
- **Frontend State**: In the Flutter HR Dashboard (`flutter_src/lib/features/dashboard/staff_profile_view.dart`), a Daily Updates Log was rendered using `hrProvider.dailyUpdatesList.where((u) => u.staffId == staff.id)`. The provider (`hr_provider.dart`) only held static in-memory mock data (`DailyUpdate(id: 'upd_1', staffId: 'staff_2', date: '2026-10-08', updateText: '...')`).
- **HR Tasks vs. Daily Work Updates**:
  - Tasks (`models/Task.js` & `controllers/taskController.js`) are administrative work items assigned **by HR** to staff with a due date and status workflow (`pending`, `in-progress`, `done`).
  - Daily Work Updates are reports of work completed **by staff members**, submitted by employees directly from the Staff Portal. HR does **not** create or assign daily work updates.
  - This clear architectural separation was strictly preserved.

---

## 2. API Specifications

### 2.1 Staff Submission Endpoint

- **Method**: `POST`
- **Path**: `/api/staff/daily-updates`
- **Role**: `STAFF` (Guarded by `authMiddleware` and `roleMiddleware('STAFF')`)
- **Description**: Authenticated staff submit their daily work update. The submission is automatically associated with the authenticated employee resolved from the JWT token; client-supplied employee identity parameters (`employee`, `employeeId`, `staffId`) are ignored to prevent identity spoofing.

#### Request Headers
```http
Authorization: Bearer <JWT_ACCESS_TOKEN>
Content-Type: application/json
```

#### Request Body
```json
{
  "updateText": "Completed phase 2 backend API integration and verified MongoDB persistence.",
  "date": "2026-10-22",
  "tasksCompleted": ["Implemented dailyUpdateService", "Added RBAC guards"],
  "blockers": "None",
  "hoursWorked": 8.0
}
```
*Note: If `date` is omitted, it defaults to the current UTC date (`YYYY-MM-DD`). The validator also accepts `workUpdate` or `description` as fallback aliases for `updateText`.*

#### Response Envelope (HTTP 201 Created)
```json
{
  "success": true,
  "message": "Daily work update submitted successfully",
  "data": {
    "id": "6ad9f7db905bc0c4beb7f89f",
    "_id": "6ad9f7db905bc0c4beb7f89f",
    "staffId": "6ad9f7db905bc0c4beb7f886",
    "employeeId": "EMP101",
    "employeeName": "Alice Tech",
    "department": "Tech",
    "date": "2026-10-22",
    "updateText": "Completed phase 2 backend API integration and verified MongoDB persistence.",
    "tasksCompleted": [
      "Implemented dailyUpdateService",
      "Added RBAC guards"
    ],
    "blockers": "None",
    "hoursWorked": 8,
    "employee": {
      "id": "6ad9f7db905bc0c4beb7f886",
      "_id": "6ad9f7db905bc0c4beb7f886",
      "employeeId": "EMP101",
      "name": "Alice Tech",
      "firstName": "Alice",
      "lastName": "Tech",
      "email": "alice.tech@example.com",
      "department": "Tech",
      "designation": "Software Engineer",
      "profileImage": null
    },
    "createdAt": "2026-10-22T11:47:39.539Z",
    "updatedAt": "2026-10-22T11:47:39.539Z"
  }
}
```

---

### 2.2 Staff Retrieval Endpoints (Self-Service Scoped)

#### 2.2.1 Get Own Daily Updates
- **Method**: `GET`
- **Path**: `/api/staff/daily-updates`
- **Role**: `STAFF`
- **Query Parameters**:
  - `date`: Filter by `YYYY-MM-DD`
  - `startDate`, `endDate`: Range filter
  - `page`: Page number (default: 1)
  - `limit`: Items per page (default: 20)
- **Response**: HTTP 200 with list of personal updates and pagination metadata. Strictly scoped to authenticated staff; staff cannot access updates of other employees.

#### 2.2.2 Get Single Own Update by ID
- **Method**: `GET`
- **Path**: `/api/staff/daily-updates/:id`
- **Role**: `STAFF`
- **Response**: HTTP 200 if update belongs to authenticated employee; HTTP 403 Forbidden if the update belongs to another employee.

---

### 2.3 HR / Super Admin Retrieval Endpoints

#### 2.3.1 Get Company-Wide Daily Updates
- **Method**: `GET`
- **Path**: `/api/hr/daily-updates`
- **Roles**: `HR`, `SUPER_ADMIN`
- **Query Parameters**:
  - `employeeId` / `staffId`: Filter by Mongo ObjectId or string ID (e.g., `EMP101`)
  - `department`: Filter by department (case-insensitive, e.g., `Tech`, `Telecalling`)
  - `date`: Filter by date (`YYYY-MM-DD`)
  - `startDate`, `endDate`: Date range filter
  - `search`: Search text within update text or employee name
  - `page`: Page number (default: 1)
  - `limit`: Items per page (default: 20, max: 100)

#### Response Envelope (HTTP 200 OK)
```json
{
  "success": true,
  "message": "Daily work updates retrieved successfully",
  "data": [
    {
      "id": "6ad9f7db905bc0c4beb7f89f",
      "_id": "6ad9f7db905bc0c4beb7f89f",
      "staffId": "6ad9f7db905bc0c4beb7f886",
      "employeeId": "EMP101",
      "employeeName": "Alice Tech",
      "department": "Tech",
      "date": "2026-10-22",
      "updateText": "Completed phase 2 backend API integration and verified MongoDB persistence.",
      "tasksCompleted": ["Implemented dailyUpdateService"],
      "blockers": "None",
      "hoursWorked": 8,
      "createdAt": "2026-10-22T11:47:39.539Z",
      "updatedAt": "2026-10-22T11:47:39.539Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

#### 2.3.2 Get Single Daily Update by ID
- **Method**: `GET`
- **Path**: `/api/hr/daily-updates/:id`
- **Roles**: `HR`, `SUPER_ADMIN`

#### 2.3.3 Get Daily Updates for Specific Employee
- **Method**: `GET`
- **Path**: `/api/hr/employees/:id/daily-updates`
- **Roles**: `HR`, `SUPER_ADMIN`
- **Parameters**: `id` can be either the Employee Mongo ObjectId or human-readable `employeeId` (e.g. `EMP101`).

---

## 3. Flutter Frontend Contract Compatibility

The backend response structure matches the existing Flutter HR Dashboard:
- `DailyUpdate` in `flutter_src/lib/models/hr_models.dart`:
  ```dart
  class DailyUpdate {
    final String id;
    final String staffId;
    final String date;
    final String updateText;
    ...
  }
  ```
- In `staff_profile_view.dart`:
  ```dart
  final staffUpdates = hrProvider.dailyUpdatesList.where((u) => u.staffId == staff.id).toList();
  ```
- The backend returns `staffId` corresponding to the employee's `_id` (`staff.id`), ensuring instant matching when filtered in `staff_profile_view.dart`.
- In `flutter_src/lib/models/hr_models.dart`, `DailyUpdate.fromJson(Map<String, dynamic> json)` and `toJson()` were added.
- In `flutter_src/lib/services/api_service.dart`, `ApiService.getDailyUpdates()` was implemented to fetch updates from `/api/hr/daily-updates`.

---

## 4. Security Architecture

1. **Authentication (JWT)**:
   - Requests without a valid Bearer token return `401 Unauthorized`.
   - Expired or tampered tokens return `401 Unauthorized`.
2. **Role-Based Access Control (RBAC)**:
   - Staff routes are restricted to `STAFF` role (`roleMiddleware('STAFF')`). HR users calling `/api/staff/daily-updates` receive `403 Forbidden`.
   - HR routes are restricted to `HR` and `SUPER_ADMIN` roles (`roleMiddleware('HR', 'SUPER_ADMIN')`). Staff members calling `/api/hr/daily-updates` receive `403 Forbidden`.
3. **No HR Creation**:
   - HR cannot create or modify daily work updates. No `POST /api/hr/daily-updates` exists. Updates originate solely from staff submissions.
4. **Identity Spoofing Prevention**:
   - The employee ID and department are resolved on the server side via `req.user._id` from the verified JWT.
   - Any client-submitted `employee`, `employeeId`, or `department` fields in the request body are completely discarded.
5. **Horizontal Privilege Escalation (Tenant Isolation)**:
   - A staff member attempting to access another staff member's update by ID receives `403 Forbidden`.
6. **Data Leakage Prevention**:
   - Responses never include passwords, password hashes, refresh tokens, or sensitive administrative metadata.

---

## 5. Automated Verification Results

Two test suites were executed to verify functionality:

### 5.1 Standalone E2E Verification (`scripts/verifyDailyUpdatesLive.js`)
All 12 checks passed:
- `[1/12]` Isolated MongoDB database setup.
- `[2/12]` Test HTTP server launched.
- `[3/12]` Super Admin, HR Admin, Staff A (Tech), and Staff B (Telecalling) seeded.
- `[4/12]` Unauthenticated access rejected with `401 Unauthorized`.
- `[5/12]` Role-based authorization guards verified (`403 Forbidden` for cross-role attempts).
- `[6/12]` Input validation verified (`422 Unprocessable Entity` for empty text, bad date, out-of-range hours).
- `[7/12]` Staff submission executed; identity spoofing attempt discarded; employee ID verified from JWT.
- `[8/12]` Database persistence verified directly in MongoDB collection `dailyupdates`.
- `[9/12]` Staff isolation verified: Staff A sees own updates; Staff B sees empty updates; Staff B blocked from Staff A's update with `403 Forbidden`.
- `[10/12]` HR Admin and Super Admin company-wide retrieval verified with full contract schema.
- `[11/12]` Department (`department=Tech`), employee (`employeeId=EMP102`), and employee endpoint (`/api/hr/employees/:id/daily-updates`) filtering and pagination verified.
- `[12/12]` Credential leakage check passed (no passwords, tokens, or hashes exposed).

### 5.2 System Verification Suite (`scripts/verifySystem.js`)
- Tests 43 to 46 added as permanent regression tests in `scripts/verifySystem.js`.
- Run command: `npm test`
- Result: **ALL 46 SYSTEM VERIFICATIONS PASSED**.

---

## 6. Changed Files Summary

| File | Change Description |
|---|---|
| `models/DailyUpdate.js` | Created Mongoose model with validation, timestamps, and indexes |
| `services/dailyUpdateService.js` | Created service for staff submission, staff scoped retrieval, HR retrieval with filtering and pagination, and contract formatting |
| `controllers/dailyUpdateController.js` | Created controller handling HTTP requests and standardized responses |
| `validators/staffValidator.js` | Added `dailyUpdateValidator` and `dailyUpdateIdParamValidator` |
| `validators/hrValidator.js` | Added `hrDailyUpdatesQueryValidator` |
| `routes/staffRoutes.js` | Registered `POST /api/staff/daily-updates`, `GET /api/staff/daily-updates`, and `GET /api/staff/daily-updates/:id` |
| `routes/hrRoutes.js` | Registered `GET /api/hr/daily-updates`, `GET /api/hr/daily-updates/:id`, and `GET /api/hr/employees/:id/daily-updates` |
| `package.json` | Added `"test:daily-updates": "node scripts/verifyDailyUpdatesLive.js"` |
| `scripts/verifyDailyUpdatesLive.js` | Created standalone end-to-end verification script testing all 12 validation and security scenarios |
| `scripts/verifySystem.js` | Added regression tests 43–46 covering daily work updates in the main test suite |
| `docs/staff_daily_updates_api.md` | Created technical API contract, security audit, and verification documentation |
| `flutter_src/lib/models/hr_models.dart` | Added `DailyUpdate.fromJson` and `DailyUpdate.toJson` |
| `flutter_src/lib/services/api_service.dart` | Added `ApiService.getDailyUpdates()` |
| `flutter_src/lib/providers/hr_provider.dart` | Wired `dailyUpdatesList` to fetch from `ApiService.getDailyUpdates()` |
