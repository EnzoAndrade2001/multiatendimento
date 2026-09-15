-- Override opcional de servidor Evolution API por conexao (WaInstance).
-- Quando nulo, o backend cai para TenantSettings.evolutionUrl/evolutionKey
-- (o padrao de hoje). Permite isolar uma conexao especifica (ex: WhatsApp
-- oficial) num servidor Evolution dedicado, diferente das demais conexoes
-- QR-code da mesma empresa.
ALTER TABLE "WaInstance" ADD COLUMN "evolutionUrl" TEXT;
ALTER TABLE "WaInstance" ADD COLUMN "evolutionKey" TEXT;
