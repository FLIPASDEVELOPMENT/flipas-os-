import type { User } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { assertOwner } from "@/owner/service";
import { decryptSecret, encryptSecret, safeError } from "../domain/security";
import { writeScopes, realDeliveryEnabled } from "../domain/delivery";
import { ZohoClient } from "../providers/zoho";
import { tokenSet } from "./token-lifecycle";
import { audit, enqueue } from "./service";

export async function finishWriteOAuth(
  u: User,
  state: {
    writeConsentedAt?: Date | null;
    expectedAccountId?: string | null;
    expectedAddress?: string | null;
    purpose: string;
    connectionId: string | null;
    region: string;
    clientId: string;
    secretCipher: string;
    redirectUri: string;
  },
  code: string,
  client = new ZohoClient(state.region),
) {
  assertOwner(u);
  if (state.purpose !== "SEND" || !state.connectionId)
    throw new Error("ACCESS_DENIED");
  const c = await db.mailConnection.findUniqueOrThrow({
    where: { id: state.connectionId },
    include: { writeConsent: true },
  });
  if (
    c.ownerId !== u.id ||
    !c.connected ||
    !c.consented ||
    c.region !== state.region ||
    !c.writeConsent ||
    c.writeConsent.revokedAt ||
    c.writeConsent.tokenCipher ||
    c.accountId !== state.expectedAccountId ||
    c.address !== state.expectedAddress ||
    c.writeConsent.consentedAt.getTime() !== state.writeConsentedAt?.getTime()
  )
    throw new Error("WRITE_AUTH_REQUIRED");
  const secret = decryptSecret(state.secretCipher);
  const tokens = await client.exchange(
    state.clientId,
    secret,
    code,
    state.redirectUri,
    writeScopes,
  );
  if (
    c.tokenCipher &&
    tokenSet.parse(JSON.parse(decryptSecret(c.tokenCipher))).refreshToken ===
      tokens.refreshToken
  ) {
    // Never revoke a provider-reused token: that would also revoke existing reading access.
    await db.$transaction((tx) =>
      audit(tx, u.id, "MAIL_WRITE_SHARED_GRANT_REJECTED", {
        connectionId: c.id,
      }),
    );
    throw new Error("SHARED_GRANT_REJECTED");
  }
  // Durable encrypted cleanup record precedes account verification. Failed discovery never loses revocation credentials.
  const pending = await db.mailOAuthGrant.create({
    data: {
      ownerId: u.id,
      expiresAt: new Date(Date.now() + 10 * 60000),
      grantCipher: encryptSecret(
        JSON.stringify({
          region: state.region,
          clientId: state.clientId,
          secret,
          tokens,
          accounts: [],
        }),
      ),
    },
  });
  try {
    if (
      tokens.scopes &&
      (writeScopes.some((scope) => !tokens.scopes!.includes(scope)) ||
        tokens.scopes.some(
          (scope) =>
            !writeScopes.includes(scope as (typeof writeScopes)[number]),
        ))
    )
      throw new Error("WRITE_AUTH_REQUIRED");
    const accounts = await client.accounts(tokens.accessToken);
    if (
      !accounts.some(
        (a) =>
          a.accountId === c.accountId &&
          a.primaryEmailAddress.toLowerCase() === c.address.toLowerCase(),
      )
    )
      throw new Error("ACCOUNT_MISMATCH");
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SalesAISettings" WHERE "id"='company' FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "MailWriteConsent" WHERE "connectionId"=${c.id} FOR UPDATE`;
      const fresh = await tx.mailConnection.findUniqueOrThrow({
        where: { id: c.id },
        include: { writeConsent: true },
      });
      if (
        !fresh.connected ||
        !fresh.consented ||
        fresh.ownerId !== u.id ||
        fresh.region !== state.region ||
        !fresh.writeConsent ||
        fresh.writeConsent.revokedAt ||
        fresh.writeConsent.tokenCipher ||
        fresh.accountId !== state.expectedAccountId ||
        fresh.address !== state.expectedAddress ||
        fresh.writeConsent.consentedAt.getTime() !==
          state.writeConsentedAt?.getTime()
      )
        throw new Error("WRITE_AUTH_REQUIRED");
      await tx.mailWriteConsent.update({
        where: { connectionId: c.id },
        data: {
          authorizedAt: new Date(),
          tokenCipher: encryptSecret(JSON.stringify(tokens)),
          tokenExpiresAt: tokens.expiresAt,
          oauthClientId: state.clientId,
          oauthSecretCipher: encryptSecret(secret),
          scopes: [...writeScopes],
          sendEnabled: false,
          testOnly: true,
          lastError: null,
        },
      });
      await tx.salesAISettings.update({
        where: { id: "company" },
        data: { outboundPaused: true },
      });
      await tx.mailOAuthGrant.delete({ where: { id: pending.id } });
      await audit(tx, u.id, "MAIL_WRITE_OAUTH_AUTHORIZED", {
        connectionId: c.id,
        region: c.region,
        scopes: [...writeScopes],
        enabled: false,
      });
    });
  } catch (e) {
    await db.mailOAuthGrant.update({
      where: { id: pending.id },
      data: { expiresAt: new Date(0) },
    });
    await enqueue("REVOKE_GRANT", `revoke-grant:${pending.id}`, {
      grantId: pending.id,
    });
    throw e;
  }
}

/** GET account access only; an expired OAuth token may be refreshed. Never sends mail. */
export async function testWriteConnection(
  u: User,
  connectionId: string,
  client?: ZohoClient,
) {
  assertOwner(u);
  const c = await db.mailConnection.findUniqueOrThrow({
    where: { id: connectionId },
  });
  if (c.ownerId !== u.id || !c.connected || !c.consented)
    throw new Error("ACCESS_DENIED");
  let errorCode: string | null = null;
  try {
    const token = await writeAccessToken(connectionId, client);
    const accounts = await (client ?? new ZohoClient(c.region)).accounts(token);
    if (
      !accounts.some(
        (a) =>
          a.accountId === c.accountId &&
          a.primaryEmailAddress.toLowerCase() === c.address.toLowerCase(),
      )
    )
      throw new Error("ACCOUNT_MISMATCH");
  } catch (e) {
    // Persist only allowlisted codes, never provider bodies or credentials.
    errorCode = safeError(e);
  }
  const result = {
    success: errorCode === null,
    errorCode,
    checkedAt: new Date().toISOString(),
  };
  await db.$transaction((tx) =>
    audit(tx, u.id, "MAIL_WRITE_CONNECTION_TESTED", {
      connectionId,
      delivery: false,
      ...result,
    }),
  );
  return result;
}

export async function writeAccessToken(
  connectionId: string,
  client?: ZohoClient,
) {
  const result = await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MailWriteConsent" WHERE "connectionId"=${connectionId} FOR UPDATE`;
      const c = await tx.mailConnection.findUniqueOrThrow({
          where: { id: connectionId },
          include: { writeConsent: true },
        }),
        w = c.writeConsent;
      if (
        !c.connected ||
        !c.consented ||
        !w?.authorizedAt ||
        w.revokedAt ||
        !w.tokenCipher ||
        !w.oauthSecretCipher ||
        w.region !== c.region ||
        w.accountId !== c.accountId ||
        w.address.toLowerCase() !== c.address.toLowerCase()
      )
        throw new Error("WRITE_AUTH_REQUIRED");
      const tokens = tokenSet.parse(JSON.parse(decryptSecret(w.tokenCipher)));
      if (tokens.expiresAt.getTime() > Date.now() + 60000)
        return tokens.accessToken;
      try {
        const refreshed = await (client ?? new ZohoClient(w.region)).refresh(
          w.oauthClientId,
          decryptSecret(w.oauthSecretCipher),
          tokens,
        );
        if (
          refreshed.scopes &&
          (writeScopes.some((scope) => !refreshed.scopes!.includes(scope)) ||
            refreshed.scopes.some(
              (scope) =>
                !writeScopes.includes(scope as (typeof writeScopes)[number]),
            ))
        )
          throw new Error("TOKEN_REFRESH_FAILED");
        const next = tokenSet.parse(refreshed);
        await tx.mailWriteConsent.update({
          where: { id: w.id },
          data: {
            tokenCipher: encryptSecret(JSON.stringify(next)),
            tokenExpiresAt: next.expiresAt,
            lastError: null,
          },
        });
        return next.accessToken;
      } catch {
        await tx.mailWriteConsent.update({
          where: { id: w.id },
          data: { lastError: "TOKEN_REFRESH_FAILED", sendEnabled: false },
        });
        return null;
      }
    },
    { timeout: 20000 },
  );
  if (!result) throw new Error("TOKEN_REFRESH_FAILED");
  return result;
}

export async function configureWriteDelivery(
  u: User,
  connectionId: string,
  enable: boolean,
  testOnly = true,
) {
  assertOwner(u);
  if (enable && !realDeliveryEnabled()) throw new Error("LIVE_DISABLED");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "SalesAISettings" WHERE "id"='company' FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "MailWriteConsent" WHERE "connectionId"=${connectionId} FOR UPDATE`;
    const w = await tx.mailWriteConsent.findUniqueOrThrow({
      where: { connectionId },
    });
    if (w.ownerId !== u.id || !w.authorizedAt || w.revokedAt || !w.tokenCipher)
      throw new Error("WRITE_AUTH_REQUIRED");
    if (enable && testOnly && w.testAttemptAt)
      throw new Error("TEST_ALREADY_ATTEMPTED");
    await tx.mailWriteConsent.update({
      where: { id: w.id },
      data: { sendEnabled: enable, testOnly },
    });
    await tx.salesAISettings.update({
      where: { id: "company" },
      data: { outboundPaused: true },
    });
    await audit(tx, u.id, "MAIL_WRITE_DELIVERY_CONFIGURED", {
      connectionId,
      enabled: enable,
      testOnly,
      paused: true,
    });
  });
}
export async function revokeWriteTokens(
  connectionId: string,
  client?: ZohoClient,
) {
  await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MailWriteConsent" WHERE "connectionId"=${connectionId} FOR UPDATE`;
      const w = await tx.mailWriteConsent.findUnique({
        where: { connectionId },
      });
      if (!w?.tokenCipher) return;
      if (!w.revokedAt || !w.oauthSecretCipher)
        throw new Error("ACCESS_DENIED");
      const tokens = tokenSet.parse(JSON.parse(decryptSecret(w.tokenCipher)));
      await (client ?? new ZohoClient(w.region)).revoke(
        tokens.refreshToken,
        w.oauthClientId,
        decryptSecret(w.oauthSecretCipher),
      );
      await tx.mailWriteConsent.update({
        where: { id: w.id },
        data: {
          tokenCipher: null,
          oauthSecretCipher: null,
          tokenExpiresAt: null,
          lastError: null,
        },
      });
      await audit(tx, w.ownerId, "MAIL_WRITE_OAUTH_REVOKED", { connectionId });
    },
    { timeout: 20000 },
  );
}
