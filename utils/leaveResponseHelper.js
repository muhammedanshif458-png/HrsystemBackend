/**
 * Leave Response Helper
 *
 * Enriches leave response objects with computed fields needed by both
 * the StaffHub Flutter app (hr-core) and the HR Management Dashboard.
 *
 * Both clients need:
 * - An authenticated download URL (not a raw static file path)
 * - Medical proof metadata fields (medicalProofUrl, medicalProofFileName, medicalProofFileType)
 * - A flag indicating whether a medical document is attached (hasMedicalProof)
 * - A totalDays computed field
 */

/**
 * Enrich a single leave object with medical proof fields and authenticated URLs.
 *
 * @param {Object} leave  - A plain leave object (from .lean()) or a Mongoose document
 * @param {string} rolePrefix - 'staff' or 'hr' – determines download URL prefix
 * @returns {Object} - The enriched leave object (plain JS object)
 */
function enrichLeaveResponse(leave, rolePrefix = 'staff') {
  if (!leave) return leave;

  // Convert Mongoose document to plain object if needed
  const obj = (typeof leave.toObject === 'function') ? leave.toObject() : { ...leave };

  // Resolve document reference (may be populated object or bare ObjectId)
  const docRef = obj.document;
  let docId = docRef && typeof docRef === 'object' ? docRef._id : docRef;

  // Fallback: extract ObjectId from existing documentUrl if docRef wasn't populated
  if (!docId && typeof obj.documentUrl === 'string') {
    const match = obj.documentUrl.match(/\/documents\/([a-f0-9]{24})\/download/i);
    if (match) {
      docId = match[1];
    }
  }

  const hasDoc = !!docId;

  // ── Medical proof fields (expected by HR Dashboard & StaffHub) ──────────
  obj.hasMedicalProof = hasDoc;
  obj.documentId = docId ? String(docId) : null;

  obj.medicalProofUrl = hasDoc
    ? `/api/${rolePrefix}/documents/${docId}/download`
    : null;

  obj.medicalProofFileName = obj.documentName
    || obj.attachment?.originalName
    || (docRef && typeof docRef === 'object' ? docRef.originalName : null)
    || (docRef && typeof docRef === 'object' ? docRef.fileName : null)
    || null;

  let fileType = obj.attachment?.fileType
    || (docRef && typeof docRef === 'object' ? docRef.fileType : null)
    || null;

  if (!fileType && obj.medicalProofFileName) {
    const lower = obj.medicalProofFileName.toLowerCase();
    if (lower.endsWith('.pdf')) {
      fileType = 'application/pdf';
    } else if (lower.endsWith('.png')) {
      fileType = 'image/png';
    } else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      fileType = 'image/jpeg';
    }
  }
  obj.medicalProofFileType = fileType || null;

  // ── Fix documentUrl to use authenticated endpoint ──────────────────────
  // Previously stored as raw static path (e.g. /uploads/documents/file.pdf).
  // Clients should use the authenticated download endpoint instead.
  if (hasDoc) {
    obj.documentUrl = `/api/${rolePrefix}/documents/${docId}/download`;
  }

  // ── Compute totalDays if absent ────────────────────────────────────────
  if (obj.startDate && obj.endDate && !obj.totalDays) {
    const start = new Date(obj.startDate);
    const end = new Date(obj.endDate);
    const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    obj.totalDays = diff > 0 ? diff : 1;
  }

  return obj;
}

/**
 * Enrich an array of leave objects.
 */
function enrichLeaveResponses(leaves, rolePrefix = 'staff') {
  if (!Array.isArray(leaves)) return leaves;
  return leaves.map(l => enrichLeaveResponse(l, rolePrefix));
}

module.exports = { enrichLeaveResponse, enrichLeaveResponses };
