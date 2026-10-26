const assert = require('assert');
const mongoose = require('mongoose');
const DepartmentSchedule = require('../models/DepartmentSchedule');
const { connectDB, disconnectDB } = require('../config/db');

async function testLogic() {
  console.log('Testing DepartmentSchedule model & classification logic...');
  await connectDB();

  // Test 1: getEffectiveSchedule with versioning
  const eff1 = await DepartmentSchedule.getEffectiveSchedule('Tech', new Date('2026-10-23'));
  assert(eff1 !== null, 'Effective schedule should exist');
  assert.strictEqual(eff1.checkInTime, '09:00');
  assert.strictEqual(eff1.gracePeriodMinutes, 0);
  assert.strictEqual(eff1.timezone, 'Asia/Kolkata');

  // Test 2: Pre-effective date query should return null (schedule not active before effective date)
  const effPast = await DepartmentSchedule.getEffectiveSchedule('Tech', new Date('2026-10-22'));
  assert.strictEqual(effPast, null, 'Schedule should not be effective before 2026-10-23');

  // Test 3: Timezone check-in calculation
  function isLate(checkInDate, schedule) {
    const [targetH, targetM] = schedule.checkInTime.split(':').map(Number);
    const targetMinutes = targetH * 60 + targetM + (schedule.gracePeriodMinutes || 0);

    const tz = schedule.timezone || 'Asia/Kolkata';
    const timeStr = checkInDate.toLocaleTimeString('en-GB', { timeZone: tz, hour12: false });
    const [h, m, s] = timeStr.split(':').map(Number);
    const checkInMinutes = h * 60 + m + (s / 60);

    return checkInMinutes > targetMinutes;
  }

  // 08:59:59 IST
  const onTimeDate = new Date('2026-10-23T03:29:59Z');
  assert.strictEqual(isLate(onTimeDate, eff1), false, '08:59:59 IST should be on-time');

  // 09:00:01 IST
  const lateDate = new Date('2026-10-23T03:30:01Z');
  assert.strictEqual(isLate(lateDate, eff1), true, '09:00:01 IST should be late');

  console.log('✓ All schedule and effective-date tests PASSED successfully!');
  await disconnectDB();
}

testLogic().catch(err => {
  console.error(err);
  process.exit(1);
});
