const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { connectDB, disconnectDB } = require('../config/db');
const DepartmentSchedule = require('../models/DepartmentSchedule');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const { calculateLateness } = require('../utils/scheduleHelper');
const { isAttendanceForCurrentWorkday } = require('../utils/attendanceSchedule');

async function correctSchedules() {
  console.log('=== SAFE, AUTHORIZED DEPARTMENT SCHEDULE CORRECTION ===\n');
  await connectDB();

  // 1. Audit current schedule records
  console.log('1. Auditing existing DepartmentSchedule records...');
  const currentSchedules = await DepartmentSchedule.find().lean();
  console.log(`Found ${currentSchedules.length} existing department schedule(s):`);
  for (const s of currentSchedules) {
    console.log(` - ID: ${s._id} | Dept: ${s.department} (${s.departmentDisplay}) | Check-In: ${s.checkInTime} | Check-Out: ${s.checkOutTime} | Grace: ${s.gracePeriodMinutes}m | TZ: ${s.timezone}`);
  }

  // 2. Enforce Tech schedule: 10:00 - 18:00 (Asia/Kolkata, grace: 0)
  console.log('\n2. Enforcing Tech Department Schedule (10:00 - 18:00)...');
  const existingTech = await DepartmentSchedule.findOne({
    $or: [
      { department: 'TECH' },
      { department: /^tech$/i },
      { departmentDisplay: /^tech$/i }
    ]
  });

  let techDoc;
  if (existingTech) {
    console.log(`   Found existing Tech schedule record (ID: ${existingTech._id}). Updating in-place (no duplicate)...`);
    techDoc = await DepartmentSchedule.findByIdAndUpdate(
      existingTech._id,
      {
        $set: {
          department: 'TECH',
          departmentDisplay: 'Tech',
          checkInTime: '10:00',
          checkOutTime: '18:00',
          timezone: 'Asia/Kolkata',
          timeZone: 'Asia/Kolkata',
          gracePeriodMinutes: 0,
          description: 'Official Tech schedule: 10:00 AM to 06:00 PM'
        }
      },
      { new: true, runValidators: true }
    );
  } else {
    console.log('   No existing Tech schedule found. Creating single canonical record...');
    techDoc = await DepartmentSchedule.create({
      department: 'TECH',
      departmentDisplay: 'Tech',
      checkInTime: '10:00',
      checkOutTime: '18:00',
      timezone: 'Asia/Kolkata',
      timeZone: 'Asia/Kolkata',
      gracePeriodMinutes: 0,
      description: 'Official Tech schedule: 10:00 AM to 06:00 PM'
    });
  }
  console.log(`   ✓ Tech schedule active: ${techDoc.department} -> ${techDoc.checkInTime} to ${techDoc.checkOutTime} (${techDoc.timezone}, grace: ${techDoc.gracePeriodMinutes}m)`);

  // 3. Enforce Telecalling schedule: 09:00 - 18:00 (Asia/Kolkata, grace: 0)
  console.log('\n3. Enforcing Telecalling Department Schedule (09:00 - 18:00)...');
  const existingTele = await DepartmentSchedule.findOne({
    $or: [
      { department: 'TELECALLING' },
      { department: /^telecalling$/i },
      { departmentDisplay: /^telecalling$/i }
    ]
  });

  let teleDoc;
  if (existingTele) {
    console.log(`   Found existing Telecalling schedule record (ID: ${existingTele._id}). Updating in-place (no duplicate)...`);
    teleDoc = await DepartmentSchedule.findByIdAndUpdate(
      existingTele._id,
      {
        $set: {
          department: 'TELECALLING',
          departmentDisplay: 'Telecalling',
          checkInTime: '09:00',
          checkOutTime: '18:00',
          timezone: 'Asia/Kolkata',
          timeZone: 'Asia/Kolkata',
          gracePeriodMinutes: 0,
          description: 'Official Telecalling schedule: 09:00 AM to 06:00 PM'
        }
      },
      { new: true, runValidators: true }
    );
  } else {
    console.log('   No existing Telecalling schedule found. Creating single canonical record...');
    teleDoc = await DepartmentSchedule.create({
      department: 'TELECALLING',
      departmentDisplay: 'Telecalling',
      checkInTime: '09:00',
      checkOutTime: '18:00',
      timezone: 'Asia/Kolkata',
      timeZone: 'Asia/Kolkata',
      gracePeriodMinutes: 0,
      description: 'Official Telecalling schedule: 09:00 AM to 06:00 PM'
    });
  }
  console.log(`   ✓ Telecalling schedule active: ${teleDoc.department} -> ${teleDoc.checkInTime} to ${teleDoc.checkOutTime} (${teleDoc.timezone}, grace: ${teleDoc.gracePeriodMinutes}m)`);

  // 4. Synchronize Current Workday Attendance Records Only
  console.log('\n4. Synchronizing current workday attendance records...');
  const allTodayAttendance = await Attendance.find()
    .populate('employee', 'employeeId firstName lastName department')
    .sort({ date: -1, createdAt: -1 });

  let updatedCount = 0;
  let preservedHistoricalCount = 0;

  for (const att of allTodayAttendance) {
    if (isAttendanceForCurrentWorkday(att)) {
      const dept = att.employee?.department;
      if (!dept) continue;

      const schedule = await DepartmentSchedule.getEffectiveSchedule(dept, new Date());
      if (schedule && att.checkIn) {
        const lateness = calculateLateness(new Date(att.checkIn), schedule);
        att.scheduledCheckIn = schedule.checkInTime;
        att.scheduledCheckOut = schedule.checkOutTime || '18:00';
        att.scheduleTimeZone = schedule.timeZone || schedule.timezone || 'Asia/Kolkata';
        att.gracePeriodMinutes = Number(schedule.gracePeriodMinutes) || 0;
        att.scheduleConfigured = true;
        att.scheduleStatus = 'CONFIGURED';
        att.late = lateness.isLate;
        att.isLate = lateness.isLate;
        att.minutesLate = lateness.minutesLate;
        att.scheduleSnapshot = {
          scheduleId: schedule._id,
          department: schedule.department,
          scheduledCheckIn: schedule.checkInTime,
          scheduledCheckOut: schedule.checkOutTime || '18:00',
          gracePeriodMinutes: Number(schedule.gracePeriodMinutes) || 0,
          timezone: schedule.timeZone || schedule.timezone || 'Asia/Kolkata'
        };
        await att.save();
        updatedCount++;
        console.log(`   Updated today record for ${att.employee.employeeId} (${dept}): Check-in ${att.checkIn.toISOString()} -> ${schedule.checkInTime}, late=${lateness.isLate}, minutesLate=${lateness.minutesLate}`);
      }
    } else {
      preservedHistoricalCount++;
    }
  }

  console.log(`   ✓ Synchronized ${updatedCount} current workday record(s). Preserved ${preservedHistoricalCount} historical record(s) without modification.`);

  // 5. Final audit of schedule records
  console.log('\n5. Verifying final schedule state:');
  const finalSchedules = await DepartmentSchedule.find().lean();
  for (const s of finalSchedules) {
    console.log(` - ID: ${s._id} | Dept: ${s.department} | Check-In: ${s.checkInTime} | Check-Out: ${s.checkOutTime} | Grace: ${s.gracePeriodMinutes}m | TZ: ${s.timezone}`);
  }

  await disconnectDB();
  console.log('\n=== SCHEDULE CORRECTION COMPLETE ===\n');
}

correctSchedules().catch(err => {
  console.error('Correction failed:', err);
  process.exit(1);
});

