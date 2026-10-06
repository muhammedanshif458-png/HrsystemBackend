const mongoose = require('mongoose');
const env = require('./env');
const logger = require('../utils/logger');

const connectDB = async (customUri = null) => {
  const uri = customUri || env.mongodbUri;
  
  try {
    const conn = await mongoose.connect(uri);
    logger.info(`MongoDB Connected successfully to: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
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
