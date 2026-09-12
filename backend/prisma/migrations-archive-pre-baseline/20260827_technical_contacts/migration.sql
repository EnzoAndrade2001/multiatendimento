-- Técnicos de campo autorizados no assistente do WhatsApp, sem conta de acesso ao painel.
CREATE TABLE IF NOT EXISTS "TechnicalContact" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "firebirdSupportName" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TechnicalContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TechnicalContact_tenantId_phone_key"
  ON "TechnicalContact"("tenantId", "phone");
CREATE INDEX IF NOT EXISTS "TechnicalContact_tenantId_active_idx"
  ON "TechnicalContact"("tenantId", "active");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TechnicalContact_tenantId_fkey'
  ) THEN
    ALTER TABLE "TechnicalContact"
      ADD CONSTRAINT "TechnicalContact_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
