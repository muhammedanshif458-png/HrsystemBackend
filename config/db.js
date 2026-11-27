const mongoose = require('mongoose');
const env = require('./env');
const logger = require('../utils/logger');

// Connection settings tuned for MongoDB Atlas on a hosted server (Render):
// keep a small pool of live sockets, detect a dead server quickly, and let the
// driver keep retrying in the background after a network blip.
const CONNECTION_OPTIONS = {
  maxPoolSize: 10,
  minPoolSize: 1, // keep at least one socket open so the connection never goes fully idle
  serverSelectionTimeoutMS: 15000, // how long one connect attempt waits for Atlas
  socketTimeoutMS: 45000,
  heartbeatFrequencyMS: 10000, // check the Atlas connection every 10s
  retryWrites: true,
  retryReads: true
};

const INITIAL_CONNECT_ATTEMPTS = 10;
const RETRY_DELAY_MS = 5000;

// True only while we are closing the connection on purpose (scripts, shutdown),
// so a normal disconnect is not reported as a lost connection.
let closingIntentionally = false;

mongoose.connection.on('disconnected', () => {
  if (closingIntentionally) return;
  logger.warn('MongoDB connection lost. The driver is reconnecting automatically...');
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected successfully.');
});

mongoose.connection.on('error', (err) => {
  logger.error(`MongoDB runtime error: ${err.name || 'Error'}${err.code ? ` (${err.code})` : ''}`);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Connect to MongoDB. In normal server start, a failed attempt (Atlas briefly
 * unreachable, DNS hiccup, cold start) is retried several times before giving
 * up, instead of crashing the whole server on the first failure.
 */
const connectDB = async (customUri = null) => {
  const uri = customUri || process.env.MONGODB_URI || env.mongodbUri;
  const attempts = customUri ? 1 : INITIAL_CONNECT_ATTEMPTS;
  closingIntentionally = false;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const conn = await mongoose.connect(uri, CONNECTION_OPTIONS);
      logger.info(`MongoDB Connected successfully: Host=${conn.connection.host}, Database=${conn.connection.name}`);
      return conn;
    } catch (error) {
      const reason = `${error.name || 'Error'}${error.code ? ` (${error.code})` : ''}: ${error.message}`;
      if (attempt < attempts) {
        logger.warn(`MongoDB connection attempt ${attempt}/${attempts} failed (${reason}). Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      logger.error(`MongoDB connection failed after ${attempts} attempt(s): ${reason}`);
      if (!customUri) {
        // Exit so the host (Render) restarts the service and tries again.
        process.exit(1);
      }
      throw error;
    }
  }
  return null;
};

const disconnectDB = async () => {
  closingIntentionally = true;
  try {
    await mongoose.disconnect();
    logger.info('MongoDB disconnected');
  } catch (error) {
    logger.error(`Error disconnecting MongoDB: ${error.message}`);
  }
};

module.exports = {
  connectDB,
  disconnectDB
};
