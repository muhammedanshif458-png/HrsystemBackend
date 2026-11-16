const mongoose = require('mongoose');
const http = require('http');
const dotenv = require('dotenv');
const path = require('path');
const { io: ioClient } = require('socket.io-client');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { app } = require('../server');
const socketService = require('../services/socketService');
const User = require('../models/User');
const Employee = require('../models/Employee');
const DepartmentChatMessage = require('../models/DepartmentChatMessage');

const TEST_DB_URI = process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017/hr_management_chat_test';

let server;
let baseUrl;
let socketUrl;
let hrToken;
let superAdminToken;
let techStaffToken;
let teleStaffToken;
let techStaffEmployeeId;
let teleStaffEmployeeId;

function assert(condition, message) {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}

async function request(endpoint, options = {}) {
  const url = `${baseUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const status = response.status;
  let json = null;
  try {
    json = await response.json();
  } catch (_) {}

  return { status, body: json };
}

function createSocket(token) {
  return ioClient(socketUrl, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000
  });
}

function waitForEvent(socket, event, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for socket event '${event}' after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function run() {
  console.log('\n================================================================');
  console.log('   SHARED REAL-TIME DEPARTMENT CHAT TEST SUITE');
  console.log('   (HR Dashboard + StaffHub Shared Gateway & WebSocket Sync)');
  console.log('================================================================\n');

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(TEST_DB_URI);
  console.log(`Connected to test DB: ${TEST_DB_URI}`);
  await mongoose.connection.db.dropDatabase();
  console.log('Database dropped and fresh for chat testing.\n');

  // Start HTTP server with Socket.IO initialized
  server = http.createServer(app);
  const io = socketService.initSocket(server);
  app.set('io', io);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      socketUrl = `ws://127.0.0.1:${port}`;
      console.log(`Test HTTP + WebSocket server listening at ${baseUrl}\n`);
      resolve();
    });
  });

  // 1. Seed Accounts
  console.log('--- SEEDING IDENTITIES ---');
  // HR User
  const hrUser = new User({
    firstName: 'Anita',
    lastName: 'Rao',
    email: 'anita.hr@testcorp.com',
    password: 'Password123!',
    role: 'HR',
    isActive: true
  });
  await hrUser.save();
  const hrLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'anita.hr@testcorp.com', password: 'Password123!' }
  });
  assert(hrLogin.status === 200, 'HR login successful');
  hrToken = hrLogin.body.data.token || hrLogin.body.data.accessToken;

  // Super Admin User
  const saUser = new User({
    firstName: 'Super',
    lastName: 'Admin',
    email: 'superadmin@testcorp.com',
    password: 'Password123!',
    role: 'SUPER_ADMIN',
    isActive: true
  });
  await saUser.save();
  const saLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'superadmin@testcorp.com', password: 'Password123!' }
  });
  assert(saLogin.status === 200, 'Super Admin login successful');
  superAdminToken = saLogin.body.data.token || saLogin.body.data.accessToken;

  // Tech Staff User & Employee
  const techUser = new User({
    firstName: 'Rohan',
    lastName: 'Verma',
    email: 'rohan.tech@testcorp.com',
    password: 'Password123!',
    role: 'STAFF',
    isActive: true
  });
  await techUser.save();
  const techEmp = new Employee({
    employeeId: 'TECH-101',
    user: techUser._id,
    firstName: 'Rohan',
    lastName: 'Verma',
    email: 'rohan.tech@testcorp.com',
    department: 'Tech & Engineering',
    designation: 'Backend Developer',
    status: 'ACTIVE'
  });
  await techEmp.save();
  techStaffEmployeeId = techEmp._id.toString();

  const techLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'rohan.tech@testcorp.com', password: 'Password123!' }
  });
  assert(techLogin.status === 200, 'Tech staff login successful');
  techStaffToken = techLogin.body.data.token || techLogin.body.data.accessToken;

  // Telecalling Staff User & Employee
  const teleUser = new User({
    firstName: 'Pooja',
    lastName: 'Sharma',
    email: 'pooja.tele@testcorp.com',
    password: 'Password123!',
    role: 'STAFF',
    isActive: true
  });
  await teleUser.save();
  const teleEmp = new Employee({
    employeeId: 'TELE-201',
    user: teleUser._id,
    firstName: 'Pooja',
    lastName: 'Sharma',
    email: 'pooja.tele@testcorp.com',
    department: 'Telecalling Support',
    designation: 'Client Relationship Officer',
    status: 'ACTIVE'
  });
  await teleEmp.save();
  teleStaffEmployeeId = teleEmp._id.toString();

  const teleLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'pooja.tele@testcorp.com', password: 'Password123!' }
  });
  assert(teleLogin.status === 200, 'Telecalling staff login successful');
  teleStaffToken = teleLogin.body.data.token || teleLogin.body.data.accessToken;

  // -------------------------------------------------------------------------
  // TEST GROUP 1: Access Control & Authorization Checks
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 1: REST Access Control & Department Boundaries ---');
  {
    // Unauthenticated access rejected
    const unauthRes = await request('/api/hr/departments/tech/messages');
    assert(unauthRes.status === 401, 'GET /api/hr/departments/tech/messages without token returns 401');

    const unauthStaff = await request('/api/staff/chat/messages');
    assert(unauthStaff.status === 401, 'GET /api/staff/chat/messages without token returns 401');

    // Staff cannot access HR endpoints
    const staffOnHr = await request('/api/hr/departments/tech/messages', {
      headers: { Authorization: `Bearer ${techStaffToken}` }
    });
    assert(staffOnHr.status === 403, 'Staff token accessing HR department chat returns 403 Forbidden');

    // HR cannot access Staff self-service endpoints
    const hrOnStaff = await request('/api/staff/chat/messages', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(hrOnStaff.status === 403, 'HR token accessing Staff chat endpoint returns 403 Forbidden');

    // Tech Staff CANNOT access Telecalling department chat
    const crossDeptGet = await request('/api/staff/departments/telecalling/messages', {
      headers: { Authorization: `Bearer ${techStaffToken}` }
    });
    assert(crossDeptGet.status === 403, 'Tech staff accessing Telecalling department chat returns 403 Forbidden');

    const crossDeptPost = await request('/api/staff/departments/telecalling/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${techStaffToken}` },
      body: { text: 'Spying on other department' }
    });
    assert(crossDeptPost.status === 403, 'Tech staff posting to Telecalling department chat returns 403 Forbidden');

    // HR & Super Admin accessing /api/staff/departments/:deptKey/messages must succeed (not return 403 Forbidden [STAFF])
    const saOnStaffDeptGet = await request('/api/staff/departments/tech/messages', {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    assert(saOnStaffDeptGet.status === 200, 'Super Admin accessing /api/staff/departments/tech/messages returns 200 OK (Not 403 Forbidden)');

    const hrOnStaffDeptGet = await request('/api/staff/departments/tech/messages', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(hrOnStaffDeptGet.status === 200, 'HR accessing /api/staff/departments/tech/messages returns 200 OK');

    const saOnHrDeptGet = await request('/api/hr/departments/tech/messages', {
      headers: { Authorization: `Bearer ${superAdminToken}` }
    });
    assert(saOnHrDeptGet.status === 200, 'Super Admin accessing /api/hr/departments/tech/messages returns 200 OK');
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 2: Shared REST Conversation (HR <-> StaffHub)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: Shared Bidirectional Conversation via REST ---');
  let msgFromHrId;
  let msgFromStaffId;
  {
    // HR sends message to Tech department
    const hrSend = await request('/api/hr/departments/tech/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { text: 'Team: Sprint review scheduled for 4 PM.' }
    });
    assert(hrSend.status === 201, 'HR posts message to Tech department (201)');
    assert(hrSend.body.data.departmentKey === 'tech', 'Message saved with canonical key "tech"');
    assert(hrSend.body.data.senderRole === 'HR', 'Server sets senderRole to HR');
    assert(hrSend.body.data.senderName === 'Anita Rao', 'Server populates trusted HR senderName');
    msgFromHrId = hrSend.body.data.id || hrSend.body.data._id;

    // StaffHub retrieves messages via dedicated /api/staff/chat/messages
    const staffGet1 = await request('/api/staff/chat/messages', {
      headers: { Authorization: `Bearer ${techStaffToken}` }
    });
    assert(staffGet1.status === 200, 'Tech staff retrieves chat messages via /api/staff/chat/messages');
    assert(Array.isArray(staffGet1.body.data), 'Returns array of messages');
    const hrMsgReceived = staffGet1.body.data.find((m) => (m.id || m._id) === msgFromHrId);
    assert(hrMsgReceived !== undefined, 'StaffHub receives HR message in Tech conversation');
    assert(hrMsgReceived.text === 'Team: Sprint review scheduled for 4 PM.', 'Message text matches exactly');

    // Staff sends reply via StaffHub /api/staff/chat/messages
    const staffReply = await request('/api/staff/chat/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${techStaffToken}` },
      body: { text: 'Noted Anita, backend demo is ready.' }
    });
    assert(staffReply.status === 201, 'StaffHub sends reply via /api/staff/chat/messages (201)');
    assert(staffReply.body.data.departmentKey === 'tech', 'Server routes staff reply to canonical "tech"');
    assert(staffReply.body.data.senderRole === 'STAFF', 'Server sets senderRole to STAFF');
    assert(staffReply.body.data.senderName === 'Rohan Verma', 'Server derives senderName from trusted Employee profile');
    assert(staffReply.body.data.senderId === techStaffEmployeeId, 'Server derives senderId from Employee record');
    msgFromStaffId = staffReply.body.data.id || staffReply.body.data._id;

    // HR Dashboard fetches Tech department messages
    const hrGet = await request('/api/hr/departments/tech/messages', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(hrGet.status === 200, 'HR Dashboard fetches Tech messages');
    const staffReplyReceived = hrGet.body.data.find((m) => (m.id || m._id) === msgFromStaffId);
    assert(staffReplyReceived !== undefined, 'HR Dashboard sees StaffHub reply in shared conversation');

    // Telecalling staff should NOT see any of these Tech messages
    const teleStaffGet = await request('/api/staff/chat/messages', {
      headers: { Authorization: `Bearer ${teleStaffToken}` }
    });
    assert(teleStaffGet.status === 200, 'Telecalling staff retrieves own messages');
    assert(teleStaffGet.body.data.length === 0, 'Telecalling conversation has 0 messages (Isolated from Tech)');
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 3: Input Validation & Message Constraints
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: Message Validation & Enforced Limits ---');
  {
    // Empty message
    const emptyMsg = await request('/api/staff/chat/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${techStaffToken}` },
      body: { text: '   ' }
    });
    assert(emptyMsg.status === 400, 'Empty/whitespace message rejected with 400');

    // Missing text
    const missingMsg = await request('/api/hr/departments/tech/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: {}
    });
    assert(missingMsg.status === 400, 'Missing message text rejected with 400');

    // Message exceeding 2000 characters
    const longText = 'A'.repeat(2005);
    const longMsg = await request('/api/staff/chat/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${techStaffToken}` },
      body: { text: longText }
    });
    assert(longMsg.status === 400, 'Message exceeding 2000 chars rejected with 400');
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 4: Socket.IO Authentication & Room Isolation
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: Real-Time Socket.IO Handshake & Room Isolation ---');
  let hrSocket;
  let techStaffSocket;
  let teleStaffSocket;
  {
    // Socket connection without token fails
    const badSocket = ioClient(socketUrl, {
      auth: { token: '' },
      transports: ['websocket'],
      reconnection: false
    });
    let authErrorCaught = false;
    await new Promise((resolve) => {
      badSocket.on('connect_error', (err) => {
        authErrorCaught = true;
        badSocket.disconnect();
        resolve();
      });
      setTimeout(resolve, 2000);
    });
    assert(authErrorCaught, 'Socket connection without token rejected by auth middleware');

    // Connect authenticated sockets
    hrSocket = createSocket(hrToken);
    techStaffSocket = createSocket(techStaffToken);
    teleStaffSocket = createSocket(teleStaffToken);

    await Promise.all([
      new Promise((res) => hrSocket.on('connect', res)),
      new Promise((res) => techStaffSocket.on('connect', res)),
      new Promise((res) => teleStaffSocket.on('connect', res))
    ]);
    assert(hrSocket.connected, 'HR Socket connected successfully');
    assert(techStaffSocket.connected, 'Tech Staff Socket connected successfully');
    assert(teleStaffSocket.connected, 'Telecalling Staff Socket connected successfully');

    // HR explicitly joins Tech department room
    await new Promise((resolve) => {
      hrSocket.emit('join_department', { departmentKey: 'tech' }, (ack) => {
        assert(ack.success === true, 'HR socket joined department:tech');
        resolve();
      });
    });

    // Tech Staff tries to join Telecalling room -> should be rejected!
    await new Promise((resolve) => {
      techStaffSocket.emit('join_department', { departmentKey: 'telecalling' }, (ack) => {
        assert(ack.success === false, 'Tech staff unauthorized to join Telecalling socket room');
        resolve();
      });
    });
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 5: Real-Time Broadcasts Across HR Dashboard & StaffHub
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 5: Real-Time Bidirectional Event Synchronization ---');
  {
    // SCENARIO A: HR sends message via REST API -> StaffHub receives 'new_message' via WebSocket
    console.log('  Scenario A: HR REST POST -> StaffHub WebSocket real-time delivery...');
    const staffPromise = waitForEvent(techStaffSocket, 'new_message');

    // Telecalling staff should NOT receive it
    let telecallingLeaked = false;
    const teleListener = () => { telecallingLeaked = true; };
    teleStaffSocket.on('new_message', teleListener);

    const hrRestSend = await request('/api/hr/departments/tech/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${hrToken}` },
      body: { text: 'Urgent: Release v2.4 hotfix deployed.' }
    });
    assert(hrRestSend.status === 201, 'HR message posted via REST');

    const receivedByStaff = await staffPromise;
    assert(receivedByStaff !== null, 'StaffHub received real-time socket event');
    assert((receivedByStaff.id || receivedByStaff._id) === (hrRestSend.body.data.id || hrRestSend.body.data._id), 'Staff received identical persisted message ID');
    assert(receivedByStaff.text === 'Urgent: Release v2.4 hotfix deployed.', 'Socket message text matches REST payload');
    assert(receivedByStaff.senderRole === 'HR', 'Socket event contains senderRole: HR');
    assert(receivedByStaff.timestamp === hrRestSend.body.data.timestamp, 'Socket event timestamp matches REST timestamp');

    // Allow short tick to verify Telecalling staff received nothing
    await new Promise((r) => setTimeout(r, 200));
    teleStaffSocket.off('new_message', teleListener);
    assert(telecallingLeaked === false, 'Room Isolation: Telecalling staff did NOT receive Tech message');

    // SCENARIO B: StaffHub sends message via Socket.IO event 'send_message' -> HR receives it in real-time
    console.log('  Scenario B: StaffHub WebSocket emit -> HR Dashboard real-time delivery...');
    const hrPromise = waitForEvent(hrSocket, 'new_message');

    await new Promise((resolve) => {
      techStaffSocket.emit('send_message', { text: 'Hotfix verified on staging.' }, (ack) => {
        assert(ack.success === true, 'Socket send_message acknowledged with success');
        assert(ack.data.text === 'Hotfix verified on staging.', 'Ack payload contains persisted text');
        assert(ack.data.senderName === 'Rohan Verma', 'Ack payload contains senderName');
        resolve();
      });
    });

    const receivedByHr = await hrPromise;
    assert(receivedByHr.text === 'Hotfix verified on staging.', 'HR received staff socket message in real-time');
    assert(receivedByHr.senderRole === 'STAFF', 'Message role confirmed as STAFF');
    assert(receivedByHr.departmentKey === 'tech', 'Message departmentKey is tech');

    // Verify it is also persisted in MongoDB
    const dbMsg = await DepartmentChatMessage.findById(receivedByHr.id || receivedByHr._id);
    assert(dbMsg !== null, 'Socket-originated message persisted in MongoDB');
    assert(dbMsg.text === 'Hotfix verified on staging.', 'MongoDB record text confirmed');
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 6: Message Deletion (For Me & For Everyone)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 6: Soft Deletion & Real-Time Deletion Broadcast ---');
  {
    // Post a message to test deletion
    const msgToDelete = await request('/api/staff/chat/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${techStaffToken}` },
      body: { text: 'Typo message to delete' }
    });
    const delMsgId = msgToDelete.body.data.id || msgToDelete.body.data._id;

    // Delete for me
    const delForMe = await request(`/api/staff/chat/messages/${delMsgId}/delete-for-me`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${techStaffToken}` }
    });
    assert(delForMe.status === 200, 'PATCH /delete-for-me returns 200 OK');

    // Verify hidden from staff's get
    const staffListAfter = await request('/api/staff/chat/messages', {
      headers: { Authorization: `Bearer ${techStaffToken}` }
    });
    assert(!staffListAfter.body.data.some((m) => (m.id || m._id) === delMsgId), 'Message hidden from user who deleted for me');

    // Still visible to HR
    const hrListAfter = await request('/api/hr/departments/tech/messages', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(hrListAfter.body.data.some((m) => (m.id || m._id) === delMsgId), 'Message remains visible to other conversation members');

    // Delete for everyone by HR -> real-time broadcast to room
    const deleteEventPromise = waitForEvent(techStaffSocket, 'message_deleted');
    const delForEveryone = await request(`/api/hr/departments/tech/messages/${delMsgId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(delForEveryone.status === 200, 'DELETE /messages/:id returns 200 OK (Delete for everyone)');

    const deleteBroadcast = await deleteEventPromise;
    assert(deleteBroadcast.messageId === delMsgId, 'Staff received real-time message_deleted event with matching messageId');
    assert(deleteBroadcast.deletedForEveryone === true, 'Deletion event confirms deletedForEveryone: true');

    const deletedHistory = await request('/api/hr/departments/tech/messages', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    const tombstone = deletedHistory.body.data.find((m) => (m.id || m._id) === delMsgId);
    assert(tombstone && tombstone.deletedForEveryone === true, 'Deleted department message remains as a history placeholder');
    assert(tombstone.text === 'This message was deleted', 'Deleted message history does not expose original content');
    const deletedSearch = await request('/api/hr/departments/tech/messages/search?q=Typo%20message', {
      headers: { Authorization: `Bearer ${hrToken}` }
    });
    assert(deletedSearch.status === 200 && !deletedSearch.body.data.some((m) => (m.id || m._id) === delMsgId), 'Search never returns deleted original message content');

    const forbiddenDelete = await request(`/api/staff/departments/tech/messages/${msgFromHrId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${teleStaffToken}` }
    });
    assert(forbiddenDelete.status === 403, 'Staff from another department cannot delete the message');
  }

  // -------------------------------------------------------------------------
  // TEST GROUP 7: Pagination & History Reconnect
  // -------------------------------------------------------------------------
  console.log('\n--- TEST GROUP 7: Pagination & History Preservation Across Reconnect ---');
  {
    // Close sockets and re-open to verify reconnect flow
    hrSocket.disconnect();
    techStaffSocket.disconnect();
    teleStaffSocket.disconnect();

    const reconnectStaffSocket = createSocket(techStaffToken);
    await new Promise((res) => reconnectStaffSocket.on('connect', res));
    assert(reconnectStaffSocket.connected, 'Staff reconnects successfully');

    // Fetch conversation with pagination
    const paginatedRes = await request('/api/staff/chat/messages?page=1&limit=2', {
      headers: { Authorization: `Bearer ${techStaffToken}` }
    });
    assert(paginatedRes.status === 200, 'GET with page & limit returns 200');
    assert(paginatedRes.body.data.length <= 2, 'Page returned at most 2 messages');
    assert(paginatedRes.body.pagination !== undefined, 'Response includes pagination metadata');
    assert(paginatedRes.body.pagination.total >= 3, 'Pagination total tracks all conversation messages');
    assert(paginatedRes.body.pagination.departmentKey === 'tech', 'Pagination metadata specifies canonical department');

    const searchRes = await request('/api/staff/chat/messages/search?q=Hotfix&page=1&limit=1', {
      headers: { Authorization: `Bearer ${techStaffToken}` }
    });
    assert(searchRes.status === 200 && searchRes.body.data.length === 1, 'Department message search supports paginated results');
    assert(searchRes.body.pagination.total >= 1 && searchRes.body.data[0].departmentKey === 'tech', 'Search results include pagination and stay in the authorized department');

    const hiddenMsg = await request('/api/staff/chat/messages', {
      method: 'POST', headers: { Authorization: `Bearer ${techStaffToken}` }, body: { text: 'persisted hidden message phrase' }
    });
    const hiddenId = hiddenMsg.body.data.id;
    await request(`/api/staff/chat/messages/${hiddenId}/delete-for-me`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${techStaffToken}` }, body: { userId: teleStaffEmployeeId }
    });
    const refreshedAfterHide = await request('/api/staff/chat/messages', { headers: { Authorization: `Bearer ${techStaffToken}` } });
    assert(!refreshedAfterHide.body.data.some((m) => (m.id || m._id) === hiddenId), 'Delete-for-me persists after refreshing history and ignores supplied userId');
    const reLogin = await request('/api/auth/login', { method: 'POST', body: { email: 'rohan.tech@testcorp.com', password: 'Password123!' } });
    const tokenAfterLogin = reLogin.body.data.token || reLogin.body.data.accessToken;
    const historyAfterLogin = await request('/api/staff/chat/messages', { headers: { Authorization: `Bearer ${tokenAfterLogin}` } });
    assert(reLogin.status === 200 && !historyAfterLogin.body.data.some((m) => (m.id || m._id) === hiddenId), 'Delete-for-me remains persisted after logging in again');
    const otherMemberBeforeClear = await request('/api/hr/departments/tech/messages', { headers: { Authorization: `Bearer ${hrToken}` } });
    assert(otherMemberBeforeClear.body.data.some((m) => (m.id || m._id) === hiddenId), 'Delete-for-me preserves message for another department member');

    const clearRes = await request('/api/staff/chat/clear', { method: 'POST', headers: { Authorization: `Bearer ${techStaffToken}` } });
    assert(clearRes.status === 200, 'Staff can clear own department chat history');
    const afterClear = await request('/api/staff/chat/messages', { headers: { Authorization: `Bearer ${techStaffToken}` } });
    assert(!afterClear.body.data.some((m) => (m.id || m._id) === hiddenId), 'Clear chat hides existing messages for requester after refresh');
    const otherMemberAfterClear = await request('/api/hr/departments/tech/messages', { headers: { Authorization: `Bearer ${hrToken}` } });
    assert(otherMemberAfterClear.body.data.some((m) => (m.id || m._id) === hiddenId), 'Clear chat does not remove history for other members');
    const afterClearPost = await request('/api/staff/chat/messages', {
      method: 'POST', headers: { Authorization: `Bearer ${techStaffToken}` }, body: { text: 'visible after my clear operation' }
    });
    const afterClearHistory = await request('/api/staff/chat/messages', { headers: { Authorization: `Bearer ${techStaffToken}` } });
    assert(afterClearHistory.body.data.some((m) => (m.id || m._id) === afterClearPost.body.data.id), 'New messages appear after clear-chat marker');
    const crossSearch = await request('/api/staff/departments/telecalling/messages/search?q=visible', { headers: { Authorization: `Bearer ${techStaffToken}` } });
    assert(crossSearch.status === 403, 'Cross-department message search is rejected');

    reconnectStaffSocket.disconnect();
  }

  console.log('\n================================================================');
  console.log('   ALL SHARED DEPARTMENT CHAT TESTS PASSED! (100%)');
  console.log('================================================================\n');

  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  server.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('\nTest Suite Error:\n', err);
  if (server) server.close();
  if (mongoose.connection) mongoose.disconnect();
  process.exit(1);
});

