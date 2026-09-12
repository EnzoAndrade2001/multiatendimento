-- CreateTable
CREATE TABLE "Tenant" (
    "maxConcurrentSessions" INTEGER,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "maxConnections" INTEGER NOT NULL DEFAULT 1,
    "maxUsers" INTEGER NOT NULL DEFAULT 5,
    "primaryColor" TEXT DEFAULT '#D4AF37',
    "logoUrl" TEXT,
    "lifecycleStatus" TEXT NOT NULL DEFAULT 'active',
    "financialStatus" TEXT NOT NULL DEFAULT 'current',
    "contractNumber" TEXT,
    "contractStartedAt" TIMESTAMP(3),
    "contractEndsAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "nextBillingAt" TIMESTAMP(3),
    "customMonthlyPriceCents" INTEGER,
    "discountPercent" DOUBLE PRECISION,
    "commercialNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feature" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "monthlyPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "limits" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanFeature" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "limits" JSONB,

    CONSTRAINT "PlanFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantFeatureOverride" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "enabled" BOOLEAN,
    "limits" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantFeatureOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "evolutionUrl" TEXT,
    "evolutionKey" TEXT,
    "geminiKey" TEXT,
    "aiProvider" TEXT NOT NULL DEFAULT 'gemini',
    "aiModel" TEXT,
    "openaiKey" TEXT,
    "anthropicKey" TEXT,
    "aiAuxProvider" TEXT,
    "aiModelCatalog" JSONB,
    "botEnabled" BOOLEAN NOT NULL DEFAULT false,
    "botName" TEXT DEFAULT 'LCD Bot',
    "botSystemPrompt" TEXT,
    "botTransferWord" TEXT DEFAULT 'atendente',
    "webhookUrl" TEXT,
    "outOfOfficeMessage" TEXT,
    "notificationPhone" TEXT,
    "serviceOrderManagerCopyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "serviceOrderManagerPhone" TEXT,
    "serviceOrderManagerInstanceId" TEXT,
    "billingInstanceId" TEXT,
    "ratingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ratingMessage" TEXT DEFAULT 'Como você avalia nosso atendimento de 1 a 5?',
    "companyName" TEXT,
    "companyCnpj" TEXT,
    "companyIE" TEXT,
    "companyAddress" TEXT,
    "companyBairro" TEXT,
    "companyCep" TEXT,
    "companyPhone" TEXT,
    "companyCity" TEXT,
    "companyState" TEXT,
    "osAccentColor" TEXT DEFAULT '#D62828',
    "osBarcodeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "serpApiKey" TEXT,
    "firebirdApiUrl" TEXT,
    "firebirdApiKey" TEXT,
    "firebirdClientToken" TEXT,
    "firebirdAuthMode" TEXT DEFAULT 'bearer',
    "firebirdHealthPath" TEXT DEFAULT '/health',
    "firebirdContactsPath" TEXT DEFAULT '/contacts',
    "firebirdSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "firebirdLastSyncAt" TIMESTAMP(3),
    "firebirdLastSyncStatus" TEXT DEFAULT 'idle',
    "firebirdLastSyncError" TEXT,
    "billingMessageTemplate" TEXT,
    "firebirdQueueBillingProcess" BOOLEAN NOT NULL DEFAULT false,
    "plugBoletoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "plugBoletoBaseUrl" TEXT DEFAULT 'https://plugboleto.com.br/api/v1',
    "plugBoletoPrintPath" TEXT DEFAULT '/boletos/impressao/lote',
    "plugBoletoCedenteCnpj" TEXT,
    "plugBoletoTokenCipher" TEXT,
    "plugBoletoConfigSyncedAt" TIMESTAMP(3),
    "statementRerenderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "billingScanStatus" JSONB,
    "kpiContractValue" DOUBLE PRECISION DEFAULT 1200.0,
    "kpiServiceValue" DOUBLE PRECISION DEFAULT 350.0,
    "kpiSlaLimitHours" INTEGER DEFAULT 24,
    "kpiReincidentThreshold" INTEGER DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FirebirdAgent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "hostname" TEXT,
    "version" TEXT,
    "protocolVersion" TEXT,
    "capabilities" JSONB,
    "runtime" TEXT,
    "processId" INTEGER,
    "healthStatus" TEXT,
    "lastPingIp" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releaseChannel" TEXT NOT NULL DEFAULT 'stable',
    "compatibility" JSONB,
    "desiredVersion" TEXT,

    CONSTRAINT "FirebirdAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentVersionAction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firebirdAgentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'stable',
    "fromVersion" TEXT,
    "targetVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedById" TEXT NOT NULL,
    "reason" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentVersionAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentChecklistItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "updatedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'agent',
    "supportLevel" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "accessProfile" TEXT NOT NULL DEFAULT 'agent',
    "permissions" JSONB,
    "homePage" TEXT,
    "phone" TEXT,
    "firebirdSupportName" TEXT,
    "avatarUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "maxConcurrentSessions" INTEGER,
    "totpSecretCipher" TEXT,
    "totpPendingSecretCipher" TEXT,
    "totpEnabledAt" TIMESTAMP(3),
    "totpRecoveryCodes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceName" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicalContact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "firebirdSupportName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TechnicalContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaInstance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "healthStatus" TEXT NOT NULL DEFAULT 'unknown',
    "lastConnectionState" TEXT,
    "lastConnectionAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastHealthError" TEXT,
    "qrCode" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'evolution_qr',
    "officialPhoneId" TEXT,
    "officialBusinessId" TEXT,

    CONSTRAINT "WaInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaInstanceHealthEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "healthStatus" TEXT NOT NULL,
    "connectionState" TEXT,
    "lastWebhookAt" TIMESTAMP(3),
    "webhookAgeSec" INTEGER,
    "error" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaInstanceHealthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaInstance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "externalId" TEXT,
    "accessToken" TEXT,
    "metaBrowserSession" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "crmCustomerId" TEXT,
    "externalSource" TEXT DEFAULT 'manual',
    "externalId" TEXT,
    "externalUpdatedAt" TIMESTAMP(3),
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "fantasyName" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "whatsapp" TEXT,
    "whatsappJid" TEXT,
    "cpfCnpj" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "enableWhatsAppBilling" BOOLEAN NOT NULL DEFAULT false,
    "enableWhatsAppMarketing" BOOLEAN NOT NULL DEFAULT false,
    "enableWhatsAppAlerts" BOOLEAN NOT NULL DEFAULT false,
    "enableWhatsAppCounters" BOOLEAN NOT NULL DEFAULT false,
    "whatsappOptOutAt" TIMESTAMP(3),

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "instanceId" TEXT,
    "metaInstanceId" TEXT,
    "contactId" TEXT NOT NULL,
    "teamId" TEXT,
    "agentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "subject" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "sessionStartedAt" TIMESTAMP(3),
    "slaDueAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "lastCustomerMessageAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "rating" INTEGER,
    "ratingAt" TIMESTAMP(3),
    "ratingFeedback" TEXT,
    "auditScore" INTEGER,
    "auditResult" TEXT,
    "auditedAt" TIMESTAMP(3),

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "agentId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "trigger" TEXT NOT NULL DEFAULT 'CREATED',
    "assistantMode" TEXT,
    "reconstructed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTicketState" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isUnread" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTicketState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "payload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Knowledge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "tags" TEXT,
    "embedding" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'MANUAL',
    "audience" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "manufacturer" TEXT,
    "equipmentModel" TEXT,
    "version" TEXT,
    "language" TEXT NOT NULL DEFAULT 'pt-BR',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "pageCount" INTEGER,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "processingError" TEXT,
    "supersedesId" TEXT,
    "createdById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "section" TEXT,
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "position" INTEGER NOT NULL,
    "tokenEstimate" INTEGER NOT NULL DEFAULT 0,
    "embedding" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessHour" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "start" TEXT NOT NULL DEFAULT '08:00',
    "end" TEXT NOT NULL DEFAULT '18:00',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BusinessHour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#D4AF37',
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "agentId" TEXT,
    "fromBot" BOOLEAN NOT NULL DEFAULT false,
    "automationType" TEXT,
    "fromMe" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "transcription" TEXT,
    "mediaUrl" TEXT,
    "mediaType" TEXT,
    "mediaStatus" TEXT DEFAULT 'pending',
    "externalId" TEXT,
    "quotedMsgId" TEXT,
    "quotedMsgBody" TEXT,
    "fileName" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickResponse" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shortcut" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "ownerUserId" TEXT,
    "teamId" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuickResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickResponseAudit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quickResponseId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuickResponseAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT,
    "teamId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'message',
    "body" TEXT NOT NULL,
    "replyToId" TEXT,
    "mentionUserIds" JSONB,
    "mentionTeamIds" JSONB,
    "attachmentUrl" TEXT,
    "attachmentName" TEXT,
    "attachmentMimeType" TEXT,
    "attachmentSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalMessageReaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalMessageReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalMessageRead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalMessageRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalConversationState" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationKey" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalConversationState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketId" TEXT,
    "messageId" TEXT,
    "knowledgeId" TEXT,
    "documentId" TEXT,
    "chunkId" TEXT,
    "query" TEXT NOT NULL,
    "content" TEXT,
    "similarity" DOUBLE PRECISION,
    "found" BOOLEAN NOT NULL DEFAULT false,
    "searched" BOOLEAN NOT NULL DEFAULT false,
    "method" TEXT,
    "error" TEXT,
    "responseOrigin" TEXT,
    "responseSources" JSONB,
    "responseModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "externalSource" TEXT DEFAULT 'manual',
    "externalId" TEXT,
    "externalUpdatedAt" TIMESTAMP(3),
    "model" TEXT NOT NULL,
    "manufacturer" TEXT,
    "type" TEXT,
    "serialNumber" TEXT,
    "sector" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "externalSource" TEXT DEFAULT 'manual',
    "externalId" TEXT,
    "externalUpdatedAt" TIMESTAMP(3),
    "requestKey" TEXT,
    "ticketId" TEXT,
    "cdOstp" TEXT,
    "cdDefeito" TEXT,
    "nmsuportet" TEXT,
    "defect" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "technicalNotes" TEXT,
    "meters" TEXT,
    "userId" TEXT,
    "managerCopySentAt" TIMESTAMP(3),
    "managerCopyLastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,

    CONSTRAINT "ServiceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalSyncRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "externalId" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ExternalSyncRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "mrrInRisk" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vazamentoValor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stalledCount" INTEGER NOT NULL DEFAULT 0,
    "avgOpenHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgSlaHours" DOUBLE PRECISION,
    "avgCsat" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenueSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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
    "pageCounter" INTEGER,
    "usageCounters" JSONB,
    "lastMeterReadAt" TIMESTAMP(3),
    "meterSource" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmEquipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "placeId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "website" TEXT,
    "rating" DOUBLE PRECISION,
    "category" TEXT,
    "query" TEXT,
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "contactId" TEXT,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "optedOutAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmOsType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "formulario" TEXT,
    "formularioObs" TEXT,
    "tipoOs" TEXT,
    "tipoChamado" TEXT,
    "logoOs" TEXT,
    "inactive" BOOLEAN NOT NULL DEFAULT false,
    "reportBundle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmOsType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmTechnician" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmTechnician_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmDefectType" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inactive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmDefectType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cpfCnpj" TEXT,
    "clientName" TEXT,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageId" TEXT,
    "deliveryStatus" TEXT DEFAULT 'sent',
    "deliveryUpdatedAt" TIMESTAMP(3),

    CONSTRAINT "BillingLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyAuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAccessSession" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "targetTenantId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "SupportAccessSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyRetentionPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "mediaRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "auditRetentionDays" INTEGER NOT NULL DEFAULT 730,
    "billingRetentionDays" INTEGER NOT NULL DEFAULT 2555,
    "agentLogRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "lastPreviewAt" TIMESTAMP(3),
    "lastPreview" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyRetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "purposes" JSONB NOT NULL,
    "channel" JSONB,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyAcceptance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "instanceId" TEXT,
    "name" TEXT NOT NULL DEFAULT 'Nova campanha',
    "category" TEXT NOT NULL DEFAULT 'MARKETING',
    "message" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "mediaType" TEXT,
    "mediaMimeType" TEXT,
    "mediaFilename" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "delaySeconds" INTEGER NOT NULL DEFAULT 5,
    "scheduledAt" TIMESTAMP(3),
    "quietHoursStart" TEXT DEFAULT '20:00',
    "quietHoursEnd" TEXT DEFAULT '08:00',
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT,
    "contactId" TEXT,
    "instanceId" TEXT,
    "phone" TEXT NOT NULL,
    "contactName" TEXT,
    "renderedMessage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "externalId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'MARKETING',
    "body" TEXT NOT NULL,
    "variables" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintGuardConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "externalId" TEXT,
    "organization" JSONB,
    "accessTokenCipher" TEXT,
    "webhookSecretCipher" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INACTIVE',
    "lastTestAt" TIMESTAMP(3),
    "lastConnectedAt" TIMESTAMP(3),
    "lastCursor" TEXT,
    "lastMeterCursor" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintGuardConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintGuardBinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "customerCode" TEXT,
    "serialNumber" TEXT,
    "customerId" TEXT,
    "equipmentId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "source" TEXT NOT NULL DEFAULT 'AUTO',
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintGuardBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintGuardTelemetryEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "occurredAt" TIMESTAMP(3),
    "customerCode" TEXT,
    "serialNumber" TEXT,
    "payload" JSONB,
    "state" TEXT NOT NULL DEFAULT 'RECEIVED',
    "bindingId" TEXT,
    "ticketId" TEXT,
    "serviceOrderId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "priorityLevel" TEXT,
    "priorityScore" INTEGER,
    "recommendation" JSONB,
    "assignedToId" TEXT,
    "decisionDueAt" TIMESTAMP(3),
    "monitoringUntil" TIMESTAMP(3),
    "monitoringCondition" TEXT,
    "nextStep" TEXT,
    "ignoredReason" TEXT,
    "decisionAt" TIMESTAMP(3),
    "decisionById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintGuardTelemetryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmContract" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT NOT NULL DEFAULT 'firebird',
    "externalId" TEXT NOT NULL,
    "customerExternalId" TEXT,
    "number" TEXT,
    "type" TEXT,
    "typeCode" TEXT,
    "modality" TEXT,
    "status" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "monthlyValue" DOUBLE PRECISION,
    "pageFranchise" INTEGER DEFAULT 0,
    "franchiseValue" DOUBLE PRECISION DEFAULT 0,
    "excessPageValue" DOUBLE PRECISION DEFAULT 0,
    "activeEquipment" INTEGER DEFAULT 0,
    "raw" JSONB,
    "externalUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmMeterReading" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "equipmentExternalId" TEXT NOT NULL,
    "serialNumber" TEXT,
    "meterCode" TEXT,
    "meterName" TEXT,
    "reading" INTEGER NOT NULL,
    "usageCounters" JSONB,
    "previousReading" INTEGER,
    "readAt" TIMESTAMP(3) NOT NULL,
    "previousReadAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'firebird',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmMeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmBillingStatement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalSource" TEXT NOT NULL DEFAULT 'firebird',
    "externalId" TEXT NOT NULL,
    "period" TEXT,
    "statementDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "customerExternalId" TEXT,
    "companyExternalId" TEXT,
    "contractGroupExternalId" TEXT,
    "receivableExternalId" TEXT,
    "invoiceNumber" TEXT,
    "totalValue" DOUBLE PRECISION DEFAULT 0,
    "fixedValue" DOUBLE PRECISION DEFAULT 0,
    "excessValue" DOUBLE PRECISION DEFAULT 0,
    "discountValue" DOUBLE PRECISION DEFAULT 0,
    "surchargeValue" DOUBLE PRECISION DEFAULT 0,
    "netValue" DOUBLE PRECISION DEFAULT 0,
    "status" TEXT,
    "notes" TEXT,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "raw" JSONB,
    "externalUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmBillingStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmBillingStatementLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "statementExternalId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "contractExternalId" TEXT,
    "contractGroupExternalId" TEXT,
    "equipmentExternalId" TEXT,
    "equipmentName" TEXT,
    "equipmentModel" TEXT,
    "equipmentSerial" TEXT,
    "meterCode" TEXT,
    "meterCodeBilling" TEXT,
    "department" TEXT,
    "installLocation" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "readingDate" TIMESTAMP(3),
    "periodDays" INTEGER,
    "meterStart" INTEGER,
    "meterEnd" INTEGER,
    "meterDiscount" INTEGER,
    "qtyProduction" INTEGER,
    "qtyFranchise" INTEGER,
    "qtyExcess" INTEGER,
    "franchiseValue" DOUBLE PRECISION DEFAULT 0,
    "excessValue" DOUBLE PRECISION DEFAULT 0,
    "franchiseCharged" DOUBLE PRECISION DEFAULT 0,
    "excessCharged" DOUBLE PRECISION DEFAULT 0,
    "invoiceValue" DOUBLE PRECISION DEFAULT 0,
    "discountValue" DOUBLE PRECISION DEFAULT 0,
    "surchargeValue" DOUBLE PRECISION DEFAULT 0,
    "isFixed" BOOLEAN NOT NULL DEFAULT false,
    "isExempt" BOOLEAN NOT NULL DEFAULT false,
    "isProrated" BOOLEAN NOT NULL DEFAULT false,
    "isBonus" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB,

    CONSTRAINT "CrmBillingStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Tenant_lifecycleStatus_idx" ON "Tenant"("lifecycleStatus");

-- CreateIndex
CREATE INDEX "Tenant_financialStatus_idx" ON "Tenant"("financialStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Feature_key_key" ON "Feature"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ProductPlan_code_key" ON "ProductPlan"("code");

-- CreateIndex
CREATE INDEX "PlanFeature_featureId_idx" ON "PlanFeature"("featureId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanFeature_planId_featureId_key" ON "PlanFeature"("planId", "featureId");

-- CreateIndex
CREATE INDEX "TenantFeatureOverride_featureId_idx" ON "TenantFeatureOverride"("featureId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantFeatureOverride_tenantId_featureId_key" ON "TenantFeatureOverride"("tenantId", "featureId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSettings_tenantId_key" ON "TenantSettings"("tenantId");

-- CreateIndex
CREATE INDEX "FirebirdAgent_tenantId_lastSeenAt_idx" ON "FirebirdAgent"("tenantId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "FirebirdAgent_tenantId_installId_key" ON "FirebirdAgent"("tenantId", "installId");

-- CreateIndex
CREATE INDEX "AgentVersionAction_tenantId_createdAt_idx" ON "AgentVersionAction"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentVersionAction_firebirdAgentId_createdAt_idx" ON "AgentVersionAction"("firebirdAgentId", "createdAt");

-- CreateIndex
CREATE INDEX "DeploymentChecklistItem_tenantId_category_status_idx" ON "DeploymentChecklistItem"("tenantId", "category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentChecklistItem_tenantId_itemKey_key" ON "DeploymentChecklistItem"("tenantId", "itemKey");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE INDEX "AuthSession_userId_revokedAt_expiresAt_idx" ON "AuthSession"("userId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "AuthSession_tenantId_createdAt_idx" ON "AuthSession"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "TechnicalContact_tenantId_active_idx" ON "TechnicalContact"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicalContact_tenantId_phone_key" ON "TechnicalContact"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");

-- CreateIndex
CREATE INDEX "WaInstanceHealthEvent_tenantId_instanceName_createdAt_idx" ON "WaInstanceHealthEvent"("tenantId", "instanceName", "createdAt");

-- CreateIndex
CREATE INDEX "WaInstanceHealthEvent_createdAt_idx" ON "WaInstanceHealthEvent"("createdAt");

-- CreateIndex
CREATE INDEX "Contact_tenantId_phone_idx" ON "Contact"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "Contact_tenantId_crmCustomerId_idx" ON "Contact"("tenantId", "crmCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_tenantId_instanceId_phone_key" ON "Contact"("tenantId", "instanceId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_tenantId_externalSource_externalId_key" ON "Contact"("tenantId", "externalSource", "externalId");

-- CreateIndex
CREATE INDEX "Ticket_tenantId_idx" ON "Ticket"("tenantId");

-- CreateIndex
CREATE INDEX "Ticket_tenantId_status_updatedAt_idx" ON "Ticket"("tenantId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Ticket_tenantId_agentId_status_idx" ON "Ticket"("tenantId", "agentId", "status");

-- CreateIndex
CREATE INDEX "Ticket_tenantId_teamId_status_idx" ON "Ticket"("tenantId", "teamId", "status");

-- CreateIndex
CREATE INDEX "Ticket_instanceId_idx" ON "Ticket"("instanceId");

-- CreateIndex
CREATE INDEX "Ticket_contactId_idx" ON "Ticket"("contactId");

-- CreateIndex
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");

-- CreateIndex
CREATE INDEX "Ticket_createdAt_idx" ON "Ticket"("createdAt");

-- CreateIndex
CREATE INDEX "Ticket_sessionStartedAt_idx" ON "Ticket"("sessionStartedAt");

-- CreateIndex
CREATE INDEX "TicketSession_tenantId_status_endedAt_idx" ON "TicketSession"("tenantId", "status", "endedAt");

-- CreateIndex
CREATE INDEX "TicketSession_tenantId_agentId_endedAt_idx" ON "TicketSession"("tenantId", "agentId", "endedAt");

-- CreateIndex
CREATE INDEX "TicketSession_ticketId_startedAt_idx" ON "TicketSession"("ticketId", "startedAt");

-- CreateIndex
CREATE INDEX "TicketSession_tenantId_reconstructed_idx" ON "TicketSession"("tenantId", "reconstructed");

-- CreateIndex
CREATE INDEX "UserTicketState_tenantId_userId_isPinned_idx" ON "UserTicketState"("tenantId", "userId", "isPinned");

-- CreateIndex
CREATE INDEX "UserTicketState_ticketId_idx" ON "UserTicketState"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTicketState_userId_ticketId_key" ON "UserTicketState"("userId", "ticketId");

-- CreateIndex
CREATE INDEX "TicketEvent_ticketId_createdAt_idx" ON "TicketEvent"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "Knowledge_tenantId_active_idx" ON "Knowledge"("tenantId", "active");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_tenantId_status_audience_idx" ON "KnowledgeDocument"("tenantId", "status", "audience");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_tenantId_manufacturer_equipmentModel_idx" ON "KnowledgeDocument"("tenantId", "manufacturer", "equipmentModel");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_supersedesId_idx" ON "KnowledgeDocument"("supersedesId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeDocument_tenantId_checksum_key" ON "KnowledgeDocument"("tenantId", "checksum");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_tenantId_documentId_idx" ON "KnowledgeChunk"("tenantId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_documentId_position_key" ON "KnowledgeChunk"("documentId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessHour_tenantId_dayOfWeek_key" ON "BusinessHour"("tenantId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "Tag_tenantId_archivedAt_idx" ON "Tag"("tenantId", "archivedAt");

-- CreateIndex
CREATE INDEX "Message_ticketId_idx" ON "Message"("ticketId");

-- CreateIndex
CREATE INDEX "Message_ticketId_createdAt_idx" ON "Message"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_externalId_idx" ON "Message"("externalId");

-- CreateIndex
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");

-- CreateIndex
CREATE INDEX "QuickResponse_tenantId_scope_category_idx" ON "QuickResponse"("tenantId", "scope", "category");

-- CreateIndex
CREATE INDEX "QuickResponse_tenantId_archivedAt_idx" ON "QuickResponse"("tenantId", "archivedAt");

-- CreateIndex
CREATE INDEX "QuickResponse_ownerUserId_idx" ON "QuickResponse"("ownerUserId");

-- CreateIndex
CREATE INDEX "QuickResponse_teamId_idx" ON "QuickResponse"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "QuickResponse_tenantId_shortcut_key" ON "QuickResponse"("tenantId", "shortcut");

-- CreateIndex
CREATE INDEX "QuickResponseAudit_tenantId_createdAt_idx" ON "QuickResponseAudit"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "QuickResponseAudit_tenantId_quickResponseId_createdAt_idx" ON "QuickResponseAudit"("tenantId", "quickResponseId", "createdAt");

-- CreateIndex
CREATE INDEX "QuickResponseAudit_actorUserId_idx" ON "QuickResponseAudit"("actorUserId");

-- CreateIndex
CREATE INDEX "InternalMessage_tenantId_receiverId_createdAt_idx" ON "InternalMessage"("tenantId", "receiverId", "createdAt");

-- CreateIndex
CREATE INDEX "InternalMessage_tenantId_teamId_createdAt_idx" ON "InternalMessage"("tenantId", "teamId", "createdAt");

-- CreateIndex
CREATE INDEX "InternalMessage_tenantId_attachmentUrl_idx" ON "InternalMessage"("tenantId", "attachmentUrl");

-- CreateIndex
CREATE INDEX "InternalMessage_replyToId_createdAt_idx" ON "InternalMessage"("replyToId", "createdAt");

-- CreateIndex
CREATE INDEX "InternalMessageReaction_tenantId_messageId_idx" ON "InternalMessageReaction"("tenantId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "InternalMessageReaction_messageId_userId_emoji_key" ON "InternalMessageReaction"("messageId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "InternalMessageRead_tenantId_userId_readAt_idx" ON "InternalMessageRead"("tenantId", "userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "InternalMessageRead_messageId_userId_key" ON "InternalMessageRead"("messageId", "userId");

-- CreateIndex
CREATE INDEX "InternalConversationState_tenantId_userId_pinned_updatedAt_idx" ON "InternalConversationState"("tenantId", "userId", "pinned", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InternalConversationState_tenantId_userId_conversationKey_key" ON "InternalConversationState"("tenantId", "userId", "conversationKey");

-- CreateIndex
CREATE INDEX "KnowledgeLog_tenantId_createdAt_idx" ON "KnowledgeLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeLog_tenantId_responseOrigin_createdAt_idx" ON "KnowledgeLog"("tenantId", "responseOrigin", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeLog_ticketId_createdAt_idx" ON "KnowledgeLog"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeLog_messageId_idx" ON "KnowledgeLog"("messageId");

-- CreateIndex
CREATE INDEX "KnowledgeLog_knowledgeId_createdAt_idx" ON "KnowledgeLog"("knowledgeId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeLog_documentId_createdAt_idx" ON "KnowledgeLog"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeLog_chunkId_createdAt_idx" ON "KnowledgeLog"("chunkId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_tenantId_externalSource_externalId_key" ON "Equipment"("tenantId", "externalSource", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceOrder_tenantId_externalSource_externalId_key" ON "ServiceOrder"("tenantId", "externalSource", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceOrder_tenantId_requestKey_key" ON "ServiceOrder"("tenantId", "requestKey");

-- CreateIndex
CREATE INDEX "ExternalSyncRecord_tenantId_source_entity_idx" ON "ExternalSyncRecord"("tenantId", "source", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalSyncRecord_tenantId_source_entity_externalId_key" ON "ExternalSyncRecord"("tenantId", "source", "entity", "externalId");

-- CreateIndex
CREATE INDEX "RevenueSnapshot_tenantId_snapshotDate_idx" ON "RevenueSnapshot"("tenantId", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueSnapshot_tenantId_snapshotDate_key" ON "RevenueSnapshot"("tenantId", "snapshotDate");

-- CreateIndex
CREATE INDEX "CrmCustomer_tenantId_name_idx" ON "CrmCustomer"("tenantId", "name");

-- CreateIndex
CREATE INDEX "CrmCustomer_tenantId_cpfCnpj_idx" ON "CrmCustomer"("tenantId", "cpfCnpj");

-- CreateIndex
CREATE INDEX "CrmCustomer_tenantId_phone_idx" ON "CrmCustomer"("tenantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "CrmCustomer_tenantId_externalSource_externalId_key" ON "CrmCustomer"("tenantId", "externalSource", "externalId");

-- CreateIndex
CREATE INDEX "CrmEquipment_tenantId_model_idx" ON "CrmEquipment"("tenantId", "model");

-- CreateIndex
CREATE INDEX "CrmEquipment_tenantId_serialNumber_idx" ON "CrmEquipment"("tenantId", "serialNumber");

-- CreateIndex
CREATE INDEX "CrmEquipment_tenantId_customerId_idx" ON "CrmEquipment"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmEquipment_tenantId_externalSource_externalId_key" ON "CrmEquipment"("tenantId", "externalSource", "externalId");

-- CreateIndex
CREATE INDEX "Lead_tenantId_imported_idx" ON "Lead"("tenantId", "imported");

-- CreateIndex
CREATE INDEX "Lead_tenantId_query_idx" ON "Lead"("tenantId", "query");

-- CreateIndex
CREATE INDEX "Lead_tenantId_city_state_idx" ON "Lead"("tenantId", "city", "state");

-- CreateIndex
CREATE INDEX "Lead_tenantId_marketingOptIn_optedOutAt_idx" ON "Lead"("tenantId", "marketingOptIn", "optedOutAt");

-- CreateIndex
CREATE INDEX "Lead_tenantId_sentAt_idx" ON "Lead"("tenantId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_tenantId_placeId_key" ON "Lead"("tenantId", "placeId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmOsType_tenantId_code_key" ON "CrmOsType"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CrmTechnician_tenantId_name_key" ON "CrmTechnician"("tenantId", "name");

-- CreateIndex
CREATE INDEX "CrmDefectType_tenantId_inactive_idx" ON "CrmDefectType"("tenantId", "inactive");

-- CreateIndex
CREATE UNIQUE INDEX "CrmDefectType_tenantId_code_key" ON "CrmDefectType"("tenantId", "code");

-- CreateIndex
CREATE INDEX "BillingLog_tenantId_idx" ON "BillingLog"("tenantId");

-- CreateIndex
CREATE INDEX "BillingLog_tenantId_messageId_idx" ON "BillingLog"("tenantId", "messageId");

-- CreateIndex
CREATE INDEX "PrivacyAuditLog_tenantId_createdAt_idx" ON "PrivacyAuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "PrivacyAuditLog_tenantId_action_createdAt_idx" ON "PrivacyAuditLog"("tenantId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_createdAt_idx" ON "AuditEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_actorId_createdAt_idx" ON "AuditEvent"("tenantId", "actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_action_createdAt_idx" ON "AuditEvent"("tenantId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_resourceType_resourceId_createdAt_idx" ON "AuditEvent"("tenantId", "resourceType", "resourceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_tenantId_requestId_idx" ON "AuditEvent"("tenantId", "requestId");

-- CreateIndex
CREATE INDEX "SupportAccessSession_actorUserId_createdAt_idx" ON "SupportAccessSession"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportAccessSession_targetTenantId_createdAt_idx" ON "SupportAccessSession"("targetTenantId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportAccessSession_expiresAt_endedAt_idx" ON "SupportAccessSession"("expiresAt", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyRetentionPolicy_tenantId_key" ON "PrivacyRetentionPolicy"("tenantId");

-- CreateIndex
CREATE INDEX "PrivacyPolicy_tenantId_active_effectiveAt_idx" ON "PrivacyPolicy"("tenantId", "active", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyPolicy_tenantId_version_key" ON "PrivacyPolicy"("tenantId", "version");

-- CreateIndex
CREATE INDEX "PrivacyAcceptance_tenantId_userId_acceptedAt_idx" ON "PrivacyAcceptance"("tenantId", "userId", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrivacyAcceptance_tenantId_userId_policyVersion_key" ON "PrivacyAcceptance"("tenantId", "userId", "policyVersion");

-- CreateIndex
CREATE INDEX "Campaign_tenantId_status_scheduledAt_idx" ON "Campaign"("tenantId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Campaign_tenantId_createdAt_idx" ON "Campaign"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_tenantId_idempotencyKey_key" ON "Campaign"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CampaignRecipient_tenantId_status_updatedAt_idx" ON "CampaignRecipient"("tenantId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignRecipient_contactId_idx" ON "CampaignRecipient"("contactId");

-- CreateIndex
CREATE INDEX "CampaignRecipient_leadId_idx" ON "CampaignRecipient"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_phone_key" ON "CampaignRecipient"("campaignId", "phone");

-- CreateIndex
CREATE INDEX "CampaignTemplate_tenantId_active_category_idx" ON "CampaignTemplate"("tenantId", "active", "category");

-- CreateIndex
CREATE UNIQUE INDEX "PrintGuardConnection_externalId_key" ON "PrintGuardConnection"("externalId");

-- CreateIndex
CREATE INDEX "PrintGuardConnection_tenantId_status_idx" ON "PrintGuardConnection"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PrintGuardConnection_tenantId_name_key" ON "PrintGuardConnection"("tenantId", "name");

-- CreateIndex
CREATE INDEX "PrintGuardBinding_tenantId_customerCode_idx" ON "PrintGuardBinding"("tenantId", "customerCode");

-- CreateIndex
CREATE INDEX "PrintGuardBinding_tenantId_serialNumber_idx" ON "PrintGuardBinding"("tenantId", "serialNumber");

-- CreateIndex
CREATE INDEX "PrintGuardBinding_connectionId_state_idx" ON "PrintGuardBinding"("connectionId", "state");

-- CreateIndex
CREATE INDEX "PrintGuardTelemetryEvent_tenantId_state_createdAt_idx" ON "PrintGuardTelemetryEvent"("tenantId", "state", "createdAt");

-- CreateIndex
CREATE INDEX "PrintGuardTelemetryEvent_tenantId_severity_occurredAt_idx" ON "PrintGuardTelemetryEvent"("tenantId", "severity", "occurredAt");

-- CreateIndex
CREATE INDEX "PrintGuardTelemetryEvent_tenantId_customerCode_serialNumber_idx" ON "PrintGuardTelemetryEvent"("tenantId", "customerCode", "serialNumber");

-- CreateIndex
CREATE INDEX "PrintGuardTelemetryEvent_tenantId_assignedToId_decisionDueA_idx" ON "PrintGuardTelemetryEvent"("tenantId", "assignedToId", "decisionDueAt");

-- CreateIndex
CREATE INDEX "PrintGuardTelemetryEvent_tenantId_priorityLevel_state_idx" ON "PrintGuardTelemetryEvent"("tenantId", "priorityLevel", "state");

-- CreateIndex
CREATE UNIQUE INDEX "PrintGuardTelemetryEvent_connectionId_externalEventId_key" ON "PrintGuardTelemetryEvent"("connectionId", "externalEventId");

-- CreateIndex
CREATE INDEX "CrmContract_tenantId_customerExternalId_idx" ON "CrmContract"("tenantId", "customerExternalId");

-- CreateIndex
CREATE INDEX "CrmContract_tenantId_isActive_idx" ON "CrmContract"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContract_tenantId_externalSource_externalId_key" ON "CrmContract"("tenantId", "externalSource", "externalId");

-- CreateIndex
CREATE INDEX "CrmMeterReading_tenantId_equipmentExternalId_readAt_idx" ON "CrmMeterReading"("tenantId", "equipmentExternalId", "readAt");

-- CreateIndex
CREATE INDEX "CrmMeterReading_tenantId_serialNumber_readAt_idx" ON "CrmMeterReading"("tenantId", "serialNumber", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrmMeterReading_tenantId_equipmentExternalId_meterCode_read_key" ON "CrmMeterReading"("tenantId", "equipmentExternalId", "meterCode", "readAt");

-- CreateIndex
CREATE INDEX "CrmBillingStatement_tenantId_period_idx" ON "CrmBillingStatement"("tenantId", "period");

-- CreateIndex
CREATE INDEX "CrmBillingStatement_tenantId_receivableExternalId_idx" ON "CrmBillingStatement"("tenantId", "receivableExternalId");

-- CreateIndex
CREATE INDEX "CrmBillingStatement_tenantId_customerExternalId_idx" ON "CrmBillingStatement"("tenantId", "customerExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmBillingStatement_tenantId_externalSource_externalId_key" ON "CrmBillingStatement"("tenantId", "externalSource", "externalId");

-- CreateIndex
CREATE INDEX "CrmBillingStatementLine_tenantId_statementExternalId_idx" ON "CrmBillingStatementLine"("tenantId", "statementExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmBillingStatementLine_statementId_lineNo_key" ON "CrmBillingStatementLine"("statementId", "lineNo");

-- AddForeignKey
ALTER TABLE "PlanFeature" ADD CONSTRAINT "PlanFeature_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanFeature" ADD CONSTRAINT "PlanFeature_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantFeatureOverride" ADD CONSTRAINT "TenantFeatureOverride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantFeatureOverride" ADD CONSTRAINT "TenantFeatureOverride_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSettings" ADD CONSTRAINT "TenantSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirebirdAgent" ADD CONSTRAINT "FirebirdAgent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentVersionAction" ADD CONSTRAINT "AgentVersionAction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentVersionAction" ADD CONSTRAINT "AgentVersionAction_firebirdAgentId_fkey" FOREIGN KEY ("firebirdAgentId") REFERENCES "FirebirdAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentChecklistItem" ADD CONSTRAINT "DeploymentChecklistItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicalContact" ADD CONSTRAINT "TechnicalContact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaInstance" ADD CONSTRAINT "WaInstance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaInstanceHealthEvent" ADD CONSTRAINT "WaInstanceHealthEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaInstance" ADD CONSTRAINT "MetaInstance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WaInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_crmCustomerId_fkey" FOREIGN KEY ("crmCustomerId") REFERENCES "CrmCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WaInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_metaInstanceId_fkey" FOREIGN KEY ("metaInstanceId") REFERENCES "MetaInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketSession" ADD CONSTRAINT "TicketSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketSession" ADD CONSTRAINT "TicketSession_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTicketState" ADD CONSTRAINT "UserTicketState_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTicketState" ADD CONSTRAINT "UserTicketState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTicketState" ADD CONSTRAINT "UserTicketState_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Knowledge" ADD CONSTRAINT "Knowledge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "KnowledgeDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessHour" ADD CONSTRAINT "BusinessHour_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickResponse" ADD CONSTRAINT "QuickResponse_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickResponse" ADD CONSTRAINT "QuickResponse_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickResponse" ADD CONSTRAINT "QuickResponse_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickResponseAudit" ADD CONSTRAINT "QuickResponseAudit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickResponseAudit" ADD CONSTRAINT "QuickResponseAudit_quickResponseId_fkey" FOREIGN KEY ("quickResponseId") REFERENCES "QuickResponse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickResponseAudit" ADD CONSTRAINT "QuickResponseAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalMessage" ADD CONSTRAINT "InternalMessage_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalMessage" ADD CONSTRAINT "InternalMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalMessage" ADD CONSTRAINT "InternalMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalMessage" ADD CONSTRAINT "InternalMessage_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalMessage" ADD CONSTRAINT "InternalMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "InternalMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalMessageReaction" ADD CONSTRAINT "InternalMessageReaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalMessageReaction" ADD CONSTRAINT "InternalMessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "InternalMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalMessageReaction" ADD CONSTRAINT "InternalMessageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalMessageRead" ADD CONSTRAINT "InternalMessageRead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalMessageRead" ADD CONSTRAINT "InternalMessageRead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "InternalMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalMessageRead" ADD CONSTRAINT "InternalMessageRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalConversationState" ADD CONSTRAINT "InternalConversationState_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalConversationState" ADD CONSTRAINT "InternalConversationState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeLog" ADD CONSTRAINT "KnowledgeLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeLog" ADD CONSTRAINT "KnowledgeLog_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeLog" ADD CONSTRAINT "KnowledgeLog_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeLog" ADD CONSTRAINT "KnowledgeLog_knowledgeId_fkey" FOREIGN KEY ("knowledgeId") REFERENCES "Knowledge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeLog" ADD CONSTRAINT "KnowledgeLog_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeLog" ADD CONSTRAINT "KnowledgeLog_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "KnowledgeChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceOrder" ADD CONSTRAINT "ServiceOrder_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSyncRecord" ADD CONSTRAINT "ExternalSyncRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueSnapshot" ADD CONSTRAINT "RevenueSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCustomer" ADD CONSTRAINT "CrmCustomer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEquipment" ADD CONSTRAINT "CrmEquipment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmEquipment" ADD CONSTRAINT "CrmEquipment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CrmCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmOsType" ADD CONSTRAINT "CrmOsType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmTechnician" ADD CONSTRAINT "CrmTechnician_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmDefectType" ADD CONSTRAINT "CrmDefectType_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingLog" ADD CONSTRAINT "BillingLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyAuditLog" ADD CONSTRAINT "PrivacyAuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAccessSession" ADD CONSTRAINT "SupportAccessSession_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAccessSession" ADD CONSTRAINT "SupportAccessSession_targetTenantId_fkey" FOREIGN KEY ("targetTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyRetentionPolicy" ADD CONSTRAINT "PrivacyRetentionPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyPolicy" ADD CONSTRAINT "PrivacyPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivacyAcceptance" ADD CONSTRAINT "PrivacyAcceptance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WaInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WaInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTemplate" ADD CONSTRAINT "CampaignTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintGuardConnection" ADD CONSTRAINT "PrintGuardConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintGuardBinding" ADD CONSTRAINT "PrintGuardBinding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintGuardBinding" ADD CONSTRAINT "PrintGuardBinding_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "PrintGuardConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintGuardTelemetryEvent" ADD CONSTRAINT "PrintGuardTelemetryEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintGuardTelemetryEvent" ADD CONSTRAINT "PrintGuardTelemetryEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "PrintGuardConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContract" ADD CONSTRAINT "CrmContract_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmMeterReading" ADD CONSTRAINT "CrmMeterReading_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmBillingStatement" ADD CONSTRAINT "CrmBillingStatement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmBillingStatementLine" ADD CONSTRAINT "CrmBillingStatementLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmBillingStatementLine" ADD CONSTRAINT "CrmBillingStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "CrmBillingStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

