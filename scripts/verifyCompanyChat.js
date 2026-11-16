const mongoose = require('mongoose');
const http = require('http');
const path = require('path');
const dotenv = require('dotenv');
const { io: ioClient } = require('socket.io-client');
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { app } = require('../server');
const socketService = require('../services/socketService');
const User = require('../models/User');
const Employee = require('../models/Employee');
const ChatMessage = require('../models/DepartmentChatMessage');
const { generateAccessToken } = require('../utils/jwt');

// Intentionally fixed local-only test database; never inherits a production URI.
const TEST_DB_URI = 'mongodb://127.0.0.1:27017/hr_management_company_chat_test';
const PASSWORD = 'TestPass123!';
let server;
let baseUrl;
let socketUrl;
const identities = {};
const sockets = [];

function assert(ok, message) {
  if (!ok) throw new Error(`FAIL: ${message}`);
  console.log(`  [PASS] ${message}`);
}

async function request(pathname, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let json;
  try { json = await response.json(); } catch (_) { json = {}; }
  return { status: response.status, body: json };
}

function connectSocket(token) {
  const socket = ioClient(socketUrl, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 5000 });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function eventOnce(socket, name, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), timeout);
    socket.once(name, (data) => { clearTimeout(timer); resolve(data); });
  });
}

async function seedUser(key, role, department) {
  const email = `${key}.companychat@testcorp.com`;
  const user = await User.create({ firstName: key, lastName: 'Tester', email, password: PASSWORD, role, isActive: true });
  let employee = null;
  if (role === 'STAFF') {
    employee = await Employee.create({ employeeId: `CC-${key}`, user: user._id, firstName: key, lastName: 'Tester', email, department, designation: 'Test', status: 'ACTIVE' });
  }
  identities[key] = { user, employee, role, token: generateAccessToken(user) };
}

async function run() {
  console.log('\n=== Dedicated Company Chat Integration Tests ===');
  await mongoose.connect(TEST_DB_URI);
  await mongoose.connection.db.dropDatabase();
  await seedUser('tech', 'STAFF', 'Tech & Engineering');
  await seedUser('tele', 'STAFF', 'Telecalling Support');
  await seedUser('hr', 'HR');
  await seedUser('admin', 'SUPER_ADMIN');

  server = http.createServer(app);
  const io = socketService.initSocket(server);
  app.set('io', io);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  socketUrl = baseUrl;

  console.log('\n-- API access and conversation information --');
  assert((await request('/api/staff/company-chat')).status === 401, 'unauthenticated access rejected');
  for (const key of ['tech', 'tele']) {
    const res = await request('/api/staff/company-chat', { token: identities[key].token });
    assert(res.status === 200 && res.body.data.conversationType === 'COMPANY', `${key} can access company conversation info`);
  }
  for (const key of ['hr', 'admin']) {
    const res = await request('/api/hr/company-chat', { token: identities[key].token });
    assert(res.status === 200 && res.body.data.conversationId === 'company', `${key} can access company conversation info`);
  }
  assert((await request('/api/hr/company-chat', { token: identities.tech.token })).status === 403, 'staff cannot use HR company route');

  const companyGet = (who, suffix = '') => request(`/api/staff/company-chat/messages${suffix}`, { token: identities[who].token });
  const companyPost = (who, text) => request('/api/staff/company-chat/messages', { method: 'POST', token: identities[who].token, body: { text } });
  const techSocket = await connectSocket(identities.tech.token);
  const teleSocket = await connectSocket(identities.tele.token);
  const hrSocket = await connectSocket(identities.hr.token);
  const adminSocket = await connectSocket(identities.admin.token);

  console.log('\n-- Company messages, roles, and conversation isolation --');
  let teleReceived = eventOnce(teleSocket, 'new_message');
  let hrReceived = eventOnce(hrSocket, 'new_message');
  let adminReceived = eventOnce(adminSocket, 'new_message');
  const techPost = await companyPost('tech', 'company hello from tech');
  assert(techPost.status === 201 && techPost.body.data.conversationType === 'COMPANY', 'Tech sends a company message');
  for (const [who, promise] of [['Telecalling', teleReceived], ['HR', hrReceived], ['SUPER_ADMIN', adminReceived]]) {
    assert((await promise).text === 'company hello from tech', `${who} receives Tech company message in real time`);
  }

  for (const who of ['tele', 'hr', 'admin']) {
    const response = await companyPost(who, `company hello from ${who}`);
    assert(response.status === 201 && response.body.data.senderRole === identities[who].role, `${who} can send a company message`);
  }

  const techHistory = await companyGet('tech');
  assert(techHistory.status === 200 && techHistory.body.data.length === 4, 'GET company history returns all company messages');
  assert(techHistory.body.data.every((m) => m.conversationType === 'COMPANY'), 'company history contains only COMPANY records');
  const teleHistory = await companyGet('tele');
  assert(teleHistory.body.data.some((m) => m.text === 'company hello from tech'), 'Telecalling REST history sees Tech company message');

  const deptPost = await request('/api/staff/chat/messages', { method: 'POST', token: identities.tech.token, body: { text: 'tech department only' } });
  assert(deptPost.status === 201, 'existing department POST still works');
  assert(!(await companyGet('tech')).body.data.some((m) => m.text === 'tech department only'), 'department message excluded from company history');
  const teleDepartment = await request('/api/staff/chat/messages', { token: identities.tele.token });
  assert(teleDepartment.status === 200 && !teleDepartment.body.data.some((m) => m.text === 'tech department only'), 'department conversations remain isolated');

  console.log('\n-- Pagination and deletion contracts --');
  const page = await companyGet('tech', '?page=1&limit=2');
  assert(page.status === 200 && page.body.data.length === 2 && page.body.pagination.total === 4, 'company pagination returns bounded page and total');
  const ownMessage = (await companyPost('tech', 'own message to delete')).body.data;
  let deleteEvent = eventOnce(teleSocket, 'message_deleted');
  const deleted = await request(`/api/staff/company-chat/messages/${ownMessage.id}`, { method: 'DELETE', token: identities.tech.token });
  assert(deleted.status === 200, 'sender can delete own company message for everyone');
  const deletionNotice = await deleteEvent;
  assert(deletionNotice.messageId === ownMessage.id && deletionNotice.conversationType === 'COMPANY', 'authorized company users receive deletion event');
  for (const who of ['tech', 'tele', 'hr', 'admin']) {
    const history = await companyGet(who);
    assert(!history.body.data.some((m) => m.id === ownMessage.id), `deleted message stays absent from ${who} refreshed history`);
  }

  const shared = (await companyPost('tech', 'delete for me only')).body.data;
  const hidden = await request(`/api/staff/company-chat/messages/${shared.id}/delete-for-me`, { method: 'PATCH', token: identities.tech.token, body: { userId: identities.tele.user._id } });
  assert(hidden.status === 200, 'delete-for-me endpoint succeeds for authenticated requester');
  assert(!(await companyGet('tech')).body.data.some((m) => m.id === shared.id), 'delete-for-me hides message for requester despite spoofed body userId');
  assert((await companyGet('tele')).body.data.some((m) => m.id === shared.id), 'delete-for-me leaves message visible to other users');
  const forbiddenDelete = await request(`/api/staff/company-chat/messages/${shared.id}`, { method: 'DELETE', token: identities.tele.token });
  assert(forbiddenDelete.status === 403, 'staff cannot delete another sender’s message');
  const forbiddenDeptJoin = await new Promise((resolve) => techSocket.emit('join_department', { departmentKey: 'telecalling' }, resolve));
  assert(forbiddenDeptJoin.success === false, 'Tech cannot join Telecalling department socket room');

  console.log('\n=== COMPANY CHAT TESTS PASSED ===');
}

run().catch((err) => { console.error('\nCompany chat test failure:', err); process.exitCode = 1; }).finally(async () => {
  for (const socket of sockets) socket.disconnect();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose.connection.readyState) await mongoose.disconnect();
});
