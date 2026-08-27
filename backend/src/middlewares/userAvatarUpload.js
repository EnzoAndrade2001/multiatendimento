const multer = require('multer');

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const userAvatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(String(file.mimetype || '').toLowerCase())) {
      const error = new Error('Formato não permitido. Use uma imagem JPG, PNG ou WebP.');
      error.statusCode = 415;
      return callback(error);
    }
    return callback(null, true);
  },
});

function parseUserAvatarUpload(req, res, next) {
  userAvatarUpload.single('file')(req, res, (error) => {
    if (!error) return next();
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : error.statusCode || 400;
    return res.status(status).json({
      error: error.code === 'LIMIT_FILE_SIZE'
        ? 'A foto excede o limite de 2 MB.'
        : error.message,
    });
  });
}

module.exports = { parseUserAvatarUpload };
