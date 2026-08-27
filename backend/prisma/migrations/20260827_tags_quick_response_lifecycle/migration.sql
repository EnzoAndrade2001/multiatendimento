-- Etiquetas e respostas rápidas podem ser arquivadas sem remover referências
-- históricas (contatos, campanhas e mensagens já enviadas).
ALTER TABLE "Tag"
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Tag_tenantId_archivedAt_idx"
  ON "Tag"("tenantId", "archivedAt");

ALTER TABLE "QuickResponse"
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "QuickResponse_tenantId_archivedAt_idx"
  ON "QuickResponse"("tenantId", "archivedAt");

CREATE TABLE IF NOT EXISTS "QuickResponseAudit" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "quickResponseId" TEXT,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuickResponseAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "QuickResponseAudit_tenantId_createdAt_idx"
  ON "QuickResponseAudit"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "QuickResponseAudit_tenantId_quickResponseId_createdAt_idx"
  ON "QuickResponseAudit"("tenantId", "quickResponseId", "createdAt");
CREATE INDEX IF NOT EXISTS "QuickResponseAudit_actorUserId_idx"
  ON "QuickResponseAudit"("actorUserId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'QuickResponseAudit_tenantId_fkey') THEN
    ALTER TABLE "QuickResponseAudit"
      ADD CONSTRAINT "QuickResponseAudit_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'QuickResponseAudit_quickResponseId_fkey') THEN
    ALTER TABLE "QuickResponseAudit"
      ADD CONSTRAINT "QuickResponseAudit_quickResponseId_fkey"
      FOREIGN KEY ("quickResponseId") REFERENCES "QuickResponse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'QuickResponseAudit_actorUserId_fkey') THEN
    ALTER TABLE "QuickResponseAudit"
      ADD CONSTRAINT "QuickResponseAudit_actorUserId_fkey"
      FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
