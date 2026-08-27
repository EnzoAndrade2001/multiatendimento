const prisma = require('../lib/prisma');

const ALLOWED_PERIOD_DAYS = [7, 30, 90];
const DAY_MS = 24 * 60 * 60 * 1000;
const FIREBIRD_STALE_AFTER_MS = 15 * 60 * 1000;

function resolvePeriodDays(raw) {
  const parsed = parseInt(raw, 10);
  return ALLOWED_PERIOD_DAYS.includes(parsed) ? parsed : 30;
}

function classifyMessageGroups(groups = []) {
  return groups.reduce((totals, item) => {
    const count = Number(item?._count?.id || 0);
    if (item.fromBot) totals.ia += count;
    else if (item.fromMe) totals.human += count;
    else totals.received += count;
    return totals;
  }, { ia: 0, human: 0, received: 0 });
}

function toTime(value) {
  if (!value) return NaN;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : NaN;
}

// Início da conversa atual. Como o mesmo Ticket é reaproveitado por contato,
// createdAt aponta para o primeiro contato histórico; sessionStartedAt (quando
// preenchido) marca o começo da conversa vigente. Fallback para createdAt em
// tickets anteriores ao backfill.
function sessionStartTime(row) {
  const started = toTime(row?.sessionStartedAt);
  return Number.isFinite(started) ? started : toTime(row?.createdAt);
}

function durationMinutes(row) {
  const startedAt = sessionStartTime(row);
  const finishedAt = toTime(row?.resolvedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) return null;
  return (finishedAt - startedAt) / 60000;
}

function percentile(sortedValues, percentileValue) {
  if (!sortedValues.length) return null;
  const position = (sortedValues.length - 1) * percentileValue;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
}

function summarizeDurations(rows = []) {
  const values = rows.map(durationMinutes).filter((value) => value !== null && Number.isFinite(value));
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) {
    return { average: null, median: null, p90: null, sampleSize: 0, invalidCount: rows.length };
  }
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    average: Math.round(total / sorted.length),
    median: Math.round(percentile(sorted, 0.5)),
    p90: Math.round(percentile(sorted, 0.9)),
    sampleSize: sorted.length,
    invalidCount: rows.length - sorted.length,
  };
}

function maxCreatedAtByTicket(groups = []) {
  const map = new Map();
  groups.forEach((group) => {
    const time = toTime(group?._max?.createdAt);
    if (Number.isFinite(time)) map.set(group.ticketId, time);
  });
  return map;
}

// Retenção IA no escopo da conversa atual. "Retido pela IA" = ticket com mensagem
// do bot e SEM mensagem humana (fromMe e não fromBot) a partir de sessionStartedAt
// — mensagens humanas de conversas anteriores na mesma linha não desqualificam.
// Também calcula um denominador mais justo (engajado): apenas conversas em que o
// bot efetivamente atuou nesta sessão (mensagem fromBot >= sessionStartedAt).
function summarizeSessionRetention(candidates = [], humanReplyGroups = [], botMessageGroups = []) {
  const latestHumanReply = maxCreatedAtByTicket(humanReplyGroups);
  const latestBotMessage = maxCreatedAtByTicket(botMessageGroups);
  let retainedByIA = 0;
  let engagedSampleSize = 0;
  let retainedByIAEngaged = 0;
  candidates.forEach((ticket) => {
    const sessionStart = sessionStartTime(ticket);
    const humanTime = latestHumanReply.get(ticket.id);
    const retained = humanTime === undefined || humanTime < sessionStart;
    if (retained) retainedByIA += 1;
    const botTime = latestBotMessage.get(ticket.id);
    const engagedThisSession = botTime !== undefined && botTime >= sessionStart;
    if (engagedThisSession) {
      engagedSampleSize += 1;
      if (retained) retainedByIAEngaged += 1;
    }
  });
  return { retainedByIA, retainedByIAEngaged, engagedSampleSize };
}

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function fillDailyMessages(rows = [], periodStart, now = new Date()) {
  const byDate = new Map();
  rows.forEach((row) => {
    const key = dateKey(row.date);
    if (key) byDate.set(key, { ia: Number(row.ia || 0), human: Number(row.human || 0) });
  });
  const first = new Date(periodStart);
  first.setUTCHours(0, 0, 0, 0);
  const last = new Date(now);
  last.setUTCHours(0, 0, 0, 0);
  const filled = [];
  for (let cursor = first.getTime(); cursor <= last.getTime(); cursor += DAY_MS) {
    const current = new Date(cursor);
    const key = current.toISOString().slice(0, 10);
    const values = byDate.get(key) || { ia: 0, human: 0 };
    filled.push({
      date: current.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }),
      ia: values.ia,
      human: values.human,
    });
  }
  return filled;
}

async function getOperationalHealth(tenantId) {
  const [settings, instances] = await Promise.all([
    prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: { firebirdApiUrl: true, firebirdSyncEnabled: true, firebirdLastSyncAt: true, firebirdLastSyncStatus: true },
    }),
    prisma.waInstance.findMany({ where: { tenantId }, select: { instanceName: true, status: true } }),
  ]);

  const visibleInstances = instances.filter((instance) => !String(instance.instanceName || '').startsWith('DELETED_'));
  const connectedInstances = visibleInstances.filter((instance) => ['connected', 'open', 'online'].includes(String(instance.status || '').toLowerCase())).length;
  const whatsappStatus = visibleInstances.length === 0 ? 'not_configured' : (connectedInstances > 0 ? 'ok' : 'degraded');

  const lastSyncAt = settings?.firebirdLastSyncAt || null;
  const syncState = String(settings?.firebirdLastSyncStatus || '').toLowerCase();
  const firebirdConfigured = Boolean(settings?.firebirdApiUrl || settings?.firebirdSyncEnabled || lastSyncAt);
  let firebirdStatus = 'not_configured';
  if (firebirdConfigured) {
    if (syncState === 'syncing') firebirdStatus = 'syncing';
    else if (['error', 'partial', 'failed'].includes(syncState)) firebirdStatus = 'degraded';
    else if (!lastSyncAt) firebirdStatus = 'unknown';
    else if (Date.now() - new Date(lastSyncAt).getTime() > FIREBIRD_STALE_AFTER_MS) firebirdStatus = 'degraded';
    else firebirdStatus = 'ok';
  }

  const statuses = [whatsappStatus, firebirdStatus];
  const overall = statuses.includes('degraded')
    ? 'degraded'
    : statuses.includes('syncing')
      ? 'syncing'
      : statuses.every((status) => status === 'not_configured')
        ? 'unknown'
        : statuses.includes('unknown')
          ? 'degraded'
          : 'ok';

  return {
    overall,
    generatedAt: new Date().toISOString(),
    services: {
      whatsapp: { status: whatsappStatus, connected: connectedInstances, total: visibleInstances.length },
      firebird: { status: firebirdStatus, lastSyncAt, lastSyncStatus: settings?.firebirdLastSyncStatus || null },
    },
  };
}

async function buildAgentBreakdown(tenantId, periodStart, activeAgents) {
  if (!activeAgents.length) return [];
  const agentIds = activeAgents.map((agent) => agent.id);
  const [resolvedTickets, messageGroups, ratedTickets] = await Promise.all([
    prisma.ticket.findMany({
      where: { tenantId, agentId: { in: agentIds }, status: 'resolved', resolvedAt: { gte: periodStart } },
      select: { agentId: true, createdAt: true, sessionStartedAt: true, resolvedAt: true },
    }),
    prisma.message.groupBy({
      by: ['agentId'],
      where: { ticket: { tenantId }, agentId: { in: agentIds }, fromMe: true, fromBot: false, createdAt: { gte: periodStart } },
      _count: { id: true },
    }),
    prisma.ticket.findMany({
      where: { tenantId, agentId: { in: agentIds }, rating: { not: null }, ratingAt: { gte: periodStart } },
      select: { agentId: true, rating: true },
    }),
  ]);

  const ticketsByAgent = new Map();
  resolvedTickets.forEach((ticket) => {
    const rows = ticketsByAgent.get(ticket.agentId) || [];
    rows.push(ticket);
    ticketsByAgent.set(ticket.agentId, rows);
  });
  const messagesByAgent = new Map(messageGroups.map((group) => [group.agentId, Number(group._count?.id || 0)]));
  const ratingsByAgent = new Map();
  ratedTickets.forEach((ticket) => {
    const rows = ratingsByAgent.get(ticket.agentId) || [];
    rows.push(Number(ticket.rating));
    ratingsByAgent.set(ticket.agentId, rows);
  });

  return activeAgents.map((agent) => {
    const resolved = ticketsByAgent.get(agent.id) || [];
    const tma = summarizeDurations(resolved);
    const ratings = ratingsByAgent.get(agent.id) || [];
    const avgCsat = ratings.length ? Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 10) / 10 : null;
    return {
      id: agent.id,
      name: agent.name,
      resolvedCount: resolved.length,
      messagesCount: messagesByAgent.get(agent.id) || 0,
      avgTma: tma.average,
      medianTma: tma.median,
      p90Tma: tma.p90,
      tmaSampleSize: tma.sampleSize,
      avgCsat,
      csatCount: ratings.length,
    };
  }).filter((agent) => agent.resolvedCount > 0 || agent.messagesCount > 0)
    .sort((a, b) => b.resolvedCount - a.resolvedCount || b.messagesCount - a.messagesCount);
}

async function getStats(req, res) {
  const tenantId = req.user.tenantId;
  const periodDays = resolvePeriodDays(req.query.days);
  const generatedAt = new Date();
  const periodStart = new Date(generatedAt.getTime() - periodDays * DAY_MS);

  const [messages, messagesAllTime, tickets, iaCandidateTickets, resolvedTickets, totalContacts, newContacts, activeAgents, ratings, ratingsDist, dailyMessageRows, health] = await Promise.all([
    prisma.message.groupBy({
      by: ['fromBot', 'fromMe'],
      where: { ticket: { tenantId }, createdAt: { gte: periodStart } },
      _count: { id: true },
    }),
    prisma.message.groupBy({
      by: ['fromBot', 'fromMe'],
      where: { ticket: { tenantId } },
      _count: { id: true },
    }),
    prisma.ticket.groupBy({ by: ['status'], where: { tenantId }, _count: { id: true } }),
    // Candidatas à retenção IA: encerradas no período que tiveram alguma mensagem
    // do bot (em qualquer momento). O recorte por sessão é feito em JS abaixo,
    // pois o Prisma não referencia o campo da linha externa dentro de `none`.
    prisma.ticket.findMany({
      where: {
        tenantId,
        status: 'resolved',
        resolvedAt: { gte: periodStart },
        messages: { some: { fromBot: true } },
      },
      select: { id: true, sessionStartedAt: true, createdAt: true },
    }),
    prisma.ticket.findMany({
      where: { tenantId, status: 'resolved', resolvedAt: { gte: periodStart } },
      select: { createdAt: true, sessionStartedAt: true, resolvedAt: true },
    }),
    prisma.contact.count({ where: { tenantId } }),
    prisma.contact.count({ where: { tenantId, createdAt: { gte: periodStart } } }),
    prisma.user.findMany({ where: { tenantId, active: true }, select: { id: true, name: true } }),
    prisma.ticket.aggregate({
      where: { tenantId, rating: { not: null }, ratingAt: { gte: periodStart } },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    prisma.ticket.groupBy({
      by: ['rating'],
      where: { tenantId, rating: { not: null }, ratingAt: { gte: periodStart } },
      _count: { id: true },
    }),
    prisma.$queryRaw`
      SELECT
        DATE("createdAt") as date,
        COUNT(CASE WHEN "fromBot" = true THEN 1 END)::int as ia,
        COUNT(CASE WHEN "fromMe" = true AND "fromBot" = false THEN 1 END)::int as human
      FROM "Message"
      WHERE "createdAt" >= ${periodStart}
      AND "ticketId" IN (SELECT id FROM "Ticket" WHERE "tenantId" = ${tenantId})
      GROUP BY DATE("createdAt")
      ORDER BY DATE("createdAt") ASC
    `,
    getOperationalHealth(tenantId),
  ]);

  const periodMessages = classifyMessageGroups(messages);
  const allTimeMessages = classifyMessageGroups(messagesAllTime);
  const tma = summarizeDurations(resolvedTickets);

  // Retenção IA no escopo da conversa atual: verifica, para cada candidata, se há
  // mensagem humana / do bot a partir do início da sessão (sessionStartedAt).
  const iaCandidateIds = iaCandidateTickets.map((ticket) => ticket.id);
  const [humanReplyGroups, botMessageGroups] = iaCandidateIds.length
    ? await Promise.all([
        prisma.message.groupBy({
          by: ['ticketId'],
          where: { ticketId: { in: iaCandidateIds }, fromMe: true, fromBot: false },
          _max: { createdAt: true },
        }),
        prisma.message.groupBy({
          by: ['ticketId'],
          where: { ticketId: { in: iaCandidateIds }, fromBot: true },
          _max: { createdAt: true },
        }),
      ])
    : [[], []];
  const retention = summarizeSessionRetention(iaCandidateTickets, humanReplyGroups, botMessageGroups);
  const resolvedByIA = retention.retainedByIA;

  const agentBreakdown = await buildAgentBreakdown(tenantId, periodStart, activeAgents);
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  ratingsDist.forEach((item) => {
    if (Object.prototype.hasOwnProperty.call(dist, item.rating)) dist[item.rating] = Number(item._count?.id || 0);
  });
  const avgRating = ratings._avg.rating == null ? null : Math.round(ratings._avg.rating * 10) / 10;
  const totalResolved = resolvedTickets.length;

  res.json({
    periodDays,
    generatedAt: generatedAt.toISOString(),
    health,
    kpis: {
      // These fields represent outbound messages; inbound traffic is exposed separately.
      iaMessages: periodMessages.ia,
      humanMessages: periodMessages.human,
      receivedMessages: periodMessages.received,
      totalMessages: periodMessages.ia + periodMessages.human,
      conversationMessages: periodMessages.ia + periodMessages.human + periodMessages.received,
      iaMessagesAllTime: allTimeMessages.ia,
      humanMessagesAllTime: allTimeMessages.human,
      receivedMessagesAllTime: allTimeMessages.received,
      totalMessagesAllTime: allTimeMessages.ia + allTimeMessages.human,
      conversationMessagesAllTime: allTimeMessages.ia + allTimeMessages.human + allTimeMessages.received,
      hoursSaved: Math.round((periodMessages.ia * 2) / 60),
      avgTMA: tma.average,
      medianTMA: tma.median,
      p90TMA: tma.p90,
      tmaSampleSize: tma.sampleSize,
      tmaInvalidCount: tma.invalidCount,
      retentionRate: totalResolved > 0 ? Math.round((resolvedByIA / totalResolved) * 100) : null,
      retainedByIA: resolvedByIA,
      retentionSampleSize: totalResolved,
      // Denominador mais justo: só conversas em que o bot atuou nesta sessão.
      retentionRateEngaged: retention.engagedSampleSize > 0
        ? Math.round((retention.retainedByIAEngaged / retention.engagedSampleSize) * 100)
        : null,
      retainedByIAEngaged: retention.retainedByIAEngaged,
      retentionEngagedSampleSize: retention.engagedSampleSize,
      totalResolved,
      totalContacts,
      newContacts,
      activeTickets: tickets.find((item) => item.status === 'open')?._count.id || 0,
      pendingTickets: tickets.find((item) => item.status === 'pending')?._count.id || 0,
      avgRating,
      totalRatings: ratings._count.rating,
    },
    ticketsByStatus: tickets,
    agentRanking: agentBreakdown.slice(0, 5).map((agent) => ({ name: agent.name, count: agent.resolvedCount })),
    agentBreakdown,
    dailyMessages: fillDailyMessages(dailyMessageRows, periodStart, generatedAt),
    ratingsDistribution: Object.keys(dist).map((rating) => ({ rating, count: dist[rating] })),
  });
}

module.exports = {
  getStats,
  classifyMessageGroups,
  summarizeDurations,
  fillDailyMessages,
  durationMinutes,
  sessionStartTime,
  summarizeSessionRetention,
};
