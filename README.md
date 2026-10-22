# HR Management System - Backend API

Production-ready, scalable RESTful API for the **HR Management System** built with Node.js, Express.js, MongoDB, Mongoose, and JWT authentication with strict Role-Based Access Control (RBAC).

---

## Table of Contents

- [Overview](#overview)
- [Architecture & Tech Stack](#architecture--tech-stack)
- [Project Structure](#project-structure)
- [Requirements](#requirements)
- [Environment Configuration](#environment-configuration)
- [MongoDB Setup](#mongodb-setup)
- [Installation & Getting Started](#installation--getting-started)
- [Seeding HR Account](#seeding-hr-account)
- [Running the Server](#running-the-server)
- [Running Automated Verification Tests](#running-automated-verification-tests)
- [Authentication & Security](#authentication--security)
- [API Endpoints Reference](#api-endpoints-reference)
  - [Health Check](#health-check)
  - [Auth APIs](#auth-apis)
  - [HR APIs](#hr-apis)
  - [Staff APIs](#staff-apis)
- [Example Requests & Responses](#example-requests--responses)
- [Connecting the Frontend (Flutter / Web)](#connecting-the-frontend-flutter--web)

---

## Overview

The HR Management System supports three distinct user roles:

1. **SUPER_ADMIN**: Master administrative authority across the entire platform. Full access to all HR administrative routes, departmental statistics, payroll, document storage, task distribution, and department chat moderation. Restricted from staff self-service to maintain data integrity.
2. **HR**: Manages employees, monitors attendance records, approves/rejects leave requests, views department-level reports, assigns tasks, and handles payroll.
3. **STAFF**: Views own profile, checks in/out daily, tracks working hours, views personal attendance records, and applies for/cancels leave requests.

Staff accounts are strictly isolated; a staff member can never view or manipulate another staff member's records. Super Admin and HR tokens are rejected from staff self-service endpoints to ensure role isolation.

---

## Architecture & Tech Stack

- **Runtime**: Node.js (v18+)
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT (Access Token + Refresh Token)
- **Password Security**: bcryptjs (Salt rounds: 10)
- **Validation**: express-validator
- **Security Headers**: Helmet & CORS
- **Request Logging**: Morgan & Custom Logger

---

## Project Structure

```text
hr management/
│
├── config/
│   ├── db.js                 # MongoDB connection & disconnection handler
│   └── env.js                # Centralized environment variable loader & validator
│
├── controllers/
│   ├── authController.js     # Thin controller for authentication endpoints
│   ├── hrController.js       # Thin controller for HR endpoints
│   └── staffController.js    # Thin controller for Staff endpoints
│
├── models/
│   ├── User.js               # User authentication model (HR / STAFF)
│   ├── Employee.js           # Comprehensive Employee profile model
│   ├── Attendance.js         # Daily check-in/out & hours calculation
│   └── Leave.js              # Leave application, approval & rejection tracking
│
├── routes/
│   ├── authRoutes.js         # /api/auth routes
│   ├── hrRoutes.js           # /api/hr routes (Protected: HR role only)
│   └── staffRoutes.js        # /api/staff routes (Protected: STAFF role only)
│
├── middleware/
│   ├── authMiddleware.js     # JWT Bearer token verification & user attachment
│   ├── roleMiddleware.js     # Role-based access control (RBAC) guard
│   ├── errorMiddleware.js    # Centralized error handler & custom AppError
│   └── notFoundMiddleware.js # 404 route not found handler
│
├── services/
│   ├── authService.js        # Business logic for auth, tokens, password reset
│   ├── hrService.js          # Business logic for HR dashboard, employees, leaves, reports
│   └── staffService.js       # Business logic for staff self-service operations
│
├── validators/
│   ├── authValidator.js      # Input validation for login, refresh, reset
│   ├── hrValidator.js        # Input validation for employee CRUD & leave actions
│   └── staffValidator.js     # Input validation for profile, check-in, leaves
│
├── utils/
│   ├── jwt.js                # JWT signing, verification, and reset token helpers
│   ├── response.js           # Consistent API response format helpers
│   └── logger.js             # Structured console logging
│
├── uploads/
│   └── .gitkeep              # Static uploads directory
│
├── scripts/
│   ├── seedAdmin.js          # Initial HR admin seeder
│   └── verifySystem.js       # 20-step automated end-to-end test suite
│
├── .env                      # Local environment configuration
├── .env.example              # Template environment configuration
├── .gitignore                # Git ignore rules
├── package.json              # Node.js dependencies & scripts
├── README.md                 # Complete documentation
└── server.js                 # Express application entrypoint
```

---

## Requirements

- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- **MongoDB**: Local MongoDB instance (v5.0+) or MongoDB Atlas cluster connection string

---

## Environment Configuration

Create a `.env` file in the root directory (copied from `.env.example`):

```env
PORT=5000
NODE_ENV=development

# MongoDB Connection String
MONGODB_URI=mongodb://127.0.0.1:27017/hr_management

# JWT Secrets (Use strong secrets in production)
JWT_SECRET=production_ready_super_secret_jwt_key_2026_hr_management_system
JWT_EXPIRES_IN=1d

JWT_REFRESH_SECRET=production_ready_super_refresh_secret_key_2026_hr_management
JWT_REFRESH_EXPIRES_IN=7d

# Allowed Client Origin
CLIENT_URL=http://localhost:3000

# Initial HR Seed Credentials
SEED_ADMIN_EMAIL=admin@hrmanagement.com
SEED_ADMIN_PASSWORD=Admin@12345
```

---

## MongoDB Setup

1. **Local MongoDB**:
   Ensure MongoDB service is running locally on port `27017`.
   ```bash
   # Test connection in terminal
   mongosh "mongodb://127.0.0.1:27017/hr_management"
   ```

2. **MongoDB Atlas (Cloud)**:
   Update `MONGODB_URI` in `.env`:
   ```env
   MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/hr_management?retryWrites=true&w=majority
   ```

---

## Installation & Getting Started

1. Clone or navigate to the project directory:
   ```bash
   cd "hr management"
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

---

## Seeding HR Account

Seed the initial HR administrator account without hardcoding credentials:

```bash
npm run seed
```

This reads `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` from `.env`, hashes the password with bcrypt, and creates both the User and HR Employee profile. Duplicate runs safely exit without duplicating records.

---

## Seeding Dedicated Super Admin Account

Seed the dedicated Super Admin (`lysoftware@gmail.com`, role `SUPER_ADMIN`) safely and idempotently:

```bash
npm run seed:superadmin
```

### Environment Configuration:
```env
SEED_SUPER_ADMIN_EMAIL=lysoftware@gmail.com
SEED_SUPER_ADMIN_PASSWORD=hrAdmin
```

### Safety & Idempotency Rules:
- If the account does not exist, it creates the User with role `SUPER_ADMIN` and linked `Employee` profile `SA0001`.
- If the account already exists, it will **not** overwrite the password or role silently. It logs a warning and exits cleanly with code 0.
- To perform an intentional credential reset, run with the `--reset-password` flag:
  ```bash
  node scripts/seedSuperAdmin.js --reset-password
  # or
  RESET_SUPER_ADMIN_PASSWORD=true npm run seed:superadmin
  ```
- Plaintext passwords and tokens are never printed to console logs or committed to git.

---

## Running the Server

- **Development Mode** (with automatic reload via nodemon):
  ```bash
  npm run dev
  ```

- **Production Mode**:
  ```bash
  npm start
  ```

The server will be accessible at:
```text
http://localhost:5000
```

Health check endpoint:
```text
GET http://localhost:5000/api/health
```

---

## Running Automated Verification Tests

The repository includes a 20-step end-to-end verification test suite:

```bash
npm test
```

This verifies:
- MongoDB connection
- Server health check
- HR account seed & authentication
- JWT creation and validation
- Unauthorized 401 handling
- Role-based 403 authorization isolation (HR cannot access Staff routes, Staff cannot access HR routes)
- Employee creation by HR
- Staff login & profile update
- Daily attendance check-in & duplicate check-in prevention
- Attendance check-out and automated working hours calculation
- Leave application & overlap prevention
- HR leave approval and rejection
- Aggregated HR dashboard & attendance reports
- Express-validator input failure handling (422)

---

## Authentication & Security

- **JWT Tokens**: Bearer token transmitted via the `Authorization` header:
  ```http
  Authorization: Bearer <accessToken>
  ```
- **Passwords**: Hashed with bcryptjs (salt rounds: 10). Passwords and reset tokens are excluded (`select: false`) by default and never returned in API responses.
- **Role Isolation**: Middleware guards routes by validating `req.user.role`.
- **Database Safety**: MongoDB compound index `{ employee: 1, date: 1 }` prevents duplicate daily check-ins.

---

## API Endpoints Reference

Base URL: `http://localhost:5000/api`

### Health Check

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Verify server is running |

### Auth APIs (`/api/auth`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | Public | Authenticate user & return access/refresh tokens |
| `POST` | `/api/auth/logout` | Authenticated | Invalidate refresh token |
| `POST` | `/api/auth/refresh-token` | Public | Obtain new access token using refresh token |
| `POST` | `/api/auth/forgot-password`| Public | Generate password reset token |
| `POST` | `/api/auth/reset-password` | Public | Reset password using valid reset token |

### HR APIs (`/api/hr`) — Requires `HR` Role

| Method | Endpoint | Query / Body Params | Description |
|---|---|---|---|
| `GET` | `/api/hr/dashboard` | - | Dashboard stats (total, active, present, leaves) |
| `GET` | `/api/hr/employees` | `page`, `limit`, `search`, `department`, `designation`, `status`, `employmentType` | Paginated employee list |
| `POST` | `/api/hr/employees` | Employee details & credentials | Create new employee & staff account |
| `GET` | `/api/hr/employees/:id` | - | Get employee by MongoDB ID or employeeId |
| `PUT` | `/api/hr/employees/:id` | Update fields | Update employee details |
| `DELETE` | `/api/hr/employees/:id` | - | Deactivate employee & user account |
| `GET` | `/api/hr/attendance` | `page`, `limit`, `employeeId`, `startDate`, `endDate`, `status` | All staff attendance records |
| `GET` | `/api/hr/attendance/:employeeId` | `page`, `limit`, `startDate`, `endDate` | Attendance records for specific employee |
| `GET` | `/api/hr/leaves` | `page`, `limit`, `employeeId`, `status`, `leaveType`, `startDate`, `endDate` | Leave requests |
| `GET` | `/api/hr/leaves/:id` | - | Single leave request detail |
| `PUT` | `/api/hr/leaves/:id/approve` | - | Approve leave request |
| `PUT` | `/api/hr/leaves/:id/reject` | `{ "rejectionReason": "..." }` | Reject leave request |
| `GET` | `/api/hr/reports/attendance`| `startDate`, `endDate`, `department` | Attendance aggregate reports |
| `GET` | `/api/hr/reports/leaves` | `startDate`, `endDate` | Leave breakdown reports |

### Staff APIs (`/api/staff`) — Requires `STAFF` Role

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/staff/dashboard` | Staff dashboard with today's status & summary |
| `GET` | `/api/staff/profile` | View own profile |
| `PUT` | `/api/staff/profile` | Update allowed profile fields (phone, address, emergency contact) |
| `POST` | `/api/staff/attendance/check-in` | Check in for today |
| `POST` | `/api/staff/attendance/check-out` | Check out for today & calculate working hours |
| `GET` | `/api/staff/attendance` | Paginated personal attendance history (`startDate`, `endDate`) |
| `POST` | `/api/staff/leaves` | Apply for leave (`leaveType`, `startDate`, `endDate`, `reason`) |
| `GET` | `/api/staff/leaves` | View personal leave requests (`status`, `page`, `limit`) |
| `GET` | `/api/staff/leaves/:id` | View single personal leave request |
| `DELETE` | `/api/staff/leaves/:id` | Cancel personal pending leave request |

---

## Example Requests & Responses

### 1. Login Request

`POST /api/auth/login`

**Request Body:**
```json
{
  "email": "admin@hrmanagement.com",
  "password": "Admin@12345"
}
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "_id": "673f1a2b...",
      "firstName": "System",
      "lastName": "Administrator",
      "email": "admin@hrmanagement.com",
      "phone": "+1234567890",
      "role": "HR",
      "isActive": true,
      "lastLogin": "2026-10-01T07:40:00.000Z",
      "createdAt": "2026-10-01T07:30:00.000Z",
      "updatedAt": "2026-10-01T07:40:00.000Z"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### 2. Authenticated Request Example

`GET /api/hr/dashboard`

**Headers:**
```http
Authorization: Bearer <accessToken>
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "HR dashboard statistics fetched successfully",
  "data": {
    "totalEmployees": 15,
    "activeEmployees": 14,
    "inactiveEmployees": 1,
    "todayPresent": 12,
    "todayAbsent": 2,
    "pendingLeaves": 3,
    "approvedLeaves": 8
  }
}
```

### 3. Paginated Response Example

`GET /api/hr/employees?page=1&limit=20&search=john`

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Employees fetched successfully",
  "data": [
    {
      "_id": "673f2b3c...",
      "employeeId": "EMP1002",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@company.com",
      "department": "Engineering",
      "designation": "Software Engineer",
      "employmentType": "FULL_TIME",
      "status": "ACTIVE"
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

### 4. Validation Error Response Example (422)

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "email",
      "message": "Please provide a valid email address",
      "value": "invalid-email"
    }
  ]
}
```

---

## Connecting the Frontend (Flutter / Web)

1. **Base URL**:
   - For Web / Android Emulator:
     - Web: `http://localhost:5000/api`
     - Android Emulator: `http://10.0.2.2:5000/api`
     - Physical Device: `http://<YOUR_LAN_IP>:5000/api`
2. **CORS**:
   Ensure `CLIENT_URL` in `.env` is configured to your web app's URL or set to `*` during development.
3. **Token Storage**:
   Store the `accessToken` in secure storage (e.g. `flutter_secure_storage` in Flutter) and send it as `Authorization: Bearer <accessToken>` with every request.
4. **Token Refresh**:
   When receiving a `401 Unauthorized` with message `"Authorization token expired"`, send a request to `POST /api/auth/refresh-token` with `{ "refreshToken": "<savedRefreshToken>" }` to renew the access token automatically.
