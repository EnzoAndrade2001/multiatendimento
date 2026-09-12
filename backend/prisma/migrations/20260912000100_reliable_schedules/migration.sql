ALTER TABLE "ScheduledMessage"
 ADD COLUMN "instanceId" TEXT,
 ADD COLUMN "status" TEXT NOT NULL DEFAULT 'queued',
 ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
 ADD COLUMN "claimedAt" TIMESTAMP(3),
 ADD COLUMN "claimToken" TEXT,
 ADD COLUMN "sentAt" TIMESTAMP(3),
 ADD COLUMN "lastError" TEXT,
 ADD COLUMN "providerMessageId" TEXT,
 ADD COLUMN "deliveryUncertain" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ScheduledMessage" s SET "instanceId" = c."instanceId" FROM "Contact" c WHERE c.id = s."contactId" AND c."tenantId" = s."tenantId";
-- The former boolean cannot distinguish delivered from blocked messages.
UPDATE "ScheduledMessage" SET "status" = 'blocked', "deliveryUncertain" = true,
 "lastError" = 'Registro legado processado: confirme o envio no histórico antes de reenviar.' WHERE processed = true;
CREATE INDEX "ScheduledMessage_status_sendAt_nextAttemptAt_idx" ON "ScheduledMessage"("status", "sendAt", "nextAttemptAt");
CREATE INDEX "ScheduledMessage_tenantId_contactId_sendAt_idx" ON "ScheduledMessage"("tenantId", "contactId", "sendAt");
