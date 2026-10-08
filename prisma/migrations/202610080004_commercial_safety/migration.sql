ALTER TABLE "MailConversation" ADD COLUMN "doNotContact" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MailConversation" ADD COLUMN "crmVerifiedAt" TIMESTAMP(3);
CREATE TABLE "MailWriteConsent" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "connectionId" TEXT NOT NULL UNIQUE REFERENCES "MailConnection"("id"),
 "ownerId" TEXT NOT NULL REFERENCES "User"("id"),
 "consentedAt" TIMESTAMP(3) NOT NULL,
 "revokedAt" TIMESTAMP(3),
 "region" TEXT NOT NULL,
 "accountId" TEXT NOT NULL,
 "address" TEXT NOT NULL,
 "scopes" JSONB NOT NULL
);
