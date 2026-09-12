-- Anexos do chat interno. Colunas opcionais preservam todas as mensagens existentes.
ALTER TABLE "InternalMessage"
  ADD COLUMN IF NOT EXISTS "attachmentUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "attachmentName" TEXT,
  ADD COLUMN IF NOT EXISTS "attachmentMimeType" TEXT,
  ADD COLUMN IF NOT EXISTS "attachmentSize" INTEGER;

CREATE INDEX IF NOT EXISTS "InternalMessage_tenantId_attachmentUrl_idx"
  ON "InternalMessage"("tenantId", "attachmentUrl");
