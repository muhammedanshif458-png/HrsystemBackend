/**
 * Read-only login diagnostic.
 *
 * Usage:
 *   node scripts/diagnoseLogin.js                       -> only checks the DB connection
 *   node scripts/diagnoseLogin.js <email> [password]    -> explains why a login succeeds / fails
 *
 * Uses MONGODB_URI from .env. Never writes to the database.
 */
const mongoose = require('mongoose');
const env = require('../config/env');
const User = require('../models/User');
const Employee = require('../models/Employee');
const { emailLookupCandidates } = require('../utils/email');

const [, , emailArg, passwordArg] = process.argv;

const maskUri = (uri) => String(uri || '').replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:****@');

(async () => {
  const uri = process.env.MONGODB_URI || env.mongodbUri;
  console.log(`Connecting to ${maskUri(uri)}`);
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  } catch (err) {
    console.error(`\n✗ DB CONNECTION FAILED: ${err.name}: ${err.message}`);
    console.error('  Check: MONGODB_URI in .env, Atlas password (URL-encode special chars like @ # %),');
    console.error('         Atlas Network Access (IP allow-list, e.g. 0.0.0.0/0 for Render), DB user permissions.');
    process.exit(1);
  }

  const dbName = mongoose.connection.name;
  console.log(`✓ Connected. Host=${mongoose.connection.host} Database=${dbName}`);
  if (dbName !== 'hr_management') {
    console.warn(`! Database is "${dbName}", expected "hr_management". /api/health will report not_ready.`);
  }
  const [users, employees] = await Promise.all([User.countDocuments(), Employee.countDocuments()]);
  const roles = await User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]);
  console.log(`  users=${users} employees=${employees} roles=${JSON.stringify(roles.map((r) => `${r._id}:${r.count}`))}`);

  if (!emailArg) {
    await mongoose.disconnect();
    return;
  }

  const candidates = emailLookupCandidates(emailArg);
  console.log(`\nLooking up ${JSON.stringify(candidates)}`);
  const matches = await User.find({ email: { $in: candidates } }).select('+password');
  // Also catch addresses stored with stray whitespace / different case by older scripts
  const loose = await User.find({
    email: { $regex: `^\\s*${candidates[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, $options: 'i' }
  }).select('email');

  if (!matches.length) {
    console.log('✗ No user found → login returns "Invalid email or password" (401).');
    if (loose.length) console.log(`  But found near-match(es): ${loose.map((u) => JSON.stringify(u.email)).join(', ')}`);
    await mongoose.disconnect();
    return;
  }
  if (matches.length > 1) {
    console.log(`! ${matches.length} accounts match (${matches.map((u) => u.email).join(', ')}). Exact match wins at login.`);
  }

  const user = matches.find((u) => u.email === candidates[0]) || matches[0];
  const employee = await Employee.findOne({ user: user._id }) || await Employee.findOne({ email: { $in: [user.email, ...candidates] } });

  console.log(`✓ User: email=${user.email} role=${user.role} isActive=${user.isActive} mustChangePassword=${user.mustChangePassword} hasPassword=${Boolean(user.password)}`);
  if (user.password && !/^\$2[aby]\$\d{2}\$/.test(user.password)) {
    console.log('✗ Stored password is NOT a bcrypt hash (was inserted as plain text directly in the DB). Login will always fail. Reset it via the API / Super Admin.');
  }
  if (employee) {
    console.log(`  Employee: ${employee.employeeId} dept="${employee.department}" status=${employee.status} isDeleted=${employee.isDeleted}`);
  } else {
    console.log('  Employee: none linked');
  }
  if (!['HR', 'STAFF', 'SUPER_ADMIN'].includes(user.role)) console.log('✗ Role is not allowed to log in (403).');
  if (!user.isActive) console.log('✗ Account deactivated (403).');
  if (employee && (employee.isDeleted || ['INACTIVE', 'TERMINATED', 'RESIGNED'].includes(employee.status))) {
    console.log('✗ Employee profile inactive/deleted (403).');
  }

  if (passwordArg !== undefined) {
    const ok = await user.comparePassword(passwordArg);
    console.log(ok ? '✓ Password matches.' : '✗ Password does NOT match → "Invalid email or password" (401).');
  }

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
