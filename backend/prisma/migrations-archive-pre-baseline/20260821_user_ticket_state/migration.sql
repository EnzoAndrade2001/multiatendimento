CREATE TABLE IF NOT EXISTS "UserTicketState" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "isPinned" BOOLEAN NOT NULL DEFAULT false,
  "isUnread" BOOLEAN NOT NULL DEFAULT false,
  "pinnedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserTicketState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserTicketState_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserTicketState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserTicketState_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserTicketState_userId_ticketId_key"
  ON "UserTicketState"("userId", "ticketId");
CREATE INDEX IF NOT EXISTS "UserTicketState_tenantId_userId_isPinned_idx"
  ON "UserTicketState"("tenantId", "userId", "isPinned");
CREATE INDEX IF NOT EXISTS "UserTicketState_ticketId_idx"
  ON "UserTicketState"("ticketId");
