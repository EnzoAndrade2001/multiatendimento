const multer = require('multer');

const MAX_INTERNAL_ATTACHMENT_SIZE = 20 * 1024 * 1024;
const ALLOWED_INTERNAL_ATTACHMENT_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf', 'text/plain', 'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const internalChatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: MAX_INTERNAL_ATTACHMENT_SIZE },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_INTERNAL_ATTACHMENT_TYPES.has(String(file.mimetype || '').toLowerCase())) {
      const error = new Error('Formato de arquivo não permitido no chat interno.');
      error.statusCode = 415;
      return callback(error);
    }
    return callback(null, true);
  },
});

module.exports = { internalChatUpload, MAX_INTERNAL_ATTACHMENT_SIZE, ALLOWED_INTERNAL_ATTACHMENT_TYPES };
