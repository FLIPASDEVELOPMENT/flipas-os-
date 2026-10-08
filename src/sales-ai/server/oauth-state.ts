import { randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/server/db";
import { User } from "@/generated/prisma/client";
import { assertOwner } from "@/owner/service";
import { callbackUri } from "../providers/zoho";
import { digest, encryptSecret } from "../domain/security";
/** Single-use OWNER/browser-bound state with immutable client, region and callback snapshots. */
export async function createOAuthState(u: User, browserBinding: string) {
  assertOwner(u);
  if (browserBinding.length < 32) throw new Error("ACCESS_DENIED");
  const settings = await db.salesAISettings.findUniqueOrThrow({
    where: { id: "company" },
  });
  if (!settings.oauthClientId || !settings.oauthSecretCipher)
    throw new Error("AUTH_REQUIRED");
  const state = randomBytes(32).toString("hex");
  await db.mailOAuthState.create({
    data: {
      redirectUri: callbackUri(),
      stateHash: digest(state),
      bindingHash: digest(browserBinding),
      userId: u.id,
      region: settings.oauthRegion,
      clientId: settings.oauthClientId,
      secretCipher: settings.oauthSecretCipher,
      expiresAt: new Date(Date.now() + 10 * 60000),
    },
  });
  return state;
}
export async function consumeOAuthState(
  u: User,
  state: string,
  browserBinding: string,
) {
  assertOwner(u);
  if (!/^[a-f0-9]{64}$/.test(state) || browserBinding.length < 32)
    throw new Error("ACCESS_DENIED");
  return db.$transaction(
    async (tx) => {
      const row = await tx.mailOAuthState.findUnique({
        where: { stateHash: digest(state) },
      });
      const expected = Buffer.from(digest(browserBinding)),
        actual = Buffer.from(row?.bindingHash ?? "".padEnd(64, "0"));
      if (
        !row ||
        !timingSafeEqual(expected, actual) ||
        row.userId !== u.id ||
        row.usedAt ||
        row.expiresAt <= new Date()
      )
        throw new Error("ACCESS_DENIED");
      const claimed = await tx.mailOAuthState.updateMany({
        where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date(), secretCipher: encryptSecret("consumed") },
      });
      if (claimed.count !== 1) throw new Error("ACCESS_DENIED");
      return row;
    },
    { isolationLevel: "Serializable" },
  );
}
