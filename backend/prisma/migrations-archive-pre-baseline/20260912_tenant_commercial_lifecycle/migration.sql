ALTER TABLE "Tenant"
  ADD COLUMN "lifecycleStatus" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "financialStatus" TEXT NOT NULL DEFAULT 'current',
  ADD COLUMN "contractNumber" TEXT,
  ADD COLUMN "contractStartedAt" TIMESTAMP(3),
  ADD COLUMN "contractEndsAt" TIMESTAMP(3),
  ADD COLUMN "trialEndsAt" TIMESTAMP(3),
  ADD COLUMN "nextBillingAt" TIMESTAMP(3),
  ADD COLUMN "customMonthlyPriceCents" INTEGER,
  ADD COLUMN "discountPercent" DOUBLE PRECISION,
  ADD COLUMN "commercialNotes" TEXT;

CREATE INDEX "Tenant_lifecycleStatus_idx" ON "Tenant"("lifecycleStatus");
CREATE INDEX "Tenant_financialStatus_idx" ON "Tenant"("financialStatus");
