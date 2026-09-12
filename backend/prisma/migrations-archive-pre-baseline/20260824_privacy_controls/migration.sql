-- Controles LGPD aditivos. Esta migração não altera nem remove dados existentes.
CREATE TABLE "PrivacyAuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrivacyAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrivacyRetentionPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "mediaRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "auditRetentionDays" INTEGER NOT NULL DEFAULT 730,
    "billingRetentionDays" INTEGER NOT NULL DEFAULT 2555,
    "agentLogRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "lastPreviewAt" TIMESTAMP(3),
    "lastPreview" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrivacyRetentionPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrivacyPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "purposes" JSONB NOT NULL,
    "channel" JSONB,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrivacyPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrivacyAcceptance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrivacyAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrivacyAuditLog_tenantId_createdAt_idx" ON "PrivacyAuditLog"("tenantId", "createdAt");
CREATE INDEX "PrivacyAuditLog_tenantId_action_createdAt_idx" ON "PrivacyAuditLog"("tenantId", "action", "createdAt");
CREATE UNIQUE INDEX "PrivacyRetentionPolicy_tenantId_key" ON "PrivacyRetentionPolicy"("tenantId");
CREATE UNIQUE INDEX "PrivacyPolicy_tenantId_version_key" ON "PrivacyPolicy"("tenantId", "version");
CREATE INDEX "PrivacyPolicy_tenantId_active_effectiveAt_idx" ON "PrivacyPolicy"("tenantId", "active", "effectiveAt");
CREATE UNIQUE INDEX "PrivacyAcceptance_tenantId_userId_policyVersion_key" ON "PrivacyAcceptance"("tenantId", "userId", "policyVersion");
CREATE INDEX "PrivacyAcceptance_tenantId_userId_acceptedAt_idx" ON "PrivacyAcceptance"("tenantId", "userId", "acceptedAt");

ALTER TABLE "PrivacyAuditLog" ADD CONSTRAINT "PrivacyAuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrivacyRetentionPolicy" ADD CONSTRAINT "PrivacyRetentionPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrivacyPolicy" ADD CONSTRAINT "PrivacyPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrivacyAcceptance" ADD CONSTRAINT "PrivacyAcceptance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
