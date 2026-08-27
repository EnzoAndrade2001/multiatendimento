const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { knowledgeTempPath } = require('../utils/uploads');

// O limite é intencionalmente maior que o tamanho dos manuais comuns. O
// arquivo é gravado no volume durante o upload, sem ocupar toda a RAM do API.
const MAX_KNOWLEDGE_FILE_SIZE = 100 * 1024 * 1024;
const ALLOWED_KNOWLEDGE_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const storage = multer.diskStorage({
  destination: (req, _file, callback) => {
    const tenantPath = path.join(knowledgeTempPath, String(req.user?.tenantId || 'unknown'));
    fs.mkdir(tenantPath, { recursive: true }, (error) => callback(error, tenantPath));
  },
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  },
});

const knowledgeUpload = multer({
  storage,
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

function handleKnowledgeUpload(req, res, next) {
  knowledgeUpload.single('file')(req, res, (error) => {
    if (!error) return next();
    if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'O documento excede o limite de 100 MB.' });
    }
    return res.status(error.statusCode || 400).json({ error: error.message || 'Não foi possível receber o documento.' });
  });
}

module.exports = { ALLOWED_KNOWLEDGE_TYPES, handleKnowledgeUpload, knowledgeUpload, MAX_KNOWLEDGE_FILE_SIZE };
