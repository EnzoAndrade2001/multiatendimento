-- Catalogo global (nao por tenant) de servidores Evolution API disponiveis
-- para a distribuicao automatica de novas conexoes escolherem sozinhas.
-- Sem nenhuma linha aqui, nada muda no comportamento de hoje.
CREATE TABLE "EvolutionServer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvolutionServer_pkey" PRIMARY KEY ("id")
);
