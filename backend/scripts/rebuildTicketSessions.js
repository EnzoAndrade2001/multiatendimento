const prisma = require('../src/lib/prisma');
const { buildHistoricalSessions } = require('../src/services/ticketSessionService');

const APPLY = process.argv.includes('--apply');
const tenantArg = process.argv.find((arg) => arg.startsWith('--tenant='));
const tenantId = tenantArg ? tenantArg.slice('--tenant='.length) : null;
const BATCH_SIZE = 100;

async function main() {
  let cursor = null;
  let ticketsRead = 0;
  let sessionsBuilt = 0;
  let sessionsWritten = 0;

  for (;;) {
    const tickets = await prisma.ticket.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        sessions: { none: {} },
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        messages: {
          select: { createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
        events: {
          where: { type: { in: ['resolved', 'reopened'] } },
          select: { type: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!tickets.length) break;

    for (const ticket of tickets) {
      const sessions = buildHistoricalSessions(ticket, ticket.messages, ticket.events);
      ticketsRead += 1;
      sessionsBuilt += sessions.length;
      if (APPLY && sessions.length) {
        const result = await prisma.$transaction(async (tx) => {
          const created = await tx.ticketSession.createMany({ data: sessions, skipDuplicates: true });
          const current = sessions.findLast((session) => session.status === 'OPEN') || sessions.at(-1);
          await tx.ticket.update({ where: { id: ticket.id }, data: { sessionStartedAt: current.startedAt } });
          return created;
        });
        sessionsWritten += result.count;
      }
    }

    cursor = tickets.at(-1).id;
    console.log(`[sessions] tickets=${ticketsRead} built=${sessionsBuilt} written=${sessionsWritten} mode=${APPLY ? 'apply' : 'dry-run'}`);
  }

  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', tenantId, ticketsRead, sessionsBuilt, sessionsWritten }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
