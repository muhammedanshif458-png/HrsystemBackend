const assert = require('assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const PayrollConflict = require('../models/PayrollConflict');
require('../models/User');
require('../models/Employee');
require('../models/Attendance');
require('../models/Leave');
const payrollService = require('../services/payrollService');

async function main() {
  const mongo = await MongoMemoryServer.create();
  try {
    await mongoose.connect(mongo.getUri());
    const employee = new mongoose.Types.ObjectId();
    const hrUser = new mongoose.Types.ObjectId();
    const records = await PayrollConflict.create([
      { employee, dateKey: '2025-01-10', conflictDate: new Date('2025-01-10'), year: 2025, month: 1, status: 'RESOLVED', auditHistory: [{ action: 'RESOLVED_BY_HR', performedBy: hrUser }] },
      { employee, dateKey: '2025-02-10', conflictDate: new Date('2025-02-10'), year: 2025, month: 2, status: 'RESOLVED' },
      { employee, dateKey: '2026-01-10', conflictDate: new Date('2026-01-10'), year: 2026, month: 1, status: 'UNRESOLVED' }
    ]);

    assert.strictEqual(await payrollService.archiveResolvedConflicts({ _id: hrUser }), 2);
    assert.strictEqual(await PayrollConflict.countDocuments({ status: 'RESOLVED', archivedAt: { $ne: null } }), 2);
    assert.strictEqual(await payrollService.archiveResolvedConflicts({ _id: hrUser }), 0);

    const archived = await PayrollConflict.findById(records[0]._id).lean();
    assert(archived.archivedAt instanceof Date);
    assert.strictEqual(String(archived.archivedBy), String(hrUser));
    assert.strictEqual(archived.auditHistory.length, 1);

    const jan = await payrollService.getConflicts(2025, 1, { status: 'all' });
    const feb = await payrollService.getConflicts(2025, 2, { status: 'resolved' });
    const unresolved = await payrollService.getConflicts(2026, 1, { status: 'unresolved' });
    assert.strictEqual(jan.pagination.total, 0);
    assert.strictEqual(feb.pagination.total, 0);
    assert.strictEqual(unresolved.pagination.total, 1);
    assert.strictEqual(unresolved.conflicts[0].status, 'UNRESOLVED');
    console.log('Payroll conflict archive verification passed.');
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
