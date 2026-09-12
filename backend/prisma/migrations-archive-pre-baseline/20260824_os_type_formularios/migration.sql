ALTER TABLE "CrmOsType"
ADD COLUMN "formulario" TEXT,
ADD COLUMN "formularioObs" TEXT,
ADD COLUMN "tipoOs" TEXT,
ADD COLUMN "tipoChamado" TEXT,
ADD COLUMN "logoOs" TEXT,
ADD COLUMN "inactive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "reportBundle" TEXT;
