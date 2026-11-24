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
  logger.error(`MongoDB runtime error: ${err.name || 'Error'}${err.code ? ` (${err.code})` : ''}`);
});

const connectDB = async (customUri = null) => {
  const uri = customUri || process.env.MONGODB_URI || env.mongodbUri;
  
  try {
    const conn = await mongoose.connect(uri);
    logger.info(`MongoDB Connected successfully: Host=${conn.connection.host}, Database=${conn.connection.name}`);
    return conn;
  } catch (error) {
    logger.error(`MongoDB connection failed: ${error.name || 'Error'}${error.code ? ` (${error.code})` : ''}`);
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
