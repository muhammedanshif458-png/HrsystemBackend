const mongoose = require('mongoose');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const DepartmentSchedule = require('../models/DepartmentSchedule');
const Leave = require('../models/Leave');
const HRDocument = require('../models/HRDocument');
const { calculateLateness } = require('../utils/scheduleHelper');
const { AppError } = require('../middleware/errorMiddleware');
const { normalizeLeaveType, enrichLeaveResponse, enrichLeaveResponses } = require('../utils/leaveResponseHelper');
const { getDateKey, getUtcDateForKey, classifyCheckIn, getScheduleForDepartment } = require('../utils/attendanceSchedule');

/**
 * Normalize date to UTC midnight for consistent daily tracking
 */
const getMidnightToday = (date = new Date()) => {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
};

const getEndOfDay = (date = new Date()) => {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
};

class StaffService {
  /**
   * Helper to ensure employee profile exists for user
   */
  async getEmployeeOrThrow(user) {
    let employee = await Employee.findOne({ user: user._id });
    if (!employee && user.email) {
      employee = await Employee.findOne({ email: user.email.toLowerCase().trim() });
      if (employee) {
        employee.user = user._id;
        await employee.save();
      }
    }
    if (!employee) {
      throw new AppError('No employee profile associated with this account. Please contact HR.', 404);
    }
    return employee;
  }

  /**
   * Staff Dashboard stats & information
   */
  async getDashboard(user) {
    const employee = await this.getEmployeeOrThrow(user);
    const schedule = await getScheduleForDepartment(employee.department);
    const today = new Date();
    const todayMidnight = schedule ? getUtcDateForKey(getDateKey(today, schedule.timeZone)) : getMidnightToday(today);
    const todayEnd = new Date(todayMidnight.getTime() + 24 * 60 * 60 * 1000 - 1);

    // Check today's attendance
    const todayAttendance = await Attendance.findOne({
      employee: employee._id,
      date: { $gte: todayMidnight, $lte: todayEnd }
    });

    // Attendance summary for current month
    const startOfMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const attendanceStats = await Attendance.aggregate([
      {
        $match: {
          employee: employee._id,
          date: { $gte: startOfMonth }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalHours: { $sum: '$workingHours' }
        }
      }
    ]);

    const attendanceSummary = {
      presentDays: 0,
      halfDays: 0,
      absentDays: 0,
      totalHours: 0
    };

    attendanceStats.forEach((stat) => {
      if (stat._id === 'PRESENT') attendanceSummary.presentDays = stat.count;
      if (stat._id === 'HALF_DAY') attendanceSummary.halfDays = stat.count;
      if (stat._id === 'ABSENT') attendanceSummary.absentDays = stat.count;
      attendanceSummary.totalHours += stat.totalHours;
    });
    attendanceSummary.totalHours = Math.round(attendanceSummary.totalHours * 100) / 100;

    // Leave counts and latest leave request
    const [pendingLeaves, approvedLeaves, latestLeaveDoc] = await Promise.all([
      Leave.countDocuments({ employee: employee._id, status: 'PENDING' }),
      Leave.countDocuments({ employee: employee._id, status: 'APPROVED' }),
      Leave.findOne({ employee: employee._id })
        .populate('employee', 'employeeId firstName lastName department designation email')
        .populate('approvedBy', 'firstName lastName email')
        .populate('document')
        .sort({ createdAt: -1 })
        .lean()
    ]);

    const latestLeave = latestLeaveDoc ? enrichLeaveResponse(latestLeaveDoc, 'staff', employee) : null;

    return {
      employee: {
        id: employee._id,
        employeeId: employee.employeeId,
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
        department: employee.department,
        designation: employee.designation,
        status: employee.status,
        profileImage: employee.profileImage
      },
      todayAttendance: todayAttendance || null,
      attendanceSummary,
      pendingLeaves,
      approvedLeaves,
      latestLeave
    };
  }

  /**
   * Get own employee profile
   */
  async getProfile(user) {
    const employee = await Employee.findOne({ user: user._id }).populate('user', 'role isActive lastLogin');
    if (!employee) {
      throw new AppError('Employee profile not found', 404);
    }
    return employee;
  }

  /**
   * Update own employee profile (restricted fields)
   */
  async updateProfile(user, updateData) {
    const employee = await this.getEmployeeOrThrow(user);

    // Only allow updating safe fields
    const allowedFields = ['phone', 'address', 'city', 'state', 'country', 'profileImage', 'emergencyContact', 'dateOfBirth'];
    const userUpdates = {};

    allowedFields.forEach((field) => {
      if (updateData[field] !== undefined) {
        employee[field] = updateData[field];

        if (field === 'phone') userUpdates.phone = updateData[field];
        if (field === 'profileImage') userUpdates.profileImage = updateData[field];
      }
    });

    await employee.save();

    if (Object.keys(userUpdates).length > 0) {
      await User.findByIdAndUpdate(user._id, userUpdates);
    }

    return await Employee.findById(employee._id).populate('user', 'role isActive');
  }

  /**
   * Attendance check-in
   */
  async checkIn(user, remarks = '', checkIn = new Date()) {
    const employee = await this.getEmployeeOrThrow(user);

    if (employee.status !== 'ACTIVE') {
      throw new AppError(`Cannot check in. Employee status is currently: ${employee.status}`, 400);
    }

    const schedule = await getScheduleForDepartment(employee.department, checkIn);
    if (!(checkIn instanceof Date) || Number.isNaN(checkIn.getTime())) {
      throw new AppError('Invalid check-in timestamp', 400);
    }
    const tz = schedule ? (schedule.timeZone || schedule.timezone || 'Asia/Kolkata') : null;
    // Without a configured schedule, retain the legacy UTC workday and do not infer lateness.
    const date = schedule ? getUtcDateForKey(getDateKey(checkIn, tz)) : getMidnightToday(checkIn);
    const dayEnd = new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1);

    // Check if attendance already recorded today
    const existingAttendance = await Attendance.findOne({
      employee: employee._id,
      date: { $gte: date, $lte: dayEnd }
    });

    if (existingAttendance) {
      throw new AppError('You have already checked in for today', 400);
    }

    const classification = classifyCheckIn(checkIn, schedule);
    const isLate = Boolean(classification.isLate ?? classification.late);
    const minutesLate = Number(classification.minutesLate) || 0;
    const scheduleStatus = classification.scheduleConfigured ? 'CONFIGURED' : 'UNCONFIGURED';
    const scheduleSnapshot = classification.scheduleSnapshot || null;

    const attendance = new Attendance({
      employee: employee._id,
      date,
      checkIn,
      workMode: employee.workMode || null,
      status: 'PRESENT',
      ...classification,
      late: isLate,
      isLate,
      minutesLate,
      scheduleStatus,
      scheduleSnapshot,
      remarks: remarks || ''
    });

    await attendance.save();
    return attendance;
  }

  /**
   * Attendance check-out
   */
  async checkOut(user, remarks = '') {
    const employee = await this.getEmployeeOrThrow(user);
    const today = new Date();
    const schedule = await getScheduleForDepartment(employee.department, today);
    const tz = schedule ? (schedule.timeZone || schedule.timezone || 'Asia/Kolkata') : null;
    const todayMidnight = schedule ? getUtcDateForKey(getDateKey(today, tz)) : getMidnightToday(today);
    const todayEnd = new Date(todayMidnight.getTime() + 24 * 60 * 60 * 1000 - 1);

    const attendance = await Attendance.findOne({
      employee: employee._id,
      date: { $gte: todayMidnight, $lte: todayEnd }
    });

    if (!attendance || !attendance.checkIn) {
      throw new AppError('Cannot check out before checking in for today', 400);
    }

    if (attendance.checkOut) {
      throw new AppError('You have already checked out for today', 400);
    }

    const checkOutTime = new Date();
    attendance.checkOut = checkOutTime;

    // If a break is still active at check-out, automatically close it
    if (attendance.activeBreak) {
      const activeBreakId = attendance.activeBreak.breakId;
      let targetBreak = activeBreakId ? attendance.breaks.id(activeBreakId) : null;
      if (!targetBreak) {
        targetBreak = attendance.breaks.find(b => !b.endTime);
      }
      if (targetBreak) {
        targetBreak.endTime = checkOutTime;
        const diffMs = Math.max(0, checkOutTime.getTime() - new Date(targetBreak.startTime).getTime());
        targetBreak.durationMinutes = Math.max(1, Math.round(diffMs / 60000));
      }
      attendance.totalBreakMinutes = attendance.breaks.reduce((sum, b) => sum + (b.durationMinutes || 0), 0);
      attendance.activeBreak = null;
      attendance.breakStartedAt = null;
    }

    // Calculate working hours net of break time
    const diffMs = checkOutTime.getTime() - attendance.checkIn.getTime();
    const breakMs = (attendance.totalBreakMinutes || 0) * 60 * 1000;
    const netWorkedMs = Math.max(0, diffMs - breakMs);
    const hours = Math.max(0, netWorkedMs / (1000 * 60 * 60));
    attendance.workingHours = Math.round(hours * 100) / 100;

    // Optional status update based on hours (only if not late)
    if (attendance.workingHours < 4 && !attendance.isLate && attendance.status !== 'LATE') {
      attendance.status = 'HALF_DAY';
    }

    if (remarks) {
      attendance.remarks = attendance.remarks ? `${attendance.remarks} | ${remarks}` : remarks;
    }

    await attendance.save();
    return attendance;
  }

  /**
   * Start a staff break (tea_break_1, lunch, tea_break_2 / Tea Break 1, Lunch Break, Tea Break 2)
   */
  async startBreak(user, body = {}) {
    const employee = await this.getEmployeeOrThrow(user);

    if (employee.status !== 'ACTIVE') {
      throw new AppError(`Cannot start break. Employee status is currently: ${employee.status}`, 400);
    }

    let attendance;
    if (body.attendanceId) {
      if (!mongoose.Types.ObjectId.isValid(body.attendanceId)) {
        throw new AppError('Invalid attendance ID format', 400);
      }
      attendance = await Attendance.findById(body.attendanceId);
      if (!attendance) {
        throw new AppError('Attendance record not found', 404);
      }
      if (attendance.employee.toString() !== employee._id.toString()) {
        throw new AppError('Unauthorized: attendance record belongs to another employee', 403);
      }
    } else {
      const schedule = await getScheduleForDepartment(employee.department);
      const tz = schedule ? (schedule.timeZone || schedule.timezone || 'Asia/Kolkata') : 'Asia/Kolkata';
      const now = new Date();
      const todayMidnight = schedule ? getUtcDateForKey(getDateKey(now, tz)) : getMidnightToday(now);
      const todayEnd = new Date(todayMidnight.getTime() + 24 * 60 * 60 * 1000 - 1);

      attendance = await Attendance.findOne({
        employee: employee._id,
        date: { $gte: todayMidnight, $lte: todayEnd }
      });

      if (!attendance) {
        attendance = await Attendance.findOne({
          employee: employee._id,
          checkIn: { $ne: null },
          checkOut: null
        }).sort({ checkIn: -1 });
      }
    }

    if (!attendance || !attendance.checkIn) {
      throw new AppError('Cannot start break before checking in for today', 400);
    }

    if (attendance.checkOut) {
      throw new AppError('Cannot start break after checking out for today', 400);
    }

    // Check if another break is currently active
    if (attendance.activeBreak && attendance.activeBreak.breakType) {
      throw new AppError(`Cannot start a new break while ${attendance.activeBreak.breakType} is currently active`, 400);
    }

    const rawType = body.canonicalBreakType || body.breakType || body.type || body.breakName || body.name;
    const { normalizeBreakType, areBreaksEquivalent } = require('../validators/staffValidator');
    const breakType = normalizeBreakType(rawType);

    if (!breakType) {
      throw new AppError('Invalid break type. Supported types: tea_break_1, lunch, tea_break_2.', 400);
    }

    // Prevent duplicate starts for the same break type today
    const alreadyTaken = attendance.breaks.some(b => areBreaksEquivalent(b.breakType, breakType));
    if (alreadyTaken) {
      throw new AppError(`${breakType} has already been taken today`, 400);
    }

    const now = new Date();
    const breakItem = {
      breakType,
      startTime: now,
      endTime: null,
      durationMinutes: 0,
      remarks: (body.remarks || '').trim()
    };

    attendance.breaks.push(breakItem);
    const addedBreak = attendance.breaks[attendance.breaks.length - 1];

    attendance.activeBreak = {
      breakType,
      startTime: now,
      breakId: addedBreak._id
    };
    attendance.breakStartedAt = now;

    await attendance.save();

    const attendanceJson = attendance.toJSON ? attendance.toJSON() : attendance.toObject();
    return {
      ...attendanceJson,
      breakId: addedBreak._id.toString(),
      id: addedBreak._id.toString(),
      attendanceId: attendance._id.toString(),
      breakType: addedBreak.breakType,
      type: addedBreak.breakType,
      startTime: addedBreak.startTime.toISOString(),
      endTime: null,
      durationMinutes: 0,
      durationSeconds: 0,
      attendance: attendanceJson
    };
  }

  /**
   * End the active staff break
   */
  async endBreak(user, body = {}) {
    const employee = await this.getEmployeeOrThrow(user);

    let attendance;
    if (body.attendanceId) {
      if (!mongoose.Types.ObjectId.isValid(body.attendanceId)) {
        throw new AppError('Invalid attendance ID format', 400);
      }
      attendance = await Attendance.findById(body.attendanceId);
      if (!attendance) {
        throw new AppError('Attendance record not found', 404);
      }
      if (attendance.employee.toString() !== employee._id.toString()) {
        throw new AppError('Unauthorized: attendance record belongs to another employee', 403);
      }
    } else {
      const schedule = await getScheduleForDepartment(employee.department);
      const tz = schedule ? (schedule.timeZone || schedule.timezone || 'Asia/Kolkata') : 'Asia/Kolkata';
      const now = new Date();
      const todayMidnight = schedule ? getUtcDateForKey(getDateKey(now, tz)) : getMidnightToday(now);
      const todayEnd = new Date(todayMidnight.getTime() + 24 * 60 * 60 * 1000 - 1);

      attendance = await Attendance.findOne({
        employee: employee._id,
        date: { $gte: todayMidnight, $lte: todayEnd }
      });

      if (!attendance) {
        attendance = await Attendance.findOne({
          employee: employee._id,
          checkIn: { $ne: null },
          checkOut: null
        }).sort({ checkIn: -1 });
      }
    }

    if (!attendance || !attendance.checkIn) {
      throw new AppError('Cannot end break before checking in for today', 400);
    }

    if (attendance.checkOut) {
      throw new AppError('Cannot end break after checking out for today', 400);
    }

    if (!attendance.activeBreak || !attendance.activeBreak.breakType) {
      throw new AppError('No active break found to end', 400);
    }

    const rawType = body.canonicalBreakType || body.breakType || body.type || body.breakName || body.name;
    const { normalizeBreakType, areBreaksEquivalent } = require('../validators/staffValidator');
    if (rawType) {
      const requestedBreakType = normalizeBreakType(rawType);
      if (requestedBreakType && !areBreaksEquivalent(requestedBreakType, attendance.activeBreak.breakType)) {
        throw new AppError(`Active break is ${attendance.activeBreak.breakType}, but requested to end ${requestedBreakType}`, 400);
      }
    }

    const activeBreakId = attendance.activeBreak.breakId;
    let targetBreak = activeBreakId ? attendance.breaks.id(activeBreakId) : null;
    if (!targetBreak) {
      targetBreak = attendance.breaks.find(b => areBreaksEquivalent(b.breakType, attendance.activeBreak.breakType) && !b.endTime);
    }

    if (!targetBreak) {
      throw new AppError('Could not find active break record to end', 400);
    }

    const now = new Date();
    targetBreak.endTime = now;
    const diffMs = Math.max(0, now.getTime() - new Date(targetBreak.startTime).getTime());
    targetBreak.durationMinutes = Math.max(1, Math.round(diffMs / 60000));
    const durationSeconds = Math.max(0, Math.round(diffMs / 1000));

    if (body.remarks && body.remarks.trim()) {
      targetBreak.remarks = targetBreak.remarks
        ? `${targetBreak.remarks} | ${body.remarks.trim()}`
        : body.remarks.trim();
    }

    attendance.totalBreakMinutes = attendance.breaks.reduce((sum, b) => sum + (b.durationMinutes || 0), 0);
    attendance.activeBreak = null;
    attendance.breakStartedAt = null;

    await attendance.save();

    const attendanceJson = attendance.toJSON ? attendance.toJSON() : attendance.toObject();
    return {
      ...attendanceJson,
      breakId: targetBreak._id.toString(),
      id: targetBreak._id.toString(),
      attendanceId: attendance._id.toString(),
      breakType: targetBreak.breakType,
      type: targetBreak.breakType,
      startTime: targetBreak.startTime ? new Date(targetBreak.startTime).toISOString() : null,
      endTime: targetBreak.endTime ? new Date(targetBreak.endTime).toISOString() : null,
      durationMinutes: targetBreak.durationMinutes,
      durationSeconds,
      totalBreakMinutes: attendance.totalBreakMinutes,
      attendance: attendanceJson
    };
  }

  async _formatAttendanceRecord(rec, employee) {
    const isLateRec = Boolean(rec.isLate || rec.status === 'LATE');
    let snapshot = rec.scheduleSnapshot || null;
    const hasSnapshot = Boolean(snapshot && (snapshot.scheduledCheckIn || snapshot.checkInTime));

    if (!hasSnapshot && employee?.department) {
      try {
        const effSched = await DepartmentSchedule.getEffectiveSchedule(employee.department, rec.date || rec.checkIn || new Date());
        if (effSched) {
          snapshot = {
            scheduleId: effSched._id,
            department: effSched.department,
            scheduledCheckIn: effSched.checkInTime,
            scheduledCheckOut: effSched.checkOutTime || '18:00',
            gracePeriodMinutes: typeof effSched.gracePeriodMinutes === 'number' ? effSched.gracePeriodMinutes : 0,
            timezone: effSched.timezone || effSched.timeZone || 'Asia/Kolkata'
          };
        }
      } catch (err) {
        // Fallback gracefully if department schedule lookup fails
      }
    }

    const scheduledCheckIn = rec.scheduledCheckIn || snapshot?.scheduledCheckIn || snapshot?.checkInTime || null;
    const scheduledCheckOut = rec.scheduledCheckOut || snapshot?.scheduledCheckOut || snapshot?.checkOutTime || (snapshot ? '18:00' : null);
    const scheduleTimeZone = rec.scheduleTimeZone || snapshot?.timezone || 'Asia/Kolkata';
    const gracePeriodMinutes = typeof rec.gracePeriodMinutes === 'number'
      ? rec.gracePeriodMinutes
      : (typeof snapshot?.gracePeriodMinutes === 'number' ? snapshot.gracePeriodMinutes : 0);
    const scheduleConfigured = Boolean(rec.scheduleConfigured || rec.scheduleStatus === 'CONFIGURED' || snapshot || scheduledCheckIn);

    const totalBreakMins = Number(rec.totalBreakMinutes) || (Array.isArray(rec.breaks) ? rec.breaks.reduce((s, b) => s + (b.durationMinutes || 0), 0) : 0);

    const formatBreakDurationStr = (mins = 0) => {
      const m = Number(mins) || 0;
      if (!m) return '0m';
      const hours = Math.floor(m / 60);
      const rem = m % 60;
      if (hours > 0 && rem > 0) return `${hours}h ${rem}m`;
      if (hours > 0) return `${hours}h`;
      return `${rem}m`;
    };

    const enrichedBreaks = (rec.breaks || []).map(b => {
      const bObj = typeof b.toObject === 'function' ? b.toObject() : { ...b };
      const startMs = b.startTime ? new Date(b.startTime).getTime() : 0;
      const endMs = b.endTime ? new Date(b.endTime).getTime() : 0;
      const nowMs = Date.now();
      const isActive = !b.endTime;
      const isCompleted = Boolean(b.endTime);
      const durationSeconds = isCompleted && startMs
        ? Math.max(0, Math.round((endMs - startMs) / 1000))
        : (startMs ? Math.max(0, Math.round((nowMs - startMs) / 1000)) : 0);
      const durationMins = typeof b.durationMinutes === 'number' && b.durationMinutes > 0
        ? b.durationMinutes
        : (durationSeconds ? Math.max(1, Math.round(durationSeconds / 60)) : 0);
      return {
        ...bObj,
        id: b._id ? b._id.toString() : (b.id ? b.id.toString() : ''),
        breakId: b._id ? b._id.toString() : (b.id ? b.id.toString() : ''),
        attendanceId: rec._id ? rec._id.toString() : '',
        breakType: b.breakType,
        type: b.breakType,
        startTime: b.startTime ? new Date(b.startTime).toISOString() : null,
        endTime: b.endTime ? new Date(b.endTime).toISOString() : null,
        durationMinutes: durationMins,
        durationSeconds,
        isActive,
        isCompleted,
        status: isActive ? 'ACTIVE' : 'COMPLETED',
        remarks: b.remarks || ''
      };
    });

    let workingHoursNum = Number(rec.workingHours) || 0;
    if (!workingHoursNum && rec.checkIn && rec.checkOut) {
      const diffMs = Math.max(0, new Date(rec.checkOut).getTime() - new Date(rec.checkIn).getTime() - totalBreakMins * 60 * 1000);
      workingHoursNum = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
    }

    let workedDuration = '0h';
    if (workingHoursNum > 0) {
      const workedHoursInt = Math.floor(workingHoursNum);
      const workedMinsInt = Math.round((workingHoursNum - workedHoursInt) * 60);
      workedDuration = workedMinsInt > 0 ? `${workedHoursInt}h ${workedMinsInt}m` : `${workedHoursInt}h`;
    } else if (rec.checkIn && !rec.checkOut) {
      const elapsedMs = Math.max(0, Date.now() - new Date(rec.checkIn).getTime() - totalBreakMins * 60 * 1000);
      const elHours = Math.floor(elapsedMs / (1000 * 60 * 60));
      const elMins = Math.floor((elapsedMs % (1000 * 60 * 60)) / (1000 * 60));
      workedDuration = elHours > 0 ? (elMins > 0 ? `${elHours}h ${elMins}m` : `${elHours}h`) : (elMins > 0 ? `${elMins}m` : '0h');
    }

    let sessionStatus = 'PENDING';
    if (rec.checkIn && rec.checkOut) {
      sessionStatus = 'COMPLETED';
    } else if (rec.checkIn) {
      sessionStatus = 'IN_PROGRESS';
    }

    const checkoutStatus = rec.checkOut ? 'Completed' : (rec.checkIn ? 'Pending' : 'Not Checked In');
    const activeBreakItem = enrichedBreaks.find(b => b.isActive) || null;

    return {
      ...rec,
      id: rec._id ? rec._id.toString() : '',
      staffId: employee._id ? employee._id.toString() : '',
      employeeId: employee.employeeId || '',
      date: rec.date ? new Date(rec.date).toISOString() : null,
      checkIn: rec.checkIn ? new Date(rec.checkIn).toISOString() : null,
      checkOut: rec.checkOut ? new Date(rec.checkOut).toISOString() : null,
      checkInTime: rec.checkIn ? new Date(rec.checkIn).toISOString() : null,
      checkOutTime: rec.checkOut ? new Date(rec.checkOut).toISOString() : null,
      checkInAt: rec.checkIn ? new Date(rec.checkIn).toISOString() : null,
      checkOutAt: rec.checkOut ? new Date(rec.checkOut).toISOString() : null,
      sessionStatus,
      checkoutStatus,
      status: rec.status || 'PRESENT',
      workMode: rec.workMode || null,
      workingHours: workingHoursNum,
      workedDuration,
      breakDuration: formatBreakDurationStr(totalBreakMins),
      totalBreakMinutes: totalBreakMins,
      totalBreakSeconds: totalBreakMins * 60,
      numberOfBreaks: enrichedBreaks.length,
      breaks: enrichedBreaks,
      activeBreak: rec.activeBreak || (activeBreakItem ? { breakType: activeBreakItem.breakType, startTime: activeBreakItem.startTime, breakId: activeBreakItem.id } : null),
      breakStartedAt: rec.breakStartedAt ? new Date(rec.breakStartedAt).toISOString() : (activeBreakItem?.startTime || null),
      department: employee.department || snapshot?.department || null,
      isLate: isLateRec,
      late: isLateRec,
      minutesLate: rec.minutesLate || 0,
      scheduleConfigured,
      scheduledCheckIn,
      scheduledCheckOut,
      scheduleTimeZone,
      timezone: scheduleTimeZone,
      gracePeriodMinutes,
      scheduleSnapshot: snapshot
    };
  }

  /**
   * View own attendance history
   */
  async getAttendanceHistory(user, { page = 1, limit = 20, startDate, endDate }) {
    const employee = await this.getEmployeeOrThrow(user);

    page = Math.max(1, parseInt(page, 10));
    limit = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (page - 1) * limit;

    const filter = { employee: employee._id };

    // Apply personal history cutoff (non-destructive "clear history" mechanism)
    if (employee.attendanceHistoryCutoff) {
      filter.$or = [
        { createdAt: { $gte: employee.attendanceHistoryCutoff } },
        { checkIn: { $gte: employee.attendanceHistoryCutoff } },
        { date: { $gt: employee.attendanceHistoryCutoff } }
      ];
    }

    if (startDate || endDate) {
      filter.date = filter.date || {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    const [rawAttendance, total] = await Promise.all([
      Attendance.find(filter)
        .sort({ date: -1, checkIn: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Attendance.countDocuments(filter)
    ]);

    const attendance = await Promise.all(rawAttendance.map(rec => this._formatAttendanceRecord(rec, employee)));

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      attendance,
      pagination: { page, limit, total, totalPages }
    };
  }

  /**
   * Apply for leave
   */
  async applyLeave(user, body, file = null) {
    const {
      leaveType,
      startDate,
      endDate,
      durationType = 'FULL_DAY',
      halfDaySession = null,
      reason,
      documentId,
      documentUrl,
      documentName,
      documentTitle
    } = body;
    const employee = await this.getEmployeeOrThrow(user);

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new AppError('Invalid start date or end date format', 400);
    }

    if (end < start) {
      throw new AppError('End date cannot be earlier than start date', 400);
    }

    const normalizedDurationType = String(durationType || 'FULL_DAY').trim().toUpperCase();
    if (!['FULL_DAY', 'HALF_DAY'].includes(normalizedDurationType)) {
      throw new AppError('Duration type must be FULL_DAY or HALF_DAY', 400);
    }

    let normalizedHalfDaySession = null;
    let totalDays = 1;
    let duration = 1;

    if (normalizedDurationType === 'HALF_DAY') {
      const sStr = String(startDate).slice(0, 10);
      const eStr = String(endDate).slice(0, 10);
      if (sStr !== eStr) {
        throw new AppError('Half-day leave must have the same start and end date', 400);
      }
      if (!halfDaySession || !['FORENOON', 'AFTERNOON'].includes(String(halfDaySession).trim().toUpperCase())) {
        throw new AppError('Half-day session is required and must be FORENOON or AFTERNOON', 400);
      }
      normalizedHalfDaySession = String(halfDaySession).trim().toUpperCase();
      totalDays = 0.5;
      duration = 0.5;
    } else {
      if (halfDaySession !== undefined && halfDaySession !== null && String(halfDaySession).trim() !== '') {
        throw new AppError('Full-day leave must not have a half-day session', 400);
      }

      // Calculate working days according to Tech (Mon-Fri) and Telecalling (Mon-Sat) rules
      const DepartmentSchedule = require('../models/DepartmentSchedule');
      const schedule = DepartmentSchedule.getEffectiveSchedule
        ? await DepartmentSchedule.getEffectiveSchedule(employee.department, start)
        : null;
      const workingDaysOfWeek = DepartmentSchedule.getWorkingDaysForSchedule
        ? DepartmentSchedule.getWorkingDaysForSchedule(schedule, employee.department)
        : [1, 2, 3, 4, 5, 6];
      const holidaysList = (DepartmentSchedule.getHolidaysForSchedule
        ? DepartmentSchedule.getHolidaysForSchedule(schedule)
        : []).map(h => String(h).slice(0, 10));

      let workingDaysCount = 0;
      const curr = new Date(start);
      while (curr <= end) {
        const dayOfWeek = curr.getDay();
        const y = curr.getFullYear();
        const m = String(curr.getMonth() + 1).padStart(2, '0');
        const d = String(curr.getDate()).padStart(2, '0');
        const dKey = `${y}-${m}-${d}`;

        if (workingDaysOfWeek.includes(dayOfWeek) && !holidaysList.includes(dKey)) {
          workingDaysCount++;
        }
        curr.setDate(curr.getDate() + 1);
      }

      const calendarDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
      const calculatedWorkingDays = workingDaysCount > 0 ? workingDaysCount : Math.max(1, calendarDiff);
      totalDays = calculatedWorkingDays;
      duration = calculatedWorkingDays;
    }

    // Check for overlapping pending or approved leave requests
    const activeLeaves = await Leave.find({
      employee: employee._id,
      status: { $in: ['PENDING', 'APPROVED'] },
      startDate: { $lte: end },
      endDate: { $gte: start }
    });

    for (const existing of activeLeaves) {
      const isExistingHalf = existing.durationType === 'HALF_DAY';
      const isNewHalf = normalizedDurationType === 'HALF_DAY';

      if (!isExistingHalf || !isNewHalf) {
        throw new AppError(
          `You already have an active leave request (${existing.status}) overlapping with this date period`,
          409
        );
      }

      // Both are HALF_DAY: conflict only if on the exact same date and same session
      const existingDateStr = new Date(existing.startDate).toISOString().slice(0, 10);
      const newDateStr = start.toISOString().slice(0, 10);
      if (existingDateStr === newDateStr && existing.halfDaySession === normalizedHalfDaySession) {
        throw new AppError(
          `You already have an active ${existing.halfDaySession} half-day leave request (${existing.status}) for this date`,
          409
        );
      }
    }

    const normalizedLeaveType = normalizeLeaveType(leaveType);

    // Enforce medical proof requirement for Medical Leave
    const hasProof = Boolean(file || documentId || documentUrl);
    if (normalizedLeaveType === 'MEDICAL' && !hasProof) {
      throw new AppError('Medical proof document is required for Medical Leave', 400);
    }

    let attachedDocId = null;
    let finalDocUrl = null;
    let finalDocName = null;
    let attachmentObj = null;

    if (file) {
      const HRDocument = require('../models/HRDocument');
      const hrDoc = new HRDocument({
        employee: employee._id,
        employeeIdString: employee.employeeId || '',
        title: documentTitle || `${normalizedLeaveType === 'MEDICAL' ? 'Medical Certificate' : 'Leave Attachment'} - ${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
        category: normalizedLeaveType === 'MEDICAL' ? 'Medical Certificate' : 'Other',
        description: reason || 'Leave attachment document',
        fileName: file.filename,
        originalName: file.originalname,
        filePath: `/uploads/documents/${file.filename}`,
        fileType: file.mimetype,
        fileSize: file.size,
        uploadedBy: `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || 'Staff',
        uploadedByUserId: user._id,
        status: 'ACTIVE'
      });
      await hrDoc.save();

      attachedDocId = hrDoc._id;
      finalDocUrl = `/uploads/documents/${file.filename}`;
      finalDocName = file.originalname;
      attachmentObj = {
        fileName: file.filename,
        originalName: file.originalname,
        filePath: `/uploads/documents/${file.filename}`,
        fileType: file.mimetype,
        fileSize: file.size,
        fileUrl: `/uploads/documents/${file.filename}`
      };
    } else if (documentId) {
      const HRDocument = require('../models/HRDocument');
      const existingDoc = await HRDocument.findOne({ _id: documentId, employee: employee._id });
      if (!existingDoc) {
        throw new AppError('Specified document not found or does not belong to you', 400);
      }
      attachedDocId = existingDoc._id;
      finalDocUrl = existingDoc.filePath;
      finalDocName = existingDoc.originalName || existingDoc.fileName;
      attachmentObj = {
        fileName: existingDoc.fileName,
        originalName: existingDoc.originalName,
        filePath: existingDoc.filePath,
        fileType: existingDoc.fileType,
        fileSize: existingDoc.fileSize,
        fileUrl: existingDoc.filePath
      };
    } else if (documentUrl) {
      const fsModule = require('fs');
      const pathModule = require('path');
      const cleanPath = documentUrl.replace(/^\/?uploads\/documents\//, '');
      const fullPath = pathModule.join(__dirname, '..', 'uploads', 'documents', cleanPath);
      if (fsModule.existsSync(fullPath)) {
        finalDocUrl = `/uploads/documents/${cleanPath}`;
        finalDocName = documentName || pathModule.basename(cleanPath);
        const HRDocument = require('../models/HRDocument');
        let hrDoc = await HRDocument.findOne({ filePath: finalDocUrl, employee: employee._id });
        if (!hrDoc) {
          const ext = pathModule.extname(cleanPath).toLowerCase();
          const mimeType = ext === '.pdf' ? 'application/pdf' : (ext === '.png' ? 'image/png' : (ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream'));
          hrDoc = new HRDocument({
            employee: employee._id,
            employeeIdString: employee.employeeId || '',
            title: documentTitle || `${normalizedLeaveType === 'MEDICAL' ? 'Medical Certificate' : 'Leave Attachment'} - ${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
            category: normalizedLeaveType === 'MEDICAL' ? 'Medical Certificate' : 'Other',
            description: reason || 'Leave attachment document',
            fileName: cleanPath,
            originalName: finalDocName,
            filePath: finalDocUrl,
            fileType: mimeType,
            fileSize: fsModule.statSync(fullPath).size,
            uploadedBy: `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || 'Staff',
            uploadedByUserId: user._id,
            status: 'ACTIVE'
          });
          await hrDoc.save();
        }
        attachedDocId = hrDoc._id;
        attachmentObj = {
          fileName: cleanPath,
          originalName: finalDocName,
          filePath: finalDocUrl,
          fileType: hrDoc.fileType || 'application/pdf',
          fileSize: hrDoc.fileSize || fsModule.statSync(fullPath).size,
          fileUrl: finalDocUrl
        };
      } else {
        throw new AppError('The specified document URL does not correspond to an uploaded server document', 400);
      }
    }

    const leave = new Leave({
      employee: employee._id,
      leaveType: normalizedLeaveType,
      durationType: normalizedDurationType,
      halfDaySession: normalizedHalfDaySession,
      totalDays,
      duration,
      startDate: start,
      endDate: end,
      reason,
      status: 'PENDING',
      document: attachedDocId,
      documentUrl: finalDocUrl,
      documentName: finalDocName || (documentName ? String(documentName).trim() : null),
      attachment: attachmentObj
    });

    await leave.save();
    return enrichLeaveResponse(leave, 'staff', employee);
  }

  /**
   * View own leave requests
   */
  async getLeaves(user, { page = 1, limit = 20, status, leaveType } = {}) {
    const employee = await this.getEmployeeOrThrow(user);

    page = Math.max(1, parseInt(page, 10));
    limit = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const skip = (page - 1) * limit;

    const filter = { employee: employee._id };
    if (status && typeof status === 'string' && status.trim().toLowerCase() !== 'all') {
      filter.status = status.trim().toUpperCase();
    }
    if (leaveType && typeof leaveType === 'string' && leaveType.trim().toLowerCase() !== 'all') {
      filter.leaveType = normalizeLeaveType(leaveType);
    }

    const [leaves, total] = await Promise.all([
      Leave.find(filter)
        .populate('employee', 'employeeId firstName lastName department designation email')
        .populate('approvedBy', 'firstName lastName')
        .populate('document')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Leave.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      leaves: enrichLeaveResponses(leaves, 'staff', employee),
      pagination: { page, limit, total, totalPages }
    };
  }

  /**
   * View single leave request (restricted to own)
   */
  async getLeaveById(user, leaveId) {
    const employee = await this.getEmployeeOrThrow(user);

    if (!mongoose.Types.ObjectId.isValid(leaveId)) {
      throw new AppError('Invalid leave ID', 400);
    }

    const leave = await Leave.findOne({
      _id: leaveId,
      employee: employee._id
    }).populate('employee', 'employeeId firstName lastName department designation email')
      .populate('approvedBy', 'firstName lastName email')
      .populate('document');

    if (!leave) {
      throw new AppError('Leave request not found or access unauthorized', 404);
    }

    return enrichLeaveResponse(leave, 'staff', employee);
  }

  /**
   * Cancel pending leave request
   */
  async cancelLeave(user, leaveId) {
    const employee = await this.getEmployeeOrThrow(user);

    if (!mongoose.Types.ObjectId.isValid(leaveId)) {
      throw new AppError('Invalid leave ID', 400);
    }

    const leave = await Leave.findOne({
      _id: leaveId,
      employee: employee._id
    });

    if (!leave) {
      throw new AppError('Leave request not found or access unauthorized', 404);
    }

    if (leave.status !== 'PENDING') {
      throw new AppError(`Cannot cancel leave request that is already ${leave.status}`, 400);
    }

    leave.status = 'CANCELLED';
    await leave.save();

    return enrichLeaveResponse(leave, 'staff', employee);
  }

  /**
   * GET /api/staff/attendance/:attendanceId
   * Returns full detail for a single attendance record (own only).
   */
  async getAttendanceById(user, attendanceId) {
    const employee = await this.getEmployeeOrThrow(user);

    if (!mongoose.Types.ObjectId.isValid(attendanceId)) {
      throw new AppError('Invalid attendance ID format', 400);
    }

    const rec = await Attendance.findById(attendanceId).lean();

    if (!rec) {
      throw new AppError('Attendance record not found', 404);
    }

    // Ownership check — 404 to avoid leaking existence
    if (rec.employee.toString() !== employee._id.toString()) {
      throw new AppError('Attendance record not found', 404);
    }

    return await this._formatAttendanceRecord(rec, employee);
  }

  /**
   * DELETE /api/staff/attendance/history
   * Sets a personal cutoff so the staff member's StaffHub view no
   * longer shows records before "now".  Attendance documents are
   * never deleted; HR/admin queries remain unaffected.
   */
  async clearAttendanceHistory(user) {
    const employee = await this.getEmployeeOrThrow(user);

    // Set cutoff to right now.  Any record with date < cutoff is hidden
    // from getAttendanceHistory for this employee only.
    const cutoff = new Date();
    await Employee.findByIdAndUpdate(employee._id, {
      attendanceHistoryCutoff: cutoff
    });

    return { clearedAt: cutoff.toISOString() };
  }
}

module.exports = new StaffService();
