const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { PERMISSIONS, PROFILE_PERMISSIONS, resolveUserAccess, resolveHomePage } = require('../auth/permissions');
const { queueAuditEvent } = require('../services/auditEventService');
const totp = require('../services/totpService');

function requestMeta(req) {
  const userAgent = String(req.get?.('user-agent') || '').slice(0, 500) || null;
  return { ipAddress: req.ip || null, userAgent, deviceName: String(req.body?.deviceName || userAgent || 'Dispositivo').slice(0, 120) };
}

function auditLogin(req, user, action, metadata = {}) {
  if (!user?.tenantId) return;
  queueAuditEvent({
    req,
    user: { userId: user.id || null, tenantId: user.tenantId },
    tenantId: user.tenantId,
  }, {
    action,
    resourceType: 'authentication',
    resourceId: user.id || null,
    status: action === 'AUTH_LOGIN_SUCCESS' ? 'SUCCESS' : 'FAILED',
    metadata: { slugProvided: Boolean(req.body?.slug), ...metadata },
  });
}

async function login(req, res) {
  const { email, password, slug, totpCode, recoveryCode } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });

  // O e-mail só é único por tenant (@@unique([tenantId, email])). Quando o
  // login vem pelo portal da empresa (com slug), a busca precisa ser escopada
  // a esse tenant — senão um e-mail repetido em outra empresa "sequestra" o
  // login e derruba com tenant_mismatch mesmo existindo o usuário certo.
  const user = await prisma.user.findFirst({
    where: { email, ...(slug ? { tenant: { slug } } : {}) },
    include: { tenant: true },
  });

  if (!user || !user.active || !user.tenant?.active) return res.status(401).json({ error: 'Credenciais inválidas' });

  // Se o login for feito via portal de empresa, validar se o usuário pertence a ela
  if (slug && user.tenant.slug !== slug) {
    auditLogin(req, user, 'AUTH_LOGIN_FAILED', { reason: 'tenant_mismatch' });
    return res.status(401).json({ error: 'Este usuário não possui permissão para acessar esta empresa.' });
  }

  // Se for um usuário comum tentando login global (sem slug), bloquear se não for superadmin
  if (!slug && user.role !== 'superadmin') {
    auditLogin(req, user, 'AUTH_LOGIN_FAILED', { reason: 'tenant_slug_required' });
    return res.status(401).json({ error: 'Por favor, utilize o link de acesso exclusivo da sua empresa.' });
  }

  if (req.supportOnly && user.role !== 'superadmin') {
    return res.status(401).json({ error: 'Acesso exclusivo da equipe de suporte.' });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) auditLogin(req, user, 'AUTH_LOGIN_FAILED', { reason: 'invalid_password' });
  if (!valid) return res.status(401).json({ error: 'Credenciais inválidas' });

  if (user.totpEnabledAt && user.totpSecretCipher) {
    let verified = Boolean(totpCode) && totp.verifyCode(totp.decryptSecret(user.totpSecretCipher), totpCode);
    if (!verified && recoveryCode && Array.isArray(user.totpRecoveryCodes)) {
      const normalized = String(recoveryCode).replace(/-/g, '').toUpperCase();
      for (let index = 0; index < user.totpRecoveryCodes.length; index += 1) {
        if (await bcrypt.compare(normalized, user.totpRecoveryCodes[index])) {
          verified = true;
          await prisma.user.update({ where: { id: user.id }, data: { totpRecoveryCodes: user.totpRecoveryCodes.filter((_, i) => i !== index) } });
          break;
        }
      }
    }
    if (!verified) return res.status(401).json({ error: 'Codigo de verificacao obrigatorio ou invalido', requiresTwoFactor: true });
  }

  const sessionLimit = user.maxConcurrentSessions || user.tenant.maxConcurrentSessions || null;
  if (sessionLimit) {
    const active = await prisma.authSession.findMany({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'asc' } });
    const overflow = active.length - sessionLimit + 1;
    if (overflow > 0) await prisma.authSession.updateMany({ where: { id: { in: active.slice(0, overflow).map(({ id }) => id) } }, data: { revokedAt: new Date(), revokeReason: 'concurrent_limit' } });
  }
  const authSession = await prisma.authSession.create({ data: { userId: user.id, tenantId: user.tenantId, expiresAt: new Date(Date.now() + 7 * 86400000), ...requestMeta(req) } });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const token = jwt.sign(
    { userId: user.id, sessionId: authSession.id },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  const access = resolveUserAccess(user);
  auditLogin(req, user, 'AUTH_LOGIN_SUCCESS');
  res.json({
    token,
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role,
      supportLevel: user.supportLevel || (user.role === 'superadmin' ? 'manager' : null),
      avatarUrl: user.avatarUrl,
      accessProfile: access.profile, permissions: access.permissions,
      homePage: resolveHomePage(user.homePage, access),
    },
    tenant: { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug },
  });
}

async function supportLogin(req, res) {
  req.body.slug = undefined;
  req.supportOnly = true;
  return login(req, res);
}

async function listSessions(req, res) {
  const sessions = await prisma.authSession.findMany({ where: { userId: req.user.userId }, orderBy: { createdAt: 'desc' } });
  res.json(sessions.map((item) => ({ ...item, current: item.id === req.user.sessionId })));
}

async function revokeSession(req, res) {
  const result = await prisma.authSession.updateMany({ where: { id: req.params.id, userId: req.user.userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: 'user_revoked' } });
  if (!result.count) return res.status(404).json({ error: 'Sessao nao encontrada ou ja encerrada' });
  res.json({ ok: true });
}

async function beginTotp(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { email: true } });
  const secret = totp.generateSecret();
  await prisma.user.update({ where: { id: req.user.userId }, data: { totpPendingSecretCipher: totp.encryptSecret(secret) } });
  res.json({ secret, otpauthUrl: `otpauth://totp/Multiatendimento:${encodeURIComponent(user.email)}?secret=${secret}&issuer=Multiatendimento` });
}

async function confirmTotp(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { totpPendingSecretCipher: true } });
  if (!user?.totpPendingSecretCipher) return res.status(409).json({ error: 'Ativacao 2FA nao iniciada' });
  const secret = totp.decryptSecret(user.totpPendingSecretCipher);
  if (!totp.verifyCode(secret, req.body?.code)) return res.status(400).json({ error: 'Codigo de verificacao invalido' });
  const recoveryCodes = totp.generateRecoveryCodes();
  await prisma.user.update({ where: { id: req.user.userId }, data: { totpSecretCipher: totp.encryptSecret(secret), totpPendingSecretCipher: null, totpEnabledAt: new Date(), totpRecoveryCodes: await totp.hashRecoveryCodes(recoveryCodes) } });
  res.json({ ok: true, recoveryCodes });
}

async function disableTotp(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { password: true } });
  if (!user || !await bcrypt.compare(String(req.body?.password || ''), user.password)) return res.status(401).json({ error: 'Senha invalida' });
  await prisma.user.update({ where: { id: req.user.userId }, data: { totpSecretCipher: null, totpPendingSecretCipher: null, totpEnabledAt: null, totpRecoveryCodes: null } });
  res.json({ ok: true });
}

async function me(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: {
      id: true, name: true, email: true, role: true, supportLevel: true, lastLoginAt: true, tenantId: true,
      avatarUrl: true,
      accessProfile: true, permissions: true, homePage: true, active: true,
      tenant: {
        select: { id: true, name: true, slug: true, primaryColor: true, logoUrl: true }
      }
    },
  });
  if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' });
  if (req.user.supportMode) {
    const targetTenant = await prisma.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: { id: true, name: true, slug: true, primaryColor: true, logoUrl: true },
    });
    if (!targetTenant) return res.status(404).json({ error: 'Empresa de suporte não encontrada' });
    user.tenantId = targetTenant.id;
    user.tenant = targetTenant;
    user.supportMode = true;
    user.supportSessionId = req.user.supportSessionId;
  }
  const access = resolveUserAccess(user);
  res.json({
    ...user,
    accessProfile: access.profile,
    permissions: access.permissions,
    homePage: resolveHomePage(user.homePage, access),
  });
}

function accessOptions(req, res) {
  res.json({
    permissions: PERMISSIONS,
    profiles: Object.entries(PROFILE_PERMISSIONS).map(([id, permissions]) => ({ id, permissions })),
  });
}

async function getTenantBySlug(req, res) {
  const { slug } = req.params;
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true, primaryColor: true, logoUrl: true }
  });
  if (!tenant) return res.status(404).json({ error: 'Empresa não encontrada' });
  res.json(tenant);
}

module.exports = { login, supportLogin, me, getTenantBySlug, accessOptions, listSessions, revokeSession, beginTotp, confirmTotp, disableTotp };
