/**
 * Application Logger
 */
const logger = {
  info: (msg, meta = '') => {
    const timestamp = new Date().toISOString();
    console.log(`[INFO] [${timestamp}] ${msg}`, meta ? meta : '');
  },
  warn: (msg, meta = '') => {
    const timestamp = new Date().toISOString();
    console.warn(`[WARN] [${timestamp}] ${msg}`, meta ? meta : '');
  },
  error: (msg, error = '') => {
    const timestamp = new Date().toISOString();
    console.error(`[ERROR] [${timestamp}] ${msg}`, error ? error : '');
  },
  debug: (msg, meta = '') => {
    if (process.env.NODE_ENV !== 'production') {
      const timestamp = new Date().toISOString();
      console.debug(`[DEBUG] [${timestamp}] ${msg}`, meta ? meta : '');
    }
  }
};

module.exports = logger;
