-- Inbox and webhook performance indexes
CREATE INDEX IF NOT EXISTS "Contact_tenantId_phone_idx" ON "Contact"("tenantId", "phone");

CREATE INDEX IF NOT EXISTS "Ticket_tenantId_status_updatedAt_idx" ON "Ticket"("tenantId", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "Ticket_tenantId_agentId_status_idx" ON "Ticket"("tenantId", "agentId", "status");
CREATE INDEX IF NOT EXISTS "Ticket_tenantId_teamId_status_idx" ON "Ticket"("tenantId", "teamId", "status");

CREATE INDEX IF NOT EXISTS "TicketEvent_ticketId_createdAt_idx" ON "TicketEvent"("ticketId", "createdAt");
CREATE INDEX IF NOT EXISTS "Knowledge_tenantId_active_idx" ON "Knowledge"("tenantId", "active");
CREATE INDEX IF NOT EXISTS "Message_ticketId_createdAt_idx" ON "Message"("ticketId", "createdAt");
