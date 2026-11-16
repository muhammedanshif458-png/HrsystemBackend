const { Server: SocketIOServer } = require('socket.io');
const jwt = require('jsonwebtoken');
const { verifyAccessToken } = require('../utils/jwt');
const env = require('../config/env');
const User = require('../models/User');
const Employee = require('../models/Employee');
const logger = require('../utils/logger');

let io = null;

class SocketService {
  /**
   * Initialize Socket.IO instance on an HTTP server
   */
  initSocket(httpServer, corsOptions = {}) {
    io = new SocketIOServer(httpServer, {
      cors: {
        origin: corsOptions.origin || '*',
        credentials: true,
        methods: ['GET', 'POST']
      },
      pingTimeout: 30000,
      pingInterval: 15000
    });

    // Lazy load chatService to avoid circular dependency
    const getChatService = () => require('./chatService');

    // Authentication middleware
    io.use(async (socket, next) => {
      try {
        const rawToken =
          socket.handshake.auth?.token ||
          socket.handshake.headers?.authorization ||
          socket.handshake.query?.token;

        if (!rawToken) {
          return next(new Error('Authentication error: Missing token'));
        }

        const token = rawToken.startsWith('Bearer ') ? rawToken.slice(7).trim() : rawToken.trim();
        const decoded = verifyAccessToken(token);

        const user = await User.findById(decoded.id).select('+role');
        if (!user || !user.isActive) {
          return next(new Error('Authentication error: User inactive or not found'));
        }

        socket.user = user;

        if (user.role === 'STAFF') {
          const employee = await Employee.findOne({ user: user._id, isDeleted: { $ne: true } });
          if (!employee || employee.status !== 'ACTIVE') {
            return next(new Error('Authentication error: Staff profile inactive or not found'));
          }
          socket.employee = employee;
          socket.departmentKey = getChatService().normalizeDeptKey(employee.department);
        }

        next();
      } catch (err) {
        logger.warn(`Socket authentication failed: ${err.message}`);
        return next(new Error(`Authentication error: ${err.message}`));
      }
    });

    // Connection handler
    io.on('connection', (socket) => {
      const user = socket.user;
      const role = user.role;
      const chatService = getChatService();

      // Automatically join authorized staff member's department room
      if (role === 'STAFF' && socket.departmentKey) {
        const room = `department:${socket.departmentKey}`;
        socket.join(room);
        socket.emit('joined_room', {
          departmentKey: socket.departmentKey,
          room,
          autoJoined: true
        });
      }

      socket.join('company');
      socket.emit('joined_room', { conversationType: 'COMPANY', conversationId: 'company', room: 'company', autoJoined: true });

      // Explicit join_department request (HR switching departments or staff joining)
      socket.on('join_department', ({ departmentKey }, callback) => {
        try {
          const canonicalKey = chatService.normalizeDeptKey(departmentKey);
          if (!canonicalKey) {
            throw new Error('Valid department key is required');
          }

          if (role === 'STAFF' && canonicalKey !== socket.departmentKey) {
            const errMessage = `Unauthorized: You can only join your authorized department chat (${socket.departmentKey})`;
            if (typeof callback === 'function') callback({ success: false, error: errMessage });
            return socket.emit('error', { message: errMessage });
          }

          const room = `department:${canonicalKey}`;
          socket.join(room);

          if (typeof callback === 'function') {
            callback({ success: true, departmentKey: canonicalKey, room });
          }
          socket.emit('joined_room', { departmentKey: canonicalKey, room });
        } catch (err) {
          if (typeof callback === 'function') callback({ success: false, error: err.message });
          socket.emit('error', { message: err.message });
        }
      });

      // Send message via Socket.IO
      socket.on('send_message', async (data, callback) => {
        try {
          if (String(data?.conversationType || '').toUpperCase() === 'COMPANY' || data?.conversationId === 'company') {
            const savedMsg = await chatService.sendCompanyMessage(data?.text || data?.message, user, { clientMessageId: data?.clientMessageId || data?.tempId });
            if (typeof callback === 'function') callback({ success: true, data: savedMsg });
            return;
          }
          let targetDeptKey = data?.departmentKey || data?.deptKey;
          if (role === 'STAFF') {
            targetDeptKey = socket.departmentKey;
          } else {
            targetDeptKey = chatService.normalizeDeptKey(targetDeptKey);
          }

          if (!targetDeptKey) {
            throw new Error('Department key is required to send message');
          }

          if (role === 'STAFF' && targetDeptKey !== socket.departmentKey) {
            throw new Error(`Unauthorized to send messages to ${targetDeptKey}`);
          }

          const text = data?.text || data?.message;
          const savedMsg = await chatService.sendDepartmentMessage(
            targetDeptKey,
            text,
            user,
            null,
            { clientMessageId: data?.clientMessageId || data?.tempId }
          );

          if (typeof callback === 'function') {
            callback({ success: true, data: savedMsg });
          }
        } catch (err) {
          if (typeof callback === 'function') {
            callback({ success: false, error: err.message });
          } else {
            socket.emit('error', { message: err.message });
          }
        }
      });

      // Leave department room
      socket.on('leave_department', ({ departmentKey }, callback) => {
        const canonicalKey = chatService.normalizeDeptKey(departmentKey);
        socket.leave(`department:${canonicalKey}`);
        if (typeof callback === 'function') {
          callback({ success: true, departmentKey: canonicalKey });
        }
      });

      socket.on('disconnect', () => {
        // Handled cleanly
      });
    });

    return io;
  }

  /**
   * Broadcast a newly persisted message to the canonical department room
   */
  emitNewMessage(deptKey, formattedMessage) {
    if (!io) return;
    const room = `department:${deptKey}`;
    // Emit both canonical 'new_message' and 'message_received' for Flutter compatibility
    io.to(room).emit('new_message', formattedMessage);
    io.to(room).emit('message_received', formattedMessage);
  }

  /**
   * Broadcast message deletion event to the canonical department room
   */
  emitMessageDeleted(deptKey, data) {
    if (!io) return;
    const room = `department:${deptKey}`;
    io.to(room).emit('message_deleted', data);
  }

  emitCompanyNewMessage(message) {
    if (!io) return;
    io.to('company').emit('new_message', message);
    io.to('company').emit('message_received', message);
  }

  emitCompanyMessageDeleted(_key, data) {
    if (!io) return;
    io.to('company').emit('message_deleted', data);
  }

  /**
   * Get the current Socket.IO server instance
   */
  getIO() {
    return io;
  }
}

module.exports = new SocketService();
