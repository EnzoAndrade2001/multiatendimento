ALTER TABLE "ServiceOrder" ADD COLUMN "cdDefeito" TEXT;

CREATE TABLE "CrmDefectType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inactive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrmDefectType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrmDefectType_tenantId_code_key" ON "CrmDefectType"("tenantId", "code");
CREATE INDEX "CrmDefectType_tenantId_inactive_idx" ON "CrmDefectType"("tenantId", "inactive");

ALTER TABLE "CrmDefectType"
ADD CONSTRAINT "CrmDefectType_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
