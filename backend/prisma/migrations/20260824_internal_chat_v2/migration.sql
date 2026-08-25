-- Chat interno v2: alterações exclusivamente aditivas e compatíveis com mensagens existentes.
ALTER TABLE "InternalMessage"
  ADD COLUMN "teamId" TEXT,
  ADD COLUMN "type" TEXT NOT NULL DEFAULT 'message',
  ADD COLUMN "replyToId" TEXT,
  ADD COLUMN "mentionUserIds" JSONB,
  ADD COLUMN "mentionTeamIds" JSONB,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "InternalMessageReaction" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InternalMessageReaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InternalMessageRead" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InternalMessageRead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InternalConversationState" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationKey" TEXT NOT NULL,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "unreadCount" INTEGER NOT NULL DEFAULT 0,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InternalConversationState_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InternalMessage_tenantId_receiverId_createdAt_idx" ON "InternalMessage"("tenantId", "receiverId", "createdAt");
CREATE INDEX "InternalMessage_tenantId_teamId_createdAt_idx" ON "InternalMessage"("tenantId", "teamId", "createdAt");
CREATE INDEX "InternalMessage_replyToId_createdAt_idx" ON "InternalMessage"("replyToId", "createdAt");
CREATE UNIQUE INDEX "InternalMessageReaction_messageId_userId_emoji_key" ON "InternalMessageReaction"("messageId", "userId", "emoji");
CREATE INDEX "InternalMessageReaction_tenantId_messageId_idx" ON "InternalMessageReaction"("tenantId", "messageId");
CREATE UNIQUE INDEX "InternalMessageRead_messageId_userId_key" ON "InternalMessageRead"("messageId", "userId");
CREATE INDEX "InternalMessageRead_tenantId_userId_readAt_idx" ON "InternalMessageRead"("tenantId", "userId", "readAt");
CREATE UNIQUE INDEX "InternalConversationState_tenantId_userId_conversationKey_key" ON "InternalConversationState"("tenantId", "userId", "conversationKey");
CREATE INDEX "InternalConversationState_tenantId_userId_pinned_updatedAt_idx" ON "InternalConversationState"("tenantId", "userId", "pinned", "updatedAt");

ALTER TABLE "InternalMessage" ADD CONSTRAINT "InternalMessage_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InternalMessage" ADD CONSTRAINT "InternalMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "InternalMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InternalMessageReaction" ADD CONSTRAINT "InternalMessageReaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalMessageReaction" ADD CONSTRAINT "InternalMessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "InternalMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalMessageReaction" ADD CONSTRAINT "InternalMessageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalMessageRead" ADD CONSTRAINT "InternalMessageRead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalMessageRead" ADD CONSTRAINT "InternalMessageRead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "InternalMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalMessageRead" ADD CONSTRAINT "InternalMessageRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalConversationState" ADD CONSTRAINT "InternalConversationState_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalConversationState" ADD CONSTRAINT "InternalConversationState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
