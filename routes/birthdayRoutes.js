const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const birthdayController = require('../controllers/birthdayController');

const router = express.Router();
router.get('/today', authMiddleware, roleMiddleware('STAFF', 'HR', 'SUPER_ADMIN'), birthdayController.getToday);

module.exports = router;
