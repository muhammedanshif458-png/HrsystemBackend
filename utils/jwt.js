const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');

const ALGORITHM = 'HS256';
const SIGN_OPTIONS = { algorithm: ALGORITHM };
const VERIFY_OPTIONS = { algorithms: [ALGORITHM] };

/**
 * Generate Access Token for authenticated user
 * @param {Object} user 
 * @returns {string} JWT access token
 */
const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id: user._id || user.id,
      email: user.email,
      role: user.role,
      tv: user.tokenVersion || 0
    },
    env.jwt.secret,
    { ...SIGN_OPTIONS, expiresIn: env.jwt.expiresIn }
  );
};

/**
 * Generate Temporary Access Token for users requiring password change
 * Restricted scope: password_change_only
 * @param {Object} user
 * @returns {string} JWT temporary access token
 */
const generateTemporaryToken = (user) => {
  return jwt.sign(
    {
      id: user._id || user.id,
      email: user.email,
      role: user.role,
      tv: user.tokenVersion || 0,
      scope: 'password_change_only'
    },
    env.jwt.secret,
    { ...SIGN_OPTIONS, expiresIn: '15m' }
  );
};

/**
 * Generate Refresh Token for authenticated user
 * @param {Object} user 
 * @returns {string} JWT refresh token
 */
const generateRefreshToken = (user) => {
  return jwt.sign(
    {
      id: user._id || user.id,
      tv: user.tokenVersion || 0,
      // Unique id so two refresh tokens issued in the same second still differ
      // (otherwise a rotated-out token would be identical to the new one).
      jti: crypto.randomUUID()
    },
    env.jwt.refreshSecret,
    { ...SIGN_OPTIONS, expiresIn: env.jwt.refreshExpiresIn }
  );
};

/**
 * Verify Access Token
 * @param {string} token 
 * @returns {Object} Decoded payload
 */
const verifyAccessToken = (token) => {
  return jwt.verify(token, env.jwt.secret, VERIFY_OPTIONS);
};

/**
 * Verify Refresh Token
 * @param {string} token 
 * @returns {Object} Decoded payload
 */
const verifyRefreshToken = (token) => {
  return jwt.verify(token, env.jwt.refreshSecret, VERIFY_OPTIONS);
};

/**
 * Generate a secure random password reset token and hash
 * @returns {{ token: string, hashedToken: string, expires: Date }}
 */
const generateResetToken = () => {
  const token = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  // Token expires in 1 hour
  const expires = new Date(Date.now() + 60 * 60 * 1000);

  return { token, hashedToken, expires };
};

/**
 * Hash a given token with sha256
 * @param {string} token
 * @returns {string}
 */
const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Shared post-verification checks for a decoded access token and its user.
 * Used by the REST auth middlewares and the Socket.IO handshake so they can
 * never drift apart.
 * @returns {null | { status: number, message: string }} null when the token is acceptable
 */
const getTokenRejection = (decoded, user, { allowPasswordChangeOnly = false } = {}) => {
  if (!user) {
    return { status: 401, message: 'User belonging to this token no longer exists.' };
  }
  if (!user.isActive) {
    return { status: 403, message: 'Your account has been deactivated. Please contact HR.' };
  }
  // Tokens issued before the last password change/reset are revoked.
  if ((decoded.tv || 0) !== (user.tokenVersion || 0)) {
    return { status: 401, message: 'Session expired because the password was changed. Please login again.' };
  }
  if (!allowPasswordChangeOnly) {
    if (decoded.scope === 'password_change_only') {
      return { status: 403, message: 'Temporary session: you must change your password before accessing system resources.' };
    }
    if (user.mustChangePassword) {
      return { status: 403, message: 'Password change required. Please change your password to continue.' };
    }
  }
  return null;
};

module.exports = {
  getTokenRejection,
  generateAccessToken,
  generateTemporaryToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateResetToken,
  hashToken
};
