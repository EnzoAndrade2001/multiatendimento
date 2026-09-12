-- Fase 2 "faturamento sem a pasta": o CRM passa a re-renderizar o demonstrativo
-- a partir dos dados do iLux (IXLDEMOFAT + IXLCONTRATOSFAT) sincronizados pelo
-- agente, sem exigir o PDF oficial na pasta monitorada. Valores vêm fechados do
-- ERP; o CRM nunca recalcula. Rollout por tenant (statementRerenderEnabled).
-- Produção aplica via `prisma db push`; este arquivo mantém a pasta de migrações
-- coerente e permite aplicar por SQL puro. Tudo aditivo / idempotente.

ALTER TABLE "TenantSettings"
  ADD COLUMN IF NOT EXISTS "statementRerenderEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "CrmBillingStatement" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "externalSource" TEXT NOT NULL DEFAULT 'firebird',
  "externalId" TEXT NOT NULL,
  "period" TEXT,
  "statementDate" TIMESTAMP(3),
  "dueDate" TIMESTAMP(3),
  "customerExternalId" TEXT,
  "companyExternalId" TEXT,
  "contractGroupExternalId" TEXT,
  "receivableExternalId" TEXT,
  "invoiceNumber" TEXT,
  "totalValue" DOUBLE PRECISION DEFAULT 0,
  "fixedValue" DOUBLE PRECISION DEFAULT 0,
  "excessValue" DOUBLE PRECISION DEFAULT 0,
  "discountValue" DOUBLE PRECISION DEFAULT 0,
  "surchargeValue" DOUBLE PRECISION DEFAULT 0,
  "netValue" DOUBLE PRECISION DEFAULT 0,
  "status" TEXT,
  "notes" TEXT,
  "lineCount" INTEGER NOT NULL DEFAULT 0,
  "raw" JSONB,
  "externalUpdatedAt" TIMESTAMP(3),
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmBillingStatement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CrmBillingStatement_tenantId_externalSource_externalId_key"
  ON "CrmBillingStatement" ("tenantId", "externalSource", "externalId");
CREATE INDEX IF NOT EXISTS "CrmBillingStatement_tenantId_period_idx"
  ON "CrmBillingStatement" ("tenantId", "period");
CREATE INDEX IF NOT EXISTS "CrmBillingStatement_tenantId_receivableExternalId_idx"
  ON "CrmBillingStatement" ("tenantId", "receivableExternalId");
CREATE INDEX IF NOT EXISTS "CrmBillingStatement_tenantId_customerExternalId_idx"
  ON "CrmBillingStatement" ("tenantId", "customerExternalId");

CREATE TABLE IF NOT EXISTS "CrmBillingStatementLine" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "statementId" TEXT NOT NULL,
  "statementExternalId" TEXT NOT NULL,
  "lineNo" INTEGER NOT NULL,
  "contractExternalId" TEXT,
  "contractGroupExternalId" TEXT,
  "equipmentExternalId" TEXT,
  "equipmentName" TEXT,
  "equipmentModel" TEXT,
  "equipmentSerial" TEXT,
  "meterCode" TEXT,
  "meterCodeBilling" TEXT,
  "department" TEXT,
  "installLocation" TEXT,
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "readingDate" TIMESTAMP(3),
  "periodDays" INTEGER,
  "meterStart" INTEGER,
  "meterEnd" INTEGER,
  "meterDiscount" INTEGER,
  "qtyProduction" INTEGER,
  "qtyFranchise" INTEGER,
  "qtyExcess" INTEGER,
  "franchiseValue" DOUBLE PRECISION DEFAULT 0,
  "excessValue" DOUBLE PRECISION DEFAULT 0,
  "franchiseCharged" DOUBLE PRECISION DEFAULT 0,
  "excessCharged" DOUBLE PRECISION DEFAULT 0,
  "invoiceValue" DOUBLE PRECISION DEFAULT 0,
  "discountValue" DOUBLE PRECISION DEFAULT 0,
  "surchargeValue" DOUBLE PRECISION DEFAULT 0,
  "isFixed" BOOLEAN NOT NULL DEFAULT false,
  "isExempt" BOOLEAN NOT NULL DEFAULT false,
  "isProrated" BOOLEAN NOT NULL DEFAULT false,
  "isBonus" BOOLEAN NOT NULL DEFAULT false,
  "raw" JSONB,
  CONSTRAINT "CrmBillingStatementLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CrmBillingStatementLine_statementId_lineNo_key"
  ON "CrmBillingStatementLine" ("statementId", "lineNo");
CREATE INDEX IF NOT EXISTS "CrmBillingStatementLine_tenantId_statementExternalId_idx"
  ON "CrmBillingStatementLine" ("tenantId", "statementExternalId");

DO $$
BEGIN
  ALTER TABLE "CrmBillingStatement"
    ADD CONSTRAINT "CrmBillingStatement_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CrmBillingStatementLine"
    ADD CONSTRAINT "CrmBillingStatementLine_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CrmBillingStatementLine"
    ADD CONSTRAINT "CrmBillingStatementLine_statementId_fkey"
    FOREIGN KEY ("statementId") REFERENCES "CrmBillingStatement" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
