const validator = require('validator');

/**
 * Canonical form used for storing and looking up emails: trimmed + lowercased.
 *
 * NOTE: We intentionally do NOT use express-validator's normalizeEmail() here.
 * Its defaults strip dots and "+tags" from Gmail addresses
 * (john.doe@gmail.com -> johndoe@gmail.com), which made accounts stored with
 * the real address impossible to find at login ("Invalid email or password").
 */
const normalizeEmailAddress = (email) => String(email || '').trim().toLowerCase();

/**
 * The form older versions of the API stored emails in (express-validator's
 * default normalizeEmail()). Used only for backward-compatible lookups so that
 * accounts created before this fix can still sign in.
 */
const legacyNormalizedEmail = (email) => {
  const canonical = normalizeEmailAddress(email);
  if (!canonical) return '';
  const legacy = validator.normalizeEmail(canonical);
  return legacy || canonical;
};

/**
 * All stored forms an email could have, exact form first.
 */
const emailLookupCandidates = (email) => {
  const canonical = normalizeEmailAddress(email);
  if (!canonical) return [];
  return Array.from(new Set([canonical, legacyNormalizedEmail(canonical)]));
};

/**
 * Find a single document by email, preferring an exact match over a legacy one.
 */
const findOneByEmail = async (Model, email, projection = '') => {
  const candidates = emailLookupCandidates(email);
  if (!candidates.length) return null;
  let query = Model.find({ email: { $in: candidates } });
  if (projection) query = query.select(projection);
  const docs = await query;
  if (!docs.length) return null;
  return docs.find((d) => d.email === candidates[0]) || docs[0];
};

// Permissive but sane email shape: allows "+", long TLDs (.info, .technology), sub-domains.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = {
  normalizeEmailAddress,
  legacyNormalizedEmail,
  emailLookupCandidates,
  findOneByEmail,
  EMAIL_REGEX
};
