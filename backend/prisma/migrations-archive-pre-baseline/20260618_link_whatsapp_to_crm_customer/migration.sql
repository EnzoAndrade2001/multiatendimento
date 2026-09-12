ALTER TABLE "Contact" ADD COLUMN "crmCustomerId" TEXT;

CREATE INDEX "Contact_tenantId_crmCustomerId_idx" ON "Contact"("tenantId", "crmCustomerId");

ALTER TABLE "Contact"
  ADD CONSTRAINT "Contact_crmCustomerId_fkey"
  FOREIGN KEY ("crmCustomerId")
  REFERENCES "CrmCustomer"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
