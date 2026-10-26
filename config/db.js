const mongoose = require('mongoose');
const env = require('./env');
const logger = require('../utils/logger');

// Connection event listeners for Atlas lifecycle events
mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB connection lost. Reconnecting...');
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected successfully.');
});

mongoose.connection.on('error', (err) => {
  logger.error(`MongoDB runtime error: ${err.message}`, err);
});

const connectDB = async (customUri = null) => {
  const uri = customUri || process.env.MONGODB_URI || env.mongodbUri;
  
  try {
    const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    logger.info(`MongoDB Connected successfully: Host=${conn.connection.host}, Database=${conn.connection.name}`);
    return conn;
  } catch (error) {
    if (!env.isProduction && (uri.includes('127.0.0.1:27017') || uri.includes('localhost:27017'))) {
      try {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        if (!global.__mongoMemoryServer) {
          logger.info('Local MongoDB on 27017 not detected. Launching in-memory development MongoDB on 27017...');
          global.__mongoMemoryServer = await MongoMemoryServer.create({
            instance: { port: 27017, dbName: 'hr_management' }
          });
        }
        const conn = await mongoose.connect(uri);
        logger.info(`MongoDB Connected successfully (Dev Instance): Host=${conn.connection.host}, Database=${conn.connection.name}`);
        return conn;
      } catch (devErr) {
        logger.warn(`Could not start MongoMemoryServer fallback: ${devErr.message}`);
      }
    }
    logger.error(`MongoDB connection error: ${error.message}`, error);
    if (!customUri) {
      // Exit process with failure in normal server start if DB connection fails
      process.exit(1);
    }
    throw error;
  }
};

const disconnectDB = async () => {
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
