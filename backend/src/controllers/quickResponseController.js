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
    const rows = await prisma.quickResponse.findMany({
      where: {
        tenantId: req.user.tenantId,
        ...(category ? { category } : {}),
        OR: [
          { scope: 'GLOBAL' },
          { scope: 'PERSONAL', ownerUserId: req.user.userId },
          ...(teamIds.length ? [{ scope: 'TEAM', teamId: { in: teamIds } }] : []),
        ],
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
  try {
    const response = await prisma.quickResponse.update({ where: { id: existing.id }, data, include: { owner: { select: { id: true, name: true } }, team: { select: { id: true, name: true } } } });
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
    where: { id: req.params.id, tenantId: req.user.tenantId, OR: [{ scope: 'GLOBAL' }, { scope: 'PERSONAL', ownerUserId: req.user.userId }, { scope: 'TEAM', teamId: { in: teamIds } }] },
  });
  if (!row) return res.status(404).json({ error: 'Modelo não encontrado ou sem acesso.' });
  const response = await prisma.quickResponse.update({ where: { id: row.id }, data: { usageCount: { increment: 1 }, lastUsedAt: new Date() } });
  res.json(response);
}

async function stats(req, res) {
  const rows = await prisma.quickResponse.findMany({ where: { tenantId: req.user.tenantId }, select: { category: true, scope: true, usageCount: true } });
  const result = { total: rows.length, totalUses: rows.reduce((sum, row) => sum + row.usageCount, 0), byCategory: {}, byScope: {} };
  rows.forEach((row) => {
    result.byCategory[row.category] = (result.byCategory[row.category] || 0) + 1;
    result.byScope[row.scope] = (result.byScope[row.scope] || 0) + 1;
  });
  res.json(result);
}

async function deleteQuickResponse(req, res) {
  const existing = await prisma.quickResponse.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Modelo não encontrado.' });
  if (!(await canManage(existing, req))) return res.status(403).json({ error: 'Você não pode excluir este modelo.' });
  await prisma.quickResponse.delete({ where: { id: existing.id } });
  res.sendStatus(204);
}

module.exports = { listQuickResponses, createQuickResponse, updateQuickResponse, useQuickResponse, stats, deleteQuickResponse, normalizeShortcut, normalizeCategory, normalizeScope };
