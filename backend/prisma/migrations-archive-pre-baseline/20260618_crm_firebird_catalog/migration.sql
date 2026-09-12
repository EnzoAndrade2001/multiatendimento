CREATE TABLE "CrmCustomer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT NOT NULL DEFAULT 'firebird',
    "externalId" TEXT NOT NULL,
    "externalUpdatedAt" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "fantasyName" TEXT,
    "cpfCnpj" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "contactName" TEXT,
    "notes" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmCustomer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrmEquipment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT,
    "externalSource" TEXT NOT NULL DEFAULT 'firebird',
    "externalId" TEXT NOT NULL,
    "externalUpdatedAt" TIMESTAMP(3),
    "model" TEXT NOT NULL,
    "manufacturer" TEXT,
    "type" TEXT,
    "serialNumber" TEXT,
    "assetTag" TEXT,
    "sector" TEXT,
    "installLocation" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "phone" TEXT,
    "contractExternalId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmEquipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrmCustomer_tenantId_externalSource_externalId_key" ON "CrmCustomer"("tenantId", "externalSource", "externalId");
CREATE INDEX "CrmCustomer_tenantId_name_idx" ON "CrmCustomer"("tenantId", "name");
CREATE INDEX "CrmCustomer_tenantId_cpfCnpj_idx" ON "CrmCustomer"("tenantId", "cpfCnpj");
CREATE INDEX "CrmCustomer_tenantId_phone_idx" ON "CrmCustomer"("tenantId", "phone");

CREATE UNIQUE INDEX "CrmEquipment_tenantId_externalSource_externalId_key" ON "CrmEquipment"("tenantId", "externalSource", "externalId");
CREATE INDEX "CrmEquipment_tenantId_model_idx" ON "CrmEquipment"("tenantId", "model");
CREATE INDEX "CrmEquipment_tenantId_serialNumber_idx" ON "CrmEquipment"("tenantId", "serialNumber");
CREATE INDEX "CrmEquipment_tenantId_customerId_idx" ON "CrmEquipment"("tenantId", "customerId");

ALTER TABLE "CrmCustomer" ADD CONSTRAINT "CrmCustomer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmEquipment" ADD CONSTRAINT "CrmEquipment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmEquipment" ADD CONSTRAINT "CrmEquipment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CrmCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
