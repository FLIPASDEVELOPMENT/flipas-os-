BEGIN;
-- CreateTable
CREATE TABLE "SalesAISettings" (
    "id" TEXT NOT NULL DEFAULT 'company',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "outboundPaused" BOOLEAN NOT NULL DEFAULT true,
    "liveAuthorized" BOOLEAN NOT NULL DEFAULT false,
    "mailProvider" TEXT NOT NULL DEFAULT 'MOCK',
    "aiProvider" TEXT NOT NULL DEFAULT 'MOCK',
    "model" TEXT NOT NULL DEFAULT '',
    "aiKeyCipher" TEXT,
    "inputCostPerMillion" DECIMAL(14,6),
    "outputCostPerMillion" DECIMAL(14,6),
    "approveRoles" JSONB NOT NULL DEFAULT '["OWNER"]',
    "sendRoles" JSONB NOT NULL DEFAULT '["OWNER"]',
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "pollMinutes" INTEGER NOT NULL DEFAULT 5,
    "oauthRegion" TEXT NOT NULL DEFAULT 'US',
    "oauthClientId" TEXT NOT NULL DEFAULT '',
    "oauthSecretCipher" TEXT,

    CONSTRAINT "SalesAISettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailConnection" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'US',
    "accountId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "folderId" TEXT,
    "consented" BOOLEAN NOT NULL DEFAULT false,
    "tokenCipher" TEXT,
    "oauthClientId" TEXT NOT NULL DEFAULT '',
    "oauthSecretCipher" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "connected" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "syncCursor" TEXT,
    "lastError" TEXT,

    CONSTRAINT "MailConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailConversation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "connectionId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "senderName" TEXT NOT NULL DEFAULT '',
    "assignedToId" TEXT NOT NULL,
    "customerId" TEXT,
    "leadId" TEXT,
    "opportunityId" TEXT,
    "unread" BOOLEAN NOT NULL DEFAULT true,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "classification" TEXT NOT NULL DEFAULT 'UNREVIEWED',
    "intelligence" JSONB,
    "analyzedAt" TIMESTAMP(3),

    CONSTRAINT "MailConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversationId" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'INBOUND',
    "fromEmail" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "MailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesEmailDraft" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "approvedVersion" INTEGER,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "requestedById" TEXT,
    "lastError" TEXT,

    CONSTRAINT "SalesEmailDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesEmailVersion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "draftId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "SalesEmailVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailSendAttempt" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "draftId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STARTED',
    "actorId" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "errorCode" TEXT,

    CONSTRAINT "MailSendAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesFollowUp" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "conversationId" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "suggested" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SalesFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesJob" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "errorCode" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SalesJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailOAuthState" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "bindingHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "secretCipher" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "MailOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesAIUsage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(14,6),
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,

    CONSTRAINT "SalesAIUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailConnection_provider_accountId_key" ON "MailConnection"("provider", "accountId");

-- CreateIndex
CREATE INDEX "MailConversation_assignedToId_updatedAt_idx" ON "MailConversation"("assignedToId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MailConversation_connectionId_threadId_key" ON "MailConversation"("connectionId", "threadId");

-- CreateIndex
CREATE UNIQUE INDEX "MailMessage_conversationId_providerMessageId_key" ON "MailMessage"("conversationId", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesEmailVersion_draftId_version_key" ON "SalesEmailVersion"("draftId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "MailSendAttempt_idempotencyKey_key" ON "MailSendAttempt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MailSendAttempt_draftId_version_key" ON "MailSendAttempt"("draftId", "version");

-- CreateIndex
CREATE INDEX "SalesFollowUp_assignedToId_dueAt_idx" ON "SalesFollowUp"("assignedToId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalesJob_key_key" ON "SalesJob"("key");

-- CreateIndex
CREATE INDEX "SalesJob_status_runAt_idx" ON "SalesJob"("status", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "MailOAuthState_stateHash_key" ON "MailOAuthState"("stateHash");

-- AddForeignKey
ALTER TABLE "MailConversation" ADD CONSTRAINT "MailConversation_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MailConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "MailConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesEmailDraft" ADD CONSTRAINT "SalesEmailDraft_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "MailConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesEmailVersion" ADD CONSTRAINT "SalesEmailVersion_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "SalesEmailDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailSendAttempt" ADD CONSTRAINT "MailSendAttempt_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "SalesEmailDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesFollowUp" ADD CONSTRAINT "SalesFollowUp_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "MailConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MailConversation" ADD FOREIGN KEY ("assignedToId") REFERENCES "User"("id"), ADD FOREIGN KEY ("customerId") REFERENCES "Customer"("id"), ADD FOREIGN KEY ("leadId") REFERENCES "Lead"("id"), ADD FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id");
ALTER TABLE "MailConnection" ADD FOREIGN KEY ("ownerId") REFERENCES "User"("id");
ALTER TABLE "SalesEmailDraft" ADD FOREIGN KEY ("approvedById") REFERENCES "User"("id"), ADD FOREIGN KEY ("requestedById") REFERENCES "User"("id"), ADD CHECK ("version">0 AND "status" IN ('GENERATED','PENDING_REVIEW','EDITED','APPROVED','SENDING','SENT','REJECTED','FAILED'));
ALTER TABLE "SalesEmailVersion" ADD FOREIGN KEY ("actorId") REFERENCES "User"("id"), ADD CHECK ("version">0);
ALTER TABLE "MailSendAttempt" ADD FOREIGN KEY ("actorId") REFERENCES "User"("id"), ADD CHECK ("status" IN ('STARTED','SENT','UNCERTAIN','DEFINITELY_FAILED'));
ALTER TABLE "SalesFollowUp" ADD FOREIGN KEY ("assignedToId") REFERENCES "User"("id");
ALTER TABLE "SalesAISettings" ADD CHECK ("retentionDays" BETWEEN 7 AND 3650 AND "pollMinutes" BETWEEN 1 AND 1440);
ALTER TABLE "SalesJob" ADD CHECK ("status" IN ('PENDING','RUNNING','COMPLETED','FAILED'));
CREATE FUNCTION guard_mail_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Mail draft versions are immutable'; END $$;
CREATE TRIGGER mail_version_immutable BEFORE UPDATE OR DELETE ON "SalesEmailVersion" FOR EACH ROW EXECUTE FUNCTION guard_mail_version();
COMMIT;
