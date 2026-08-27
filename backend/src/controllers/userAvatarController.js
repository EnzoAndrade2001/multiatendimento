const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');
const { userAvatarPath } = require('../utils/uploads');

const AVATAR_TYPES = {
  jpeg: { mimeType: 'image/jpeg', extension: '.jpg' },
  png: { mimeType: 'image/png', extension: '.png' },
  webp: { mimeType: 'image/webp', extension: '.webp' },
};

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return AVATAR_TYPES.jpeg;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return AVATAR_TYPES.png;
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return AVATAR_TYPES.webp;
  return null;
}

function safeAvatarPath(url) {
  const filename = path.basename(String(url || '').replace(/^\/uploads\/user-avatars\//, ''));
  if (!filename || filename !== String(url || '').replace(/^\/uploads\/user-avatars\//, '')) return null;
  const target = path.resolve(userAvatarPath, filename);
  return target.startsWith(`${path.resolve(userAvatarPath)}${path.sep}`) ? target : null;
}

async function removeStoredAvatar(url) {
  const target = safeAvatarPath(url);
  if (!target) return;
  try { await fs.promises.unlink(target); } catch (error) { if (error.code !== 'ENOENT') console.warn('[avatars] não foi possível remover arquivo antigo:', error.message); }
}

async function persistAvatar(file) {
  const type = detectImageType(file?.buffer);
  if (!type || String(file.mimetype || '').toLowerCase() !== type.mimeType) {
    const error = new Error('O conteúdo da foto não corresponde a uma imagem JPG, PNG ou WebP válida.');
    error.statusCode = 415;
    throw error;
  }
  const filename = `avatar-${crypto.randomUUID()}${type.extension}`;
  const target = path.join(userAvatarPath, filename);
  await fs.promises.writeFile(target, file.buffer, { flag: 'wx', mode: 0o600 });
  return { url: `/uploads/user-avatars/${filename}`, target };
}

async function updateAvatarForUser({ tenantId, userId, file }) {
  const existing = await prisma.user.findFirst({ where: { id: userId, tenantId }, select: { avatarUrl: true } });
  if (!existing) return null;
  const stored = await persistAvatar(file);
  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: stored.url },
      select: { id: true, name: true, email: true, role: true, avatarUrl: true },
    });
    await removeStoredAvatar(existing.avatarUrl);
    return user;
  } catch (error) {
    await removeStoredAvatar(stored.url);
    throw error;
  }
}

async function clearAvatarForUser({ tenantId, userId }) {
  const existing = await prisma.user.findFirst({ where: { id: userId, tenantId }, select: { avatarUrl: true } });
  if (!existing) return null;
  const user = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: null },
    select: { id: true, name: true, email: true, role: true, avatarUrl: true },
  });
  await removeStoredAvatar(existing.avatarUrl);
  return user;
}

async function uploadProfileAvatar(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Selecione uma foto para enviar.' });
  try {
    const user = await updateAvatarForUser({ tenantId: req.user.tenantId, userId: req.user.userId, file: req.file });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    return res.json(user);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Não foi possível salvar a foto do perfil.' });
  }
}

async function removeProfileAvatar(req, res) {
  try {
    const user = await clearAvatarForUser({ tenantId: req.user.tenantId, userId: req.user.userId });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    return res.json(user);
  } catch {
    return res.status(500).json({ error: 'Não foi possível remover a foto do perfil.' });
  }
}

async function uploadUserAvatar(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Selecione uma foto para enviar.' });
  try {
    const user = await updateAvatarForUser({ tenantId: req.user.tenantId, userId: req.params.id, file: req.file });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    return res.json(user);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Não foi possível salvar a foto do usuário.' });
  }
}

async function removeUserAvatar(req, res) {
  try {
    const user = await clearAvatarForUser({ tenantId: req.user.tenantId, userId: req.params.id });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    return res.json(user);
  } catch {
    return res.status(500).json({ error: 'Não foi possível remover a foto do usuário.' });
  }
}

async function downloadUserAvatar(req, res) {
  const filename = path.basename(String(req.params.filename || ''));
  if (!filename || filename !== req.params.filename) return res.status(400).json({ error: 'Arquivo inválido.' });
  const avatarUrl = `/uploads/user-avatars/${filename}`;
  const user = await prisma.user.findFirst({ where: { tenantId: req.user.tenantId, avatarUrl }, select: { id: true } });
  const target = safeAvatarPath(avatarUrl);
  if (!user || !target || !fs.existsSync(target)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.sendFile(target);
}

module.exports = {
  uploadProfileAvatar,
  removeProfileAvatar,
  uploadUserAvatar,
  removeUserAvatar,
  downloadUserAvatar,
  detectImageType,
};
