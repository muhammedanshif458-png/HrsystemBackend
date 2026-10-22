const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { AppError } = require('./errorMiddleware');

const uploadDir = path.join(__dirname, '..', 'uploads', 'documents');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueSuffix = `${Date.now()}_${Math.round(Math.random() * 1e6)}`;
    cb(null, `${cleanName}_${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png'
  ];
  const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new AppError('Only PDF, JPG, JPEG, and PNG files are allowed', 400), false);
  }
};

const documentUpload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024 // 15MB max
  },
  fileFilter
});

const leaveAttachmentUpload = (req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return next();
  }

  const upload = documentUpload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'document', maxCount: 1 },
    { name: 'medicalDocument', maxCount: 1 },
    { name: 'medicalCertificate', maxCount: 1 },
    { name: 'medicalProof', maxCount: 1 },
    { name: 'attachment', maxCount: 1 }
  ]);

  upload(req, res, (err) => {
    if (err) {
      if (err.name === 'MulterError' && err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError('File size exceeds 15MB limit', 400));
      }
      return next(err);
    }
    if (req.files) {
      req.file = req.files['document']?.[0]
        || req.files['file']?.[0]
        || req.files['medicalDocument']?.[0]
        || req.files['medicalCertificate']?.[0]
        || req.files['medicalProof']?.[0]
        || req.files['attachment']?.[0]
        || null;
    }
    next();
  });
};

module.exports = {
  documentUpload,
  leaveAttachmentUpload,
  uploadDir
};

