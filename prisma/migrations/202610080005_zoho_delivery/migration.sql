ALTER TABLE "MailOAuthState" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'READ', ADD COLUMN "connectionId" TEXT, ADD COLUMN "writeConsentedAt" TIMESTAMP(3), ADD COLUMN "expectedAccountId" TEXT, ADD COLUMN "expectedAddress" TEXT;
ALTER TABLE "MailWriteConsent" ADD COLUMN "authorizedAt" TIMESTAMP(3), ADD COLUMN "tokenCipher" TEXT, ADD COLUMN "tokenExpiresAt" TIMESTAMP(3), ADD COLUMN "oauthClientId" TEXT NOT NULL DEFAULT '', ADD COLUMN "oauthSecretCipher" TEXT, ADD COLUMN "sendEnabled" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "testOnly" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "testAttemptAt" TIMESTAMP(3), ADD COLUMN "lastError" TEXT;

-- Installing real transport must never inherit an unpaused mock-testing state.
UPDATE "SalesAISettings" SET "outboundPaused" = true WHERE "id" = 'company';
