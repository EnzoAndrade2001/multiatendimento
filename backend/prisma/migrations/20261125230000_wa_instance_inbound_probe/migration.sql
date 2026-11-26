-- Deteccao de instancia conectada que parou de RECEBER mensagens.
ALTER TABLE "WaInstance" ADD COLUMN IF NOT EXISTS "lastInboundAt" TIMESTAMP(3);
ALTER TABLE "WaInstance" ADD COLUMN IF NOT EXISTS "probeToken" TEXT;
ALTER TABLE "WaInstance" ADD COLUMN IF NOT EXISTS "probeSentAt" TIMESTAMP(3);
ALTER TABLE "WaInstance" ADD COLUMN IF NOT EXISTS "probeOkAt" TIMESTAMP(3);
ALTER TABLE "WaInstance" ADD COLUMN IF NOT EXISTS "probeFailures" INTEGER NOT NULL DEFAULT 0;
