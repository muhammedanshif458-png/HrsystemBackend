const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const http = require('http');
const mongoose = require('mongoose');
const socketService = require('./services/socketService');

// 1. Load environment variables
const env = require('./config/env');
const { connectDB, disconnectDB } = require('./config/db');
const logger = require('./utils/logger');

// Middleware imports
const notFoundMiddleware = require('./middleware/notFoundMiddleware');
const { errorMiddleware } = require('./middleware/errorMiddleware');

// Route imports
const authRoutes = require('./routes/authRoutes');
const hrRoutes = require('./routes/hrRoutes');
const staffRoutes = require('./routes/staffRoutes');
const birthdayRoutes = require('./routes/birthdayRoutes');

// 3. Initialize Express app
const app = express();

// Render (and most hosts) sit behind one reverse proxy; trust it so req.ip is the
// real client IP. Required for per-client login rate limiting.
app.set('trust proxy', 1);

// 4. Enable Helmet for HTTP security headers (permit cross-origin resource policy for documents & media)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// 5. Enable CORS
const defaultAllowedOrigins = [
  'http://localhost:60895',
  'http://127.0.0.1:60895',
  'http://localhost:50250',
  'http://127.0.0.1:50250',
  'http://localhost:51834',
  'http://127.0.0.1:51834',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

const configuredOrigins = (env.clientUrl && env.clientUrl !== '*')
  ? env.clientUrl.split(',').map((url) => url.trim().replace(/\/+$/, '')).filter(Boolean)
  : [];

const allowedOrigins = Array.from(new Set([
  ...defaultAllowedOrigins.map((o) => o.replace(/\/+$/, '')),
  ...configuredOrigins
]));

// Helper: Checks if origin is any loopback interface on ANY port (localhost, 127.0.0.1, [::1])
const isLocalhostOrigin = (origin) => {
  if (!origin || typeof origin !== 'string') return false;
  const normalized = origin.trim().replace(/\/+$/, '');
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(normalized);
};

const corsOptions = {
  origin: (origin, callback) => {
    // 1. Allow non-browser requests with no origin (e.g. curl, Postman, server-to-server, mobile native)
    if (!origin) {
      return callback(null, true);
    }
    const normalized = String(origin).trim().replace(/\/+$/, '');

    // 2. Unconditionally allow any port on localhost, 127.0.0.1, or IPv6 [::1]
    if (isLocalhostOrigin(normalized)) {
      return callback(null, true);
    }

    // 3. Allow if wildcard is configured or origin matches allowed list
    if (env.clientUrl === '*' || allowedOrigins.includes(normalized) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }

    // 4. In non-production environments, default to permissive for local developer tooling
    if (!env.isProduction) {
      return callback(null, true);
    }

    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Cache-Control',
    'Pragma',
    'If-Modified-Since',
    'X-Client-Platform',
    'X-Client-Version',
    'Access-Control-Request-Headers',
    'Access-Control-Request-Method'
  ],
  exposedHeaders: ['Content-Disposition', 'Content-Type', 'Content-Length', 'Cross-Origin-Resource-Policy'],
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.options('/*', cors(corsOptions));

// 6. Enable JSON body parsing
app.use(express.json({ limit: '10mb' }));

// 7. Enable URL-encoded body parsing
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 8. Enable request logging with Morgan
if (env.nodeEnv !== 'test') {
  app.use(morgan(env.isProduction ? 'combined' : 'dev'));
}

// Serve uploads folder statically – but protect /uploads/documents/ (medical files etc.)
// Medical documents must be accessed through authenticated API endpoints:
//   Staff: GET /api/staff/documents/:docId/download
//   HR:    GET /api/hr/documents/:docId/download
app.use('/uploads', (req, res, next) => {
  if (req.path.startsWith('/documents/') || req.path === '/documents') {
    return res.status(403).json({
      success: false,
      message: 'Document access requires authentication. Use the document download API endpoint.'
    });
  }
  next();
}, express.static(path.join(__dirname, 'uploads')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1;
  const databaseName = databaseConnected ? mongoose.connection.name : null;
  // Production must use hr_management (catches a URI that silently points at "test").
  // The isolated test suite runs against hr_management_test.
  const expectedDatabases = env.nodeEnv === 'test' ? ['hr_management', 'hr_management_test', 'hr_management_e2e'] : ['hr_management'];
  const databaseReady = databaseConnected && expectedDatabases.includes(databaseName);
  const ready = databaseReady;

  return res.status(ready ? 200 : 503).json({
    success: ready,
    status: ready ? 'ready' : 'not_ready',
    backend: 'running',
    database: {
      connected: databaseConnected,
      ready: databaseReady,
      name: databaseName
    }
  });
});

// 9. Register API routes
app.use('/api/auth', authRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/birthdays', birthdayRoutes);

// 10. Register 404 Not Found middleware
app.use(notFoundMiddleware);

// 11. Register centralized error handling middleware
app.use(errorMiddleware);

// 12. Create HTTP server and initialize Socket.IO real-time engine
const server = http.createServer(app);
const io = socketService.initSocket(server, corsOptions);
app.set('io', io);

// Start the server (when run directly)
if (require.main === module) {
  connectDB()
    .then(() => {
      server.listen(env.port, '0.0.0.0', () => {
        const activePort = server.address()?.port ?? env.port;
        logger.info(`HR Management Server is running in [${env.nodeEnv}] mode on port ${activePort}`);
        logger.info(`Health check available at http://localhost:${activePort}/api/health`);
        logger.info(`Socket.IO real-time chat gateway active on port ${activePort}`);
      });
    })
    .catch((err) => {
      logger.error('Failed to start server:', err);
      process.exit(1);
    });

  // A rejected promise that nobody handled (e.g. one failed DB call in a
  // background task) must not take the whole API and its DB connection down.
  // Log it and keep serving; the request that caused it already got an error.
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error(`UNHANDLED REJECTION (server kept running): ${err.name}: ${err.message}`, err.stack);
  });

  // Render sends SIGTERM on every deploy/restart: stop accepting requests and
  // close the MongoDB connection cleanly instead of dropping it mid-request.
  const shutdown = (signal) => {
    logger.info(`${signal} received. Closing HTTP server and MongoDB connection...`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    logger.error(`UNCAUGHT EXCEPTION! Shutting down... ${err.name}: ${err.message}`, err.stack);
    process.exit(1);
  });
}

module.exports = { app, server, io, socketService };
