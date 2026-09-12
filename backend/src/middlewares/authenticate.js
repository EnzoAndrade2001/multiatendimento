const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { resolveUserAccess } = require('../auth/permissions');

module.exports = async (req, res, next) => {
  const auth = req.headers.authorization;
  let token;

  if (auth && auth.startsWith('Bearer ')) token = auth.slice(7);
  else if (req.query.token) token = req.query.token;

  if (!token) return res.status(401).json({ error: 'Token obrigatorio' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.userId) return res.status(401).json({ error: 'Token invalido' });

    // Tokens emitidos antes do rastreamento continuam validos ate expirarem.
    // Novos tokens (inclusive os derivados para suporte) podem ser revogados.
    if (decoded.sessionId) {
      const authSession = await prisma.authSession.findFirst({ where: { id: decoded.sessionId, userId: decoded.userId, revokedAt: null, expiresAt: { gt: new Date() } } });
      if (!authSession) return res.status(401).json({ error: 'Sessao revogada ou expirada' });
    }

    if (decoded.supportTenantId && decoded.supportSessionId) {
      const [actor, session] = await Promise.all([
        prisma.user.findUnique({
          where: { id: decoded.userId },
          select: { id: true, tenantId: true, role: true, supportLevel: true, accessProfile: true, permissions: true, active: true },
        }),
        prisma.supportAccessSession.findFirst({
          where: {
            id: decoded.supportSessionId,
            actorUserId: decoded.userId,
            targetTenantId: decoded.supportTenantId,
            endedAt: null,
            expiresAt: { gt: new Date() },
          },
          include: { targetTenant: { select: { active: true, lifecycleStatus: true } } },
        }),
      ]);
      if (!actor?.active || actor.role !== 'superadmin' || !session?.targetTenant || session.targetTenant.lifecycleStatus === 'cancelled') {
        return res.status(401).json({ error: 'Sessao de suporte invalida ou expirada' });
      }
      const access = resolveUserAccess(actor);
      req.user = {
        userId: actor.id,
        tenantId: decoded.supportTenantId,
        role: actor.role,
        supportLevel: actor.supportLevel || 'manager',
        accessProfile: access.profile,
        permissions: access.permissions,
        supportMode: true,
        supportSessionId: session.id,
        sessionId: decoded.sessionId || null,
        supportHomeTenantId: actor.tenantId,
      };
      return next();
    }

    // O token identifica a sessao; status, tenant e permissoes sempre vem do banco.
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        tenantId: true,
        role: true,
        supportLevel: true,
        accessProfile: true,
        permissions: true,
        active: true,
        tenant: { select: { active: true, lifecycleStatus: true, financialStatus: true, trialEndsAt: true } },
      },
    });

    const unavailableLifecycle = ['suspended', 'cancelled'].includes(user?.tenant?.lifecycleStatus);
    const blockedFinancial = ['blocked', 'cancelled'].includes(user?.tenant?.financialStatus);
    if (!user || !user.active || !user.tenant?.active || unavailableLifecycle || blockedFinancial) {
      return res.status(401).json({ error: 'Usuario inativo ou nao encontrado' });
    }

    const access = resolveUserAccess(user);
    req.user = {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      supportLevel: user.supportLevel || (user.role === 'superadmin' ? 'manager' : null),
      accessProfile: access.profile,
      permissions: access.permissions,
      sessionId: decoded.sessionId || null,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Token invalido' });
  }
};
