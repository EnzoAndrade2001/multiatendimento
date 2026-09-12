ALTER TABLE "ServiceOrder"
ADD COLUMN IF NOT EXISTS "requestKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ServiceOrder_tenantId_requestKey_key"
  ON "ServiceOrder"("tenantId", "requestKey");
