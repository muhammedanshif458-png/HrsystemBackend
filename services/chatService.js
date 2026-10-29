const mongoose = require('mongoose');
const DepartmentChatMessage = require('../models/DepartmentChatMessage');
const Employee = require('../models/Employee');
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
      senderId: m.senderId ? m.senderId.toString() : '',
      senderName: m.senderName || '',
      senderRole: m.senderRole || 'STAFF',
      senderUser: m.senderUser ? m.senderUser.toString() : null,
      senderEmployee: m.senderEmployee ? m.senderEmployee.toString() : null,
      receiverId: m.receiverId || '',
      text: m.text,
      message: m.text, // alias for Flutter chat message compatibility
      timestamp: ts,
      createdAt: created,
      isRead: Boolean(m.isRead),
      deletedForEveryone: Boolean(m.deletedForEveryone),
      deletedByIds: (m.deletedByIds || []).map((id) => id.toString())
    };

    if (clientMessageId) {
      formatted.clientMessageId = clientMessageId;
    }

    return formatted;
  }

  /**
   * Get department messages with pagination and authorization
   */
  async getDepartmentMessages(deptKey, user, { limit = 50, page = 1, before = null } = {}) {
    const normalizedKey = this.normalizeDeptKey(deptKey);
    const userId = user._id.toString();

    // Staff access control: staff can ONLY access their own department
    if (user.role === 'STAFF') {
      const staffInfo = await this.getStaffAuthorizedDepartment(user);
      if (normalizedKey !== staffInfo.departmentKey) {
        throw new AppError(
          `Unauthorized: You can only access the chat for your own department (${staffInfo.departmentKey})`,
          403
        );
      }
    }

    const parsedLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const skip = (parsedPage - 1) * parsedLimit;

    // Base query: not deleted for everyone, and not deleted by this user
    const query = {
      departmentKey: normalizedKey,
      deletedForEveryone: false,
      deletedByIds: { $ne: userId }
    };

    if (before) {
      const beforeDate = new Date(before);
      if (!isNaN(beforeDate.getTime())) {
        query.timestamp = { $lt: beforeDate };
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
  async deleteMessageForMe(messageId, userId) {
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      throw new AppError('Invalid message ID', 400);
    }

    const message = await DepartmentChatMessage.findById(messageId);
    if (!message) {
      throw new AppError('Message not found', 404);
    }

    const idStr = userId.toString();
    if (!message.deletedByIds.includes(idStr)) {
      message.deletedByIds.push(idStr);
      await message.save();
    }

    return { message: 'Message deleted for user successfully' };
  }

  /**
   * Delete message for everyone (soft tombstone)
   */
  async deleteMessageForEveryone(messageId, user) {
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      throw new AppError('Invalid message ID', 400);
    }

    const message = await DepartmentChatMessage.findById(messageId);
    if (!message) {
      throw new AppError('Message not found', 404);
    }

    // Role check: HR and SUPER_ADMIN can delete any message; Staff can only delete own message
    if (user.role !== 'HR' && user.role !== 'SUPER_ADMIN') {
      const empDoc = await Employee.findOne({ user: user._id });
      const isOwner =
        (message.senderUser && message.senderUser.toString() === user._id.toString()) ||
        (empDoc && message.senderEmployee && message.senderEmployee.toString() === empDoc._id.toString()) ||
        message.senderId === user._id.toString() ||
        (empDoc && message.senderId === empDoc._id.toString());

      if (!isOwner) {
        throw new AppError('Only the sender or an HR manager can delete a message for everyone', 403);
      }
    }

    message.deletedForEveryone = true;
    message.deletedForEveryoneBy = user._id;
    message.deletedForEveryoneAt = new Date();
    await message.save();

    // Broadcast deletion event to room
    try {
      const socketService = require('./socketService');
      socketService.emitMessageDeleted(message.departmentKey, {
        messageId: message._id.toString(),
        departmentKey: message.departmentKey,
        deletedForEveryone: true
      });
    } catch (_) {}

    return { message: 'Message deleted for everyone successfully' };
  }
}

module.exports = new ChatService();
