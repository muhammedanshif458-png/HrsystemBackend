const mongoose = require('mongoose');
const DepartmentChatMessage = require('../models/DepartmentChatMessage');
const Employee = require('../models/Employee');
const { AppError } = require('../middleware/errorMiddleware');

class ChatService {
  /**
   * Normalize department key ('tech', 'telecalling')
   */
  normalizeDeptKey(deptKey) {
    if (!deptKey) return 'tech';
    const key = deptKey.trim().toLowerCase();
    if (key.includes('tech') || key.includes('engineering')) return 'tech';
    if (key.includes('tele') || key.includes('client')) return 'telecalling';
    return key;
  }

  /**
   * Get department messages
   */
  async getDepartmentMessages(deptKey, user, { limit = 100, page = 1 } = {}) {
    const normalizedKey = this.normalizeDeptKey(deptKey);
    const userId = user._id.toString();

    // Query messages that are NOT deleted for everyone and NOT deleted by this user
    const query = {
      departmentKey: normalizedKey,
      deletedForEveryone: false,
      deletedByIds: { $ne: userId }
    };

    const messages = await DepartmentChatMessage.find(query)
      .sort({ timestamp: 1 })
      .limit(parseInt(limit, 10))
      .lean();

    // Format for frontend ChatMessage compatibility
    return messages.map((m) => ({
      id: m._id.toString(),
      _id: m._id.toString(),
      senderId: m.senderId,
      senderName: m.senderName,
      receiverId: m.receiverId || '',
      departmentKey: m.departmentKey,
      text: m.text,
      timestamp: m.timestamp,
      isRead: m.isRead,
      deletedForEveryone: m.deletedForEveryone,
      deletedByIds: m.deletedByIds || []
    }));
  }

  /**
   * Send department message
   */
  async sendDepartmentMessage(deptKey, text, user, customSenderName = null) {
    if (!text || text.trim() === '') {
      throw new AppError('Message text cannot be empty', 400);
    }

    const normalizedKey = this.normalizeDeptKey(deptKey);
    let senderName = customSenderName;
    let senderId = user._id.toString();
    let empDoc = null;

    if (user.role === 'STAFF') {
      empDoc = await Employee.findOne({ user: user._id });
      if (empDoc) {
        senderId = empDoc._id.toString();
        senderName = `${empDoc.firstName || ''} ${empDoc.lastName || ''}`.trim();
      }
    } else if (!senderName) {
      senderName = `${user.firstName || 'HR'} ${user.lastName || 'Admin'}`.trim();
    }

    const message = new DepartmentChatMessage({
      departmentKey: normalizedKey,
      senderId,
      senderUser: user._id,
      senderEmployee: empDoc ? empDoc._id : null,
      senderName: senderName || 'User',
      text: text.trim(),
      timestamp: new Date(),
      isRead: false,
      deletedForEveryone: false,
      deletedByIds: []
    });

    await message.save();

    return {
      id: message._id.toString(),
      _id: message._id.toString(),
      senderId: message.senderId,
      senderName: message.senderName,
      departmentKey: message.departmentKey,
      text: message.text,
      timestamp: message.timestamp,
      isRead: message.isRead,
      deletedForEveryone: message.deletedForEveryone,
      deletedByIds: []
    };
  }

  /**
   * Delete message for me
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
   * Delete message for everyone (tombstone / soft delete)
   */
  async deleteMessageForEveryone(messageId, user) {
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      throw new AppError('Invalid message ID', 400);
    }

    const message = await DepartmentChatMessage.findById(messageId);
    if (!message) {
      throw new AppError('Message not found', 404);
    }

    // Role check: HR and SUPER_ADMIN can delete any message; Staff can only delete their own message
    if (user.role !== 'HR' && user.role !== 'SUPER_ADMIN') {
      const empDoc = await Employee.findOne({ user: user._id });
      const isOwner = (message.senderUser && message.senderUser.toString() === user._id.toString()) ||
                      (empDoc && message.senderEmployee && message.senderEmployee.toString() === empDoc._id.toString()) ||
                      (message.senderId === user._id.toString()) ||
                      (empDoc && message.senderId === empDoc._id.toString());
      if (!isOwner) {
        throw new AppError('Only the sender or an HR manager can delete a message for everyone', 403);
      }
    }

    message.deletedForEveryone = true;
    message.deletedForEveryoneBy = user._id;
    message.deletedForEveryoneAt = new Date();
    await message.save();

    return { message: 'Message deleted for everyone successfully' };
  }
}

module.exports = new ChatService();
