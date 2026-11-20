# Leave Management API Endpoints

Verified against the active Express route registration in `server.js`, `routes/staffRoutes.js`, and `routes/hrRoutes.js`. All paths below include the `/api` prefix. These are registered, implemented endpoints; there is no Leave Postman collection in the repository (no Postman collection JSON was found).

## Authentication and authorization

- Every `/api/staff/*` route is protected by `authMiddleware` (JWT) at router level. Leave routes additionally require `roleMiddleware('STAFF')`. Requests therefore need a valid authenticated Staff account; Staff data is scoped to that employee.
- Every `/api/hr/*` route is protected by JWT and `roleMiddleware('HR', 'SUPER_ADMIN')` at router level. `roleMiddleware` explicitly treats `SUPER_ADMIN` as having access where HR is allowed. Thus Leave HR/Admin endpoints are available to HR and SUPER_ADMIN only.
- Staff apply accepts multipart upload through `leaveAttachmentUpload` before validation. The accepted upload fields and aliases are handled by the upload middleware; an uploaded file is optional generally, but medical leave requires proof.
- Success envelope is `{ "success": true, "message": string, "data": object | array, "pagination"?: { "page": number, "limit": number, "total": number, "totalPages": number } }`. Errors use the shared error/validation handlers (error envelope may be `{success:false,message,error}` or validation `{success:false,message,errors}`).

## Staff self-service endpoints

| Method | Complete path | Purpose | Required role | Request body / query | Success response `data` | Status |
|---|---|---|---|---|---|---|
| POST | `/api/staff/leaves` | Submit a leave request. Prevents overlapping pending/approved requests; medical leave requires proof. | STAFF (JWT) | Multipart or JSON fields: `leaveType` (CASUAL, SICK, ANNUAL, EARNED, MEDICAL, UNPAID, OTHER; aliases normalized), `startDate` and `endDate` (ISO dates; `fromDate`/`toDate` accepted aliases), `reason` (2–500 chars). Optional `documentId`, `documentUrl`, `documentName`, or uploaded file (`file`/supported upload aliases). | Created enriched Leave object, typically with `status: "PENDING"`; HTTP 201. | Implemented and active |
| GET | `/api/staff/leaves` | List the authenticated Staff member’s own leave requests. | STAFF (JWT) | Query: `page` (default 1), `limit` (default 20, max 100), `status`, `leaveType`. | Array of enriched Leave objects and `pagination`. | Implemented and active |
| GET | `/api/staff/leaves/:id` | Get one of the authenticated Staff member’s own leave requests. | STAFF (JWT) | Path: Mongo ObjectId `id`. | Enriched Leave object. Other employee’s leave is not exposed. | Implemented and active |
| DELETE | `/api/staff/leaves/:id` | Cancel the authenticated Staff member’s pending leave request. | STAFF (JWT) | Path: Mongo ObjectId `id`; no body. Only `PENDING` can be cancelled. | Updated enriched Leave object with `status: "CANCELLED"`. | Implemented and active |

## HR / Admin endpoints

| Method | Complete path | Purpose | Required role | Request body / query | Success response `data` | Status |
|---|---|---|---|---|---|---|
| GET | `/api/hr/leaves` | List leave requests across employees. Supports filtering and pagination. | HR or SUPER_ADMIN (JWT) | Query: `page` (default 1), `limit` (default 20, max 100), `employeeId` (Mongo ID or employee code), `department`, `status`, `leaveType`, `startDate`, `endDate`. Date range filters for overlapping leave periods. | Array of enriched/safe Leave objects and `pagination`. | Implemented and active |
| GET | `/api/hr/leaves/:id` | Get one leave request. | HR or SUPER_ADMIN (JWT) | Path: Mongo ObjectId `id`. | Enriched Leave object. | Implemented and active |
| PUT | `/api/hr/leaves/:id/approve` | Approve a pending leave request and record approver/time. | HR or SUPER_ADMIN (JWT) | Path: Mongo ObjectId `id`; no body. Only pending requests can be approved. | Updated enriched Leave object (`APPROVED`, `approvedBy`, `approvedAt`). | Implemented and active |
| PUT | `/api/hr/leaves/:id/reject` | Reject a pending leave request and record reason, approver/time. | HR or SUPER_ADMIN (JWT) | Path: Mongo ObjectId `id`. Optional JSON body `{ "rejectionReason": "..." }` (max 500 chars); defaults to a standard HR rejection message if omitted/empty. | Updated enriched Leave object (`REJECTED`, `rejectionReason`, `approvedBy`, `approvedAt`). | Implemented and active |
| DELETE | `/api/hr/leaves` | Delete selected eligible leave requests. Despite method/path, can also clear requests when `all: true` or `clearAll: true` is supplied. | HR or SUPER_ADMIN (JWT) | Selected mode: body/query `ids`, `leaveIds`, or `selectedIds` (array or comma-separated string), alternatively `id`; optional `status` to enforce a matching status. Clear mode: `all: true` or `clearAll: true`, plus required `status` (`APPROVED` or `REJECTED`) and optional filters `employeeId`/`employee`/`staffId`, `department`, `leaveType`, `startDate`, `endDate`. Only APPROVED/REJECTED are deletable. | `{ "deletedCount": number, "status"?: string, "filtersApplied"?: object }`. | Implemented and active |
| POST | `/api/hr/leaves/bulk-delete` | Alias of selected-delete/conditional clear behavior above. | HR or SUPER_ADMIN (JWT) | Same as `DELETE /api/hr/leaves`. | Same result as `DELETE /api/hr/leaves`. | Implemented and active |
| DELETE | `/api/hr/leaves/all` | Clear leave requests for a required status, optionally scoped by employee, department, leave type, and dates. | HR or SUPER_ADMIN (JWT) | Query and/or body: required `status` (`APPROVED` or `REJECTED`); optional `employeeId`/`employee`/`staffId`, `department`, `leaveType`, `startDate`, `endDate`. No unfiltered deletion across statuses. | `{ "deletedCount": number, "status": string, "filtersApplied": object }`. | Implemented and active |
| POST | `/api/hr/leaves/clear-all` | Alias of `/api/hr/leaves/all`. | HR or SUPER_ADMIN (JWT) | Same as `DELETE /api/hr/leaves/all`. | Same result. | Implemented and active |
| DELETE | `/api/hr/leaves/:id` | Delete one eligible leave request. Only APPROVED or REJECTED requests can be deleted. | HR or SUPER_ADMIN (JWT) | Path: Mongo ObjectId `id`; no body. | Delete result object (includes deleted count). | Implemented and active |
| GET | `/api/hr/reports/leaves` | Aggregate Leave counts for HR reporting. | HR or SUPER_ADMIN (JWT) | Query: `startDate`, `endDate`, `department`, `status`, `leaveType`. | Report object with `statusSummary`, `typeSummary`, `totalLeaveApplications`, `approvedRequests`, `pendingRequests`, `rejectedRequests`, `casualLeaves`, `sickMedicalLeaves`, `earnedAnnualLeaves`. | Implemented and active |

## Data model and behavior notes

The `Leave` model stores employee, leave type, start/end date, reason, status, document/attachment metadata, approver, approval time, and rejection reason. Model statuses are `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`; model leave types include `CASUAL`, `SICK`, `ANNUAL`, `MEDICAL`, `EARNED`, `UNPAID`, and `OTHER`.

## Missing functionality / caveats

- No registered endpoint was found for Staff editing/updating an existing application, withdrawing an already approved request, or viewing a leave balance/accrual ledger. Staff can submit, list, inspect, and cancel pending requests.
- No endpoint was found to re-open/undo an HR approval or rejection. HR can approve/reject pending requests and delete only approved/rejected records.
- No Postman collection containing Leave APIs is present in this project tree. The repository has Markdown API docs, but those are descriptive documents rather than an active collection.
- `DELETE /api/hr/leaves` and `POST /api/hr/leaves/bulk-delete` are registered aliases with dual behavior. In clear mode they require an explicit `APPROVED` or `REJECTED` status; pending and cancelled requests are protected.
- The standard success `data` fields above reflect the controller response envelope; detailed Leave object fields can be enriched/filtered by `utils/leaveResponseHelper.js` depending on Staff vs HR view.

## Source files checked

- `server.js` — registers `/api/staff` and `/api/hr` routers.
- `routes/staffRoutes.js`, `routes/hrRoutes.js` — active route/middleware registration.
- `controllers/staffController.js`, `controllers/hrController.js` — request handling and response envelopes.
- `services/staffService.js`, `services/hrService.js` — ownership, filtering, approval, deletion, and reporting behavior.
- `models/Leave.js` — persisted Leave fields and enums.
- `middleware/authMiddleware.js`, `middleware/roleMiddleware.js`, `middleware/documentUploadMiddleware.js` — authentication, role access, and attachment handling.
- `validators/staffValidator.js`, `validators/hrValidator.js` — request validation.
