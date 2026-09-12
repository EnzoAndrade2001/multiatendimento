-- Firebird push client support and raw sync records

ALTER TABLE "TenantSettings"
ADD COLUMN IF NOT EXISTS "firebirdClientToken" TEXT;

ALTER TABLE "Contact"
ADD COLUMN IF NOT EXISTS "externalSource" TEXT DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS "externalId" TEXT,
ADD COLUMN IF NOT EXISTS "externalUpdatedAt" TIMESTAMP(3);

ALTER TABLE "Equipment"
ADD COLUMN IF NOT EXISTS "externalSource" TEXT DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS "externalId" TEXT,
ADD COLUMN IF NOT EXISTS "externalUpdatedAt" TIMESTAMP(3);

ALTER TABLE "ServiceOrder"
ADD COLUMN IF NOT EXISTS "externalSource" TEXT DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS "externalId" TEXT,
ADD COLUMN IF NOT EXISTS "externalUpdatedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ExternalSyncRecord" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "externalId" TEXT,
  "payload" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "syncedAt" TIMESTAMP(3),

  CONSTRAINT "ExternalSyncRecord_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ExternalSyncRecord_tenantId_fkey'
  ) THEN
    ALTER TABLE "ExternalSyncRecord"
    ADD CONSTRAINT "ExternalSyncRecord_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Contact_tenantId_externalSource_externalId_key"
  ON "Contact"("tenantId", "externalSource", "externalId");

CREATE UNIQUE INDEX IF NOT EXISTS "Equipment_tenantId_externalSource_externalId_key"
  ON "Equipment"("tenantId", "externalSource", "externalId");

CREATE UNIQUE INDEX IF NOT EXISTS "ServiceOrder_tenantId_externalSource_externalId_key"
  ON "ServiceOrder"("tenantId", "externalSource", "externalId");

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalSyncRecord_tenantId_source_entity_externalId_key"
  ON "ExternalSyncRecord"("tenantId", "source", "entity", "externalId");

CREATE INDEX IF NOT EXISTS "ExternalSyncRecord_tenantId_source_entity_idx"
  ON "ExternalSyncRecord"("tenantId", "source", "entity");
