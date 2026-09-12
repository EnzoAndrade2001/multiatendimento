const router = require('express').Router();
const prisma = require('../lib/prisma');
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const requireEntitlement = require('../middlewares/requireEntitlement');
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
router.use(authenticate, requirePermission('inbox.view'), requireEntitlement('inbox'));
router.get('/availability', wrap(async (req, res) => {
  const user = await prisma.user.findFirst({ where: { id: req.user.userId, tenantId: req.user.tenantId }, select: { attendanceAvailable: true } });
  res.json({ available: Boolean(user?.attendanceAvailable) });
}));
router.put('/availability', wrap(async (req, res) => {
  if (req.body.available !== undefined && typeof req.body.available !== 'boolean') return res.status(400).json({ error: 'Disponibilidade inválida.' });
  await prisma.user.updateMany({ where: { id: req.user.userId, tenantId: req.user.tenantId, active: true }, data: { attendanceHeartbeatAt: new Date(), ...(req.body.available !== undefined ? { attendanceAvailable: req.body.available } : {}) } });
  res.json({ ok: true });
}));
router.use(requirePermission('settings.attendance.manage'));
router.get('/', wrap(async (req, res) => {
  const tenantId = req.user.tenantId;
  const [policy, teams, alerts] = await Promise.all([
    prisma.attendancePolicy.findUnique({ where: { tenantId } }),
    prisma.team.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    prisma.ticket.findMany({ where: { tenantId, status: { in: ['open', 'pending'] }, slaDueAt: { not: null }, OR: [{ slaWarnedAt: { not: null } }, { slaBreachedAt: { not: null } }] }, include: { contact: { select: { name: true } }, agent: { select: { name: true } }, team: { select: { name: true } } }, orderBy: { slaDueAt: 'asc' }, take: 100 }),
  ]);
  res.json({ policy: policy || { slaEnabled: false, assignmentEnabled: false, redistributeUnavailable: false, maxActiveTickets: 10, unavailableMinutes: 5, rules: [] }, teams, alerts });
}));
router.put('/', wrap(async (req, res) => {
  const tenantId = req.user.tenantId;
  const { slaEnabled, assignmentEnabled, redistributeUnavailable, maxActiveTickets, unavailableMinutes, rules } = req.body;
  if ([slaEnabled, assignmentEnabled, redistributeUnavailable].some(v => typeof v !== 'boolean') || !Number.isInteger(maxActiveTickets) || maxActiveTickets < 1 || maxActiveTickets > 100 || !Number.isInteger(unavailableMinutes) || unavailableMinutes < 2 || unavailableMinutes > 1440 || !Array.isArray(rules) || rules.length > 100) return res.status(400).json({ error: 'Configuração inválida.' });
  const teams = await prisma.team.findMany({ where: { tenantId }, select: { id: true } });
  const seen = new Set();
  for (const r of rules) {
    if (!r || (r.teamId && !teams.some(t => t.id === r.teamId)) || (r.priority && !['low', 'medium', 'high', 'urgent'].includes(r.priority)) || !Number.isInteger(r.minutes) || r.minutes < 1 || r.minutes > 10080 || !Number.isInteger(r.warningMinutes) || r.warningMinutes < 0 || r.warningMinutes >= r.minutes || typeof r.businessHours !== 'boolean') return res.status(400).json({ error: 'Regra de SLA inválida. Verifique equipe, prazo e antecedência.' });
    const key = `${r.teamId || ''}:${r.priority || ''}`;
    if (seen.has(key)) return res.status(400).json({ error: 'Há regras duplicadas para a mesma equipe e prioridade.' });
    seen.add(key);
  }
  if (slaEnabled && !rules.length) return res.status(400).json({ error: 'Adicione pelo menos uma regra de SLA.' });
  if (slaEnabled && rules.some(r => r.businessHours)) {
    const hours = await prisma.businessHour.findMany({ where: { tenantId } });
    if (!hours.some(h => h.active && h.start < h.end)) return res.status(400).json({ error: 'Configure o horário comercial antes de ativar estas regras.' });
  }
  const data = { slaEnabled, assignmentEnabled, redistributeUnavailable, maxActiveTickets, unavailableMinutes, rules: rules.map(r => ({ teamId: r.teamId || null, priority: r.priority || null, minutes: r.minutes, warningMinutes: r.warningMinutes, businessHours: r.businessHours })) };
  const policy = await prisma.attendancePolicy.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
  if (!slaEnabled) await prisma.ticket.updateMany({ where: { tenantId, slaPolicyKey: { not: null } }, data: { slaDueAt: null, slaPolicyKey: null } });
  res.json(policy);
}));
module.exports = router;
