const chatService = require('../services/chatService');
const { sendSuccess } = require('../utils/response');

class ChatController {
  async getCompanyMessages(req, res, next) {
    try {
      const { messages, pagination } = await chatService.getCompanyMessages(req.user, req.query);
      return sendSuccess(res, 'Company messages retrieved successfully', messages, 200, pagination);
    } catch (err) { next(err); }
  }

  async sendCompanyMessage(req, res, next) {
    try {
      const data = await chatService.sendCompanyMessage(req.body.text || req.body.message, req.user, { clientMessageId: req.body.clientMessageId });
      return sendSuccess(res, 'Company message sent successfully', data, 201);
    } catch (err) { next(err); }
  }

  getCompanyConversation(req, res) {
    return sendSuccess(res, 'Company conversation retrieved successfully', { conversationType: 'COMPANY', conversationId: 'company', participantRoles: ['STAFF', 'HR', 'SUPER_ADMIN'] });
  }
  /**
   * GET /api/hr/departments/:deptKey/messages
   * GET /api/hr/departments/:departmentKey/messages
   * GET /api/staff/departments/:deptKey/messages
   */
  async getDepartmentMessages(req, res, next) {
    try {
      const deptKey = req.params.deptKey || req.params.departmentKey;
      const { limit, page, before } = req.query;

      const { messages, pagination } = await chatService.getDepartmentMessages(deptKey, req.user, { limit, page, before });
      return sendSuccess(res, 'Department messages retrieved successfully', messages, 200, pagination);
    } catch (err) {
      next(err);
    }
  }

  async clearDepartmentChat(req, res, next) {
    try {
      const deptKey = req.params.deptKey || req.params.departmentKey;
      const result = await chatService.clearDepartmentChat(deptKey, req.user);
      return sendSuccess(res, result.message, result);
    } catch (err) { next(err); }
  }

  async searchDepartmentMessages(req, res, next) {
    try {
      const deptKey = req.params.deptKey || req.params.departmentKey;
      const { messages, pagination } = await chatService.searchDepartmentMessages(deptKey, req.user, req.query);
      return sendSuccess(res, 'Department messages searched successfully', messages, 200, pagination);
    } catch (err) { next(err); }
  }

  async clearStaffDepartmentChat(req, res, next) {
    try {
      const staffInfo = await chatService.getStaffAuthorizedDepartment(req.user);
      const result = await chatService.clearDepartmentChat(staffInfo.departmentKey, req.user);
      return sendSuccess(res, result.message, result);
    } catch (err) { next(err); }
  }

  async searchStaffDepartmentMessages(req, res, next) {
    try {
      const staffInfo = await chatService.getStaffAuthorizedDepartment(req.user);
      const { messages, pagination } = await chatService.searchDepartmentMessages(staffInfo.departmentKey, req.user, req.query);
      return sendSuccess(res, 'Department messages searched successfully', messages, 200, pagination);
    } catch (err) { next(err); }
  }

  /**
   * POST /api/hr/departments/:deptKey/messages
   * POST /api/hr/departments/:departmentKey/messages
   * POST /api/staff/departments/:deptKey/messages
   */
  async sendDepartmentMessage(req, res, next) {
    try {
      const deptKey = req.params.deptKey || req.params.departmentKey;
      const { text, message, senderName, clientMessageId } = req.body;
      const messageText = text || message;

      const newMsg = await chatService.sendDepartmentMessage(
        deptKey,
        messageText,
        req.user,
        senderName,
        { clientMessageId }
      );
      return sendSuccess(res, 'Message sent successfully', newMsg, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/staff/chat/messages
   * Retrieve the authenticated staff member's department messages
   */
  async getStaffMessages(req, res, next) {
    try {
      const { limit, page, before } = req.query;
      const { messages, pagination } = await chatService.getStaffDepartmentMessages(req.user, { limit, page, before });
      return sendSuccess(res, 'Staff department messages retrieved successfully', messages, 200, pagination);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/staff/chat/messages
   * Send a message to the authenticated staff member's department conversation
   */
  async sendStaffMessage(req, res, next) {
    try {
      const { text, message, clientMessageId } = req.body;
      const messageText = text || message;

      const newMsg = await chatService.sendStaffDepartmentMessage(
        messageText,
        req.user,
        { clientMessageId }
      );
      return sendSuccess(res, 'Message sent successfully', newMsg, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/hr/departments/:deptKey/messages/:messageId/delete-for-me
   * PATCH /api/staff/departments/:deptKey/messages/:messageId/delete-for-me
   * PATCH /api/staff/chat/messages/:messageId/delete-for-me
   */
  async deleteMessageForMe(req, res, next) {
    try {
      const { messageId } = req.params;
      const userId = req.user._id;

      const result = await chatService.deleteMessageForMe(messageId, req.user);
      return sendSuccess(res, result.message, null);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/hr/departments/:deptKey/messages/:messageId
   * DELETE /api/staff/departments/:deptKey/messages/:messageId
   * DELETE /api/staff/chat/messages/:messageId
   */
  async deleteMessageForEveryone(req, res, next) {
    try {
      const { messageId } = req.params;

      const result = await chatService.deleteMessageForEveryone(messageId, req.user);
      return sendSuccess(res, result.message, null);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new ChatController();
