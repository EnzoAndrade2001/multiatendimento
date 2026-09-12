ALTER TABLE "TenantSettings"
ADD COLUMN "serviceOrderManagerCopyEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "serviceOrderManagerPhone" TEXT,
ADD COLUMN "serviceOrderManagerInstanceId" TEXT;

ALTER TABLE "ServiceOrder"
ADD COLUMN "managerCopySentAt" TIMESTAMP(3);
