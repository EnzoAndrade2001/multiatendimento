/**
 * Backfill de Ticket.sessionStartedAt.
 *
 * O mesmo Ticket é reaproveitado por contato (reaberto a cada nova conversa),
 * então createdAt aponta para o primeiro contato histórico. sessionStartedAt
 * passa a marcar o início da conversa vigente e alimenta as métricas do
 * dashboard (TMA e Retenção IA). Para linhas anteriores à coluna, usamos
 * createdAt como melhor aproximação disponível.
 *
 * É idempotente: só toca linhas com sessionStartedAt IS NULL. Pode rodar
 * quantas vezes precisar. O deploy roda `prisma db push --accept-data-loss`
 * no boot, criando a coluna nullable; rode este script logo depois.
 *
 * Uso:
 *   cd backend && node scripts/backfillTicketSessionStartedAt.js
 */
const prisma = require('../src/lib/prisma');

async function main() {
  const pending = await prisma.ticket.count({ where: { sessionStartedAt: null } });
  console.log(`Tickets sem sessionStartedAt: ${pending}`);
  if (!pending) {
    console.log('Nada a fazer.');
    return;
  }

  // updateMany não referencia outra coluna diretamente; usamos UPDATE cru.
  const affected = await prisma.$executeRaw`
    UPDATE "Ticket"
    SET "sessionStartedAt" = "createdAt"
    WHERE "sessionStartedAt" IS NULL
  `;
  console.log(`Linhas atualizadas: ${affected}`);

  const remaining = await prisma.ticket.count({ where: { sessionStartedAt: null } });
  console.log(`Restantes com sessionStartedAt nulo: ${remaining}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
