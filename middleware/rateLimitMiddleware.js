const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const env = require('../config/env');
const { normalizeEmailAddress } = require('../utils/email');

const tooMany = (req, res) => res.status(429).json({
  success: false,
  message: 'Too many attempts. Please wait 15 minutes and try again.'
});

// Keyed by IP + email so one office (shared NAT IP) is not locked out together,
// while repeated guesses against a single account are still throttled.
const keyByIpAndEmail = (req) => `${ipKeyGenerator(req.ip || '')}|${normalizeEmailAddress(req.body?.email)}`;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true, // only failed logins count
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: keyByIpAndEmail,
  skip: () => env.nodeEnv === 'test',
  handler: tooMany
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: keyByIpAndEmail,
  skip: () => env.nodeEnv === 'test',
  handler: tooMany
});

module.exports = { loginLimiter, passwordResetLimiter };
