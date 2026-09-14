ALTER TABLE "BillingLog" ADD COLUMN "receivableExternalId" TEXT;

CREATE INDEX "BillingLog_tenantId_receivableExternalId_status_sentAt_idx"
ON "BillingLog"("tenantId", "receivableExternalId", "status", "sentAt");
