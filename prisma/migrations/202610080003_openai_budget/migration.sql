ALTER TABLE "SalesAISettings" ADD COLUMN "aiPaused" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "monthlyBudget" DECIMAL(14,6) NOT NULL DEFAULT 10, ADD COLUMN "alertAt" DECIMAL(14,6) NOT NULL DEFAULT 5;
UPDATE "SalesAISettings" SET "aiKeyCipher" = NULL;
CREATE TABLE "SalesAIBudgetMonth" ("id" TEXT PRIMARY KEY, "alertSentAt" TIMESTAMP(3));
ALTER TABLE "SalesAIUsage" ADD COLUMN "operation" TEXT NOT NULL DEFAULT 'ANALYZE', ADD COLUMN "monthKey" TEXT NOT NULL DEFAULT '', ADD COLUMN "messageId" TEXT NOT NULL DEFAULT '', ADD COLUMN "status" TEXT NOT NULL DEFAULT 'LEGACY', ADD COLUMN "reservedCost" DECIMAL(14,6) NOT NULL DEFAULT 0, ADD COLUMN "inputRate" DECIMAL(14,6), ADD COLUMN "outputRate" DECIMAL(14,6);
CREATE INDEX "SalesAIUsage_monthKey_provider_idx" ON "SalesAIUsage"("monthKey", "provider");
CREATE INDEX "SalesAIUsage_messageId_provider_idx" ON "SalesAIUsage"("messageId", "provider");
ALTER TABLE "MailConversation" ADD COLUMN "reviewedAt" TIMESTAMP(3);
