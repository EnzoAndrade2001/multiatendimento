const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { queueAuditEvent } = require('../services/auditEventService');
const { readReleaseManifest } = require('./agentController');
const { isOutdated } = require('../utils/agentVersion');

// Mesma regra de "offline" usada na tela do tenant: sem ping ha mais que 2x o
// SYNC_INTERVAL padrao (5 min).
const AGENT_STALE_AFTER_MS = 10 * 60 * 1000;

function denySuperadmin(req, res) {
  if (req.user.role !== 'superadmin' || req.user.supportMode) {
    res.status(403).json({ error: 'Acesso negado' });
    return true;
  }
  return false;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeCredential({ name, email, password }, { requirePassword = true } = {}) {
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPassword = String(password || '');
  if (!cleanName) return { error: 'Informe o nome do responsável pelo acesso.' };
  if (!EMAIL_RE.test(cleanEmail)) return { error: 'Informe um e-mail válido para o acesso.' };
  if (requirePassword || cleanPassword) {
    if (cleanPassword.length < 6) return { error: 'A senha do acesso deve ter ao menos 6 caracteres.' };
  }
  return { name: cleanName, email: cleanEmail, password: cleanPassword };
}

async function listTenants(req, res) {
  if (denySuperadmin(req, res)) return;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const tenants = await prisma.tenant.findMany({
    include: {
      // O front usava tenant._count.instances para o contador de conexões,
      // mas o select nunca incluía "instances" - o número ficava sempre 0.
      _count: { select: { users: true, tickets: true, instances: true, contacts: true } },
      instances: { select: { status: true } },
      users: { select: { active: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Métricas de uso real por empresa (mensagens/atividade/tickets abertos).
  // Não dá pra filtrar Message por tenantId direto (só tem via ticket), então
  // é uma consulta por tenant - tranquilo na escala atual do painel (dezenas
  // de empresas, não milhares), e é uma tela de admin, não um hot path.
  const enriched = await Promise.all(tenants.map(async (tenant) => {
    const [messages30d, lastTicket, openTickets] = await Promise.all([
      prisma.message.count({
        where: { ticket: { tenantId: tenant.id }, createdAt: { gte: thirtyDaysAgo } },
      }),
      prisma.ticket.findFirst({
        where: { tenantId: tenant.id },
        orderBy: { lastMessageAt: 'desc' },
        select: { lastMessageAt: true, updatedAt: true },
      }),
      prisma.ticket.count({ where: { tenantId: tenant.id, status: { in: ['pending', 'open'] } } }),
    ]);
    const connectedInstances = tenant.instances.filter((i) => String(i.status || '').toLowerCase() === 'connected').length;
    const activeUsers = tenant.users.filter((u) => u.active).length;
    return {
      ...tenant,
      instances: undefined,
      users: undefined,
      metrics: {
        connectedInstances,
        activeUsers,
        messages30d,
        openTickets,
        lastActivityAt: lastTicket?.lastMessageAt || lastTicket?.updatedAt || null,
      },
    };
  }));

  res.json(enriched);
}

async function createTenant(req, res) {
  if (denySuperadmin(req, res)) return;
  const { name, slug, plan, maxConnections, maxUsers } = req.body;

  const cleanSlug = String(slug || '').trim().toLowerCase();
  if (!String(name || '').trim() || !cleanSlug) {
    return res.status(400).json({ error: 'Nome e slug são obrigatórios.' });
  }

  // O acesso do administrador é opcional aqui só para não quebrar chamadas
  // antigas; a tela nova sempre envia. Sem ele, a empresa nasce sem login.
  const wantsAdmin = req.body.adminName || req.body.adminEmail || req.body.adminPassword;
  let admin = null;
  if (wantsAdmin) {
    admin = normalizeCredential({ name: req.body.adminName, email: req.body.adminEmail, password: req.body.adminPassword });
    if (admin.error) return res.status(400).json({ error: admin.error });
  }

  const slugTaken = await prisma.tenant.findUnique({ where: { slug: cleanSlug } });
  if (slugTaken) return res.status(409).json({ error: 'Já existe uma empresa com esse slug.' });

  try {
    const tenant = await prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          name: String(name).trim(),
          slug: cleanSlug,
          plan: plan || 'trial',
          maxConnections: Number(maxConnections) || 1,
          maxUsers: Number(maxUsers) || 5,
          settings: { create: {} },
        },
      });
      if (admin) {
        await tx.user.create({
          data: {
            tenantId: created.id,
            name: admin.name,
            email: admin.email,
            password: await bcrypt.hash(admin.password, 10),
            role: 'admin',
            accessProfile: 'admin',
          },
        });
      }
      return created;
    });
    console.log(`[superadminController] Tenant criado: ${tenant.slug}${admin ? ` (admin ${admin.email})` : ' (sem login)'}`);
    res.json({ ...tenant, admin: admin ? { email: admin.email } : null });
  } catch (error) {
    console.error('[superadminController] Falha ao criar tenant:', error.message);
    res.status(500).json({ error: 'Não foi possível criar a empresa.' });
  }
}

async function updateTenant(req, res) {
  if (denySuperadmin(req, res)) return;
  const { id } = req.params;
  const { name, plan, active, maxConnections, maxUsers, primaryColor, logoUrl } = req.body;

  const tenant = await prisma.tenant.update({
    where: { id },
    data: {
      ...(name && { name }),
      ...(plan && { plan }),
      ...(active !== undefined && { active }),
      ...(maxConnections !== undefined && { maxConnections: Number(maxConnections) }),
      ...(maxUsers !== undefined && { maxUsers: Number(maxUsers) }),
      ...(primaryColor !== undefined && { primaryColor }),
      ...(logoUrl !== undefined && { logoUrl }),
    },
  });
  res.json(tenant);
}

async function startSupportSession(req, res) {
  if (denySuperadmin(req, res)) return;
  if (req.user.supportMode) return res.status(409).json({ error: 'Encerre a sessão de suporte atual antes de acessar outra empresa.' });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5) return res.status(400).json({ error: 'Informe o motivo do acesso técnico.' });
  const tenant = await prisma.tenant.findFirst({
    where: { id: req.params.id, active: true },
    select: { id: true, name: true, slug: true },
  });
  if (!tenant) return res.status(404).json({ error: 'Empresa ativa não encontrada.' });

  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const session = await prisma.supportAccessSession.create({
    data: {
      actorUserId: req.user.userId,
      targetTenantId: tenant.id,
      reason: reason.slice(0, 500),
      expiresAt,
      ipAddress: req.ip || null,
      userAgent: String(req.get('user-agent') || '').slice(0, 500) || null,
    },
  });
  queueAuditEvent({ req, user: req.user, tenantId: tenant.id }, {
    action: 'SUPPORT_SESSION_STARTED', resourceType: 'support_session', resourceId: session.id,
    metadata: { reason: session.reason, expiresAt: expiresAt.toISOString() },
  });
  const token = jwt.sign({
    userId: req.user.userId,
    supportTenantId: tenant.id,
    supportSessionId: session.id,
  }, process.env.JWT_SECRET, { expiresIn: '2h' });
  res.json({ token, tenant, expiresAt, supportSessionId: session.id });
}

async function endSupportSession(req, res) {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Acesso negado' });
  if (!req.user.supportMode || !req.user.supportSessionId) return res.status(400).json({ error: 'Nenhuma sessão de suporte ativa.' });
  await prisma.supportAccessSession.updateMany({
    where: { id: req.user.supportSessionId, actorUserId: req.user.userId, endedAt: null },
    data: { endedAt: new Date() },
  });
  queueAuditEvent({ req, user: req.user }, {
    action: 'SUPPORT_SESSION_ENDED', resourceType: 'support_session', resourceId: req.user.supportSessionId,
  });
  res.json({ ok: true });
}

async function listTenantUsers(req, res) {
  if (denySuperadmin(req, res)) return;
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, slug: true, maxUsers: true } });
  if (!tenant) return res.status(404).json({ error: 'Empresa não encontrada.' });
  const users = await prisma.user.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true, email: true, role: true, accessProfile: true, active: true, createdAt: true },
    orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
  });
  res.json({ tenant, users });
}

async function createTenantUser(req, res) {
  if (denySuperadmin(req, res)) return;
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id }, select: { id: true, slug: true, maxUsers: true } });
  if (!tenant) return res.status(404).json({ error: 'Empresa não encontrada.' });

  const cred = normalizeCredential({ name: req.body.name, email: req.body.email, password: req.body.password });
  if (cred.error) return res.status(400).json({ error: cred.error });

  const role = req.body.role === 'agent' ? 'agent' : 'admin';

  const count = await prisma.user.count({ where: { tenantId: tenant.id } });
  if (tenant.maxUsers && count >= tenant.maxUsers) {
    return res.status(409).json({ error: `Limite de ${tenant.maxUsers} usuário(s) do plano já foi atingido.` });
  }
  const clash = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: cred.email }, select: { id: true } });
  if (clash) return res.status(409).json({ error: 'Já existe um usuário com esse e-mail nesta empresa.' });

  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: cred.name,
      email: cred.email,
      password: await bcrypt.hash(cred.password, 10),
      role,
      accessProfile: role,
    },
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
  });
  console.log(`[superadminController] Login criado para ${tenant.slug}: ${cred.email} (${role})`);
  res.json(user);
}

async function updateTenantUser(req, res) {
  if (denySuperadmin(req, res)) return;
  const { id, userId } = req.params;
  const existing = await prisma.user.findFirst({ where: { id: userId, tenantId: id }, select: { id: true, role: true } });
  if (!existing) return res.status(404).json({ error: 'Usuário não encontrado nesta empresa.' });

  const data = {};
  if (req.body.password !== undefined) {
    if (String(req.body.password).length < 6) return res.status(400).json({ error: 'A nova senha deve ter ao menos 6 caracteres.' });
    data.password = await bcrypt.hash(String(req.body.password), 10);
  }
  if (req.body.active !== undefined) data.active = Boolean(req.body.active);
  if (req.body.name !== undefined && String(req.body.name).trim()) data.name = String(req.body.name).trim();
  if (req.body.role !== undefined) {
    const role = req.body.role === 'agent' ? 'agent' : 'admin';
    data.role = role;
    data.accessProfile = role;
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nada para atualizar.' });

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
  });
  res.json(user);
}

// Inventario cross-tenant das instalacoes do agente Firebird: quantas rodam,
// em quais empresas, em qual versao e ha quanto tempo pingaram. Alimentado
// pelos pings (modelo FirebirdAgent). Best-effort: erro de banco vira lista
// vazia, nunca 500.
async function listFirebirdAgents(req, res) {
  if (denySuperadmin(req, res)) return;

  const manifest = readReleaseManifest();
  const latestVersion = manifest?.version || process.env.FIREBIRD_AGENT_VERSION || null;

  let rows = [];
  try {
    rows = await prisma.firebirdAgent.findMany({
      include: { tenant: { select: { slug: true, name: true } } },
      orderBy: [{ lastSeenAt: 'desc' }],
    });
  } catch (error) {
    console.error('[superadminController] falha ao listar agentes Firebird:', error.message);
  }

  const now = Date.now();
  const agents = rows.map((row) => {
    const lastSeenMs = row.lastSeenAt ? now - new Date(row.lastSeenAt).getTime() : null;
    return {
      id: row.id,
      tenantSlug: row.tenant?.slug || null,
      tenantName: row.tenant?.name || null,
      installId: row.installId,
      identified: !String(row.installId || '').startsWith('legacy:'),
      hostname: row.hostname || null,
      version: row.version || null,
      protocolVersion: row.protocolVersion || null,
      runtime: row.runtime || null,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      lastPingIp: row.lastPingIp || null,
      online: lastSeenMs != null && lastSeenMs < AGENT_STALE_AFTER_MS,
      updateAvailable: latestVersion ? isOutdated(row.version, latestVersion) : false,
    };
  });

  const tenantSlugs = new Set(agents.map((agent) => agent.tenantSlug).filter(Boolean));

  res.json({
    latestVersion,
    releasedAt: manifest?.releasedAt || null,
    staleAfterMs: AGENT_STALE_AFTER_MS,
    agentCount: agents.length,
    tenantCount: tenantSlugs.size,
    onlineCount: agents.filter((agent) => agent.online).length,
    outdatedCount: agents.filter((agent) => agent.updateAvailable).length,
    agents,
  });
}

module.exports = {
  listTenants, createTenant, updateTenant,
  listTenantUsers, createTenantUser, updateTenantUser,
  listFirebirdAgents,
  startSupportSession, endSupportSession,
};
