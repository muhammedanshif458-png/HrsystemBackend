const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const env = {
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hr_management',
  
  jwt: {
    secret: process.env.JWT_SECRET || 'default_jwt_secret_change_in_production_min_32_chars',
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'default_jwt_refresh_secret_change_in_production',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  },
  
  clientUrl: process.env.CLIENT_URL || 'http://localhost:51834,http://localhost:3000',
  
  seedAdmin: {
    email: process.env.SEED_ADMIN_EMAIL || 'admin@hrmanagement.com',
    password: process.env.SEED_ADMIN_PASSWORD || 'Admin@12345'
  },

  seedSuperAdmin: {
    email: (process.env.SEED_SUPER_ADMIN_EMAIL || 'lysoftware@gmail.com').toLowerCase(),
    password: process.env.SEED_SUPER_ADMIN_PASSWORD || 'hrAdmin'
  }
};

module.exports = env;
