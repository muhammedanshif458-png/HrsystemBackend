const { sendSuccess } = require('../utils/response');
const birthdayTodayService = require('../services/birthdayTodayService');

async function getToday(req, res, next) {
  try {
    const result = await birthdayTodayService.getTodaysBirthdays();
    return sendSuccess(res, "Today's birthdays fetched successfully", result);
  } catch (error) {
    return next(error);
  }
}

module.exports = { getToday };
