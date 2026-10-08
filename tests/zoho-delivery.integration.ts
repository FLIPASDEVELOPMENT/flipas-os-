import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import * as service from "../src/sales-ai/server/service";
import {
  prepareWriteConsent,
  revokeWriteConsent,
} from "../src/sales-ai/server/write-consent";
import {
  finishWriteOAuth,
  writeAccessToken,
  revokeWriteTokens,
  testWriteConnection,
  configureWriteDelivery,
} from "../src/sales-ai/server/write-oauth";
import {
  createOAuthState,
  consumeOAuthState,
} from "../src/sales-ai/server/oauth-state";
import { ZohoClient } from "../src/sales-ai/providers/zoho";
import { writeScopes } from "../src/sales-ai/domain/delivery";
import {
  decryptSecret,
  encryptSecret,
  digest,
} from "../src/sales-ai/domain/security";
import { zohoSendingProvider } from "../src/sales-ai/server/zoho-send";
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error("Disposable database required");
process.env.MAIL_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.APP_ORIGIN = "http://localhost:3000";
after(() => db.$disconnect());
test("Zoho sending OAuth lifecycle, security, exact approval and single-use transport", async (t) => {
  const owner = await db.user.create({
    data: {
      name: "Owner",
      role: "OWNER",
      email: randomUUID() + "@example.invalid",
      passwordHash: "not-a-login",
    },
  });
  const sales = await db.user.create({
    data: {
      name: "Sales",
      role: "SALES",
      email: randomUUID() + "@example.invalid",
      passwordHash: "not-a-login",
    },
  });
  await db.salesAISettings.create({ data: { id: "company" } });
  await db.salesAISettings.update({
    where: { id: "company" },
    data: {
      processingEnabled: true,
      outboundPaused: true,
      oauthRegion: "US",
      oauthClientId: "synthetic-client",
      oauthSecretCipher: encryptSecret("synthetic-secret"),
    },
  });
  const c = await db.mailConnection.create({
    data: {
      provider: "ZOHO",
      ownerId: owner.id,
      accountId: "123",
      region: "US",
      address: "owner@example.invalid",
      consented: true,
      connected: true,
      folderId: "456",
      tokenCipher: encryptSecret(
        JSON.stringify({
          accessToken: "read-token",
          refreshToken: "read-refresh",
          expiresAt: new Date(Date.now() + 3600000),
        }),
      ),
    },
  });
  let refreshes = 0,
    revokes = 0,
    posts = 0;
  const transport: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === "/oauth/v2/token") {
      const form = init?.body as URLSearchParams;
      if (form.get("grant_type") === "refresh_token") refreshes++;
      else assert.equal(form.get("scope"), writeScopes.join(","));
      return Response.json({
        access_token: "write-token",
        refresh_token: "write-refresh",
        expires_in: 3600,
      });
    }
    if (path === "/oauth/v2/revoke/token") {
      revokes++;
      return new Response(null, { status: 200 });
    }
    if (path === "/api/accounts")
      return Response.json({
        status: { code: 200 },
        data: [{ accountId: "123", primaryEmailAddress: c.address }],
      });
    posts++;
    throw new Error("Unexpected HTTP path");
  };
  const client = new ZohoClient("US", transport);
  await t.test(
    "OWNER-only browser-bound SEND state cannot reuse READ state or another browser",
    async () => {
      await assert.rejects(prepareWriteConsent(sales, c.id, true));
      await prepareWriteConsent(owner, c.id, true);
      const binding = "b".repeat(64),
        state = await createOAuthState(owner, binding, c.id);
      await assert.rejects(
        consumeOAuthState(owner, state, "wrong".repeat(16)),
        /ACCESS_DENIED/,
      );
      const snapshot = await consumeOAuthState(owner, state, binding);
      assert.equal(snapshot.purpose, "SEND");
      assert.equal(snapshot.connectionId, c.id);
      await assert.rejects(
        consumeOAuthState(owner, state, binding),
        /ACCESS_DENIED/,
      );
      await finishWriteOAuth(owner, snapshot, "synthetic-code", client);
      const w = await db.mailWriteConsent.findUniqueOrThrow({
        where: { connectionId: c.id },
      });
      assert.ok(w.authorizedAt);
      assert.equal(w.sendEnabled, false);
      assert.equal(w.testOnly, true);
      assert.ok(!w.tokenCipher?.includes("write-token"));
      assert.equal(
        JSON.parse(decryptSecret(w.tokenCipher!)).accessToken,
        "write-token",
      );
      assert.equal(
        (await db.mailConnection.findUniqueOrThrow({ where: { id: c.id } }))
          .tokenCipher,
        c.tokenCipher,
      );
      assert.equal((await service.salesSettings()).outboundPaused, true);
      assert.equal(posts, 0);
    },
  );
  await t.test(
    "refresh serialized, connection test never sends and missing gate cannot arm",
    async () => {
      const w = await db.mailWriteConsent.findUniqueOrThrow({
        where: { connectionId: c.id },
      });
      const tokens = JSON.parse(decryptSecret(w.tokenCipher!));
      tokens.expiresAt = new Date(0);
      await db.mailWriteConsent.update({
        where: { id: w.id },
        data: { tokenCipher: encryptSecret(JSON.stringify(tokens)) },
      });
      const values = await Promise.all([
        writeAccessToken(c.id, client),
        writeAccessToken(c.id, client),
      ]);
      assert.deepEqual(values, ["write-token", "write-token"]);
      assert.equal(refreshes, 1);
      await testWriteConnection(owner, c.id, client);
      assert.equal(posts, 0);
      await assert.rejects(testWriteConnection(sales, c.id, client));
      delete process.env.ZOHO_SEND_ENABLED;
      await assert.rejects(
        configureWriteDelivery(owner, c.id, true),
        /LIVE_DISABLED/,
      );
    },
  );
  const conv = await db.mailConversation.create({
    data: {
      connectionId: c.id,
      threadId: "789",
      subject: "Self test",
      senderEmail: c.address,
      assignedToId: owner.id,
      classification: "POTENTIAL_LEAD",
      reviewedAt: new Date(),
    },
  });
  await db.mailMessage.create({
    data: {
      conversationId: conv.id,
      providerMessageId: "789",
      direction: "INBOUND",
      fromEmail: c.address,
      toEmail: c.address,
      subject: conv.subject,
      body: "Self test",
      receivedAt: new Date(),
    },
  });
  const draft = async () => {
    const d = await db.salesEmailDraft.create({
      data: { conversationId: conv.id, version: 1, status: "GENERATED" },
    });
    await db.salesEmailVersion.create({
      data: {
        draftId: d.id,
        version: 1,
        recipient: c.address,
        subject: "Re: Self test",
        body: "Thank you. This is the approved self test.",
        bodyHash: digest("Thank you. This is the approved self test."),
        actorId: owner.id,
        source: "HUMAN_EDIT",
      },
    });
    await service.reviewDraft(owner, d.id, "submit", 1);
    await service.reviewDraft(owner, d.id, "approve", 1);
    return d;
  };
  const d = await draft();
  await t.test(
    "pause, grant identity, modified/rejected draft and wrong recipient block",
    async () => {
      await assert.rejects(
        service.requestSend(owner, d.id, 1),
        /OUTBOUND_PAUSED/,
      );
      process.env.ZOHO_SEND_ENABLED = "true";
      await configureWriteDelivery(owner, c.id, true);
      await db.salesAISettings.update({
        where: { id: "company" },
        data: { outboundPaused: false },
      });
      const edited = await draft();
      await service.editDraft(owner, edited.id, {
        expectedVersion: 1,
        recipient: c.address,
        subject: "Re: Self test",
        body: "Changed approved text",
      });
      await assert.rejects(
        service.requestSend(owner, edited.id, 1),
        /approved/,
      );
      const rejected = await draft();
      await db.salesEmailDraft.update({
        where: { id: rejected.id },
        data: { status: "REJECTED" },
      });
      await assert.rejects(
        service.requestSend(owner, rejected.id, 1),
        /approved/,
      );
      await db.mailWriteConsent.update({
        where: { connectionId: c.id },
        data: { accountId: "999" },
      });
      await assert.rejects(
        service.requestSend(owner, d.id, 1),
        /WRITE_AUTH_REQUIRED/,
      );
      await db.mailWriteConsent.update({
        where: { connectionId: c.id },
        data: { accountId: c.accountId },
      });
      await db.mailConversation.update({
        where: { id: conv.id },
        data: { senderEmail: "other@example.invalid" },
      });
      await assert.rejects(
        service.requestSend(owner, d.id, 1),
        /TEST_RECIPIENT_REQUIRED/,
      );
      await db.mailConversation.update({
        where: { id: conv.id },
        data: { senderEmail: c.address },
      });
      await assert.rejects(
        service.requestSend(sales, d.id, 1),
        /ACCESS_DENIED/,
      );
    },
  );
  await t.test(
    "separate request and bounded Zoho mock POST run exactly once across concurrent workers",
    async () => {
      await service.requestSend(owner, d.id, 1);
      let count = 0;
      const provider = await zohoSendingProvider(
        c.id,
        d.id,
        1,
        owner.id,
        async (url, init) => {
          count++;
          assert.equal(
            String(url),
            "https://mail.zoho.com/api/accounts/123/messages/789",
          );
          assert.equal(JSON.parse(String(init?.body)).toAddress, c.address);
          return Response.json({
            status: { code: 200 },
            data: { messageId: "1001" },
          });
        },
      );
      const results = await Promise.allSettled([
        service.sendApproved(d.id, 1, owner.id, provider),
        service.sendApproved(d.id, 1, owner.id, provider),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(count, 1);
      assert.equal(
        (await db.salesEmailDraft.findUniqueOrThrow({ where: { id: d.id } }))
          .status,
        "SENT",
      );
      const newDraft = await draft();
      assert.notEqual(newDraft.id, d.id);
      assert.equal(newDraft.version, d.version);
      await assert.rejects(
        service.requestSend(owner, newDraft.id, 1),
        /TEST_ALREADY_ATTEMPTED/,
      );
      const audit = await db.activity.findFirstOrThrow({
        where: {
          type: "EMAIL_SENT",
          metadata: { path: ["draftId"], equals: d.id },
        },
      });
      const text = JSON.stringify(audit.metadata);
      assert.ok(
        text.includes(owner.id) &&
          text.includes("1001") &&
          text.includes(c.address),
      );
      assert.ok(
        !text.includes("write-token") && !text.includes("synthetic-secret"),
      );
    },
  );
  await t.test(
    "wrong account OAuth is cleaned up and READ state cannot install sending grant",
    async () => {
      const other = await db.mailConnection.create({
        data: {
          provider: "ZOHO",
          ownerId: owner.id,
          accountId: "222",
          address: "other@example.invalid",
          connected: true,
          consented: true,
        },
      });
      await prepareWriteConsent(owner, other.id, true);
      const state = await createOAuthState(owner, "c".repeat(64), other.id);
      const snapshot = await consumeOAuthState(owner, state, "c".repeat(64));
      await assert.rejects(
        finishWriteOAuth(
          owner,
          { ...snapshot, purpose: "READ" },
          "code",
          client,
        ),
        /ACCESS_DENIED/,
      );
      await assert.rejects(
        finishWriteOAuth(owner, snapshot, "code", client),
        /ACCOUNT_MISMATCH/,
      );
      assert.equal(
        (
          await db.mailWriteConsent.findUniqueOrThrow({
            where: { connectionId: other.id },
          })
        ).tokenCipher,
        null,
      );
      assert.ok(
        await db.salesJob.findFirst({
          where: { type: "REVOKE_GRANT", status: "PENDING" },
        }),
      );
      await assert.rejects(
        finishWriteOAuth(
          owner,
          { ...snapshot, expectedAddress: c.address },
          "code",
          client,
        ),
        /WRITE_AUTH_REQUIRED/,
      );
    },
  );
  await t.test(
    "shared read refresh tokens are rejected without revoking reading",
    async () => {
      const shared = await db.mailConnection.create({
        data: {
          provider: "ZOHO",
          ownerId: owner.id,
          accountId: "333",
          address: "shared@example.invalid",
          connected: true,
          consented: true,
          tokenCipher: encryptSecret(
            JSON.stringify({
              accessToken: "read",
              refreshToken: "write-refresh",
              expiresAt: new Date(Date.now() + 3600000),
            }),
          ),
        },
      });
      await prepareWriteConsent(owner, shared.id, true);
      const state = await createOAuthState(owner, "d".repeat(64), shared.id);
      const snapshot = await consumeOAuthState(owner, state, "d".repeat(64));
      const pendingBefore = await db.salesJob.count({
        where: { type: "REVOKE_GRANT" },
      });
      await assert.rejects(
        finishWriteOAuth(owner, snapshot, "code", client),
        /SHARED_GRANT_REJECTED/,
      );
      assert.equal(
        await db.salesJob.count({ where: { type: "REVOKE_GRANT" } }),
        pendingBefore,
      );
      assert.equal(
        (
          await db.mailConnection.findUniqueOrThrow({
            where: { id: shared.id },
          })
        ).tokenCipher,
        shared.tokenCipher,
      );
    },
  );
  await t.test(
    "refresh failure preserves encrypted credentials but disables sending",
    async () => {
      const failed = await db.mailConnection.create({
        data: {
          provider: "ZOHO",
          ownerId: owner.id,
          accountId: "444",
          address: "fail@example.invalid",
          connected: true,
          consented: true,
        },
      });
      await prepareWriteConsent(owner, failed.id, true);
      const cipher = encryptSecret(
        JSON.stringify({
          accessToken: "write",
          refreshToken: "write-refresh",
          expiresAt: new Date(0),
        }),
      );
      await db.mailWriteConsent.update({
        where: { connectionId: failed.id },
        data: {
          authorizedAt: new Date(),
          tokenCipher: cipher,
          oauthClientId: "client",
          oauthSecretCipher: encryptSecret("secret"),
          sendEnabled: true,
        },
      });
      const failing = new ZohoClient("US", async () =>
        Response.json({ error: "private-provider-error" }, { status: 401 }),
      );
      await assert.rejects(
        writeAccessToken(failed.id, failing),
        /TOKEN_REFRESH_FAILED/,
      );
      const row = await db.mailWriteConsent.findUniqueOrThrow({
        where: { connectionId: failed.id },
      });
      assert.equal(row.sendEnabled, false);
      assert.equal(row.tokenCipher, cipher);
      assert.equal(row.lastError, "TOKEN_REFRESH_FAILED");
      await revokeWriteConsent(owner, failed.id);
      await assert.rejects(revokeWriteTokens(failed.id, failing));
      assert.equal(
        (
          await db.mailWriteConsent.findUniqueOrThrow({
            where: { connectionId: failed.id },
          })
        ).tokenCipher,
        cipher,
      );
    },
  );
  await t.test(
    "dispatch rechecks pause after claim, and network ambiguity blocks replacement drafts",
    async () => {
      // Explicitly broaden only the synthetic grant in this disposable database; never reset its test counter.
      await configureWriteDelivery(owner, c.id, true, false);
      await db.salesAISettings.update({
        where: { id: "company" },
        data: { outboundPaused: false },
      });
      const freshConv = await db.mailConversation.create({
        data: {
          connectionId: c.id,
          threadId: "890",
          subject: "Another self test",
          senderEmail: c.address,
          assignedToId: owner.id,
          classification: "POTENTIAL_LEAD",
          reviewedAt: new Date(),
        },
      });
      await db.mailMessage.create({
        data: {
          conversationId: freshConv.id,
          providerMessageId: "890",
          direction: "INBOUND",
          fromEmail: c.address,
          toEmail: c.address,
          subject: freshConv.subject,
          body: "Test",
          receivedAt: new Date(),
        },
      });
      const make = async () => {
        const d = await db.salesEmailDraft.create({
          data: { conversationId: freshConv.id, status: "GENERATED" },
        });
        const body = "Thank you. Please share a convenient consultation time.";
        await db.salesEmailVersion.create({
          data: {
            draftId: d.id,
            version: 1,
            recipient: c.address,
            subject: "Re: Another self test",
            body,
            bodyHash: digest(body),
            actorId: owner.id,
            source: "HUMAN_EDIT",
          },
        });
        await service.reviewDraft(owner, d.id, "submit", 1);
        await service.reviewDraft(owner, d.id, "approve", 1);
        return d;
      };
      const paused = await make();
      await service.requestSend(owner, paused.id, 1);
      let calls = 0;
      const p = await zohoSendingProvider(
        c.id,
        paused.id,
        1,
        owner.id,
        async () => {
          calls++;
          return Response.json({ status: { code: 200 } });
        },
      );
      const wrapped = {
        ...p,
        send: async (...args: Parameters<typeof p.send>) => {
          await db.salesAISettings.update({
            where: { id: "company" },
            data: { outboundPaused: true },
          });
          return p.send(...args);
        },
      };
      await assert.rejects(
        service.sendApproved(paused.id, 1, owner.id, wrapped),
        /OUTBOUND_PAUSED/,
      );
      assert.equal(calls, 0);
      assert.equal(
        (
          await db.salesEmailDraft.findUniqueOrThrow({
            where: { id: paused.id },
          })
        ).lastError,
        "OUTBOUND_PAUSED",
      );
      await db.salesAISettings.update({
        where: { id: "company" },
        data: { outboundPaused: false },
      });
      const inactive = await make();
      await service.requestSend(owner, inactive.id, 1);
      const activeProvider = await zohoSendingProvider(
        c.id,
        inactive.id,
        1,
        owner.id,
        async () => {
          calls++;
          return Response.json({ status: { code: 200 } });
        },
      );
      const inactiveWrapper = {
        ...activeProvider,
        send: async (...args: Parameters<typeof activeProvider.send>) => {
          await db.user.update({
            where: { id: owner.id },
            data: { active: false },
          });
          return activeProvider.send(...args);
        },
      };
      await assert.rejects(
        service.sendApproved(inactive.id, 1, owner.id, inactiveWrapper),
        /ACCESS_DENIED/,
      );
      assert.equal(calls, 0);
      await db.user.update({ where: { id: owner.id }, data: { active: true } });
      const uncertain = await make();
      await service.requestSend(owner, uncertain.id, 1);
      const failing = await zohoSendingProvider(
        c.id,
        uncertain.id,
        1,
        owner.id,
        async () => {
          calls++;
          throw new Error("synthetic timeout after possible delivery");
        },
      );
      await assert.rejects(
        service.sendApproved(uncertain.id, 1, owner.id, failing),
        /SEND_UNCERTAIN/,
      );
      assert.equal(calls, 1);
      const replacement = await make();
      await assert.rejects(
        service.requestSend(owner, replacement.id, 1),
        /SEND_UNCERTAIN/,
      );
      assert.equal(
        (
          await db.mailSendAttempt.findFirstOrThrow({
            where: { draftId: uncertain.id },
          })
        ).status,
        "UNCERTAIN",
      );
    },
  );
  await t.test(
    "independent revocation immediately disables sending and clears tokens only after confirmed revoke",
    async () => {
      await revokeWriteConsent(owner, c.id);
      await assert.rejects(
        writeAccessToken(c.id, client),
        /WRITE_AUTH_REQUIRED/,
      );
      assert.equal((await service.salesSettings()).outboundPaused, true);
      await revokeWriteTokens(c.id, client);
      assert.equal(revokes, 1);
      const w = await db.mailWriteConsent.findUniqueOrThrow({
        where: { connectionId: c.id },
      });
      assert.equal(w.tokenCipher, null);
      assert.equal(w.oauthSecretCipher, null);
      const read = await db.mailConnection.findUniqueOrThrow({
        where: { id: c.id },
      });
      assert.equal(read.connected, true);
      assert.equal(read.tokenCipher, c.tokenCipher);
      delete process.env.ZOHO_SEND_ENABLED;
    },
  );
});
