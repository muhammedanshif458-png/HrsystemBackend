const assert = require('assert');
const { calculateLateness } = require('../utils/scheduleHelper');

console.log('--- Testing Lateness Calculation Boundaries & Timezones ---');

const techSchedule = {
  department: 'TECH',
  checkInTime: '10:00',
  checkOutTime: '18:00',
  gracePeriodMinutes: 0,
  timezone: 'Asia/Kolkata'
};

const telecallingSchedule = {
  department: 'TELECALLING',
  checkInTime: '09:00',
  checkOutTime: '18:00',
  gracePeriodMinutes: 0,
  timezone: 'Asia/Kolkata'
};

const graceSchedule = {
  department: 'TECH',
  checkInTime: '10:00',
  checkOutTime: '18:00',
  gracePeriodMinutes: 15,
  timezone: 'Asia/Kolkata'
};

// 1. Boundary: Before scheduled check-in time (09:59:59 IST)
const beforeTime = new Date('2026-10-23T04:29:59Z');
const resBefore = calculateLateness(beforeTime, techSchedule);
assert.strictEqual(resBefore.isLate, false, 'Before scheduled time must be on time');
assert.strictEqual(resBefore.minutesLate, 0, 'Before scheduled time must have 0 minutesLate');
console.log('✓ Boundary: Before scheduled time passed');

// 2. Boundary: Exactly at scheduled check-in time (10:00:00.000 IST)
const exactTime = new Date('2026-10-23T04:30:00.000Z');
const resExact = calculateLateness(exactTime, techSchedule);
assert.strictEqual(resExact.isLate, false, 'Exactly at scheduled time must be on time');
assert.strictEqual(resExact.minutesLate, 0, 'Exactly at scheduled time must have 0 minutesLate');
console.log('✓ Boundary: Exactly at scheduled time passed');

// 3. Boundary: Within grace period (10:14:59 IST with 15 min grace)
const withinGrace = new Date('2026-10-23T04:44:59Z');
const resWithinGrace = calculateLateness(withinGrace, graceSchedule);
assert.strictEqual(resWithinGrace.isLate, false, 'Within grace period must be on time');
assert.strictEqual(resWithinGrace.minutesLate, 0, 'Within grace period must have 0 minutesLate');
console.log('✓ Boundary: Within grace period passed');

// 4. Boundary: Exactly at grace cutoff (10:15:00.000 IST with 15 min grace)
const exactGrace = new Date('2026-10-23T04:45:00.000Z');
const resExactGrace = calculateLateness(exactGrace, graceSchedule);
assert.strictEqual(resExactGrace.isLate, false, 'Exactly at grace cutoff must be on time');
assert.strictEqual(resExactGrace.minutesLate, 0, 'Exactly at grace cutoff must have 0 minutesLate');
console.log('✓ Boundary: Exactly at grace cutoff passed');

// 5. Boundary: Beyond grace cutoff (10:16:00 IST with 15 min grace)
const beyondGrace = new Date('2026-10-23T04:46:00Z');
const resBeyondGrace = calculateLateness(beyondGrace, graceSchedule);
assert.strictEqual(resBeyondGrace.isLate, true, 'Beyond grace cutoff must be classified late');
assert.strictEqual(resBeyondGrace.minutesLate, 1, '1 minute after grace cutoff must report 1 minute late');
console.log('✓ Boundary: Beyond grace cutoff passed');

// 6. Problem case: Rahul K (Tech 10:00, check-in 2:15 PM / 14:15 IST)
const rahulCheckIn = new Date('2026-10-23T08:45:00Z');
const resRahul = calculateLateness(rahulCheckIn, techSchedule);
assert.strictEqual(resRahul.isLate, true, 'Rahul K must be classified late');
assert.strictEqual(resRahul.minutesLate, 255, 'Rahul K must be exactly 255 minutes late');
console.log('✓ Problem Case: Rahul K (255 mins late) passed');

// 7. Problem case: Rashid K (Tech 10:00, check-in 12:58 PM / 12:58 IST)
const rashidCheckIn = new Date('2026-10-23T07:28:00Z');
const resRashid = calculateLateness(rashidCheckIn, techSchedule);
assert.strictEqual(resRashid.isLate, true, 'Rashid K must be classified late');
assert.strictEqual(resRashid.minutesLate, 178, 'Rashid K must be exactly 178 minutes late');
console.log('✓ Problem Case: Rashid K (178 mins late) passed');

// 8. Problem case: Arjun KP (Telecalling 09:00, check-in 10:45 AM / 10:45 IST)
const arjunCheckIn = new Date('2026-10-23T05:15:00Z');
const resArjun = calculateLateness(arjunCheckIn, telecallingSchedule);
assert.strictEqual(resArjun.isLate, true, 'Arjun KP must be classified late');
assert.strictEqual(resArjun.minutesLate, 105, 'Arjun KP must be exactly 105 minutes late');
console.log('✓ Problem Case: Arjun KP (105 mins late) passed');

// 9. Unconfigured schedule case: null schedule
const resUnconfigured = calculateLateness(new Date(), null);
assert.strictEqual(resUnconfigured.scheduleStatus, 'UNCONFIGURED', 'Missing schedule must return UNCONFIGURED');
assert.strictEqual(resUnconfigured.isLate, false, 'Missing schedule must not falsely classify as late');
assert.strictEqual(resUnconfigured.minutesLate, 0, 'Missing schedule must report 0 minutes late');
console.log('✓ Unconfigured schedule handling passed');

console.log('\n=== ALL BOUNDARY & PROBLEM CASE TESTS PASSED! ===');
