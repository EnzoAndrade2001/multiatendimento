CREATE TABLE "TicketPresence" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "typingUntil" TIMESTAMP(3),
  "sendingUntil" TIMESTAMP(3),
  CONSTRAINT "TicketPresence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TicketPresence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TicketPresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TicketPresence_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TicketPresence_userId_sessionId_key" ON "TicketPresence"("userId", "sessionId");
CREATE INDEX "TicketPresence_tenantId_ticketId_lastSeenAt_idx" ON "TicketPresence"("tenantId", "ticketId", "lastSeenAt");
