const prisma = require('../lib/prisma');

const HOUR_MS = 60 * 60 * 1000;
const SESSION_INACTIVITY_HOURS = Math.max(1, Number.parseInt(process.env.TICKET_SESSION_INACTIVITY_HOURS, 10) || 24);
const SESSION_INACTIVITY_MS = SESSION_INACTIVITY_HOURS * HOUR_MS;

function asDate(value, fallback = null) {
  const date = value instanceof Date ? value : new Date(value || '');
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function activityStartsNewSession(ticket, occurredAt = new Date()) {
  const at = asDate(occurredAt, new Date());
  if (!ticket) return { startsNew: true, trigger: 'CREATED', startedAt: at };
  if (ticket.status === 'resolved') return { startsNew: true, trigger: 'REOPENED', startedAt: at };
  const lastActivity = asDate(ticket.lastMessageAt);
  if (lastActivity && at.getTime() - lastActivity.getTime() >= SESSION_INACTIVITY_MS) {
    return { startsNew: true, trigger: 'INACTIVITY', startedAt: at };
  }
  return {
    startsNew: false,
    trigger: 'CREATED',
    startedAt: asDate(ticket.sessionStartedAt) || asDate(ticket.createdAt) || at,
  };
}

async function lockTicket(tx, ticketId) {
  await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${ticketId} FOR UPDATE`;
}

async function startTicketSession({ tenantId, ticketId, startedAt = new Date(), trigger = 'CREATED', forceNew = false, closeAt = null }) {
  const normalizedStart = asDate(startedAt, new Date());
  return prisma.$transaction(async (tx) => {
    await lockTicket(tx, ticketId);
    const ticket = await tx.ticket.findUnique({ where: { id: ticketId }, select: { agentId: true } });
    const current = await tx.ticketSession.findFirst({
      where: { ticketId, status: 'OPEN' },
      orderBy: { startedAt: 'desc' },
    });
    if (current && !forceNew) return { session: current, startedNew: false };
    if (current) {
      const requestedEnd = asDate(closeAt) || normalizedStart;
      const safeEnd = requestedEnd < current.startedAt ? current.startedAt : requestedEnd;
      await tx.ticketSession.update({
        where: { id: current.id },
        data: { status: 'INACTIVE', endedAt: safeEnd },
      });
    }
    const session = await tx.ticketSession.create({
      data: { tenantId, ticketId, agentId: ticket?.agentId || null, startedAt: normalizedStart, trigger, status: 'OPEN' },
    });
    await tx.ticket.update({ where: { id: ticketId }, data: { sessionStartedAt: normalizedStart } });
    return { session, startedNew: true };
  });
}

async function ensureSessionForActivity(ticket, occurredAt = new Date()) {
  const decision = activityStartsNewSession(ticket, occurredAt);
  return startTicketSession({
    tenantId: ticket.tenantId,
    ticketId: ticket.id,
    startedAt: decision.startedAt,
    trigger: decision.trigger,
    forceNew: decision.startsNew,
    closeAt: ticket.lastMessageAt || decision.startedAt,
  });
}

async function resolveTicketSession(ticket, resolvedAt = new Date()) {
  const normalizedEnd = asDate(resolvedAt, new Date());
  return prisma.$transaction(async (tx) => {
    await lockTicket(tx, ticket.id);
    let current = await tx.ticketSession.findFirst({
      where: { ticketId: ticket.id, status: 'OPEN' },
      orderBy: { startedAt: 'desc' },
    });
    if (!current) {
      const startedAt = asDate(ticket.sessionStartedAt) || asDate(ticket.createdAt) || normalizedEnd;
      current = await tx.ticketSession.create({
        data: {
          tenantId: ticket.tenantId,
          ticketId: ticket.id,
          startedAt: startedAt > normalizedEnd ? normalizedEnd : startedAt,
          trigger: 'HISTORICAL',
          status: 'OPEN',
          reconstructed: true,
        },
      });
    }
    const safeEnd = normalizedEnd < current.startedAt ? current.startedAt : normalizedEnd;
    return tx.ticketSession.update({
      where: { id: current.id },
      data: { status: 'RESOLVED', endedAt: safeEnd, agentId: ticket.agentId || current.agentId || null },
    });
  });
}

function buildHistoricalSessions(ticket, messages = [], events = []) {
  const orderedMessages = messages
    .map((message) => ({ ...message, createdAt: asDate(message.createdAt) }))
    .filter((message) => message.createdAt)
    .sort((left, right) => left.createdAt - right.createdAt);
  const resolvedEvents = events
    .filter((event) => event.type === 'resolved')
    .map((event) => asDate(event.createdAt))
    .filter(Boolean)
    .sort((left, right) => left - right);
  const reopenedEvents = events
    .filter((event) => event.type === 'reopened')
    .map((event) => asDate(event.createdAt))
    .filter(Boolean);

  const starts = [];
  let previousMessageAt = null;
  orderedMessages.forEach((message, index) => {
    const previousResolvedBefore = previousMessageAt
      ? resolvedEvents.some((endedAt) => endedAt >= previousMessageAt && endedAt < message.createdAt)
      : false;
    const inactivityGap = previousMessageAt && message.createdAt - previousMessageAt >= SESSION_INACTIVITY_MS;
    if (index === 0 || inactivityGap || previousResolvedBefore) starts.push(message.createdAt);
    previousMessageAt = message.createdAt;
  });
  reopenedEvents.forEach((date) => starts.push(date));
  if (!starts.length) starts.push(asDate(ticket.sessionStartedAt) || asDate(ticket.createdAt) || new Date());

  const uniqueStarts = [...new Map(starts.sort((a, b) => a - b).map((date) => [date.getTime(), date])).values()];
  const hasActivityEvidence = orderedMessages.length > 0 || reopenedEvents.length > 0;
  return uniqueStarts.map((startedAt, index) => {
    const nextStart = uniqueStarts[index + 1] || null;
    const resolvedAt = hasActivityEvidence
      ? resolvedEvents.find((date) => date >= startedAt && (!nextStart || date < nextStart))
        || (!nextStart && ticket.status === 'resolved' && asDate(ticket.resolvedAt) >= startedAt ? asDate(ticket.resolvedAt) : null)
      : null;
    const intervalMessages = orderedMessages.filter((message) => message.createdAt >= startedAt && (!nextStart || message.createdAt < nextStart));
    const lastMessageAt = intervalMessages.at(-1)?.createdAt || startedAt;
    return {
      tenantId: ticket.tenantId,
      ticketId: ticket.id,
      agentId: ticket.agentId || null,
      startedAt,
      endedAt: resolvedAt || (nextStart ? lastMessageAt : null),
      status: resolvedAt ? 'RESOLVED' : (nextStart || ticket.status === 'resolved' ? 'INACTIVE' : 'OPEN'),
      trigger: 'HISTORICAL',
      reconstructed: true,
    };
  });
}

module.exports = {
  SESSION_INACTIVITY_HOURS,
  activityStartsNewSession,
  buildHistoricalSessions,
  ensureSessionForActivity,
  resolveTicketSession,
  startTicketSession,
};
