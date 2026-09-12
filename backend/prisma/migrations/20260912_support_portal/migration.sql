ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "supportLevel" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);

UPDATE "User"
SET "supportLevel" = 'manager'
WHERE "role" = 'superadmin' AND "supportLevel" IS NULL;
