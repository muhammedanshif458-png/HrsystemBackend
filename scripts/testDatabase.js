const mongoose = require('mongoose');
const TEST_DB_NAME = 'hr_management_test';

const validateTestUri = (uri) => {
  const parsed = new URL(uri);
  const database = parsed.pathname.replace(/^\//, '');
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  if (!localHosts.has(parsed.hostname) || database !== TEST_DB_NAME || parsed.username || parsed.password) {
    throw new Error(`Unsafe test MongoDB URI. Use a local, credential-free URI targeting /${TEST_DB_NAME}.`);
  }
};

const connectTestDatabase = async () => {
  const uri = process.env.TEST_MONGODB_URI || `mongodb://127.0.0.1:27017/${TEST_DB_NAME}`;
  validateTestUri(uri);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  const database = mongoose.connection.name;
  if (database !== TEST_DB_NAME) {
    await mongoose.disconnect();
    throw new Error(`Refusing to run tests against unexpected database: ${database}`);
  }
  // This is the dedicated test database only; production MONGODB_URI is never consulted.
  await mongoose.connection.dropDatabase();
  console.log(`Connected to explicitly isolated local test database: ${database}.`);
  return { database };
};

module.exports = { connectTestDatabase, TEST_DB_NAME };
