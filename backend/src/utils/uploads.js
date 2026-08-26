const path = require('path');
const fs = require('fs');

const uploadsPath = process.env.UPLOADS_PATH || (
  fs.existsSync('/app/uploads')
    ? '/app/uploads'
    : path.resolve(__dirname, '..', '..', 'uploads')
);

if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

const mediaPath = path.join(uploadsPath, 'media');
if (!fs.existsSync(mediaPath)) {
  fs.mkdirSync(mediaPath, { recursive: true });
}

const knowledgePath = path.join(uploadsPath, 'knowledge');
if (!fs.existsSync(knowledgePath)) {
  fs.mkdirSync(knowledgePath, { recursive: true });
}

module.exports = {
  uploadsPath,
  mediaPath,
  knowledgePath,
};
