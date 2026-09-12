-- Telemetria de conexao Evolution para diferenciar online, reconectando e API indisponivel.
ALTER TABLE "WaInstance"
  ADD COLUMN IF NOT EXISTS "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "lastConnectionState" TEXT,
  ADD COLUMN IF NOT EXISTS "lastConnectionAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastWebhookAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastHealthCheckAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastHealthError" TEXT;
