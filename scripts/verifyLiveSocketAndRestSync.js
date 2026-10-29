const { io } = require('socket.io-client');
const http = require('http');
const mongoose = require('mongoose');
const env = require('../config/env');
const User = require('../models/User');
const Employee = require('../models/Employee');
const DepartmentChatMessage = require('../models/DepartmentChatMessage');
const { generateAccessToken } = require('../utils/jwt');

function assert(condition, message) {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}

async function request(path, options = {}) {
  const url = `http://localhost:5000${path}`;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const status = response.status;
  let body = null;
  try {
    body = await response.json();
  } catch (_) {}

  return { status, body };
}

function waitForEvent(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event "${event}" after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function main() {
  console.log('================================================================');
  console.log('   LIVE PORT 5000: CHAT REST + WEBSOCKET SYNCHRONIZATION TEST');
  console.log('================================================================\n');

  await mongoose.connect(env.mongodbUri);

  // 1. Get Accounts
  const superAdmin = await User.findOne({ email: 'lysoftware@gmail.com' });
  assert(superAdmin, 'Super Admin user found');
  const superAdminToken = generateAccessToken({ id: superAdmin._id, role: superAdmin.role });

  const techEmp = await Employee.findOne({ department: /tech/i, status: 'ACTIVE', isDeleted: { $ne: true } });
  assert(techEmp, `Tech Employee found: ${techEmp.firstName} ${techEmp.lastName}`);
  const techUser = await User.findById(techEmp.user);
  assert(techUser, 'Tech User found');
  const techStaffToken = generateAccessToken({ id: techUser._id, role: 'STAFF' });

  const teleEmp = await Employee.findOne({ department: /tele/i, status: 'ACTIVE', isDeleted: { $ne: true } });
  assert(teleEmp, `Telecalling Employee found: ${teleEmp.firstName} ${teleEmp.lastName}`);
  const teleUser = await User.findById(teleEmp.user);
  assert(teleUser, 'Telecalling User found');
  const teleStaffToken = generateAccessToken({ id: teleUser._id, role: 'STAFF' });

  // 2. Verify REST endpoints with Super Admin (Fix verification)
  console.log('\n--- 1. Testing HR & Staff REST Endpoints for Super Admin ---');
  const staffDeptGet = await request('/api/staff/departments/tech/messages', {
    headers: { Authorization: `Bearer ${superAdminToken}` }
  });
  assert(staffDeptGet.status === 200, 'GET /api/staff/departments/tech/messages returns 200 for SUPER_ADMIN');

  const hrDeptGet = await request('/api/hr/departments/tech/messages', {
    headers: { Authorization: `Bearer ${superAdminToken}` }
  });
  assert(hrDeptGet.status === 200, 'GET /api/hr/departments/tech/messages returns 200 for SUPER_ADMIN');

  // 3. Connect Sockets
  console.log('\n--- 2. Connecting Sockets to Live Server on Port 5000 ---');
  const superAdminSocket = io('http://localhost:5000', {
    auth: { token: superAdminToken },
    transports: ['websocket'],
    timeout: 5000
  });

  const techStaffSocket = io('http://localhost:5000', {
    auth: { token: techStaffToken },
    transports: ['websocket'],
    timeout: 5000
  });

  const teleStaffSocket = io('http://localhost:5000', {
    auth: { token: teleStaffToken },
    transports: ['websocket'],
    timeout: 5000
  });

  await Promise.all([
    new Promise((resolve) => superAdminSocket.on('connect', resolve)),
    new Promise((resolve) => techStaffSocket.on('connect', resolve)),
    new Promise((resolve) => teleStaffSocket.on('connect', resolve))
  ]);
  assert(superAdminSocket.connected, 'Super Admin socket connected');
  assert(techStaffSocket.connected, 'Tech Staff socket connected');
  assert(teleStaffSocket.connected, 'Telecalling Staff socket connected');

  // Super Admin joins department:tech
  await new Promise((resolve) => {
    superAdminSocket.emit('join_department', { departmentKey: 'tech' }, (ack) => {
      assert(ack && ack.success, 'Super Admin joined department:tech');
      resolve();
    });
  });

  // Track if Telecalling receives any Tech messages (it MUST NOT!)
  let teleReceivedForbiddenMsg = false;
  teleStaffSocket.on('new_message', (msg) => {
    if (msg.departmentKey === 'tech') {
      teleReceivedForbiddenMsg = true;
    }
  });

  // 4. StaffHub sends message via REST -> HR receives via WebSocket
  console.log('\n--- 3. StaffHub sends REST message -> Super Admin WebSocket reception ---');
  const uniqueStaffText = `StaffHub Live Test Message at ${Date.now()}`;
  const hrReceivePromise = waitForEvent(superAdminSocket, 'new_message');

  const staffPostRes = await request('/api/staff/chat/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${techStaffToken}` },
    body: { text: uniqueStaffText }
  });
  assert(staffPostRes.status === 201, 'Staff message posted via REST /api/staff/chat/messages');
  assert(staffPostRes.body.data.senderRole === 'STAFF', 'Sender role is STAFF');
  assert(staffPostRes.body.data.departmentKey === 'tech', 'Department key is tech');

  const receivedByHr = await hrReceivePromise;
  assert(receivedByHr.text === uniqueStaffText, 'Super Admin WebSocket received exact staff message in real-time');
  assert(receivedByHr.senderRole === 'STAFF', 'Received message senderRole is STAFF');

  // 5. Super Admin sends message via REST -> Staff receives via WebSocket
  console.log('\n--- 4. Super Admin sends REST message -> StaffHub WebSocket reception ---');
  const uniqueHrText = `HR Admin Reply at ${Date.now()}`;
  const staffReceivePromise = waitForEvent(techStaffSocket, 'new_message');

  const hrPostRes = await request('/api/staff/departments/tech/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: { text: uniqueHrText, senderName: 'Super Admin' }
  });
  assert(hrPostRes.status === 201, 'Super Admin message posted via /api/staff/departments/tech/messages');
  assert(hrPostRes.body.data.senderRole === 'SUPER_ADMIN', 'Sender role is SUPER_ADMIN');

  const receivedByStaff = await staffReceivePromise;
  assert(receivedByStaff.text === uniqueHrText, 'Staff WebSocket received exact Super Admin reply in real-time');
  assert(receivedByStaff.senderRole === 'SUPER_ADMIN', 'Received reply senderRole is SUPER_ADMIN');

  // 6. Verify Isolation
  console.log('\n--- 5. Verifying Department Isolation ---');
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert(!teleReceivedForbiddenMsg, 'Department Isolation verified: Telecalling socket received 0 Tech messages');

  // 7. Verify Message History & Persistence
  console.log('\n--- 6. Verifying Persistence in MongoDB ---');
  const persistedStaff = await DepartmentChatMessage.findOne({ text: uniqueStaffText });
  assert(persistedStaff, 'Staff message persisted in MongoDB');
  assert(persistedStaff.departmentKey === 'tech', 'Staff message departmentKey in DB is tech');

  const persistedHr = await DepartmentChatMessage.findOne({ text: uniqueHrText });
  assert(persistedHr, 'HR message persisted in MongoDB');
  assert(persistedHr.departmentKey === 'tech', 'HR message departmentKey in DB is tech');

  // 8. Clean up test messages from live DB
  await DepartmentChatMessage.deleteMany({ text: { $in: [uniqueStaffText, uniqueHrText] } });
  console.log('Cleaned up live verification test messages.');

  superAdminSocket.disconnect();
  techStaffSocket.disconnect();
  teleStaffSocket.disconnect();
  await mongoose.disconnect();

  console.log('\n================================================================');
  console.log('   ALL LIVE PORT 5000 TESTS PASSED SUCCESSFULLY! (100%)');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('\nTest failed with error:', err);
  process.exit(1);
});
