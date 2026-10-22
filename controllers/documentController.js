const documentService = require('../services/documentService');
const { sendSuccess } = require('../utils/response');

class DocumentController {
  /**
   * POST /api/hr/employees/:id/documents
   * Upload a document for an employee
   */
  async uploadDocument(req, res, next) {
    try {
      const { id } = req.params;
      const { title, category, description, issueDate, expiryDate } = req.body;
      const file = req.file;

      const doc = await documentService.uploadDocument({
        employeeId: id,
        file,
        title,
        category,
        description,
        issueDate,
        expiryDate,
        user: req.user
      });

      return sendSuccess(res, doc, 'Document uploaded successfully', 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/employees/:id/documents
   * Get all documents for an employee
   */
  async getEmployeeDocuments(req, res, next) {
    try {
      const { id } = req.params;
      const includeArchived = req.query.includeArchived === 'true';

      const docs = await documentService.getEmployeeDocuments(id, { includeArchived });

      return sendSuccess(res, docs, 'Employee documents retrieved successfully');
    } catch (err) {
      next(err);
    }
  }

  /**
   * PUT /api/hr/documents/:docId
   * Replace an existing document with a new file
   */
  async replaceDocument(req, res, next) {
    try {
      const { docId } = req.params;
      const { title, description, issueDate, expiryDate } = req.body;
      const file = req.file;

      const doc = await documentService.replaceDocument(docId, {
        file,
        title,
        description,
        issueDate,
        expiryDate,
        user: req.user
      });

      return sendSuccess(res, doc, 'Document replaced successfully');
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/hr/documents/:docId/archive
   * Archive a document
   */
  async archiveDocument(req, res, next) {
    try {
      const { docId } = req.params;

      const doc = await documentService.archiveDocument(docId, req.user);

      return sendSuccess(res, doc, 'Document archived successfully');
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/documents/:docId/download  OR  /api/staff/documents/:docId/download
   * Download / preview document with authorization
   */
  async downloadDocument(req, res, next) {
    try {
      const { docId } = req.params;

      const { document, absolutePath } = await documentService.getDocumentFile(docId, req.user);

      // Determine appropriate MIME Content-Type
      let contentType = document.fileType;
      const originalName = document.originalName || document.fileName || '';
      const lowerName = originalName.toLowerCase();
      if (lowerName.endsWith('.pdf')) {
        contentType = 'application/pdf';
      } else if (lowerName.endsWith('.png')) {
        contentType = 'image/png';
      } else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
        contentType = 'image/jpeg';
      }
      if (!contentType || contentType === 'application/octet-stream') {
        contentType = lowerName.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';
      }

      // Determine disposition based on query param (?download=true forces attachment)
      const isDownload = req.query.download === 'true' || req.query.download === '1';
      const dispositionType = isDownload ? 'attachment' : 'inline';
      const safeFilename = (originalName || 'document.pdf').replace(/["\r\n\\]/g, '_');
      const disposition = `${dispositionType}; filename="${safeFilename}"`;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', disposition);
      // Allow cross-origin access for authenticated document fetches from Flutter Web
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Type, Content-Length, Cross-Origin-Resource-Policy');

      return res.sendFile(absolutePath, (err) => {
        if (err && !res.headersSent) {
          next(err);
        }
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/hr/documents/:docId
   */
  async getDocumentById(req, res, next) {
    try {
      const { docId } = req.params;
      const HRDocument = require('../models/HRDocument');
      const doc = await HRDocument.findById(docId).populate('employee');
      if (!doc) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }
      return sendSuccess(res, 'Document retrieved successfully', doc);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/staff/documents
   * Get authenticated staff's own documents
   */
  async getMyDocuments(req, res, next) {
    try {
      const Employee = require('../models/Employee');
      const staffEmp = await Employee.findOne({ user: req.user._id });
      if (!staffEmp) {
        return sendSuccess(res, 'No employee profile linked to user', []);
      }

      const docs = await documentService.getEmployeeDocuments(staffEmp._id, { includeArchived: false });
      return sendSuccess(res, 'Documents retrieved successfully', docs);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/staff/documents/:docId
   * Get single document metadata for authenticated staff (scoped to own)
   */
  async getStaffDocumentById(req, res, next) {
    try {
      const { docId } = req.params;
      const Employee = require('../models/Employee');
      const HRDocument = require('../models/HRDocument');
      const staffEmp = await Employee.findOne({ user: req.user._id });
      if (!staffEmp) {
        return res.status(404).json({ success: false, message: 'Employee profile not found' });
      }

      const doc = await HRDocument.findOne({ _id: docId, employee: staffEmp._id });
      if (!doc) {
        return res.status(404).json({ success: false, message: 'Document not found or unauthorized' });
      }

      return sendSuccess(res, 'Document retrieved successfully', doc);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new DocumentController();

