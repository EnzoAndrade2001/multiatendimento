-- Proprietario do equipamento no iLux (PROPRIETARIO: C=cliente, E=empresa).
ALTER TABLE "CrmEquipment" ADD COLUMN "ownerType" TEXT;

-- Codigo detalhado do status da O.S. no iLux (IXLOS.CDSTATUS).
ALTER TABLE "ServiceOrder" ADD COLUMN "sourceStatusCode" TEXT;
