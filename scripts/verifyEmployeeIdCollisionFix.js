const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const hrService = require('../services/hrService');
const Employee = require('../models/Employee');
const User = require('../models/User');

async function runTest() {
  console.log('--- Starting POST /api/hr/employees Verification ---');
  await connectDB();

  const testEmailPrefix = `test_audit_${Date.now()}`;

  // 1. Create a dummy employee with a specific employeeId (e.g., EMP9900)
  const empAId = `EMP99${Math.floor(10 + Math.random() * 89)}`;
  const empAEmail = `${testEmailPrefix}_a@test.com`;
  console.log(`Step 1: Creating Employee A with fixed ID ${empAId}...`);
  const empA = await hrService.createEmployee({
    name: 'Test Audit A',
    email: empAEmail,
    employeeId: empAId,
    department: 'Tech',
    designation: 'QA Tester',
    salary: 50000
  });
  console.log(`Employee A created with ID: ${empA.employeeId}`);

  // 2. Test auto-generation collision resistance:
  // Artificially create an employee that occupies the next count-based ID
  const count = await Employee.countDocuments();
  const collidingId = `EMP${String(count + 1001).padStart(4, '0')}`;
  console.log(`Step 2: Occupying candidate ID ${collidingId} to test collision avoidance...`);
  const empColliding = await hrService.createEmployee({
    name: 'Test Collision Seed',
    email: `${testEmailPrefix}_colliding@test.com`,
    employeeId: collidingId,
    department: 'Tech',
    designation: 'Tester'
  });
  console.log(`Colliding seed created with ID: ${empColliding.employeeId}`);

  // Now create an employee WITHOUT employeeId
  console.log('Step 3: Creating Employee B without employeeId (should skip collidingId cleanly)...');
  const empB = await hrService.createEmployee({
    name: 'Test Audit B',
    email: `${testEmailPrefix}_b@test.com`,
    department: 'Telecalling',
    designation: 'Agent'
  });
  console.log(`Employee B successfully created with auto-generated ID: ${empB.employeeId}`);
  if (empB.employeeId === collidingId) {
    throw new Error(`Collision not avoided! ID assigned was ${collidingId}`);
  }

  // 3. Test Duplicate Email Conflict (409)
  console.log('Step 4: Testing duplicate email conflict (409)...');
  try {
    await hrService.createEmployee({
      name: 'Duplicate Email Person',
      email: empAEmail,
      department: 'Tech',
      designation: 'Developer'
    });
    throw new Error('Expected 409 duplicate email conflict but succeeded!');
  } catch (err) {
    console.log(`Caught expected duplicate email error: status=${err.statusCode}, message="${err.message}"`);
    if (err.statusCode !== 409 || !err.message.includes('field: email')) {
      throw new Error(`Unexpected error format: ${err.message}`);
    }
  }

  // 4. Test Duplicate Employee ID Conflict (409)
  console.log('Step 5: Testing duplicate employeeId conflict (409)...');
  try {
    await hrService.createEmployee({
      name: 'Duplicate EmpId Person',
      email: `${testEmailPrefix}_c@test.com`,
      employeeId: empA.employeeId,
      department: 'Tech',
      designation: 'Developer'
    });
    throw new Error('Expected 409 duplicate employeeId conflict but succeeded!');
  } catch (err) {
    console.log(`Caught expected duplicate employeeId error: status=${err.statusCode}, message="${err.message}"`);
    if (err.statusCode !== 409 || !err.message.includes('field: employeeId')) {
      throw new Error(`Unexpected error format: ${err.message}`);
    }
  }

  // Cleanup test employees
  console.log('Cleaning up test records...');
  await Employee.deleteMany({ email: { $regex: testEmailPrefix } });
  await User.deleteMany({ email: { $regex: testEmailPrefix } });
  console.log('Cleanup completed.');

  console.log('--- ALL TESTS PASSED SUCCESSFULLY ---');
  process.exit(0);
}

runTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
