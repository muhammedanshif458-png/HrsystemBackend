const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const HRDocument = require('../models/HRDocument');
const Employee = require('../models/Employee');
const { AppError } = require('../middleware/errorMiddleware');

class DocumentService {
  /**
   * Resolve employee by Mongo ObjectId or employeeId string
   */
  async resolveEmployee(idOrEmpId) {
    let query = {};
    if (mongoose.Types.ObjectId.isValid(idOrEmpId)) {
      query = { $or: [{ _id: idOrEmpId }, { employeeId: idOrEmpId.toUpperCase() }] };
    } else {
      query = { employeeId: idOrEmpId.toUpperCase() };
    }
    const employee = await Employee.findOne(query);
    if (!employee) {
      throw new AppError('Employee not found', 404);
    }
    return employee;
  }

  /**
   * Upload / create new HR document for an employee
   */
  async uploadDocument({ employeeId, file, title, category, description, issueDate, expiryDate, user }) {
    if (!file) {
      throw new AppError('Document file is required', 400);
    }

    const employee = await this.resolveEmployee(employeeId);

    const uploaderName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'HR Admin' : 'HR Admin';

    const relativePath = `/uploads/documents/${file.filename}`;

    const document = new HRDocument({
      employee: employee._id,
      employeeIdString: employee.employeeId,
      title: title ? title.trim() : file.originalname,
      category,
      description: description ? description.trim() : '',
      fileName: file.filename,
      originalName: file.originalname,
      filePath: relativePath,
      fileType: file.mimetype,
      fileSize: file.size,
      issueDate: issueDate || '',
      expiryDate: expiryDate || '',
      uploadedBy: uploaderName,
      uploadedByUserId: user ? user._id : null,
      status: 'ACTIVE',
      version: 1,
      history: [
        {
          action: 'UPLOADED',
          performedBy: uploaderName,
          timestamp: new Date(),
          notes: 'Initial document upload'
        }
      ]
    });

    await document.save();
    return document;
  }

  /**
   * Get all documents for an employee
   */
  async getEmployeeDocuments(employeeId, { includeArchived = false } = {}) {
    const employee = await this.resolveEmployee(employeeId);

    const query = { employee: employee._id };
    if (!includeArchived) {
      query.status = { $ne: 'ARCHIVED' };
    }

    const docs = await HRDocument.find(query).sort({ createdAt: -1 }).lean();
    return docs;
  }

  /**
   * Replace an existing document with a new file
   */
  async replaceDocument(docId, { file, title, description, issueDate, expiryDate, user }) {
    if (!file) {
      throw new AppError('Replacement file is required', 400);
    }

    const document = await HRDocument.findById(docId);
    if (!document) {
      throw new AppError('Document not found', 404);
    }

    const uploaderName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'HR Admin' : 'HR Admin';
    const oldFileName = document.fileName;
    const oldFilePath = path.join(__dirname, '..', document.filePath.replace(/^\//, ''));

    // Record history
    document.history.push({
      action: 'REPLACED',
      performedBy: uploaderName,
      timestamp: new Date(),
      notes: `Replaced with new file "${file.originalname}"`,
      previousFileName: oldFileName
    });

    // Update document
    document.fileName = file.filename;
    document.originalName = file.originalname;
    document.filePath = `/uploads/documents/${file.filename}`;
    document.fileType = file.mimetype;
    document.fileSize = file.size;
    if (title) document.title = title.trim();
    if (description !== undefined) document.description = description.trim();
    if (issueDate !== undefined) document.issueDate = issueDate;
    if (expiryDate !== undefined) document.expiryDate = expiryDate;
    document.version = (document.version || 1) + 1;
    document.uploadedBy = uploaderName;

    await document.save();

    // Optionally cleanup old file if it exists and isn't the same
    try {
      if (fs.existsSync(oldFilePath) && oldFileName !== file.filename) {
        fs.unlinkSync(oldFilePath);
      }
    } catch (_) {}

    return document;
  }

  /**
   * Archive a document
   */
  async archiveDocument(docId, user) {
    const document = await HRDocument.findById(docId);
    if (!document) {
      throw new AppError('Document not found', 404);
    }

    const uploaderName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'HR Admin' : 'HR Admin';

    document.status = 'ARCHIVED';
    document.history.push({
      action: 'ARCHIVED',
      performedBy: uploaderName,
      timestamp: new Date(),
      notes: 'Document archived by HR'
    });

    await document.save();
    return document;
  }

  /**
   * Get document file for download/preview with authorization check
   */
  async getDocumentFile(docId, user) {
    const document = await HRDocument.findById(docId).populate('employee');
    if (!document) {
      throw new AppError('Document not found', 404);
    }

    // Role check: HR can view any employee document.
    // Staff can only view documents belonging to their own employee profile.
    if (user.role === 'STAFF') {
      const staffEmp = await Employee.findOne({ user: user._id });
      if (!staffEmp || String(staffEmp._id) !== String(document.employee._id)) {
        throw new AppError('You are not authorized to access this document', 403);
      }
    }

    const absolutePath = path.join(__dirname, '..', document.filePath.replace(/^\//, ''));
    if (!fs.existsSync(absolutePath)) {
      throw new AppError('Document file does not exist on disk', 404);
    }

    return {
      document,
      absolutePath
    };
  }
}

module.exports = new DocumentService();
