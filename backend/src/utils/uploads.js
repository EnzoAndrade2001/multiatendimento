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

// Staging do multipart. Fica dentro do mesmo volume persistente de uploads,
// portanto não depende da camada efêmera do container durante um deploy.
const knowledgeTempPath = path.join(uploadsPath, '.knowledge-tmp');
if (!fs.existsSync(knowledgeTempPath)) {
  fs.mkdirSync(knowledgeTempPath, { recursive: true });
}

// Fotos de usuários ficam no volume persistente de uploads, separadas dos
// anexos de atendimento. O diretório é servido somente pela rota tenant-aware
// /api/user-avatars/:filename.
const userAvatarPath = path.join(uploadsPath, 'user-avatars');
if (!fs.existsSync(userAvatarPath)) {
  fs.mkdirSync(userAvatarPath, { recursive: true });
}

module.exports = {
  uploadsPath,
  mediaPath,
  knowledgePath,
  knowledgeTempPath,
  userAvatarPath,
};
