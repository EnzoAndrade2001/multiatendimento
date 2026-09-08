-- Cor de destaque da O.S. por empresa (cabecalho e bandas de secao). O texto
-- do documento continua preto; so o acento vermelho padrao vira configuravel.
ALTER TABLE "TenantSettings"
  ADD COLUMN IF NOT EXISTS "osAccentColor" TEXT DEFAULT '#D62828';
