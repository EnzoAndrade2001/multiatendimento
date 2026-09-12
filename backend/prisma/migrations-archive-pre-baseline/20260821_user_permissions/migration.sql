ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accessProfile" TEXT NOT NULL DEFAULT 'agent';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "permissions" JSONB;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "homePage" TEXT;

UPDATE "User"
SET "accessProfile" = CASE
  WHEN "role" IN ('admin', 'superadmin') THEN 'admin'
  ELSE 'agent'
END;

CREATE INDEX IF NOT EXISTS "TeamMember_userId_idx" ON "TeamMember"("userId");
