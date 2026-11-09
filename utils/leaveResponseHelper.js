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
 * Normalizes frontend leave types ('Casual Leave', 'Sick Leave', 'Earned Leave', 'Medical Leave', etc.)
 * and legacy aliases (e.g. SICK_LEAVE, MEDICAL_LEAVE) to canonical uppercase enum values understood across models and services.
 *
 * @param {string} type
 * @returns {string}
 */
function normalizeLeaveType(type) {
  if (!type || typeof type !== 'string') return type;
  const upper = type.trim().toUpperCase().replace(/_/g, ' ');
  switch (upper) {
    case 'CASUAL':
    case 'CASUAL LEAVE':
      return 'CASUAL';
    case 'SICK':
    case 'SICK LEAVE':
      return 'SICK';
    case 'MEDICAL':
    case 'MEDICAL LEAVE':
      return 'MEDICAL';
    case 'ANNUAL':
    case 'ANNUAL LEAVE':
    case 'EARNED':
    case 'EARNED LEAVE':
      return 'ANNUAL';
    case 'UNPAID':
    case 'UNPAID LEAVE':
      return 'UNPAID';
    case 'OTHER':
    case 'OTHER LEAVE':
      return 'OTHER';
    default:
      return upper;
  }
}

/**
 * Returns a human-friendly display label for canonical leave types.
 *
 * @param {string} type
 * @returns {string}
 */
function formatLeaveTypeDisplay(type) {
  const norm = normalizeLeaveType(type);
  switch (norm) {
    case 'CASUAL': return 'Casual Leave';
    case 'SICK': return 'Sick Leave';
    case 'MEDICAL': return 'Medical Leave';
    case 'ANNUAL':
    case 'EARNED': return 'Earned Leave';
    case 'UNPAID': return 'Unpaid Leave';
    case 'OTHER': return 'Other';
    default: return type || 'Other';
  }
}

/**
 * Enrich a single leave object with medical proof fields, employee identifiers, and authenticated URLs.
 *
 * @param {Object} leave  - A plain leave object (from .lean()) or a Mongoose document
 * @param {string} rolePrefix - 'staff' or 'hr' – determines download URL prefix
 * @param {Object} [employeeContext] - Optional Employee document/object to enrich identifiers
 * @returns {Object} - The enriched leave object (plain JS object)
 */
function enrichLeaveResponse(leave, rolePrefix = 'staff', employeeContext = null) {
  if (!leave) return leave;

  // Convert Mongoose document to plain object if needed
  const obj = (typeof leave.toObject === 'function') ? leave.toObject() : { ...leave };

  // Ensure string 'id' is always present alongside '_id'
  if (obj._id && !obj.id) {
    obj.id = obj._id.toString();
  }

  // ── Employee & Staff Identifiers ───────────────────────────────────────────
  // StaffHub Flutter matches leave requests by comparing `r.staffId == widget.staffId`.
  // When staff logs in, StaffHub stores `staff.id` as `employee.employeeId` (e.g. 'EMP1066').
  // StaffHub parses each leave using: `final staffObj = e['staff'] ?? e['employee'];`
  // By providing `staff`, `staffId`, and `employeeId` normalized to the staff code,
  // StaffHub assigns `LeaveRequest.staffId = 'EMP1066'`, which strictly matches `widget.staff.id`.
  // Only treat obj.employee as a full document when it has employeeId (i.e. is a populated object).
  // After leave.save() the employee field is a bare ObjectId — in that case, fall back to employeeContext.
  const empFromObj = (obj.employee && typeof obj.employee === 'object' && obj.employee.employeeId !== undefined)
    ? obj.employee : null;
  const empCtx = (employeeContext && typeof employeeContext === 'object') ? employeeContext : null;
  const effectiveEmp = empFromObj || empCtx;

  const empCode = (effectiveEmp?.employeeId ? String(effectiveEmp.employeeId).trim() : '') ||
    (typeof obj.employeeId === 'string' && obj.employeeId.trim() ? obj.employeeId.trim() : '');

  const empMongoId = effectiveEmp?._id
    ? effectiveEmp._id.toString()
    : (obj.employee ? (typeof obj.employee === 'string' ? obj.employee : obj.employee.toString()) : '');

  const staffIdentifier = empCode || empMongoId;

  if (staffIdentifier) {
    obj.staffId = staffIdentifier;
    obj.employeeId = staffIdentifier;
    obj.staff = staffIdentifier;
  }

  // Ensure standard employee object structure if context is available
  if (empCtx && (!obj.employee || typeof obj.employee !== 'object')) {
    obj.employee = {
      _id: empMongoId,
      id: staffIdentifier,
      employeeId: empCode || empMongoId,
      firstName: empCtx.firstName || '',
      lastName: empCtx.lastName || '',
      department: empCtx.department || '',
      designation: empCtx.designation || '',
      email: empCtx.email || ''
    };
  } else if (empFromObj && !obj.employee.employeeId && empCode) {
    obj.employee.employeeId = empCode;
    obj.employee.id = staffIdentifier;
  }

  // ── Date & Timing Aliases ──────────────────────────────────────────────────
  if (obj.startDate && !obj.fromDate) {
    obj.fromDate = obj.startDate;
  }
  if (obj.endDate && !obj.toDate) {
    obj.toDate = obj.endDate;
  }
  if (obj.createdAt) {
    if (!obj.appliedAt) obj.appliedAt = obj.createdAt;
    if (!obj.submittedDate) obj.submittedDate = obj.createdAt;
    if (!obj.submissionDate) obj.submissionDate = obj.createdAt;
  }

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

  // ── Distinct Leave Type & Display ──────────────────────────────────────
  const canonicalType = normalizeLeaveType(obj.leaveType);
  obj.leaveType = canonicalType;
  obj.leaveTypeDisplay = formatLeaveTypeDisplay(canonicalType);
  obj.isMedical = canonicalType === 'MEDICAL';
  obj.isSick = canonicalType === 'SICK';

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

  // ── Compute totalDays and daysCount if absent ───────────────────────────
  if (obj.startDate && obj.endDate) {
    if (!obj.totalDays) {
      const start = new Date(obj.startDate);
      const end = new Date(obj.endDate);
      const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
      obj.totalDays = diff > 0 ? diff : 1;
    }
    if (!obj.daysCount) {
      obj.daysCount = obj.totalDays;
    }
  }

  return obj;
}

/**
 * Enrich an array of leave objects.
 */
function enrichLeaveResponses(leaves, rolePrefix = 'staff', employeeContext = null) {
  if (!Array.isArray(leaves)) return leaves;
  return leaves.map(l => enrichLeaveResponse(l, rolePrefix, employeeContext));
}

module.exports = {
  normalizeLeaveType,
  formatLeaveTypeDisplay,
  enrichLeaveResponse,
  enrichLeaveResponses
};
