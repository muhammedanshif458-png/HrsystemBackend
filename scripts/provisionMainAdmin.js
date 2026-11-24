const crypto = require('node:crypto');
const readlinePromises = require('node:readline/promises');
const mongoose = require('mongoose');
const env = require('../config/env');
const { connectDB, disconnectDB } = require('../config/db');
const User = require('../models/User');

const TARGET_EMAIL = 'lysoftware@gmail.com';
const EXPECTED_HOST = 'ly-hr-cluster.ttn1ys6.mongodb.net';
const EXPECTED_DATABASE = 'hr_management';
const EXPECTED_ROLE = 'SUPER_ADMIN';

const normalizedEmailMatch = {
  $expr: {
    $eq: [
      { $toLower: { $trim: { input: { $ifNull: ['$email', ''] } } } },
      TARGET_EMAIL
    ]
  }
};

function inspectConfiguredTarget(uri) {
  let parsed;
  try {
    parsed = new URL(uri);
  } catch (_) {
    throw new Error('Configured MongoDB URL is invalid.');
  }

  const database = decodeURIComponent(
    (parsed.pathname || '').replace(/^\/+/, '').split('/')[0] || ''
  );

  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol)) {
    throw new Error('Configured target is not a MongoDB URL.');
  }
  if (parsed.hostname.toLowerCase() !== EXPECTED_HOST) {
    throw new Error('Configured MongoDB host does not match the approved Atlas cluster.');
  }
  if (database !== EXPECTED_DATABASE) {
    throw new Error('Configured MongoDB database does not match the approved database.');
  }

  return { host: parsed.hostname, database };
}

async function confirmTarget() {
  const rl = readlinePromises.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const answer = await rl.question(
      `Target: ${EXPECTED_HOST}/${EXPECTED_DATABASE}. Type CREATE to continue: `
    );
    return answer.trim() === 'CREATE';
  } finally {
    rl.close();
  }
}

async function readHidden(label) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(
      new Error('A real interactive terminal with raw-mode input is required; refusing visible input.')
    );
  }

  const rl = readlinePromises.createInterface({
    input,
    output: process.stdout,
    terminal: false
  });

  try {
    input.setRawMode(true);
    input.resume();
    return await rl.question(label);
  } finally {
    try {
      input.setRawMode(false);
    } catch (_) {}
    rl.close();
    process.stdout.write('\n');
  }
}

function validatePassword(password) {
  const byteLength = Buffer.byteLength(password, 'utf8');
  const characterClasses = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^\p{L}\p{N}\s]/u.test(password)
  ].filter(Boolean).length;

  return byteLength >= 16 &&
    byteLength <= 72 &&
    password === password.trim() &&
    !/[\u0000-\u001f\u007f]/.test(password) &&
    characterClasses >= 3;
}

async function countMatchingUsers() {
  return mongoose.connection.db
    .collection('users')
    .countDocuments(normalizedEmailMatch);
}

async function main() {
  let connected = false;
  let password = '';
  let confirmation = '';
  let created = false;

  try {
    const effectiveUri = process.env.MONGODB_URI || env.mongodbUri;
    if (!effectiveUri) {
      throw new Error('No MongoDB URI is configured.');
    }

    const configuredTarget = inspectConfiguredTarget(effectiveUri);
    await connectDB(effectiveUri);
    connected = true;

    if (mongoose.connection.name !== EXPECTED_DATABASE) {
      throw new Error('Connected database does not match the approved database.');
    }

    const firstCount = await countMatchingUsers();
    if (firstCount !== 0) {
      console.log(JSON.stringify({
        result: 'stopped_existing_account',
        database: EXPECTED_DATABASE,
        matchingUserCount: firstCount
      }));
      return;
    }

    if (!User.schema.path('mustChangePassword')) {
      console.log(JSON.stringify({
        result: 'stopped_first_login_change_unsupported',
        database: EXPECTED_DATABASE,
        databaseChanges: false
      }));
      return;
    }

    console.log(JSON.stringify({
      targetVerified: true,
      cluster: configuredTarget.host,
      database: mongoose.connection.name,
      matchingUserCount: 0
    }));

    if (!(await confirmTarget())) {
      console.log(JSON.stringify({ result: 'cancelled', databaseChanges: false }));
      return;
    }

    password = await readHidden('New password (hidden): ');
    confirmation = await readHidden('Confirm password (hidden): ');

    const firstBytes = Buffer.from(password, 'utf8');
    const secondBytes = Buffer.from(confirmation, 'utf8');
    const matches = firstBytes.length === secondBytes.length &&
      crypto.timingSafeEqual(firstBytes, secondBytes);
    firstBytes.fill(0);
    secondBytes.fill(0);

    if (!matches) {
      console.log(JSON.stringify({ result: 'stopped_password_mismatch', databaseChanges: false }));
      return;
    }
    if (!validatePassword(password)) {
      console.log(JSON.stringify({
        result: 'stopped_password_policy',
        databaseChanges: false,
        passwordPolicy: '16-72 UTF-8 bytes, no edge whitespace, no control characters, and at least three character classes.'
      }));
      return;
    }

    const finalCount = await countMatchingUsers();
    if (finalCount !== 0) {
      console.log(JSON.stringify({
        result: 'stopped_existing_account',
        database: EXPECTED_DATABASE,
        matchingUserCount: finalCount
      }));
      return;
    }

    const user = new User({
      firstName: 'LY SOFTWARE Main',
      lastName: 'Admin',
      email: TARGET_EMAIL,
      password,
      role: EXPECTED_ROLE,
      isActive: true
    });

    await user.save();
    created = true;

    const savedUser = await User.findOne(normalizedEmailMatch).select('+password');
    const hashPresent = Boolean(
      savedUser && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(savedUser.password || '')
    );
    const passwordMatches = Boolean(savedUser && await savedUser.comparePassword(password));
    const exactCount = await countMatchingUsers();
    const verified = exactCount === 1 &&
      savedUser.role === EXPECTED_ROLE &&
      savedUser.isActive === true &&
      hashPresent && passwordMatches;

    console.log(JSON.stringify({
      result: verified ? 'created_and_verified' : 'created_verification_failed',
      database: mongoose.connection.name,
      email: TARGET_EMAIL,
      role: savedUser?.role || null,
      active: savedUser?.isActive === true,
      matchingUserCount: exactCount,
      bcryptHashPresent: hashPresent,
      passwordComparisonPassed: passwordMatches,
      employeeProfileCreated: false
    }));

    if (!verified) process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({
      result: created ? 'created_verification_failed' : 'stopped_safely',
      userCreated: created,
      errorType: error.name || 'Error',
      errorCode: error.code || null
    }));
    process.exitCode = 1;
  } finally {
    password = '';
    confirmation = '';
    if (connected) await disconnectDB();
  }
}

main();
