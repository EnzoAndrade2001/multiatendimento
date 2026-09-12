-- AddColumn mediaStatus to Message
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "mediaStatus" TEXT DEFAULT 'pending';
