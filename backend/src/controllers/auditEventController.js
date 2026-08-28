const prisma = require('../lib/prisma');
const { hasPermission } = require('../auth/permissions');

function positiveInt(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function dateFilter(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) date.setUTCHours(23, 59, 59, 999);
  return date;
}

/**
 * Lists the central audit trail for the current tenant. This endpoint is
 * deliberately scoped to the tenant from the authenticated token; callers
 * cannot provide a tenantId. Metadata is already bounded/sanitized by the
 * audit event service and is returned only to users with audit.view.
 */
async function listAuditEvents(req, res) {
  if (!hasPermission(req.user, 'audit.view')) {
    return res.status(403).json({ error: 'Voce nao possui permissao para consultar a auditoria.' });
  }

  const page = positiveInt(req.query.page, 1, 1000000);
  const pageSize = positiveInt(req.query.pageSize || req.query.limit, 50, 100);
  const action = String(req.query.action || '').trim().slice(0, 120);
  const resourceType = String(req.query.entityType || req.query.resourceType || '').trim().slice(0, 80);
  const status = String(req.query.status || '').trim().slice(0, 40);
  const actorId = String(req.query.userId || req.query.actorId || '').trim().slice(0, 120);
  const search = String(req.query.search || '').trim().slice(0, 160);
  const from = dateFilter(req.query.from);
  const to = dateFilter(req.query.to, true);

  const where = {
    tenantId: req.user.tenantId,
    ...(action ? { action } : {}),
    ...(resourceType ? { resourceType } : {}),
    ...(status ? { status } : {}),
    ...(actorId ? { actorId } : {}),
    ...((from || to) ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(search ? {
      OR: [
        { action: { contains: search, mode: 'insensitive' } },
        { resourceType: { contains: search, mode: 'insensitive' } },
        { resourceId: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };

  try {
    const [events, total] = await prisma.$transaction([
      prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          action: true,
          resourceType: true,
          resourceId: true,
          status: true,
          metadata: true,
          ipAddress: true,
          userAgent: true,
          requestId: true,
          createdAt: true,
          actor: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.auditEvent.count({ where }),
    ]);

    return res.json({
      events,
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    });
  } catch (error) {
    // A missing migration should produce a useful response, never take down
    // the rest of the application. The central service also remains best
    // effort for writes during a rolling deployment.
    console.error('[audit-events] falha ao consultar trilha:', error.message);
    return res.status(503).json({ error: 'A auditoria ainda nao esta disponivel. Tente novamente em instantes.' });
  }
}

module.exports = { listAuditEvents };
