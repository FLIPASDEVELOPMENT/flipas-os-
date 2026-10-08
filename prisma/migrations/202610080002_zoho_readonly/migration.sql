ALTER TABLE "MailOAuthState" ADD COLUMN "redirectUri" TEXT NOT NULL DEFAULT '';
CREATE TABLE "MailOAuthGrant" (
 "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "grantCipher" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "MailOAuthGrant_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "MailOAuthGrant_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
