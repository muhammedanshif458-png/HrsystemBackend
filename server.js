const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const http = require('http');
const socketService = require('./services/socketService');

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
const birthdayRoutes = require('./routes/birthdayRoutes');

// 3. Initialize Express app
const app = express();

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

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests with no origin (e.g. curl, Postman, server-to-server)
    if (!origin) {
      return callback(null, true);
    }
    const normalized = String(origin).trim().replace(/\/+$/, '');
    if (allowedOrigins.includes(normalized)) {
      return callback(null, true);
    }
    // In development mode, also allow any local port on localhost, 127.0.0.1, or IPv6 [::1]
    if (!env.isProduction && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(normalized)) {
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
  return res.status(200).json({
    success: true,
    message: 'HR Management API is running'
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
        logger.info(`HR Management Server is running in [${env.nodeEnv}] mode on port ${env.port}`);
        logger.info(`Health check available at http://localhost:${env.port}/api/health`);
        logger.info(`Socket.IO real-time chat gateway active on port ${env.port}`);
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

module.exports = { app, server, io, socketService };
