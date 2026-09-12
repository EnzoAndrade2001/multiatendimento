const { hasPermission } = require('../auth/permissions');
const { Prisma } = require('@prisma/client');

const failure = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const include = {
  assignee: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  contact: { select: { id: true, name: true } },
  ticket: { select: { id: true, subject: true } },
  serviceOrder: { select: { id: true, externalId: true, ticketId: true } },
};

function createTaskService(db) {
  async function context(user) {
    const teams = await db.team.findMany({ where: { tenantId: user.tenantId, ...(hasPermission(user, 'inbox.view_all') ? {} : { members: { some: { userId: user.userId } } }) }, select: { id: true, name: true } });
    return { user, teams, teamIds: teams.map(t => t.id), elevated: hasPermission(user, 'inbox.view_all') };
  }
  function visibility(ctx, scope = 'team') {
    if (scope === 'mine') return { assigneeId: ctx.user.userId };
    if (ctx.elevated) return {};
    return { OR: [{ assigneeId: ctx.user.userId }, { createdById: ctx.user.userId }, { teamId: { in: ctx.teamIds } }] };
  }
  function ticketVisibility(ctx) {
    return ctx.elevated ? {} : { OR: [{ agentId: ctx.user.userId }, { agentId: null }, { teamId: { in: ctx.teamIds } }] };
  }
  async function validatedData(ctx, input, current = {}) {
    const merged = { ...current, ...input };
    const title = String(merged.title || '').trim();
    if (!title || title.length > 200) throw failure('Informe um título de até 200 caracteres.');
    const description = String(merged.description || '').trim();
    if (description.length > 5000) throw failure('A descrição deve ter até 5.000 caracteres.');
    const kind = merged.kind || 'task';
    const status = merged.status || 'open';
    if (!['task', 'callback'].includes(kind) || !['open', 'in_progress', 'done', 'cancelled'].includes(status)) throw failure('Tipo ou situação inválida.');
    const dueAt = merged.dueAt ? new Date(merged.dueAt) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) throw failure('Prazo inválido.');
    if (kind === 'callback' && !dueAt) throw failure('Informe o prazo do retorno prometido.');
    const assigneeId = merged.assigneeId || ctx.user.userId;
    const teamId = merged.teamId || null;
    if (teamId && !ctx.teamIds.includes(teamId)) throw failure('Equipe indisponível.', 403);
    if (assigneeId !== ctx.user.userId && !hasPermission(ctx.user, 'inbox.assign')) throw failure('Sem permissão para atribuir a outro atendente.', 403);
    const assignee = await db.user.findFirst({ where: { id: assigneeId, tenantId: ctx.user.tenantId, active: true, ...(!ctx.elevated && assigneeId !== ctx.user.userId ? { teamMembers: { some: { teamId: { in: ctx.teamIds } } } } : {}) }, select: { id: true } });
    if (!assignee) throw failure('Responsável indisponível.');
    if (teamId && !await db.teamMember.findFirst({ where: { teamId, userId: assigneeId } })) throw failure('O responsável deve pertencer à equipe selecionada.');
    const links = {};
    for (const [field, model] of [['contactId', 'contact'], ['ticketId', 'ticket'], ['serviceOrderId', 'serviceOrder']]) {
      links[field] = merged[field] || null;
      if (!links[field]) continue;
      if (field === 'serviceOrderId' && !hasPermission(ctx.user, 'crm.view')) throw failure('Sem acesso às ordens de serviço.', 403);
      const record = await db[model].findFirst({ where: { id: links[field], tenantId: ctx.user.tenantId, ...(field === 'ticketId' ? ticketVisibility(ctx) : {}) } });
      if (!record) throw failure('Vínculo indisponível para este usuário.', 404);
      if (field !== 'contactId' && merged.contactId && record.contactId !== merged.contactId) throw failure('O vínculo deve pertencer ao cliente selecionado.');
      if (field === 'serviceOrderId' && merged.ticketId && record.ticketId !== merged.ticketId) throw failure('A O.S. deve pertencer à conversa selecionada.');
    }
    return { title, description, kind, status, dueAt, assigneeId, teamId, ...links, completedAt: status === 'done' ? (current.completedAt || new Date()) : null };
  }
  async function list(user, query = {}) {
    const ctx = await context(user);
    const page = Math.max(1, Math.min(10000, Number.parseInt(query.page, 10) || 1));
    const status = query.status || 'active';
    if (!['active', 'all', 'open', 'in_progress', 'done', 'cancelled'].includes(status)) throw failure('Filtro de situação inválido.');
    const where = { tenantId: user.tenantId, ...visibility(ctx, query.scope === 'team' ? 'team' : 'mine'), ...(status === 'all' ? {} : { status: status === 'active' ? { in: ['open', 'in_progress'] } : status }), ...(query.overdue === 'true' ? { dueAt: { lt: new Date() }, status: { in: ['open', 'in_progress'] } } : {}) };
    const [items, total] = await Promise.all([db.attendanceTask.findMany({ where, include, orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }], take: 50, skip: (page - 1) * 50 }), db.attendanceTask.count({ where })]);
    return { items, total, page, pageSize: 50 };
  }
  async function create(user, input) {
    const ctx = await context(user);
    const data = await validatedData(ctx, input);
    return db.attendanceTask.create({ data: { ...data, tenantId: user.tenantId, createdById: user.userId }, include });
  }
  async function update(user, id, input) {
    const ctx = await context(user);
    const where = { id, tenantId: user.tenantId, ...visibility(ctx) };
    const current = await db.attendanceTask.findFirst({ where });
    if (!current) throw failure('Pendência não encontrada.', 404);
    const data = await validatedData(ctx, input, current);
    // Retain access and tenant predicates during the mutation as well.
    const result = await db.attendanceTask.updateMany({ where, data });
    if (!result.count) throw failure('Pendência não encontrada.', 404);
    return db.attendanceTask.findFirst({ where: { id, tenantId: user.tenantId }, include });
  }
  async function waiting(user, query = {}) {
    const ctx = await context(user);
    const access = query.scope !== 'team' ? Prisma.sql`t."agentId" = ${user.userId}`
      : ctx.elevated ? Prisma.sql`TRUE`
        : Prisma.sql`(t."agentId" = ${user.userId} OR t."agentId" IS NULL ${ctx.teamIds.length ? Prisma.sql`OR t."teamId" IN (${Prisma.join(ctx.teamIds)})` : Prisma.empty})`;
    // Filter the latest message in PostgreSQL before limiting; answered tickets
    // must never hide an older or newer customer waiting for a human response.
    const rows = await db.$queryRaw(Prisma.sql`
      SELECT t."id", latest."createdAt" AS "waitingSince"
      FROM "Ticket" t
      JOIN LATERAL (
        SELECT m."fromMe", m."createdAt" FROM "Message" m
        WHERE m."ticketId" = t."id" AND m."isDeleted" = false
          AND (m."fromMe" = false OR (m."fromBot" = false AND m."automationType" IS NULL))
        ORDER BY m."createdAt" DESC, m."id" DESC LIMIT 1
      ) latest ON true
      WHERE t."tenantId" = ${user.tenantId} AND t."status" IN ('open', 'pending')
        AND ${access} AND latest."fromMe" = false
      ORDER BY latest."createdAt" ASC, t."id" ASC LIMIT 101`);
    const tickets = rows.length ? await db.ticket.findMany({ where: { tenantId: user.tenantId, id: { in: rows.slice(0, 100).map(t => t.id) }, ...ticketVisibility(ctx) }, select: { id: true, subject: true, slaDueAt: true, contact: { select: { name: true } }, agent: { select: { name: true } } } }) : [];
    const byId = new Map(tickets.map(t => [t.id, t]));
    return { items: rows.slice(0, 100).filter(t => byId.has(t.id)).map(t => ({ ...byId.get(t.id), waitingSince: t.waitingSince })), truncated: rows.length > 100 };
  }
  async function options(user, query = {}) {
    const ctx = await context(user);
    const q = String(query.q || '').trim().slice(0, 100);
    const [users, contacts, tickets, serviceOrders] = await Promise.all([
      db.user.findMany({ where: { tenantId: user.tenantId, active: true, ...(!hasPermission(user, 'inbox.assign') ? { id: user.userId } : !ctx.elevated ? { OR: [{ id: user.userId }, { teamMembers: { some: { teamId: { in: ctx.teamIds } } } }] } : {}) }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 300 }),
      db.contact.findMany({ where: { tenantId: user.tenantId, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 50 }),
      db.ticket.findMany({ where: { tenantId: user.tenantId, ...ticketVisibility(ctx), ...(q ? { contact: { name: { contains: q, mode: 'insensitive' } } } : { status: { in: ['open', 'pending'] } }) }, select: { id: true, contactId: true, contact: { select: { name: true } } }, orderBy: { updatedAt: 'desc' }, take: 50 }),
      hasPermission(user, 'crm.view') ? db.serviceOrder.findMany({ where: { tenantId: user.tenantId, ...(q ? { contact: { name: { contains: q, mode: 'insensitive' } } } : {}) }, select: { id: true, externalId: true, contactId: true, ticketId: true, contact: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 50 }) : [],
    ]);
    return { users, teams: ctx.teams, contacts, tickets, serviceOrders, currentUserId: user.userId };
  }
  return { list, create, update, waiting, options };
}
module.exports = { createTaskService };

