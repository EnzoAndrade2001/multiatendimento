-- Inventario de instalacoes do agente Firebird: uma linha por (tenant, installId),
-- atualizada a cada ping. Alimenta a visao de frota e o alerta de versao
-- desatualizada. Producao aplica via `prisma db push`; este arquivo mantem a
-- pasta de migracoes coerente e permite aplicar por SQL puro.
CREATE TABLE IF NOT EXISTS "FirebirdAgent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "installId" TEXT NOT NULL,
  "hostname" TEXT,
  "version" TEXT,
  "protocolVersion" TEXT,
  "capabilities" JSONB,
  "runtime" TEXT,
  "processId" INTEGER,
  "healthStatus" TEXT,
  "lastPingIp" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FirebirdAgent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FirebirdAgent_tenantId_installId_key"
  ON "FirebirdAgent" ("tenantId", "installId");

CREATE INDEX IF NOT EXISTS "FirebirdAgent_tenantId_lastSeenAt_idx"
  ON "FirebirdAgent" ("tenantId", "lastSeenAt");

DO $$
BEGIN
  ALTER TABLE "FirebirdAgent"
    ADD CONSTRAINT "FirebirdAgent_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
