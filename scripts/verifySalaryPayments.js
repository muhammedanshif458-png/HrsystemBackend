const http = require('http');
const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const { app } = require('../server');
const User = require('../models/User');
const Employee = require('../models/Employee');
const PayrollBatch = require('../models/PayrollBatch');
const PayrollRecord = require('../models/PayrollRecord');
const PayrollConflict = require('../models/PayrollConflict');
const { generateAccessToken } = require('../utils/jwt');

let server;
let baseUrl;
let testDatabase;
function assert(ok, message) { if (!ok) throw new Error(`FAIL: ${message}`); console.log(`PASS: ${message}`); }
async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json() };
}

async function run() {
  testDatabase = `hr_management_salary_payments_${randomUUID().replace(/-/g, '')}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${testDatabase}`);
  const SalaryPayment = require('../models/SalaryPayment');
  await Promise.all([User.init(), Employee.init(), PayrollBatch.init(), PayrollRecord.init(), PayrollConflict.init(), SalaryPayment.init()]);
  await Promise.all([
    SalaryPayment.deleteMany({}), User.deleteMany({}), Employee.deleteMany({}),
    PayrollBatch.deleteMany({}), PayrollRecord.deleteMany({}), PayrollConflict.deleteMany({})
  ]);
  const hr = await User.create({ firstName: 'Test', lastName: 'HR', email: 'salary-hr@example.com', password: 'password123', role: 'HR', isActive: true });
  const staffUser = await User.create({ firstName: 'Test', lastName: 'Staff', email: 'salary-staff@example.com', password: 'password123', role: 'STAFF', isActive: true });
  const employees = await Promise.all(Array.from({ length: 10 }, (_, i) => `PAY${String(i + 1).padStart(3, '0')}`).map((employeeId, i) => Employee.create({
    employeeId, user: new mongoose.Types.ObjectId(), firstName: `Employee${i + 1}`, lastName: 'Test', email: `employee${i + 1}@example.com`, department: i === 9 ? 'Tech' : 'Sales', designation: 'Staff', salary: 50000
  })));
  const oldPaidAt = new Date('2026-06-01T00:00:00.000Z');
  const batch = await PayrollBatch.create({ year: 2026, month: 5, department: 'all', status: 'PAID', grossSalary: 100000, totalMonthlyBaseSalary: 100000, totalDeductions: 0, netPay: 100000, totalNetPayout: 100000, employeeCount: 10, unresolvedConflictCount: 0, createdBy: hr._id, paidAt: oldPaidAt, paymentDetails: { paymentMethod: 'LEGACY', reference: 'legacy-ref', remarks: 'legacy batch state', paidBy: hr._id } });
  const records = await Promise.all(employees.map((employee, i) => PayrollRecord.create({
    batchId: batch._id, employee: employee._id, employeeId: employee.employeeId, employeeName: `${employee.firstName} ${employee.lastName}`, department: employee.department, monthlyBaseSalary: 50000, scheduledWorkingDays: 22, presentDays: 18, wfhDays: 2, paidLeaveDays: 1, lopDays: 1, payableDays: 21, dailySalary: 2272.73, grossPay: 50000, deductions: 0, netPay: i === 9 ? 3142.86 : (i === 8 ? 729.52 : 300), calculationBreakdown: {}
  })));
  await SalaryPayment.create({ employee: employees[9]._id, employeeId: employees[9].employeeId, employeeName: 'Employee10 Test', department: 'Tech', payrollBatch: batch._id, payrollRecord: records[9]._id, payrollMonth: 5, payrollYear: 2026, monthlyBaseSalary: 50000, totalPresentDays: 20, paidLeaveDays: 1, lopDays: 1, payableDays: 21, netSalary: 3142.86, status: 'PAID', paymentDate: oldPaidAt, paymentMethod: 'CASH', confirmedBy: hr._id, confirmedAt: oldPaidAt });
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const hrToken = generateAccessToken(hr);
  const staffToken = generateAccessToken(staffUser);

  const list = await request('/api/hr/payroll/payments?year=2026&month=5', { token: hrToken });
  assert(list.status === 200 && list.body.data.length === 10, 'Employee-wise payment list returns payroll snapshots');
  const first = list.body.data.find(p => p.employeeId === 'PAY001');
  const second = list.body.data.find(p => p.employeeId === 'PAY002');
  assert(first.status === 'PENDING' && second.status === 'PENDING', 'Legacy PAID batch does not imply individual payment');
  assert(first.legacyBatchStatus === 'PAID' && first.paymentStatusEvidence === 'NO_EMPLOYEE_PAYMENT_CONFIRMATION', 'Legacy payment ambiguity is exposed without inferring employee payment');
  assert(first.totalPresentDays === 20 && first.netSalary === 300, 'List uses immutable snapshot values and combines office/WFH attendance');
  assert(list.body.pagination.summary.totalEmployees === 10 && list.body.pagination.summary.totalSalary === 6272.38 && list.body.pagination.summary.paidEmployees === 1 && list.body.pagination.summary.pendingEmployees === 9, 'Overall list summary includes both payment statuses');
  const paidList = await request('/api/hr/payroll/payments?year=2026&month=5&status=PAID', { token: hrToken });
  const pendingList = await request('/api/hr/payroll/payments?year=2026&month=5&status=PENDING', { token: hrToken });
  assert(paidList.body.data.length === 1 && paidList.body.pagination.pagination.total === 1 && paidList.body.pagination.summary.totalSalary === 6272.38, 'PAID list is filtered while summary stays overall');
  assert(pendingList.body.data.length === 9 && pendingList.body.pagination.pagination.total === 9 && pendingList.body.pagination.summary.totalEmployees === 10, 'PENDING list is filtered while summary stays overall');
  assert(paidList.body.pagination.summary.paidAmount === 3142.86 && paidList.body.pagination.summary.pendingAmount === 3129.52, 'Overall paid and pending amounts remain correct');
  const pageTwo = await request('/api/hr/payroll/payments?year=2026&month=5&page=2&limit=3', { token: hrToken });
  assert(pageTwo.body.data.length === 3 && pageTwo.body.pagination.summary.totalSalary === 6272.38, 'Pagination does not change the overall summary');
  const departmentList = await request('/api/hr/payroll/payments?year=2026&month=5&department=Tech', { token: hrToken });
  const departmentSummary = await request('/api/hr/payroll/payments/summary?year=2026&month=5&department=Tech&status=PENDING', { token: hrToken });
  assert(departmentList.body.data.length === 1 && departmentList.body.pagination.summary.totalSalary === 3142.86 && departmentSummary.body.data.totalSalary === 3142.86, 'Department filter applies consistently to list and summary regardless of status');
  const searched = await request('/api/hr/payroll/payments?year=2026&month=5&search=PAY001', { token: hrToken });
  assert(searched.status === 200 && searched.body.data.length === 1, 'Employee search filters the salary payment list');
  const summary = await request('/api/hr/payroll/payments/summary?year=2026&month=5', { token: hrToken });
  assert(summary.status === 200 && summary.body.data.totalSalary === 6272.38 && summary.body.data.pendingAmount === 3129.52, 'Payment summary totals match all snapshot amounts');
  const statusSummary = await request('/api/hr/payroll/payments/summary?year=2026&month=5&status=PAID', { token: hrToken });
  assert(statusSummary.body.data.totalEmployees === 10 && statusSummary.body.data.totalSalary === 6272.38, 'Summary endpoint ignores payment status filter');
  const searchSummary = await request('/api/hr/payroll/payments/summary?year=2026&month=5&search=PAY001&status=PAID', { token: hrToken });
  assert(searchSummary.body.data.totalEmployees === 1 && searchSummary.body.data.totalSalary === 300, 'Employee search affects summary consistently while status does not');

  const unauthorized = await request(`/api/hr/payroll/payments/${second._id}/mark-paid`, { method: 'POST', token: staffToken, body: { paymentDate: '2026-06-02', paymentMethod: 'CASH' } });
  assert(unauthorized.status === 403, 'Staff cannot confirm salary payment');
  const badMethod = await request(`/api/hr/payroll/payments/${first._id}/mark-paid`, { method: 'POST', token: hrToken, body: { paymentDate: '2026-06-02', paymentMethod: 'CHEQUE' } });
  assert(badMethod.status === 400, 'Invalid payment method is rejected');
  const missingRef = await request(`/api/hr/payroll/payments/${first._id}/mark-paid`, { method: 'POST', token: hrToken, body: { paymentDate: '2026-06-02', paymentMethod: 'UPI' } });
  assert(missingRef.status === 400, 'UPI payment without transaction reference is rejected');

  const unresolved = await PayrollConflict.create({ employee: employees[1]._id, employeeId: employees[1].employeeId, dateKey: '2026-05-12', conflictDate: new Date('2026-05-12'), year: 2026, month: 5, status: 'UNRESOLVED' });
  const conflictBlocked = await request(`/api/hr/payroll/payments/${second._id}/mark-paid`, { method: 'POST', token: hrToken, body: { paymentDate: '2026-06-02', paymentMethod: 'CASH' } });
  assert(conflictBlocked.status === 409, 'Unresolved employee payroll conflict blocks payment');
  await PayrollConflict.deleteOne({ _id: unresolved._id });

  const concurrent = await Promise.all([
    request(`/api/hr/payroll/payments/${first._id}/mark-paid`, { method: 'POST', token: hrToken, body: { paymentDate: '2026-06-02', paymentMethod: 'BANK_TRANSFER', transactionReference: 'TXN-001', remarks: 'Test payment' } }),
    request(`/api/hr/payroll/payments/${first._id}/mark-paid`, { method: 'POST', token: hrToken, body: { paymentDate: '2026-06-02', paymentMethod: 'BANK_TRANSFER', transactionReference: 'TXN-002', remarks: 'Concurrent retry' } })
  ]);
  const paid = concurrent.find(result => result.status === 200);
  assert(concurrent.filter(result => result.status === 200).length === 1 && concurrent.filter(result => result.status === 409).length === 1, 'Concurrent duplicate confirmations yield one PAID update and one conflict');
  assert(paid.body.data.status === 'PAID' && String(paid.body.data.confirmedBy._id) === String(hr._id), 'HR payment confirmation stores authenticated confirmer and audit details');
  const duplicate = await request(`/api/hr/payroll/payments/${first._id}/mark-paid`, { method: 'POST', token: hrToken, body: { paymentDate: '2026-06-03', paymentMethod: 'CASH' } });
  assert(duplicate.status === 409, 'Duplicate payment confirmation is rejected');
  const after = await request('/api/hr/payroll/payments?year=2026&month=5', { token: hrToken });
  assert(after.body.data.find(p => p.employeeId === 'PAY001').status === 'PAID' && after.body.data.find(p => p.employeeId === 'PAY002').status === 'PENDING', 'Marking one employee PAID leaves other employee PENDING');
  const history = await request('/api/hr/payroll/payments/history?year=2026&month=5&status=PAID&department=Sales', { token: hrToken });
  assert(history.status === 200 && history.body.data.length === 1 && ['TXN-001', 'TXN-002'].includes(history.body.data[0].transactionReference), 'Payment history filters and returns payment metadata');
  const detail = await request(`/api/hr/payroll/payments/${first._id}`, { token: hrToken });
  assert(detail.status === 200 && detail.body.data.remarks === 'Test payment', 'Individual payment detail endpoint returns full record');
  const batchAfter = await PayrollBatch.findById(batch._id).lean();
  assert(batchAfter.status === 'PAID' && batchAfter.paidAt.getTime() === oldPaidAt.getTime() && batchAfter.paymentDetails.reference === 'legacy-ref', 'Legacy PAID batch snapshot metadata remains unchanged');
  assert(await SalaryPaymentCount() === 10, 'Unique employee-month payment rows were created');
  console.log('\nSalary payment integration checks passed.');
}

async function SalaryPaymentCount() { return require('../models/SalaryPayment').countDocuments({}); }

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.readyState) {
    if (testDatabase) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
