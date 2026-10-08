import { db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { deliveryBlock, writeScopes } from "../domain/delivery";
import { digest } from "../domain/security";
import { postZohoDelivery } from "../providers/zoho-delivery";
import type { MailProvider } from "../providers/mail";
import { writeAccessToken } from "./write-oauth";
import { configuredRole } from "./access";
import { conversation, assertContactAllowed } from "./service";

export async function assertWriteGrant(
  tx: Prisma.TransactionClient,
  connectionId: string,
  recipient: string,
) {
  await tx.$queryRaw`SELECT "id" FROM "MailWriteConsent" WHERE "connectionId"=${connectionId} FOR UPDATE`;
  const c = await tx.mailConnection.findUniqueOrThrow({
      where: { id: connectionId },
      include: { writeConsent: true },
    }),
    w = c.writeConsent;
  const scopes = Array.isArray(w?.scopes) ? w.scopes : [];
  const valid =
    c.provider === "ZOHO" &&
    w?.ownerId === c.ownerId &&
    !!w?.authorizedAt &&
    !w.revokedAt &&
    !!w.tokenCipher &&
    !!w.oauthSecretCipher &&
    w.region === c.region &&
    w.accountId === c.accountId &&
    w.address.toLowerCase() === c.address.toLowerCase() &&
    writeScopes.every((s) => scopes.includes(s));
  const block = deliveryBlock(
    c.provider,
    false,
    valid,
    w?.sendEnabled ?? false,
  );
  if (block) throw new Error(block);
  if (!c.connected || !c.consented) throw new Error("WRITE_AUTH_REQUIRED");
  if (w!.testOnly && recipient.toLowerCase() !== c.address.toLowerCase())
    throw new Error("TEST_RECIPIENT_REQUIRED");
  return { c, w: w! };
}

/** Token renewal precedes claim; the dispatch transaction rechecks all controls immediately before POST. */
export async function zohoSendingProvider(
  connectionId: string,
  draftId: string,
  version: number,
  userId: string,
  transport: typeof fetch = fetch,
): Promise<MailProvider> {
  const token = await writeAccessToken(connectionId);
  return {
    listMessages: async () => {
      throw new Error("ACCESS_DENIED");
    },
    disconnect: async () => {
      throw new Error("ACCESS_DENIED");
    },
    send: async (id, message, signal) =>
      db.$transaction(
        async (tx) => {
          if (id !== connectionId) throw new Error("ACCESS_DENIED");
          await tx.$queryRaw`SELECT "id" FROM "SalesAISettings" WHERE "id"='company' FOR UPDATE`;
          const settings = await tx.salesAISettings.findUniqueOrThrow({
            where: { id: "company" },
          });
          if (settings.outboundPaused) throw new Error("OUTBOUND_PAUSED");
          if (!settings.processingEnabled)
            throw new Error("PROCESSING_DISABLED");
          const { c } = await assertWriteGrant(tx, id, message.recipient);
          await tx.$queryRaw`SELECT "id" FROM "SalesEmailDraft" WHERE "id"=${draftId} FOR UPDATE`;
          const d = await tx.salesEmailDraft.findUniqueOrThrow({
            where: { id: draftId },
            include: { versions: { where: { version } }, attempts: true },
          });
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" IN (${userId},${d.approvedById ?? ""}) ORDER BY "id" FOR UPDATE`;
          await tx.$queryRaw`SELECT "id" FROM "MailConversation" WHERE "id"=${d.conversationId} FOR UPDATE`;
          const user = await tx.user.findUniqueOrThrow({
            where: { id: userId },
          });
          const approver = await tx.user.findUnique({
            where: { id: d.approvedById ?? "" },
          });
          const conv = await conversation(user, d.conversationId, tx);
          await assertContactAllowed(conv, tx);
          const snapshot = d.versions[0];
          if (
            !configuredRole(user, settings.sendRoles) ||
            !approver ||
            !configuredRole(approver, settings.approveRoles) ||
            d.status !== "SENDING" ||
            d.version !== version ||
            d.approvedVersion !== version ||
            d.requestedById !== userId ||
            message.replyToMessageId !==
              conv.messages.findLast((m) => m.direction === "INBOUND")
                ?.providerMessageId ||
            conv.connectionId !== id ||
            conv.senderEmail.toLowerCase() !==
              message.recipient.toLowerCase() ||
            !d.approvedAt ||
            conv.messages.some(
              (m) => m.direction === "INBOUND" && m.createdAt > d.approvedAt!,
            ) ||
            !snapshot ||
            snapshot.bodyHash !== digest(message.body) ||
            snapshot.body !== message.body ||
            snapshot.subject !== message.subject ||
            snapshot.recipient.toLowerCase() !==
              message.recipient.toLowerCase() ||
            !d.attempts.some(
              (a) =>
                a.version === version &&
                a.status === "STARTED" &&
                a.idempotencyKey === message.idempotencyKey,
            )
          )
            throw new Error("ACCESS_DENIED");
          signal?.throwIfAborted();
          // Settings and grant locks cover the bounded POST: pause/revoke linearize before or after dispatch.
          return postZohoDelivery(
            {
              replyToMessageId: message.replyToMessageId,
              region: c.region,
              accountId: c.accountId,
              address: c.address,
              expectedRecipient: conv.senderEmail,
              recipient: message.recipient,
              subject: message.subject,
              body: message.body,
            },
            token,
            message.idempotencyKey,
            signal,
            transport,
          );
        },
        { timeout: 20000 },
      ),
  };
}
