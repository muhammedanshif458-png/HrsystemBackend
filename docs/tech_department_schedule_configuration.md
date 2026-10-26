# Department Schedules & Exact Late Duration Verification Report

## 1. Running Backend & Database Architecture
- **Repository Checkout**: `c:\Users\admin\StudioProjects\LY-hr_management_backend` (Remote origin: `muhammedanshif458-png/HrsystemBackend`)
- **Port**: `5000` (Listening on `0.0.0.0:5000`)
- **Environment**: `development` (`NODE_ENV=development`)
- **Database**: Local MongoDB instance (`mongodb://127.0.0.1:27017/hr_management`)
- **Health Check Status**: `GET http://localhost:5000/api/health` -> HTTP 200 OK (`HR Management API is running`)

---

## 2. Department Schedules Configuration
Configured via authenticated endpoint `POST /api/hr/departments/schedules`:

### A. Tech Department
- **Canonical Department Key**: `TECH`
- **Check-In Cutoff Time**: `10:00` (10:00 AM)
- **Check-Out Cutoff Time**: `18:00` (6:00 PM)
- **Grace Period**: `0` minutes
- **IANA Timezone**: `Asia/Kolkata`
- **Effective Date**: `2026-10-23`

### B. Telecalling Department
- **Canonical Department Key**: `TELECALLING`
- **Check-In Cutoff Time**: `09:00` (9:00 AM)
- **Check-Out Cutoff Time**: `18:00` (6:00 PM)
- **Grace Period**: `0` minutes
- **IANA Timezone**: `Asia/Kolkata`
- **Effective Date**: `2026-10-23`

---

## 3. Authoritative Late Classification & Duration Calculations
Calculated via `utils/scheduleHelper.js`:
- Scheduled cutoff timestamp is computed in the schedule's IANA timezone (`Asia/Kolkata`).
- `diffMs = actualCheckIn - (scheduledCheckIn + gracePeriod)`.
- If `diffMs > 0`: `isLate = true` and `minutesLate = Math.max(1, Math.round(diffMs / (60 * 1000)))`.
- Persists `isLate`, `minutesLate`, `scheduleStatus` (`CONFIGURED` or `UNCONFIGURED`), and an immutable `scheduleSnapshot` on every `Attendance` record.
- If no schedule is active, marked as `UNCONFIGURED` and not falsely classified.

### Verified Boundary Cases
1. **Before Scheduled Time** (09:59:59 IST vs 10:00): `isLate = false`, `minutesLate = 0` (On-time)
2. **Exactly at Scheduled Time** (10:00:00 IST vs 10:00): `isLate = false`, `minutesLate = 0` (On-time)
3. **Within Grace Period** (10:14:59 IST with 15 min grace): `isLate = false`, `minutesLate = 0` (On-time)
4. **Exactly at Grace Cutoff** (10:15:00 IST with 15 min grace): `isLate = false`, `minutesLate = 0` (On-time)
5. **Beyond Grace Cutoff** (10:16:00 IST with 15 min grace): `isLate = true`, `minutesLate = 1`
6. **Problem Cases from Dashboard**:
   - **Rahul K** (Tech 10:00, check-in 2:15 PM): `minutesLate = 255`
   - **Rashid K** (Tech 10:00, check-in 12:58 PM): `minutesLate = 178`
   - **Arjun KP** (Telecalling 09:00, check-in 10:45 AM): `minutesLate = 105`

---

## 4. HR API Updates & Verification
- `GET /api/hr/dashboard`:
  - Returns authoritative `todayLate` and `lateArrivals` counts matching `Attendance.countDocuments({ date: today, $or: [{ status: 'LATE' }, { isLate: true }] })`.
- `GET /api/hr/attendance?status=LATE`:
  - Returns late records with `employee`, `department`, `checkIn`, `status`, `isLate: true`, exact `minutesLate`, and `scheduleSnapshot`.
- `GET /api/hr/attendance?department=Tech&status=LATE`:
  - Filters strictly to Tech late records.
- `GET /api/hr/attendance?department=Telecalling&status=LATE`:
  - Filters strictly to Telecalling late records.

---

## 5. Safe Auditable Historical Reclassification
- Endpoint: `POST /api/hr/attendance/reclassify` (Requires `SUPER_ADMIN`).
- Defaults to `dryRun: true` mode: evaluates records against their date-effective schedules without writing changes.
- Pre-existing records are never automatically or silently modified.
