function validateSession(body) {
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(String(body?.sessionId || ''))) {
    throw Object.assign(new Error('Sessão de presença inválida.'), { status: 400 });
  }
  return body.sessionId;
}

async function heartbeat(db, user, ticketId, body, now = new Date()) {
  const sessionId = validateSession(body);
  const { tenantId, userId } = user;
  const cutoff = new Date(now.getTime() - 45000);
  const data = { tenantId, userId, ticketId, lastSeenAt: now,
    typingUntil: body.typing === true ? new Date(now.getTime() + 6000) : null,
    sendingUntil: body.sending === true ? new Date(now.getTime() + 20000) : null };
  await db.ticketPresence.upsert({ where: { userId_sessionId: { userId, sessionId } },
    create: { ...data, sessionId }, update: data });
  await db.ticketPresence.deleteMany({ where: { tenantId, lastSeenAt: { lt: cutoff } } });
  const rows = await db.ticketPresence.findMany({ where: { tenantId, ticketId, userId: { not: userId }, lastSeenAt: { gte: cutoff }, user: { active: true } },
    select: { userId: true, typingUntil: true, sendingUntil: true, user: { select: { name: true } } }, take: 100 });
  const viewers = new Map();
  for (const row of rows) {
    const previous = viewers.get(row.userId);
    viewers.set(row.userId, { id: row.userId, name: row.user.name,
      typing: Boolean(previous?.typing || (row.typingUntil && row.typingUntil > now)),
      sending: Boolean(previous?.sending || (row.sendingUntil && row.sendingUntil > now)) });
  }
  return { viewers: [...viewers.values()] };
}
async function leave(db, user, ticketId, body) {
  return db.ticketPresence.deleteMany({ where: { tenantId: user.tenantId, userId: user.userId, ticketId, sessionId: validateSession(body) } });
}
module.exports = { heartbeat, leave, validateSession };
