-- PlugBoleto (TecnoSpeed): o CRM passa a buscar o PDF do boleto direto na API,
-- sem a pasta monitorada. Token cifrado (aes-256-gcm, mesma chave do PrintGuard).
ALTER TABLE "TenantSettings"
  ADD COLUMN IF NOT EXISTS "plugBoletoEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "plugBoletoBaseUrl" TEXT DEFAULT 'https://plugboleto.com.br/api/v1',
  ADD COLUMN IF NOT EXISTS "plugBoletoPrintPath" TEXT DEFAULT '/boletos/impressao/lote',
  ADD COLUMN IF NOT EXISTS "plugBoletoCedenteCnpj" TEXT,
  ADD COLUMN IF NOT EXISTS "plugBoletoTokenCipher" TEXT;
