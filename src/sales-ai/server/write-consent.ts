import type { User } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { assertOwner } from "@/owner/service";
import { writeScopes } from "../domain/delivery";
import { regionEndpoints } from "../providers/zoho";
import { audit } from "./service";
/** No OAuth exchange and no tokens: OWNER consent is preparation, not a grant. */
export async function prepareWriteConsent(
  u: User,
  connectionId: string,
  consent: boolean,
) {
  assertOwner(u);
  if (!consent) throw new Error("WRITE_AUTH_REQUIRED");
  return db.$transaction(async (tx) => {
    const c = await tx.mailConnection.findUniqueOrThrow({
      where: { id: connectionId },
    });
    if (
      c.provider !== "ZOHO" ||
      c.ownerId !== u.id ||
      !c.connected ||
      !c.consented
    )
      throw new Error("ACCESS_DENIED");
    regionEndpoints(c.region);
    const data = {
      ownerId: u.id,
      consentedAt: new Date(),
      revokedAt: null,
      region: c.region,
      accountId: c.accountId,
      address: c.address,
      scopes: [...writeScopes],
    };
    await tx.mailWriteConsent.upsert({
      where: { connectionId },
      create: { connectionId, ...data },
      update: data,
    });
    await audit(tx, u.id, "MAIL_WRITE_CONSENT_PREPARED", {
      connectionId,
      scopes: [...writeScopes],
      activated: false,
    });
  });
}
export async function revokeWriteConsent(u: User, connectionId: string) {
  assertOwner(u);
  await db.$transaction(async (tx) => {
    const c = await tx.mailConnection.findUniqueOrThrow({
      where: { id: connectionId },
    });
    if (c.ownerId !== u.id) throw new Error("ACCESS_DENIED");
    await tx.mailWriteConsent.updateMany({
      where: { connectionId, ownerId: u.id },
      data: { revokedAt: new Date() },
    });
    await tx.salesAISettings.update({
      where: { id: "company" },
      data: { outboundPaused: true },
    });
    await audit(tx, u.id, "MAIL_WRITE_CONSENT_REVOKED", { connectionId });
  });
}
