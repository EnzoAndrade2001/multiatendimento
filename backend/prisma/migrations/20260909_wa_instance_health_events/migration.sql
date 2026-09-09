-- Historico de saude das instancias WhatsApp: uma linha por transicao de estado
-- e por evento de "instancia muda" (conectada mas sem webhook). Base para o
-- post-mortem do proximo incidente. Aditivo.

CREATE TABLE IF NOT EXISTS "WaInstanceHealthEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "instanceName" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "healthStatus" TEXT NOT NULL,
  "connectionState" TEXT,
  "lastWebhookAt" TIMESTAMP(3),
  "webhookAgeSec" INTEGER,
  "error" TEXT,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaInstanceHealthEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WaInstanceHealthEvent_tenantId_instanceName_createdAt_idx"
  ON "WaInstanceHealthEvent" ("tenantId", "instanceName", "createdAt");
CREATE INDEX IF NOT EXISTS "WaInstanceHealthEvent_createdAt_idx"
  ON "WaInstanceHealthEvent" ("createdAt");

DO $$
BEGIN
  ALTER TABLE "WaInstanceHealthEvent"
    ADD CONSTRAINT "WaInstanceHealthEvent_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
