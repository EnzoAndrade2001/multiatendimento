const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');
const evolutionService = require('../services/evolutionService');
const technicalAssistantService = require('../services/technicalAssistantService');
const { normalizeProfile, normalizePermissionList, resolveUserAccess, resolveHomePage, hasPermission } = require('../auth/permissions');

const publicUserSelect = {
  id: true, name: true, email: true, role: true, active: true, createdAt: true,
  accessProfile: true, permissions: true, homePage: true,
  avatarUrl: true, phone: true,
};

function serializeUser(user) {
  const access = resolveUserAccess(user);
  return {
    ...user,
    accessProfile: access.profile,
    permissions: access.permissions,
    homePage: resolveHomePage(user.homePage, access),
  };
}

function accessData(body, currentUser) {
  if (body.accessProfile === undefined && body.permissions === undefined && body.role === undefined) return {};
  const requestedProfile = body.accessProfile !== undefined
    ? body.accessProfile
    : (body.role || currentUser?.accessProfile || currentUser?.role);
  const profile = normalizeProfile(requestedProfile, requestedProfile === 'admin' ? 'admin' : 'agent');
  const role = profile === 'admin' ? 'admin' : 'agent';
  return {
    role,
    accessProfile: profile,
    permissions: profile === 'personalizado' ? normalizePermissionList(body.permissions) : null,
  };
}

function canDelegateAccess(requester, access) {
  if (requester.role === 'admin' || requester.role === 'superadmin') return true;
  if (access.role === 'admin') return false;
  const requestedPermissions = resolveUserAccess(access).permissions;
  return requestedPermissions.every((permission) => requester.permissions.includes(permission));
}

async function list(req, res) {
  const canManageUsers = hasPermission(req.user, 'users.manage');
  const users = await prisma.user.findMany({
    where: { tenantId: req.user.tenantId },
    select: canManageUsers ? publicUserSelect : { id: true, name: true, active: true },
    orderBy: { name: 'asc' },
  });
  res.json(canManageUsers ? users.map(serializeUser) : users);
}

async function create(req, res) {
  const { name, email, password, role, accessProfile, permissions, homePage, phone } = req.body;

  const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId } });
  const count = await prisma.user.count({ where: { tenantId: req.user.tenantId } });

  if (count >= tenant.maxUsers) {
    return res.status(403).json({ error: `Limite de usuarios atingido (${tenant.maxUsers}).` });
  }

  const exists = await prisma.user.findFirst({
    where: { tenantId: req.user.tenantId, email },
  });
  if (exists) return res.status(400).json({ error: 'Email ja cadastrado para esta empresa' });

  const hash = await bcrypt.hash(password, 10);
  const requestedAccess = accessData({ role, accessProfile, permissions });
  if (!canDelegateAccess(req.user, requestedAccess)) {
    return res.status(403).json({ error: 'Nao e permitido conceder um nivel de acesso superior ao seu.' });
  }
  const user = await prisma.user.create({
    data: {
      tenantId: req.user.tenantId,
      name,
      email,
      password: hash,
      ...requestedAccess,
      homePage: resolveHomePage(homePage, resolveUserAccess(requestedAccess)),
      ...(phone !== undefined ? { phone: evolutionService.normalizePhoneNumber(phone) || null } : {}),
    },
    select: publicUserSelect,
  });
  technicalAssistantService.clearActorCache();
  res.json(serializeUser(user));
}

async function update(req, res) {
  const { id } = req.params;
  const { name, email, password, role, accessProfile, permissions, homePage, active, phone } = req.body;

  const data = {
    ...(name && { name }),
    ...(email && { email }),
    ...(active !== undefined && { active }),
    ...(phone !== undefined ? { phone: evolutionService.normalizePhoneNumber(phone) || null } : {}),
  };

  if (password) {
    data.password = await bcrypt.hash(password, 10);
  }

  const existing = await prisma.user.findFirst({ where: { id, tenantId: req.user.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Usuario nao encontrado' });

  const requestedAccess = accessData({ role, accessProfile, permissions }, existing);
  if (
    !canDelegateAccess(req.user, requestedAccess)
    || (existing.role === 'admin' && !['admin', 'superadmin'].includes(req.user.role))
  ) {
    return res.status(403).json({ error: 'Nao e permitido alterar este nivel de acesso.' });
  }
  Object.assign(data, requestedAccess);
  if (homePage !== undefined || Object.keys(requestedAccess).length) {
    data.homePage = resolveHomePage(homePage ?? existing.homePage, resolveUserAccess({ ...existing, ...requestedAccess }));
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: publicUserSelect,
  });
  technicalAssistantService.clearActorCache();
  res.json(serializeUser(user));
}

async function remove(req, res) {
  const { id } = req.params;

  if (id === req.user.userId) {
    return res.status(400).json({ error: 'Voce nao pode deletar seu proprio usuario' });
  }

  const existing = await prisma.user.findFirst({ where: { id, tenantId: req.user.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Usuario nao encontrado' });
  if (existing.role === 'admin' && !['admin', 'superadmin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Nao e permitido remover um administrador.' });
  }

  const sentInternalCount = await prisma.internalMessage.count({ where: { senderId: id } });
  if (sentInternalCount > 0) {
    return res.status(400).json({
      error: 'Este atendente possui mensagens internas enviadas no historico. Arquive o usuario em vez de excluir.'
    });
  }

  await prisma.$transaction([
    prisma.teamMember.deleteMany({ where: { userId: id } }),
    prisma.message.updateMany({ where: { agentId: id }, data: { agentId: null } }),
    prisma.ticket.updateMany({ where: { agentId: id }, data: { agentId: null, status: 'pending' } }),
    prisma.ticketEvent.updateMany({ where: { userId: id }, data: { userId: null } }),
    prisma.internalMessage.updateMany({ where: { receiverId: id }, data: { receiverId: null } }),
    prisma.serviceOrder.updateMany({ where: { userId: id }, data: { userId: null } }),
    prisma.serviceOrder.updateMany({ where: { closedById: id }, data: { closedById: null } }),
    prisma.user.delete({ where: { id } })
  ]);

  res.sendStatus(204);
}

module.exports = { list, create, update, remove };
