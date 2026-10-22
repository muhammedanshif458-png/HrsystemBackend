const chatService = require('../services/chatService');
const { sendSuccess } = require('../utils/response');

class ChatController {
  /**
   * GET /api/hr/departments/:deptKey/messages
   * GET /api/staff/departments/:deptKey/messages
   */
  async getDepartmentMessages(req, res, next) {
    try {
      const { deptKey } = req.params;
      const { limit, page } = req.query;

      const messages = await chatService.getDepartmentMessages(deptKey, req.user, { limit, page });
      return sendSuccess(res, 'Department messages retrieved successfully', messages);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/hr/departments/:deptKey/messages
   * POST /api/staff/departments/:deptKey/messages
   */
  async sendDepartmentMessage(req, res, next) {
    try {
      const { deptKey } = req.params;
      const { text, message, senderName } = req.body;
      const messageText = text || message;

      const newMsg = await chatService.sendDepartmentMessage(deptKey, messageText, req.user, senderName);
      return sendSuccess(res, 'Message sent successfully', newMsg, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/hr/departments/:deptKey/messages/:messageId/delete-for-me
   * PATCH /api/staff/departments/:deptKey/messages/:messageId/delete-for-me
   */
  async deleteMessageForMe(req, res, next) {
    try {
      const { messageId } = req.params;
      const userId = req.body.userId || req.user._id;

      const result = await chatService.deleteMessageForMe(messageId, userId);
      return sendSuccess(res, result.message, null);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/hr/departments/:deptKey/messages/:messageId
   * DELETE /api/staff/departments/:deptKey/messages/:messageId
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
