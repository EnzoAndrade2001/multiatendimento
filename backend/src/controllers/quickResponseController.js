const prisma = require('../lib/prisma');

const CATEGORIES = new Set(['GENERAL', 'SUPPORT', 'BILLING', 'CAMPAIGN', 'TECHNICAL']);
const SCOPES = new Set(['GLOBAL', 'TEAM', 'PERSONAL']);
const CATEGORY_ALIASES = {
  GERAL: 'GENERAL',
  ATENDIMENTO: 'SUPPORT',
  SUPORTE: 'SUPPORT',
  COBRANCA: 'BILLING',
  'COBRANÇA': 'BILLING',
  CAMPANHA: 'CAMPAIGN',
  CAMPANHAS: 'CAMPAIGN',
  TECNICO: 'TECHNICAL',
  TÉCNICO: 'TECHNICAL',
  'TECNICO / O.S.': 'TECHNICAL',
};

function normalizeCategory(value) {
  const category = String(value || 'GENERAL').trim().toUpperCase();
  const canonical = CATEGORY_ALIASES[category] || category;
  return CATEGORIES.has(canonical) ? canonical : null;
}

function normalizeShortcut(value) {
  // A barra é uma convenção de uso no chat, não faz parte do identificador.
  // Mantemos a barra no banco para compatibilidade com os modelos existentes.
  const raw = String(value || '').trim().replace(/^\/+/, '').toLowerCase();
  if (!raw || raw.length > 64 || !/^[a-z0-9][a-z0-9._-]*$/i.test(raw)) return null;
  return `/${raw}`;
}

function normalizeScope(value) {
  const scope = String(value || 'GLOBAL').trim().toUpperCase();
  return SCOPES.has(scope) ? scope : null;
}

async function memberships(user) {
  return prisma.teamMember.findMany({ where: { userId: user.userId, team: { tenantId: user.tenantId } }, select: { teamId: true } });
}

function isAdministrator(user) {
  return user?.role === 'admin' || user?.role === 'superadmin' || user?.accessProfile === 'admin';
}

function isTrue(value) {
  return ['1', 'true', 'yes', 'sim', 'on'].includes(String(value || '').trim().toLowerCase());
}

// Auditing must never break a quick-response operation (for example while a
// tenant is upgrading from a schema without the audit table). We keep only
// operational metadata and deliberately omit message bodies.
async function writeQuickResponseAudit({ tenantId, quickResponseId = null, actorUserId = null, action, metadata = null }) {
  try {
    await prisma.quickResponseAudit.create({
      data: {
        tenantId,
        quickResponseId,
        actorUserId,
        action,
        metadata,
      },
    });
  } catch (err) {
    console.error('[quick-responses:audit]', err.message);
  }
}

function safeMetadata(body = {}) {
  return Object.fromEntries(Object.entries({
    shortcut: body.shortcut,
    category: body.category,
    scope: body.scope,
    favorite: body.favorite ?? body.pinned,
  }).filter(([, value]) => value !== undefined));
}

async function canManage(row, req, teamIds = null) {
  if (row.scope === 'GLOBAL') return true;
  if (row.scope === 'PERSONAL') return row.ownerUserId === req.user.userId;
  if (row.scope === 'TEAM') {
    if (isAdministrator(req.user)) return true;
    const ids = teamIds || (await memberships(req.user)).map((item) => item.teamId);
    return Boolean(row.teamId && ids.includes(row.teamId));
  }
  return false;
}

async function listQuickResponses(req, res) {
  try {
    const teams = await memberships(req.user);
    let teamIds = teams.map((item) => item.teamId);
    if (isAdministrator(req.user)) {
      const allTeams = await prisma.team.findMany({ where: { tenantId: req.user.tenantId }, select: { id: true } });
      teamIds = allTeams.map((item) => item.id);
    }
    const category = req.query.category ? normalizeCategory(req.query.category) : null;
    if (req.query.category && !category) return res.status(400).json({ error: 'Categoria inválida.' });
    const scope = req.query.scope ? normalizeScope(req.query.scope) : null;
    if (req.query.scope && !scope) return res.status(400).json({ error: 'Escopo inválido.' });
    // Arquivados continuam sujeitos ao mesmo filtro de escopo; não expomos
    // modelos de outras equipes. Usuários que podem gerenciar respostas podem
    // restaurar os modelos que também podem administrar.
    const includeArchived = isTrue(req.query.includeArchived);
    const search = String(req.query.q || req.query.search || '').trim();
    const rows = await prisma.quickResponse.findMany({
      where: {
        tenantId: req.user.tenantId,
        ...(includeArchived ? {} : { archivedAt: null }),
        ...(category ? { category } : {}),
        ...(scope ? { scope } : {}),
        ...(search ? { OR: [{ shortcut: { contains: search, mode: 'insensitive' } }, { message: { contains: search, mode: 'insensitive' } }] } : {}),
        AND: [{ OR: [
          { scope: 'GLOBAL' },
          { scope: 'PERSONAL', ownerUserId: req.user.userId },
          ...(teamIds.length ? [{ scope: 'TEAM', teamId: { in: teamIds } }] : []),
        ] }],
      },
      include: { owner: { select: { id: true, name: true } }, team: { select: { id: true, name: true } } },
      orderBy: [{ category: 'asc' }, { shortcut: 'asc' }],
    });
    // Corrige somente a representação enviada ao cliente; não altera atalhos legados
    // durante uma simples leitura e evita exibir barras duplicadas no atendimento.
    res.json(rows.map((row) => ({ ...row, shortcut: normalizeShortcut(row.shortcut) || row.shortcut })));
  } catch (err) {
    console.error('[quick-responses:list]', err.message);
    res.status(500).json({ error: 'Erro ao listar modelos de mensagem.' });
  }
}

async function createQuickResponse(req, res) {
  const shortcut = normalizeShortcut(req.body.shortcut);
  const message = String(req.body.message || '').trim();
  const category = normalizeCategory(req.body.category);
  const scope = normalizeScope(req.body.scope);
  if (!shortcut || !message) return res.status(400).json({ error: 'Atalho e mensagem são obrigatórios. Use somente letras, números, ponto, hífen ou sublinhado no atalho.' });
  if (!category) return res.status(400).json({ error: 'Categoria inválida.' });
  if (!scope) return res.status(400).json({ error: 'Escopo inválido.' });
  if (message.length > 10000) return res.status(400).json({ error: 'A mensagem deve ter no máximo 10.000 caracteres.' });
  const teamId = scope === 'TEAM' ? String(req.body.teamId || '') : null;
  if (scope === 'TEAM') {
    const team = await prisma.team.findFirst({ where: { id: teamId, tenantId: req.user.tenantId }, select: { id: true } });
    if (!team) return res.status(400).json({ error: 'Equipe inválida.' });
    if (isAdministrator(req.user)) {
      // Administradores podem publicar um modelo para qualquer equipe da empresa.
      // A associação continua protegida pelo tenantId acima.
    } else {
      const membership = await prisma.teamMember.findFirst({ where: { userId: req.user.userId, teamId, team: { tenantId: req.user.tenantId } } });
    if (!membership) return res.status(403).json({ error: 'Você não participa da equipe selecionada.' });
    }
  }
  try {
    const response = await prisma.quickResponse.create({
      data: { tenantId: req.user.tenantId, shortcut, message, category, scope, teamId, ownerUserId: scope === 'PERSONAL' ? req.user.userId : null },
      include: { owner: { select: { id: true, name: true } }, team: { select: { id: true, name: true } } },
    });
    await writeQuickResponseAudit({
      tenantId: req.user.tenantId,
      quickResponseId: response.id,
      actorUserId: req.user.userId,
      action: 'CREATED',
      metadata: safeMetadata({ shortcut, category, scope }),
    });
    res.status(201).json(response);
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'Atalho já existe.' });
    console.error('[quick-responses:create]', err.message);
    res.status(500).json({ error: 'Erro ao criar modelo de mensagem.' });
  }
}

async function updateQuickResponse(req, res) {
  const existing = await prisma.quickResponse.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Modelo não encontrado.' });
  let teamIds = (await memberships(req.user)).map((item) => item.teamId);
  if (isAdministrator(req.user)) {
    const allTeams = await prisma.team.findMany({ where: { tenantId: req.user.tenantId }, select: { id: true } });
    teamIds = allTeams.map((item) => item.id);
  }
  if (!(await canManage(existing, req, teamIds))) return res.status(403).json({ error: 'Você não pode alterar este modelo.' });

  const data = {};
  const archiveRequested = req.body.archived !== undefined || req.body.archivedAt !== undefined;
  let archiveChanged = false;
  if (req.body.shortcut !== undefined) {
    data.shortcut = normalizeShortcut(req.body.shortcut);
    if (!data.shortcut) return res.status(400).json({ error: 'Atalho inválido.' });
  }
  if (req.body.message !== undefined) {
    data.message = String(req.body.message || '').trim();
    if (!data.message || data.message.length > 10000) return res.status(400).json({ error: 'Mensagem inválida ou maior que 10.000 caracteres.' });
  }
  if (req.body.category !== undefined) {
    data.category = normalizeCategory(req.body.category);
    if (!data.category) return res.status(400).json({ error: 'Categoria inválida.' });
  }
  if (req.body.favorite !== undefined || req.body.pinned !== undefined) {
    const favorite = req.body.favorite !== undefined ? req.body.favorite : req.body.pinned;
    if (typeof favorite !== 'boolean') return res.status(400).json({ error: 'Favorito inválido.' });
    data.isFavorite = favorite;
  }
  if (archiveRequested) {
    const rawArchived = req.body.archived !== undefined ? req.body.archived : req.body.archivedAt;
    const requestedArchived = typeof rawArchived === 'boolean' ? rawArchived : isTrue(rawArchived);
    const currentArchived = Boolean(existing.archivedAt);
    archiveChanged = requestedArchived !== currentArchived;
    data.archivedAt = requestedArchived ? new Date() : null;
  }
  if (req.body.scope !== undefined) {
    data.scope = normalizeScope(req.body.scope);
    if (!data.scope) return res.status(400).json({ error: 'Escopo inválido.' });
    data.teamId = data.scope === 'TEAM' ? String(req.body.teamId || '') : null;
    data.ownerUserId = data.scope === 'PERSONAL' ? req.user.userId : null;
    if (data.scope === 'TEAM' && !teamIds.includes(data.teamId)) return res.status(403).json({ error: 'Você não participa da equipe selecionada.' });
  } else if (req.body.teamId !== undefined) {
    if (existing.scope !== 'TEAM' || !teamIds.includes(String(req.body.teamId))) return res.status(403).json({ error: 'Equipe inválida para este modelo.' });
    data.teamId = String(req.body.teamId);
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nenhuma alteração informada.' });
  try {
    const response = await prisma.quickResponse.update({ where: { id: existing.id }, data, include: { owner: { select: { id: true, name: true } }, team: { select: { id: true, name: true } } } });
    await writeQuickResponseAudit({
      tenantId: req.user.tenantId,
      quickResponseId: response.id,
      actorUserId: req.user.userId,
      action: archiveChanged ? (data.archivedAt ? 'ARCHIVED' : 'RESTORED') : 'UPDATED',
      metadata: safeMetadata({ ...req.body, shortcut: data.shortcut ?? existing.shortcut, category: data.category ?? existing.category, scope: data.scope ?? existing.scope }),
    });
    res.json(response);
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'Atalho já existe.' });
    console.error('[quick-responses:update]', err.message);
    res.status(500).json({ error: 'Erro ao atualizar modelo de mensagem.' });
  }
}

async function useQuickResponse(req, res) {
  const teams = await memberships(req.user);
  let teamIds = teams.map((item) => item.teamId);
  if (isAdministrator(req.user)) {
    const allTeams = await prisma.team.findMany({ where: { tenantId: req.user.tenantId }, select: { id: true } });
    teamIds = allTeams.map((item) => item.id);
  }
  const row = await prisma.quickResponse.findFirst({
    where: { id: req.params.id, tenantId: req.user.tenantId, archivedAt: null, OR: [{ scope: 'GLOBAL' }, { scope: 'PERSONAL', ownerUserId: req.user.userId }, { scope: 'TEAM', teamId: { in: teamIds } }] },
  });
  if (!row) return res.status(404).json({ error: 'Modelo não encontrado ou sem acesso.' });
  const response = await prisma.quickResponse.update({ where: { id: row.id }, data: { usageCount: { increment: 1 }, lastUsedAt: new Date() } });
  await writeQuickResponseAudit({ tenantId: req.user.tenantId, quickResponseId: row.id, actorUserId: req.user.userId, action: 'USED', metadata: { shortcut: row.shortcut, category: row.category, scope: row.scope } });
  res.json(response);
}

async function stats(req, res) {
  const includeArchived = isTrue(req.query.includeArchived) && isAdministrator(req.user);
  const rows = await prisma.quickResponse.findMany({ where: { tenantId: req.user.tenantId, ...(includeArchived ? {} : { archivedAt: null }) }, select: { category: true, scope: true, usageCount: true, archivedAt: true } });
  const result = { total: rows.length, totalUses: rows.reduce((sum, row) => sum + row.usageCount, 0), byCategory: {}, byScope: {} };
  rows.forEach((row) => {
    result.byCategory[row.category] = (result.byCategory[row.category] || 0) + 1;
    result.byScope[row.scope] = (result.byScope[row.scope] || 0) + 1;
  });
  if (includeArchived) result.archived = rows.filter((row) => row.archivedAt).length;
  res.json(result);
}

async function deleteQuickResponse(req, res) {
  const existing = await prisma.quickResponse.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Modelo não encontrado.' });
  if (!(await canManage(existing, req))) return res.status(403).json({ error: 'Você não pode excluir este modelo.' });
  if (!existing.archivedAt) {
    await prisma.quickResponse.update({ where: { id: existing.id }, data: { archivedAt: new Date() } });
    await writeQuickResponseAudit({ tenantId: req.user.tenantId, quickResponseId: existing.id, actorUserId: req.user.userId, action: 'ARCHIVED', metadata: { shortcut: existing.shortcut, category: existing.category, scope: existing.scope, via: 'delete' } });
  }
  res.sendStatus(204);
}

async function archiveQuickResponse(req, res) {
  const existing = await prisma.quickResponse.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Modelo não encontrado.' });
  if (!(await canManage(existing, req))) return res.status(403).json({ error: 'Você não pode arquivar este modelo.' });
  if (existing.archivedAt) return res.json({ ...existing, archived: true });
  const response = await prisma.quickResponse.update({ where: { id: existing.id }, data: { archivedAt: new Date() } });
  await writeQuickResponseAudit({ tenantId: req.user.tenantId, quickResponseId: existing.id, actorUserId: req.user.userId, action: 'ARCHIVED', metadata: { shortcut: existing.shortcut, category: existing.category, scope: existing.scope } });
  res.json({ ...response, archived: true });
}

async function restoreQuickResponse(req, res) {
  const existing = await prisma.quickResponse.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Modelo não encontrado.' });
  if (!(await canManage(existing, req))) return res.status(403).json({ error: 'Você não pode restaurar este modelo.' });
  if (!existing.archivedAt) return res.json({ ...existing, archived: false });
  const response = await prisma.quickResponse.update({ where: { id: existing.id }, data: { archivedAt: null } });
  await writeQuickResponseAudit({ tenantId: req.user.tenantId, quickResponseId: existing.id, actorUserId: req.user.userId, action: 'RESTORED', metadata: { shortcut: existing.shortcut, category: existing.category, scope: existing.scope } });
  res.json({ ...response, archived: false });
}

async function listQuickResponseAudit(req, res) {
  if (!isAdministrator(req.user)) return res.status(403).json({ error: 'Apenas administradores podem consultar a auditoria.' });
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.min(Math.max(Number.parseInt(req.query.offset, 10) || 0, 0), 100000);
  const where = {
    tenantId: req.user.tenantId,
    ...(req.query.quickResponseId ? { quickResponseId: String(req.query.quickResponseId) } : {}),
    ...(req.query.action ? { action: String(req.query.action).trim().toUpperCase() } : {}),
  };
  try {
    const [items, total] = await Promise.all([
      prisma.quickResponseAudit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          actor: { select: { id: true, name: true, email: true } },
          quickResponse: { select: { id: true, shortcut: true, category: true } },
        },
      }),
      prisma.quickResponseAudit.count({ where }),
    ]);
    res.json({ items, total, limit, offset, hasMore: offset + items.length < total });
  } catch (err) {
    console.error('[quick-responses:audit:list]', err.message);
    res.status(500).json({ error: 'Erro ao consultar auditoria dos modelos.' });
  }
}

module.exports = {
  listQuickResponses,
  createQuickResponse,
  updateQuickResponse,
  useQuickResponse,
  stats,
  deleteQuickResponse,
  archiveQuickResponse,
  restoreQuickResponse,
  listQuickResponseAudit,
  normalizeShortcut,
  normalizeCategory,
  normalizeScope,
};
