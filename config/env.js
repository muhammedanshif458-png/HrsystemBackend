const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const isProduction = process.env.NODE_ENV === 'production';
const rawPort = process.env.PORT ? Number(process.env.PORT) : NaN;

if (isProduction) {
  const requiredProductionVars = ['MONGODB_URI', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'PORT'];
  const missingVars = requiredProductionVars.filter((key) => !process.env[key] || !process.env[key].trim());
  if (missingVars.length) {
    throw new Error(`Missing required production environment variables: ${missingVars.join(', ')}`);
  }

  // HS256 secrets must be long and random; short secrets can be brute-forced offline from any token.
  const weakSecrets = ['JWT_SECRET', 'JWT_REFRESH_SECRET'].filter((key) => {
    const value = process.env[key].trim();
    return value.length < 32 || /^replace_with|^default_jwt|change_in_production/i.test(value);
  });
  if (weakSecrets.length) {
    throw new Error(`${weakSecrets.join(', ')} must be at least 32 random characters (generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))").`);
  }
  if (process.env.JWT_SECRET.trim() === process.env.JWT_REFRESH_SECRET.trim()) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different.');
  }

  let configuredMongoUrl;
  try {
    configuredMongoUrl = new URL(process.env.MONGODB_URI);
  } catch (_) {
    throw new Error('MONGODB_URI must be a valid MongoDB connection URL in production.');
  }

  const configuredDatabase = decodeURIComponent((configuredMongoUrl.pathname || '').replace(/^\/+/, '').split('/')[0] || '');
  if (!['mongodb:', 'mongodb+srv:'].includes(configuredMongoUrl.protocol) || configuredDatabase !== 'hr_management') {
    throw new Error('Production MONGODB_URI must select the hr_management database.');
  }
}

if (process.env.PORT && (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65535)) {
  throw new Error('PORT must be a valid TCP port number.');
}
const port = Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535 ? rawPort : 5000;

const env = {
  port,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  mongodbUri: process.env.MONGODB_URI || (isProduction ? null : 'mongodb://127.0.0.1:27017/hr_management'),
  birthdayTimeZone: process.env.BIRTHDAY_TIMEZONE || 'Asia/Kolkata',
  
  jwt: {
    secret: process.env.JWT_SECRET || 'default_jwt_secret_change_in_production_min_32_chars',
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'default_jwt_refresh_secret_change_in_production',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  },
  
  clientUrl: process.env.CLIENT_URL || 'https://hr-dashboard-1-9c41.onrender.com,https://hrsystem-zzhg.onrender.com',

  // Location is optional for staff login (both OFFICE and WORK_FROM_HOME). Kept for legacy client compatibility.
  staffLoginRequireLocation: process.env.STAFF_LOGIN_REQUIRE_LOCATION === 'true',
  
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
