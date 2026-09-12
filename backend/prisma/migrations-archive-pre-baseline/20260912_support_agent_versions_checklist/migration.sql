ALTER TABLE "FirebirdAgent" ADD COLUMN IF NOT EXISTS "releaseChannel" TEXT NOT NULL DEFAULT 'stable';
ALTER TABLE "FirebirdAgent" ADD COLUMN IF NOT EXISTS "compatibility" JSONB;
ALTER TABLE "FirebirdAgent" ADD COLUMN IF NOT EXISTS "desiredVersion" TEXT;

CREATE TABLE IF NOT EXISTS "AgentVersionAction" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "firebirdAgentId" TEXT NOT NULL,
  "action" TEXT NOT NULL, "channel" TEXT NOT NULL DEFAULT 'stable', "fromVersion" TEXT,
  "targetVersion" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending', "requestedById" TEXT NOT NULL,
  "reason" TEXT, "error" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3),
  CONSTRAINT "AgentVersionAction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
  CONSTRAINT "AgentVersionAction_firebirdAgentId_fkey" FOREIGN KEY ("firebirdAgentId") REFERENCES "FirebirdAgent"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "AgentVersionAction_tenantId_createdAt_idx" ON "AgentVersionAction"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentVersionAction_firebirdAgentId_createdAt_idx" ON "AgentVersionAction"("firebirdAgentId", "createdAt");

CREATE TABLE IF NOT EXISTS "DeploymentChecklistItem" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "itemKey" TEXT NOT NULL, "label" TEXT NOT NULL,
  "category" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending', "notes" TEXT, "updatedById" TEXT,
  "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeploymentChecklistItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "DeploymentChecklistItem_tenantId_itemKey_key" ON "DeploymentChecklistItem"("tenantId", "itemKey");
CREATE INDEX IF NOT EXISTS "DeploymentChecklistItem_tenantId_category_status_idx" ON "DeploymentChecklistItem"("tenantId", "category", "status");
