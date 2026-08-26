const multer = require('multer');

const MAX_KNOWLEDGE_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_KNOWLEDGE_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const knowledgeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: MAX_KNOWLEDGE_FILE_SIZE },
  fileFilter: (_req, file, callback) => {
    const mimeType = String(file.mimetype || '').toLowerCase();
    if (!ALLOWED_KNOWLEDGE_TYPES.has(mimeType)) {
      const error = new Error('Formato não permitido. Envie PDF, DOCX, TXT, JPG, PNG ou WEBP.');
      error.statusCode = 415;
      return callback(error);
    }
    return callback(null, true);
  },
});

module.exports = { ALLOWED_KNOWLEDGE_TYPES, knowledgeUpload, MAX_KNOWLEDGE_FILE_SIZE };
