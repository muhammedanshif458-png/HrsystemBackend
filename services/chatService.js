const mongoose = require('mongoose');
const DepartmentChatMessage = require('../models/DepartmentChatMessage');
const Employee = require('../models/Employee');
const DepartmentChatUserState = require('../models/DepartmentChatUserState');
const { AppError } = require('../middleware/errorMiddleware');

class ChatService {
  /**
   * Normalize department key to canonical identifier ('tech', 'telecalling', etc.)
   */
  normalizeDeptKey(deptKey) {
    if (!deptKey || typeof deptKey !== 'string') return 'tech';
    const key = deptKey.trim().toLowerCase();
    if (key.includes('tech') || key.includes('engineer')) return 'tech';
    if (key.includes('tele') || key.includes('call') || key.includes('client')) return 'telecalling';
    if (key.includes('human') || key === 'hr') return 'hr';
    return key.replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
  }

  /**
   * Derive staff member's authorized department from database
   */
  async getStaffAuthorizedDepartment(user) {
    if (user.role !== 'STAFF') {
      return null;
    }
    const employee = await Employee.findOne({ user: user._id, isDeleted: { $ne: true } });
    if (!employee) {
      throw new AppError('Employee profile not found for this staff account', 404);
    }
    if (employee.status !== 'ACTIVE') {
      throw new AppError(`Cannot access department chat. Employee status is currently: ${employee.status}`, 403);
    }

    const canonicalDeptKey = this.normalizeDeptKey(employee.department);
    return {
      employee,
      departmentName: employee.department,
      departmentKey: canonicalDeptKey
    };
  }

  /**
   * Format message for consistent API and WebSocket consumption
   */
  formatMessage(m, clientMessageId = null) {
    const id = m._id ? m._id.toString() : (m.id || '');
    const ts = m.timestamp instanceof Date ? m.timestamp.toISOString() : new Date(m.timestamp || m.createdAt || Date.now()).toISOString();
    const created = m.createdAt instanceof Date ? m.createdAt.toISOString() : ts;

    const formatted = {
      id,
      _id: id,
      departmentKey: m.departmentKey,
      conversationType: m.conversationType || 'DEPARTMENT',
      senderId: m.senderId ? m.senderId.toString() : '',
      senderName: m.senderName || '',
      senderRole: m.senderRole || 'STAFF',
      senderUser: m.senderUser ? m.senderUser.toString() : null,
      senderEmployee: m.senderEmployee ? m.senderEmployee.toString() : null,
      receiverId: m.receiverId || '',
      text: m.deletedForEveryone ? 'This message was deleted' : m.text,
      message: m.deletedForEveryone ? 'This message was deleted' : m.text,
      timestamp: ts,
      createdAt: created,
      isRead: Boolean(m.isRead),
      deletedForEveryone: Boolean(m.deletedForEveryone)
    };

    if (clientMessageId) {
      formatted.clientMessageId = clientMessageId;
    }

    return formatted;
  }

  async assertDepartmentAccess(deptKey, user) {
    const normalizedKey = this.normalizeDeptKey(deptKey);
    if (!['STAFF', 'HR', 'SUPER_ADMIN'].includes(user.role)) throw new AppError('Unauthorized', 403);
    if (user.role === 'STAFF') {
      const staffInfo = await this.getStaffAuthorizedDepartment(user);
      if (normalizedKey !== staffInfo.departmentKey) throw new AppError(`Unauthorized: You can only access the chat for your own department (${staffInfo.departmentKey})`, 403);
    }
    return normalizedKey;
  }

  /**
   * Get department messages with pagination and authorization
   */
  async getDepartmentMessages(deptKey, user, { limit = 50, page = 1, before = null } = {}) {
    const normalizedKey = this.normalizeDeptKey(deptKey);
    const userId = user._id.toString();

    await this.assertDepartmentAccess(normalizedKey, user);

    const parsedLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const state = await DepartmentChatUserState.findOne({ userId: user._id, departmentKey: normalizedKey }).lean();
    // Include globally deleted tombstones but never leak their original content.
    const query = {
      $or: [{ conversationType: 'DEPARTMENT' }, { conversationType: { $exists: false } }],
      departmentKey: normalizedKey,
      deletedByIds: { $ne: userId }
    };

    if (state?.clearedThroughTimestamp && state?.clearedThroughMessageId) {
      query.$and = [{ $or: [
        { timestamp: { $gt: state.clearedThroughTimestamp } },
        { timestamp: state.clearedThroughTimestamp, _id: { $gt: state.clearedThroughMessageId } }
      ] }];
    }

    if (before) {
      const beforeDate = new Date(before);
      if (!isNaN(beforeDate.getTime())) {
        query.timestamp = { ...(query.timestamp || {}), $lt: beforeDate };
      }
    }

    const [rawMessages, total] = await Promise.all([
      DepartmentChatMessage.find(query)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(parsedLimit)
        .lean(),
      DepartmentChatMessage.countDocuments(query)
    ]);

    // Reverse to present chronological order (oldest to newest)
    const messages = rawMessages.reverse().map((m) => this.formatMessage(m));
    const totalPages = Math.ceil(total / parsedLimit) || 1;

    const pagination = {
      page: parsedPage,
      limit: parsedLimit,
      total,
      totalPages,
      hasMore: parsedPage < totalPages,
      departmentKey: normalizedKey
    };

    return { messages, pagination };
  }

  /**
   * Get messages for the authenticated staff member's department
   */
  async getStaffDepartmentMessages(user, query = {}) {
    const staffInfo = await this.getStaffAuthorizedDepartment(user);
    return await this.getDepartmentMessages(staffInfo.departmentKey, user, query);
  }

  async clearDepartmentChat(deptKey, user) {
    const normalizedKey = await this.assertDepartmentAccess(deptKey, user);
    const clearedAt = new Date();
    const latestMessage = await DepartmentChatMessage.findOne({
      $or: [{ conversationType: 'DEPARTMENT' }, { conversationType: { $exists: false } }],
      departmentKey: normalizedKey
    }).sort({ timestamp: -1, _id: -1 }).select('_id timestamp').lean();
    await DepartmentChatUserState.findOneAndUpdate(
      { userId: user._id, departmentKey: normalizedKey },
      { $set: { clearedAt, clearedThroughTimestamp: latestMessage?.timestamp || null, clearedThroughMessageId: latestMessage?._id || null } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return { message: 'Department chat cleared for current user', departmentKey: normalizedKey, clearedAt: clearedAt.toISOString() };
  }

  async searchDepartmentMessages(deptKey, user, { q, limit = 50, page = 1 } = {}) {
    const normalizedKey = await this.assertDepartmentAccess(deptKey, user);
    const term = typeof q === 'string' ? q.trim() : '';
    if (!term) throw new AppError('Search query is required', 400);
    if (term.length > 100) throw new AppError('Search query cannot exceed 100 characters', 400);
    const parsedLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const state = await DepartmentChatUserState.findOne({ userId: user._id, departmentKey: normalizedKey }).lean();
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const query = {
      $or: [{ conversationType: 'DEPARTMENT' }, { conversationType: { $exists: false } }],
      departmentKey: normalizedKey,
      deletedByIds: { $ne: user._id.toString() },
      deletedForEveryone: false,
      text: { $regex: escaped, $options: 'i' }
    };
    if (state?.clearedThroughTimestamp && state?.clearedThroughMessageId) {
      query.$and = [{ $or: [
        { timestamp: { $gt: state.clearedThroughTimestamp } },
        { timestamp: state.clearedThroughTimestamp, _id: { $gt: state.clearedThroughMessageId } }
      ] }];
    }
    const [rows, total] = await Promise.all([
      DepartmentChatMessage.find(query).sort({ timestamp: -1 }).skip((parsedPage - 1) * parsedLimit).limit(parsedLimit).lean(),
      DepartmentChatMessage.countDocuments(query)
    ]);
    const totalPages = Math.ceil(total / parsedLimit) || 1;
    return { messages: rows.reverse().map((m) => this.formatMessage(m)), pagination: { page: parsedPage, limit: parsedLimit, total, totalPages, hasMore: parsedPage < totalPages, departmentKey: normalizedKey, query: term } };
  }

  async getCompanyMessages(user, { limit = 50, page = 1, before = null } = {}) {
    if (!['STAFF', 'HR', 'SUPER_ADMIN'].includes(user.role)) throw new AppError('Unauthorized', 403);
    if (user.role === 'STAFF') await this.getStaffAuthorizedDepartment(user);
    const parsedLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const query = { conversationType: 'COMPANY', deletedForEveryone: false, deletedByIds: { $ne: user._id.toString() } };
    if (before && !Number.isNaN(new Date(before).getTime())) query.timestamp = { $lt: new Date(before) };
    const [rows, total] = await Promise.all([
      DepartmentChatMessage.find(query).sort({ timestamp: -1 }).skip((parsedPage - 1) * parsedLimit).limit(parsedLimit).lean(),
      DepartmentChatMessage.countDocuments(query)
    ]);
    const totalPages = Math.ceil(total / parsedLimit) || 1;
    return { messages: rows.reverse().map((m) => this.formatMessage(m)), pagination: { page: parsedPage, limit: parsedLimit, total, totalPages, hasMore: parsedPage < totalPages, conversationType: 'COMPANY', conversationId: 'company' } };
  }

  async sendCompanyMessage(text, user, options = {}) {
    if (!['STAFF', 'HR', 'SUPER_ADMIN'].includes(user.role)) throw new AppError('Unauthorized', 403);
    const employee = user.role === 'STAFF' ? (await this.getStaffAuthorizedDepartment(user)).employee : null;
    const cleanText = typeof text === 'string' ? text.trim() : '';
    if (!cleanText) throw new AppError('Message text cannot be empty', 400);
    if (cleanText.length > 2000) throw new AppError('Message text cannot exceed 2000 characters', 400);
    const message = await DepartmentChatMessage.create({ conversationType: 'COMPANY', departmentKey: 'company', senderId: employee ? employee._id.toString() : user._id.toString(), senderUser: user._id, senderEmployee: employee?._id || null, senderRole: user.role, senderName: employee ? `${employee.firstName || ''} ${employee.lastName || ''}`.trim() : `${user.firstName || ''} ${user.lastName || ''}`.trim(), text: cleanText });
    const formatted = this.formatMessage(message, options.clientMessageId);
    require('./socketService').emitCompanyNewMessage(formatted);
    return formatted;
  }

  /**
   * Send a department message with server-side identity validation
   */
  async sendDepartmentMessage(deptKey, text, user, customSenderName = null, options = {}) {
    if (!text || typeof text !== 'string' || text.trim() === '') {
      throw new AppError('Message text cannot be empty', 400);
    }
    const cleanText = text.trim();
    if (cleanText.length > 2000) {
      throw new AppError('Message text cannot exceed 2000 characters', 400);
    }

    let normalizedKey = this.normalizeDeptKey(deptKey);
    let senderId = user._id.toString();
    let senderName = customSenderName;
    let senderEmployee = null;
    let senderRole = user.role;

    // Server-side identity and department enforcement for STAFF
    if (user.role === 'STAFF') {
      const staffInfo = await this.getStaffAuthorizedDepartment(user);
      if (deptKey && this.normalizeDeptKey(deptKey) !== staffInfo.departmentKey) {
        throw new AppError(
          `Unauthorized: You can only send messages to your authorized department (${staffInfo.departmentKey})`,
          403
        );
      }
      normalizedKey = staffInfo.departmentKey;
      senderEmployee = staffInfo.employee._id;
      senderId = staffInfo.employee._id.toString();
      senderName = `${staffInfo.employee.firstName || ''} ${staffInfo.employee.lastName || ''}`.trim() || 'Staff';
      senderRole = 'STAFF';
    } else {
      // HR or SUPER_ADMIN
      if (!senderName) {
        senderName = `${user.firstName || 'HR'} ${user.lastName || 'Admin'}`.trim();
      }
      // Check if this HR user also has an Employee document to link
      const empDoc = await Employee.findOne({ user: user._id });
      if (empDoc) {
        senderEmployee = empDoc._id;
      }
      senderRole = user.role;
    }

    const message = new DepartmentChatMessage({
      departmentKey: normalizedKey,
      senderId,
      senderUser: user._id,
      senderEmployee,
      senderRole,
      senderName,
      text: cleanText,
      timestamp: new Date(),
      isRead: false,
      deletedForEveryone: false,
      deletedByIds: []
    });

    await message.save();

    const formattedMessage = this.formatMessage(message, options.clientMessageId);

    // Broadcast to department room via Socket.IO
    try {
      const socketService = require('./socketService');
      socketService.emitNewMessage(normalizedKey, formattedMessage);
    } catch (_) {}

    return formattedMessage;
  }

  /**
   * Send a message from authenticated staff member
   */
  async sendStaffDepartmentMessage(text, user, options = {}) {
    const staffInfo = await this.getStaffAuthorizedDepartment(user);
    return await this.sendDepartmentMessage(staffInfo.departmentKey, text, user, null, options);
  }

  /**
   * Delete message for user (hide from user view)
   */
  async deleteMessageForMe(messageId, user, expectedDeptKey = null) {
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      throw new AppError('Invalid message ID', 400);
    }

    const message = await DepartmentChatMessage.findById(messageId);
    if (!message) {
      throw new AppError('Message not found', 404);
    }

    if (message.conversationType === 'DEPARTMENT' || !message.conversationType) {
      if (expectedDeptKey && this.normalizeDeptKey(expectedDeptKey) !== message.departmentKey) {
        throw new AppError('Message not found', 404);
      }
      await this.assertDepartmentAccess(message.departmentKey, user);
    } else if (message.conversationType !== 'COMPANY') {
      throw new AppError('Message not found', 404);
    }
    const idStr = user._id.toString();
    if (!message.deletedByIds.includes(idStr)) {
      message.deletedByIds.push(idStr);
      await message.save();
    }

    return { message: 'Message deleted for user successfully' };
  }

  /**
   * Delete message for everyone (soft tombstone)
   */
  async deleteMessageForEveryone(messageId, user, expectedDeptKey = null) {
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      throw new AppError('Invalid message ID', 400);
    }

    const message = await DepartmentChatMessage.findById(messageId);
    if (!message) {
      throw new AppError('Message not found', 404);
    }

    if (message.conversationType === 'DEPARTMENT' || !message.conversationType) {
      if (expectedDeptKey && this.normalizeDeptKey(expectedDeptKey) !== message.departmentKey) {
        throw new AppError('Message not found', 404);
      }
      await this.assertDepartmentAccess(message.departmentKey, user);
    } else if (message.conversationType !== 'COMPANY') {
      throw new AppError('Message not found', 404);
    }

    if (message.conversationType === 'DEPARTMENT' || !message.conversationType) {
      let isOriginalSender = message.senderUser?.toString() === user._id.toString();

      // Preserve deletion for legacy department messages that predate senderUser.
      if (!isOriginalSender && !message.senderUser) {
        if (message.senderRole === 'STAFF') {
          const originalEmployeeId = message.senderEmployee || message.senderId;
          isOriginalSender = Boolean(await Employee.exists({ _id: originalEmployeeId, user: user._id }));
        } else {
          isOriginalSender = message.senderId === user._id.toString();
        }
      }

      if (!isOriginalSender) {
        throw new AppError('Only the original sender can delete a department message for everyone', 403);
      }
    } else if (user.role !== 'HR' && user.role !== 'SUPER_ADMIN') {
      // Keep the existing company-chat moderation behavior unchanged.
      const empDoc = await Employee.findOne({ user: user._id });
      const isOwner =
        (message.senderUser && message.senderUser.toString() === user._id.toString()) ||
        (empDoc && message.senderEmployee && message.senderEmployee.toString() === empDoc._id.toString()) ||
        message.senderId === user._id.toString() ||
        (empDoc && message.senderId === empDoc._id.toString());
      if (!isOwner) throw new AppError('Only the sender or an HR manager can delete a message for everyone', 403);
    }

    message.deletedForEveryone = true;
    message.deletedForEveryoneBy = user._id;
    message.deletedForEveryoneAt = new Date();
    message.deletedAt = message.deletedForEveryoneAt;
    message.deletedBy = user._id;
    await message.save();

    // Broadcast deletion event to room
    try {
      const socketService = require('./socketService');
      const emitDeleted = message.conversationType === 'COMPANY' ? socketService.emitCompanyMessageDeleted : socketService.emitMessageDeleted;
      emitDeleted.call(socketService, message.departmentKey, {
        messageId: message._id.toString(),
        conversationType: message.conversationType || 'DEPARTMENT',
        conversationId: message.conversationType === 'COMPANY' ? 'company' : message.departmentKey,
        departmentKey: message.departmentKey,
        deletedForEveryone: true
      });
    } catch (_) {}

    return { message: 'Message deleted for everyone successfully' };
  }
}

module.exports = new ChatService();
