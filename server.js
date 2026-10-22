const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

// 1. Load environment variables
const env = require('./config/env');
const { connectDB } = require('./config/db');
const logger = require('./utils/logger');

// Middleware imports
const notFoundMiddleware = require('./middleware/notFoundMiddleware');
const { errorMiddleware } = require('./middleware/errorMiddleware');

// Route imports
const authRoutes = require('./routes/authRoutes');
const hrRoutes = require('./routes/hrRoutes');
const staffRoutes = require('./routes/staffRoutes');

// 3. Initialize Express app
const app = express();

// 4. Enable Helmet for HTTP security headers
app.use(helmet());

// 5. Enable CORS
const defaultAllowedOrigins = [
  'http://localhost:50250',
  'http://127.0.0.1:50250',
  'http://localhost:51834',
  'http://127.0.0.1:51834',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

const configuredOrigins = (env.clientUrl && env.clientUrl !== '*')
  ? env.clientUrl.split(',').map((url) => url.trim()).filter(Boolean)
  : [];

const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...configuredOrigins]));

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests with no origin (e.g. curl, Postman, server-to-server)
    if (!origin) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // In development mode, also allow any local port on localhost or 127.0.0.1
    if (!env.isProduction && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Disposition'],
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// 6. Enable JSON body parsing
app.use(express.json({ limit: '10mb' }));

// 7. Enable URL-encoded body parsing
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 8. Enable request logging with Morgan
if (env.nodeEnv !== 'test') {
  app.use(morgan(env.isProduction ? 'combined' : 'dev'));
}

// Serve uploads folder statically if needed
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'HR Management API is running'
  });
});

// 9. Register API routes
app.use('/api/auth', authRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/staff', staffRoutes);

// 10. Register 404 Not Found middleware
app.use(notFoundMiddleware);

// 11. Register centralized error handling middleware
app.use(errorMiddleware);

// 12. Start the server (when run directly)
let server = null;
if (require.main === module) {
  // Connect to database then listen
  connectDB()
    .then(() => {
      server = app.listen(env.port, '0.0.0.0', () => {
        logger.info(`HR Management Server is running in [${env.nodeEnv}] mode on port ${env.port}`);
        logger.info(`Health check available at http://localhost:${env.port}/api/health`);
      });
    })
    .catch((err) => {
      logger.error('Failed to start server:', err);
      process.exit(1);
    });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (err) => {
    logger.error(`UNHANDLED REJECTION! Shutting down... ${err.name}: ${err.message}`, err.stack);
    if (server) {
      server.close(() => process.exit(1));
    } else {
      process.exit(1);
    }
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    logger.error(`UNCAUGHT EXCEPTION! Shutting down... ${err.name}: ${err.message}`, err.stack);
    process.exit(1);
  });
}

module.exports = { app, server };
