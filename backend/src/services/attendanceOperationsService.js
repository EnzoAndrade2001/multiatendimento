const prisma = require('../lib/prisma');
const { calculateBusinessMinutesBetween } = require('./businessHourService');
const { resolveUserAccess } = require('../auth/permissions');

function selectRule(rules, ticket) {
  return [...rules].filter(r => (!r.teamId || r.teamId === ticket.teamId) && (!r.priority || r.priority === ticket.priority))
    .sort((a, b) => (Number(Boolean(b.teamId)) * 2 + Number(Boolean(b.priority))) - (Number(Boolean(a.teamId)) * 2 + Number(Boolean(a.priority))))[0];
}

function dueAt(start, minutes, hours, businessHours) {
  if (!businessHours) return new Date(new Date(start).getTime() + minutes * 60000);
  if (!hours.some(h => h.active && h.start < h.end)) return null;
  // Reuse the same timezone and calendar as attendance reporting. Binary search
  // keeps the number of calendar scans bounded, including weekends and DST.
  const startMs = new Date(start).getTime();
  let low = 0; let high = Math.max(1440, minutes);
  const elapsed = value => calculateBusinessMinutesBetween(start, new Date(startMs + value * 60000), hours);
  while (elapsed(high) < minutes && high < 366 * 24 * 60) high = Math.min(high * 2, 366 * 24 * 60);
  if (elapsed(high) < minutes) return null;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (elapsed(middle) >= minutes) high = middle; else low = middle + 1; }
  return new Date(startMs + low * 60000);
}

function chooseAgent(users, ticket, counts, policy, now) {
  return users.filter(user => user.active && user.attendanceAvailable && resolveUserAccess(user).permissions.includes('inbox.assign')
    && user.attendanceHeartbeatAt && now - new Date(user.attendanceHeartbeatAt) < 120000
    && (!ticket.teamId || user.teamMembers.some(member => member.teamId === ticket.teamId))
    && (counts.get(user.id) || 0) < policy.maxActiveTickets)
    .sort((a, b) => (counts.get(a.id) || 0) - (counts.get(b.id) || 0) || a.id.localeCompare(b.id))[0];
}

async function processTenant(tenantId, io, db = prisma, now = new Date()) {
  const changed = await db.$transaction(async tx => {
    // Serialize every allocator for this tenant across backend replicas.
    await tx.$queryRaw`SELECT "id" FROM "AttendancePolicy" WHERE "tenantId" = ${tenantId} FOR UPDATE`;
    const policy = await tx.attendancePolicy.findUnique({ where: { tenantId } });
    if (!policy || (!policy.slaEnabled && !policy.assignmentEnabled)) return [];
    const tickets = await tx.ticket.findMany({ where: { tenantId, status: { in: ['open', 'pending'] } }, orderBy: { createdAt: 'asc' } });
    const users = policy.assignmentEnabled ? await tx.user.findMany({ where: { tenantId }, include: { teamMembers: true } }) : [];
    const hours = policy.slaEnabled ? await tx.businessHour.findMany({ where: { tenantId } }) : [];
    const counts = new Map();
    for (const t of tickets) if (t.agentId) counts.set(t.agentId, (counts.get(t.agentId) || 0) + 1);
    const result = [];
    for (const ticket of tickets) {
      const data = {}; const events = [];
      if (policy.slaEnabled) {
        const rule = selectRule(policy.rules || [], ticket);
        const start = ticket.sessionStartedAt || ticket.createdAt;
        const responded = ticket.firstResponseAt && new Date(ticket.firstResponseAt) >= new Date(start);
        const key = JSON.stringify([start, ticket.teamId, ticket.priority, rule || null, rule?.businessHours ? hours.map(h => [h.dayOfWeek, h.active, h.start, h.end]).sort((a, b) => a[0] - b[0]) : null]);
        if (ticket.slaPolicyKey !== key) Object.assign(data, { slaPolicyKey: key, slaDueAt: !responded && rule ? dueAt(start, rule.minutes, hours, rule.businessHours) : null, ...(!responded && ticket.firstResponseAt ? { firstResponseAt: null } : {}) });
        if (responded && ticket.slaDueAt) data.slaDueAt = null;
        const deadline = Object.hasOwn(data, 'slaDueAt') ? data.slaDueAt : ticket.slaDueAt;
        if (deadline && !responded && rule) {
          const remaining = new Date(deadline) - now;
          if (remaining <= 0 && !(Object.hasOwn(data, 'slaBreachedAt') ? data.slaBreachedAt : ticket.slaBreachedAt)) { data.slaBreachedAt = now; events.push('sla_breached'); }
          else if (remaining > 0 && remaining <= rule.warningMinutes * 60000 && !(Object.hasOwn(data, 'slaWarnedAt') ? data.slaWarnedAt : ticket.slaWarnedAt)) { data.slaWarnedAt = now; events.push('sla_warning'); }
        }
      }
      if (policy.assignmentEnabled) {
        const owner = users.find(u => u.id === ticket.agentId);
        const unavailable = owner && (!owner.active || !owner.attendanceAvailable || !owner.attendanceHeartbeatAt || now - new Date(owner.attendanceHeartbeatAt) >= policy.unavailableMinutes * 60000);
        if (!ticket.agentId || (policy.redistributeUnavailable && (!owner || unavailable))) {
          const next = chooseAgent(users.filter(u => u.id !== ticket.agentId), ticket, counts, policy, now);
          if (next) {
            if (ticket.agentId) counts.set(ticket.agentId, Math.max(0, (counts.get(ticket.agentId) || 0) - 1));
            counts.set(next.id, (counts.get(next.id) || 0) + 1);
            Object.assign(data, { agentId: next.id, status: 'open' }); events.push(ticket.agentId ? 'auto_redistributed' : 'auto_assigned');
          }
        }
      }
      if (Object.keys(data).length) {
        // Do not overwrite a manual assignment or response arriving during this scan.
        const updated = await tx.ticket.updateMany({ where: { id: ticket.id, tenantId, updatedAt: ticket.updatedAt, status: ticket.status, firstResponseAt: ticket.firstResponseAt }, data });
        if (!updated.count) continue;
        for (const type of events) await tx.ticketEvent.create({ data: { tenantId, ticketId: ticket.id, type, payload: JSON.stringify({ agentId: data.agentId || ticket.agentId, deadline: data.slaDueAt || ticket.slaDueAt }) } });
        result.push({ ticketId: ticket.id, ...data, events });
      }
    }
    return result;
  }, { timeout: 60000 });
  for (const item of changed) io?.to(tenantId).emit('ticket_updated', item);
  return changed;
}

function start(io) {
  let busy = false;
  const run = async () => {
    if (busy) return; busy = true;
    try {
      const policies = await prisma.attendancePolicy.findMany({ where: { OR: [{ slaEnabled: true }, { assignmentEnabled: true }] }, select: { tenantId: true } });
      for (const policy of policies) await processTenant(policy.tenantId, io);
    } catch (error) { console.error('[attendance-operations]', error.message); }
    finally { busy = false; }
  };
  const timer = setInterval(run, 30000); timer.unref(); run();
  return () => clearInterval(timer);
}
module.exports = { dueAt, selectRule, chooseAgent, processTenant, start };
