/**
 * Password Policy and Security Validator
 *
 * Requirements:
 * 1. 16 to 72 UTF-8 bytes (Bcrypt safely processes up to 72 bytes max).
 * 2. Reject edge whitespace (leading/trailing whitespace) and ASCII control characters.
 * 3. Require at least three character classes out of four:
 *    - Uppercase letters (A-Z)
 *    - Lowercase letters (a-z)
 *    - Digits (0-9)
 *    - Special characters / symbols
 * 4. Forbid default/insecure passwords (e.g., 'hrAdmin', 'Password@123', etc.)
 */

function validatePasswordPolicy(password) {
  if (typeof password !== 'string') {
    return {
      isValid: false,
      message: 'Password must be a valid string.'
    };
  }

  // 1. Check for edge whitespace (leading or trailing whitespace)
  if (password !== password.trim()) {
    return {
      isValid: false,
      message: 'Password must not begin or end with whitespace.'
    };
  }

  // 2. Reject control characters (ASCII 0x00 - 0x1F and 0x7F)
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(password)) {
    return {
      isValid: false,
      message: 'Password must not contain control characters.'
    };
  }

  // 3. UTF-8 byte length calculation (Buffer.byteLength in Node.js)
  const byteLength = Buffer.byteLength(password, 'utf8');

  if (byteLength < 16) {
    return {
      isValid: false,
      message: 'Password must be at least 16 bytes/characters long.'
    };
  }

  if (byteLength > 72) {
    return {
      isValid: false,
      message: 'Password must not exceed 72 bytes (Bcrypt truncation limit).'
    };
  }

  // 4. Character class count: check at least 3 of 4 classes
  let classCount = 0;
  if (/[A-Z]/.test(password)) classCount++;
  if (/[a-z]/.test(password)) classCount++;
  if (/[0-9]/.test(password)) classCount++;
  // Special characters: anything that is not alphanumeric or whitespace
  if (/[^A-Za-z0-9\s]/.test(password)) classCount++;

  if (classCount < 3) {
    return {
      isValid: false,
      message: 'Password must contain characters from at least three categories: uppercase, lowercase, numbers, and special characters.'
    };
  }

  // 5. Explicit blacklist of known default or weak values
  const normalized = password.toLowerCase();
  const forbiddenPatterns = ['hradmin', 'password@123', 'admin@123', 'changeme'];
  for (const pattern of forbiddenPatterns) {
    if (normalized === pattern) {
      return {
        isValid: false,
        message: 'This password is too common or reserved and cannot be used.'
      };
    }
  }

  return {
    isValid: true,
    message: 'Password meets all security policy requirements.'
  };
}

module.exports = {
  validatePasswordPolicy
};
