CREATE TABLE "SupportAccessSession" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "targetTenantId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "SupportAccessSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportAccessSession_actorUserId_createdAt_idx" ON "SupportAccessSession"("actorUserId", "createdAt");
CREATE INDEX "SupportAccessSession_targetTenantId_createdAt_idx" ON "SupportAccessSession"("targetTenantId", "createdAt");
CREATE INDEX "SupportAccessSession_expiresAt_endedAt_idx" ON "SupportAccessSession"("expiresAt", "endedAt");
ALTER TABLE "SupportAccessSession" ADD CONSTRAINT "SupportAccessSession_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportAccessSession" ADD CONSTRAINT "SupportAccessSession_targetTenantId_fkey" FOREIGN KEY ("targetTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
