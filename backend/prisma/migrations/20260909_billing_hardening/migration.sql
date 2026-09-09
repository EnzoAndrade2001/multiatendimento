-- Endurecimento da cobranca (folder-based): confirmacao de entrega no WhatsApp,
-- resumo da varredura do envio automatico e base para a auditoria de divergencia.
-- Tudo aditivo / idempotente. Producao aplica via `prisma db push`.

ALTER TABLE "BillingLog"
  ADD COLUMN IF NOT EXISTS "messageId" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS "deliveryUpdatedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "BillingLog_tenantId_messageId_idx"
  ON "BillingLog" ("tenantId", "messageId");

ALTER TABLE "TenantSettings"
  ADD COLUMN IF NOT EXISTS "billingScanStatus" JSONB;
