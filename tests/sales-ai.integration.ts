import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { db } from "../src/server/db";
import * as service from "../src/sales-ai/server/service";
import {
  createOAuthState,
  consumeOAuthState,
} from "../src/sales-ai/server/oauth-state";
import { accessToken } from "../src/sales-ai/server/token-lifecycle";
import { encryptSecret, decryptSecret } from "../src/sales-ai/domain/security";
import {
  claimJob,
  runJob,
  recoverExpiredJobs,
  scheduleJobs,
} from "../src/sales-ai/server/jobs";
import { MockMailProvider, mockMessages } from "../src/sales-ai/providers/mail";
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error("Disposable *_test database required");
process.env.MAIL_ENCRYPTION_KEY = randomBytes(32).toString("hex");
after(() => db.$disconnect());
test("durable inbox, human CRM confirmation and exact-version approval", async (t) => {
  const make = (role: "OWNER" | "ADMIN" | "SALES" | "CREW") =>
    db.user.create({
      data: {
        name: role,
        email: randomUUID() + "@example.invalid",
        role,
        passwordHash: "not-a-login-hash",
      },
    });
  const owner = await make("OWNER"),
    sales = await make("SALES"),
    other = await make("SALES"),
    admin = await make("ADMIN"),
    crew = await make("CREW");
  await t.test(
    "only OWNER can initialize; mail sync deduplicates and persists analysis jobs",
    async () => {
      await assert.rejects(service.initializeMock(sales));
      await assert.rejects(service.initializeMock(admin));
      await service.initializeMock(owner);
    },
  );
  await t.test(
    "OWNER configuration refuses stored AI keys, preserves encrypted Zoho secrets and mock remains explicit",
    async () => {
      const key = randomBytes(32).toString("hex");
      const config = {
        processingEnabled: false,
        outboundPaused: true,
        liveAuthorized: false,
        mailProvider: "MOCK",
        aiProvider: "OPENAI",
        model: "configured-test-model",
        approveRoles: ["OWNER"],
        sendRoles: ["OWNER"],
        retentionDays: 30,
        pollMinutes: 5,
        oauthRegion: "US",
        oauthClientId: "",
        oauthSecret: "",
        aiKey: key,
        inputCostPerMillion: "2.25",
        outputCostPerMillion: "4.50",
      };
      await assert.rejects(service.configureAI(sales, config));
      await assert.rejects(service.configureAI(admin, config));
      await assert.rejects(service.configureAI(owner, config), /AI_CONFIG_REQUIRED/);
      await service.configureAI(owner, {...config, aiKey:"", aiProvider:"MOCK", oauthSecret:key});
      const saved = await db.salesAISettings.findUniqueOrThrow({
        where: { id: "company" },
      });
      assert.equal(saved.processingEnabled, false);
      assert.equal(saved.aiKeyCipher, null);
      assert.equal(decryptSecret(saved.oauthSecretCipher!), key);
      const log = await db.activity.findFirstOrThrow({
        where: { type: "AI_CONFIGURATION_CHANGED" },
        orderBy: { createdAt: "desc" },
      });
      assert.ok(!JSON.stringify(log).includes(key));
      await service.configureAI(owner, {
        ...config,
        processingEnabled: true,
        aiProvider: "MOCK",
        aiKey: "",
      });
      assert.equal(
        (
          await db.salesAISettings.findUniqueOrThrow({
            where: { id: "company" },
          })
        ).aiKeyCipher,
        saved.aiKeyCipher,
      );
    },
  );
  const connection = await db.mailConnection.findUniqueOrThrow({
    where: {
      provider_accountId: { provider: "MOCK", accountId: "development-only" },
    },
  });
  await service.syncMailbox(connection.id);
  await db.mailConnection.update({
    where: { id: connection.id },
    data: { syncCursor: null },
  });
  await service.syncMailbox(connection.id);
  assert.equal(await db.mailMessage.count(), 2);
  assert.equal(await db.salesJob.count({ where: { type: "ANALYZE" } }), 2);
  assert.equal(await db.customer.count(), 0);
  const thread = await db.mailConversation.findFirstOrThrow({
      where: { threadId: "development-kitchen" },
    }),
    news = await db.mailConversation.findFirstOrThrow({
      where: { threadId: "development-newsletter" },
    });
  await service.analyzeConversation(thread.id);
  await service.analyzeConversation(news.id);
  await t.test(
    "unrelated mail is never imported; assignment restricts SALES and CREW",
    async () => {
      await assert.rejects(
        service.confirmLead(owner, news.id, {
          firstName: "Test",
          lastName: "Newsletter",
        }),
      );
      await assert.rejects(service.generateDraft(owner, news.id, "EN"));
      await assert.rejects(
        service.conversation(sales, thread.id),
        /ACCESS_DENIED/,
      );
      await assert.rejects(
        service.conversation(crew, thread.id),
        /ACCESS_DENIED/,
      );
      await service.assignConversation(owner, thread.id, sales.id);
      assert.equal(
        (await service.conversation(sales, thread.id)).id,
        thread.id,
      );
      await assert.rejects(service.conversation(other, thread.id));
    },
  );
  let leadId = "";
  await t.test(
    "human-confirmed lead creation is idempotent; no opportunity/estimate is auto-created",
    async () => {
      leadId = await service.confirmLead(sales, thread.id, {
        firstName: "Verified",
        lastName: "Customer",
      });
      assert.equal(
        await service.confirmLead(sales, thread.id, {
          firstName: "Verified",
          lastName: "Customer",
        }),
        leadId,
      );
      assert.equal(await db.customer.count(), 1);
      assert.equal(await db.lead.count(), 1);
      assert.equal(await db.opportunity.count(), 0);
      assert.equal(await db.estimate.count(), 0);
      assert.equal(
        (await service.matchingCustomers(sales, thread.id)).length,
        1,
      );
    },
  );
  await t.test(
    "CRM ambiguity requires confirmation; wrong customers and scopes cannot be linked",
    async () => {
      const duplicate = await db.mailConversation.create({
        data: {
          connectionId: connection.id,
          threadId: "duplicate-customer",
          subject: "Kitchen",
          senderEmail: thread.senderEmail,
          assignedToId: sales.id,
          classification: "Kitchen Remodeling",
        },
      });
      await assert.rejects(
        service.confirmLead(sales, duplicate.id, {
          firstName: "Again",
          lastName: "Customer",
        }),
        /Existing or ambiguous/,
      );
      await service.linkCRM(sales, duplicate.id, {
        customerId: (await db.lead.findUniqueOrThrow({ where: { id: leadId } }))
          .customerId,
        leadId,
        opportunityId: "",
      });
      await assert.rejects(
        service.linkCRM(other, duplicate.id, {
          customerId: "wrong",
          leadId,
          opportunityId: "",
        }),
      );
    },
  );
  const draftId = await service.generateDraft(sales, thread.id, "ES");
  await t.test(
    "editing an approved reply invalidates approval and older versions are immutable",
    async () => {
      await service.reviewDraft(sales, draftId, "submit", 1);
      await assert.rejects(
        service.reviewDraft(sales, draftId, "approve", 1),
        /ACCESS_DENIED/,
      );
      await service.reviewDraft(owner, draftId, "approve", 1);
      await service.editDraft(sales, draftId, {
        expectedVersion: 1,
        recipient: thread.senderEmail,
        subject: "Re: Kitchen",
        body: "Gracias. ¿Cuál es la dirección de la propiedad?",
      });
      const d = await db.salesEmailDraft.findUniqueOrThrow({
        where: { id: draftId },
      });
      assert.equal(d.status, "EDITED");
      assert.equal(d.approvedVersion, null);
      assert.equal(d.version, 2);
      await assert.rejects(service.requestSend(owner, draftId, 1));
      await assert.rejects(
        db.salesEmailVersion.update({
          where: { draftId_version: { draftId, version: 1 } },
          data: { body: "tamper" },
        }),
      );
      await assert.rejects(
        service.editDraft(sales, draftId, {
          expectedVersion: 1,
          recipient: thread.senderEmail,
          subject: "Old",
          body: "Old",
        }),
        /changed/,
      );
    },
  );
  await t.test(
    "pause and send permission hold; exact approved text sends once and audits CRM",
    async () => {
      await service.reviewDraft(sales, draftId, "submit", 2);
      await service.reviewDraft(owner, draftId, "approve", 2);
      await assert.rejects(
        service.requestSend(owner, draftId, 2),
        /OUTBOUND_PAUSED/,
      );
      await db.salesAISettings.update({
        where: { id: "company" },
        data: { outboundPaused: false },
      });
      await assert.rejects(
        service.requestSend(sales, draftId, 2),
        /ACCESS_DENIED/,
      );
      await service.requestSend(owner, draftId, 2);
      await service.sendApproved(draftId, 2, owner.id);
      assert.equal(
        (await db.salesEmailDraft.findUniqueOrThrow({ where: { id: draftId } }))
          .status,
        "SENT",
      );
      assert.equal(await db.mailSendAttempt.count({ where: { draftId } }), 1);
      await assert.rejects(service.sendApproved(draftId, 2, owner.id));
      assert.ok(
        await db.activity.findFirst({ where: { type: "EMAIL_SENT", leadId } }),
      );
      const outbound = await db.mailMessage.findFirstOrThrow({
        where: { conversationId: thread.id, direction: "OUTBOUND" },
      });
      assert.equal(
        outbound.body,
        "Gracias. ¿Cuál es la dirección de la propiedad?",
      );
    },
  );
  async function approved() {
    const id = await service.generateDraft(sales, thread.id, "EN");
    await service.reviewDraft(sales, id, "submit", 1);
    await service.reviewDraft(owner, id, "approve", 1);
    await service.requestSend(owner, id, 1);
    return id;
  }
  await t.test(
    "worker reauthorizes changed roles, assignments and pause immediately before sending",
    async () => {
      const id = await approved();
      await db.salesAISettings.update({
        where: { id: "company" },
        data: { outboundPaused: true },
      });
      await assert.rejects(
        service.sendApproved(id, 1, owner.id),
        /OUTBOUND_PAUSED/,
      );
      assert.equal(
        await db.mailSendAttempt.count({ where: { draftId: id } }),
        0,
      );
      await db.salesAISettings.update({
        where: { id: "company" },
        data: { outboundPaused: false },
      });
      await db.user.update({
        where: { id: owner.id },
        data: { active: false },
      });
      await assert.rejects(
        service.sendApproved(id, 1, owner.id),
        /ACCESS_DENIED/,
      );
      await db.user.update({ where: { id: owner.id }, data: { active: true } });
    },
  );
  await t.test(
    "revoked SALES send permission and reassigned conversations are rechecked by the worker",
    async () => {
      const id = await service.generateDraft(sales, thread.id, "EN");
      await service.reviewDraft(sales, id, "submit", 1);
      await service.reviewDraft(owner, id, "approve", 1);
      await db.salesAISettings.update({
        where: { id: "company" },
        data: { sendRoles: ["OWNER", "SALES"] },
      });
      await service.requestSend(sales, id, 1);
      await db.salesAISettings.update({
        where: { id: "company" },
        data: { sendRoles: ["OWNER"] },
      });
      await assert.rejects(
        service.sendApproved(id, 1, sales.id),
        /ACCESS_DENIED/,
      );
      await db.salesAISettings.update({
        where: { id: "company" },
        data: { sendRoles: ["OWNER", "SALES"] },
      });
      await service.assignConversation(owner, thread.id, other.id);
      await assert.rejects(
        service.sendApproved(id, 1, sales.id),
        /ACCESS_DENIED/,
      );
      assert.equal(
        await db.mailSendAttempt.count({ where: { draftId: id } }),
        0,
      );
      await service.assignConversation(owner, thread.id, sales.id);
      await db.salesAISettings.update({
        where: { id: "company" },
        data: { sendRoles: ["OWNER"] },
      });
    },
  );
  await t.test(
    "uncertain API outcome is recorded and NEVER blindly retried across versions",
    async () => {
      const id = await approved();
      let sends = 0;
      class Failure extends MockMailProvider {
        async send(): Promise<{ messageId: string }> {
          sends++;
          throw new Error("simulated transport loss, sensitive details");
        }
      }
      await assert.rejects(
        service.sendApproved(id, 1, owner.id, new Failure()),
        /SEND_UNCERTAIN/,
      );
      assert.equal(
        (await db.mailSendAttempt.findFirstOrThrow({ where: { draftId: id } }))
          .status,
        "UNCERTAIN",
      );
      assert.equal(
        (await db.salesEmailDraft.findUniqueOrThrow({ where: { id } }))
          .lastError,
        "SEND_UNCERTAIN",
      );
      await assert.rejects(
        service.sendApproved(id, 1, owner.id, new Failure()),
      );
      await service.editDraft(sales, id, {
        expectedVersion: 1,
        recipient: thread.senderEmail,
        subject: "Re: Kitchen",
        body: "Please confirm your availability.",
      });
      await service.reviewDraft(sales, id, "submit", 2);
      await service.reviewDraft(owner, id, "approve", 2);
      await assert.rejects(service.requestSend(owner, id, 2), /uncertain/);
      const replacement = await service.generateDraft(sales, thread.id, "EN");
      await service.reviewDraft(sales, replacement, "submit", 1);
      await service.reviewDraft(owner, replacement, "approve", 1);
      await assert.rejects(service.requestSend(owner, replacement, 1), /SEND_UNCERTAIN/);
      assert.equal(sends, 1);
    },
  );
  await t.test(
    "drafts with pricing, discounts or contractual claims cannot be approved",
    async () => {
      const id = await service.generateDraft(sales, thread.id, "EN");
      await service.editDraft(sales, id, {
        expectedVersion: 1,
        recipient: thread.senderEmail,
        subject: "Quote",
        body: "Our discount makes this $100.",
      });
      await service.reviewDraft(sales, id, "submit", 2);
      await assert.rejects(
        service.reviewDraft(owner, id, "approve", 2),
        /Remove pricing/,
      );
    },
  );
  await t.test(
    "follow-ups require scoped access, offset-aware dates and audit completion",
    async () => {
      await service.followUp(sales, thread.id, {
        dueAt: "2026-10-07T09:00:00-04:00",
        reason: "Confirm a visit",
      });
      const f = await db.salesFollowUp.findFirstOrThrow({
        where: { conversationId: thread.id },
      });
      await assert.rejects(service.completeFollowUp(other, f.id));
      await service.completeFollowUp(sales, f.id);
      await service.completeFollowUp(sales, f.id);
      assert.equal(
        await db.activity.count({
          where: { type: "SALES_FOLLOW_UP_COMPLETED" },
        }),
        1,
      );
      await assert.rejects(
        service.followUp(sales, thread.id, {
          dueAt: "bad",
          reason: "Bad date",
        }),
      );
    },
  );
  await t.test(
    "OAuth state binds owner/browser, expires and consumes only once",
    async () => {
      await db.salesAISettings.update({
        where: { id: "company" },
        data: {
          oauthClientId: "test-client",
          oauthSecretCipher: encryptSecret(randomBytes(32).toString("hex")),
        },
      });
      const binding = randomBytes(32).toString("hex");
      const state = await createOAuthState(owner, binding);
      await assert.rejects(consumeOAuthState(owner, state, "wrong".repeat(10)));
      await assert.rejects(consumeOAuthState(sales, state, binding));
      await consumeOAuthState(owner, state, binding);
      await assert.rejects(consumeOAuthState(owner, state, binding));
      const expired = await createOAuthState(owner, binding);
      await db.mailOAuthState.updateMany({ data: { expiresAt: new Date(0) } });
      await assert.rejects(consumeOAuthState(owner, expired, binding));
    },
  );
  await t.test(
    "encrypted refresh failures preserve refresh token and redact error; refresh rotation succeeds",
    async () => {
      const tokens = {
        accessToken: randomUUID(),
        refreshToken: randomUUID(),
        expiresAt: new Date(0),
      };
      await db.mailConnection.update({
        where: { id: connection.id },
        data: { tokenCipher: encryptSecret(JSON.stringify(tokens)) },
      });
      await assert.rejects(
        accessToken(connection.id, {
          async refresh() {
            throw new Error("provider secret rejected");
          },
        }),
        /TOKEN_REFRESH_FAILED/,
      );
      const failed = await db.mailConnection.findUniqueOrThrow({
        where: { id: connection.id },
      });
      assert.equal(failed.lastError, "TOKEN_REFRESH_FAILED");
      assert.equal(
        JSON.parse(decryptSecret(failed.tokenCipher!)).refreshToken,
        tokens.refreshToken,
      );
      const next = {
        accessToken: randomUUID(),
        refreshToken: randomUUID(),
        expiresAt: new Date(Date.now() + 3600000),
      };
      assert.equal(
        await accessToken(connection.id, {
          async refresh() {
            return next;
          },
        }),
        next.accessToken,
      );
      assert.equal(
        JSON.parse(
          decryptSecret(
            (
              await db.mailConnection.findUniqueOrThrow({
                where: { id: connection.id },
              })
            ).tokenCipher!,
          ),
        ).refreshToken,
        next.refreshToken,
      );
    },
  );
  await t.test(
    "pagination queues a durable continuation and error backoff does not leak provider details",
    async () => {
      class Page extends MockMailProvider {
        async listMessages() {
          return {
            messages: [
              { ...mockMessages[0], messageId: "page-2", threadId: "page-2" },
            ],
            nextCursor: "next-page",
            more: true,
          };
        }
      }
      await service.syncMailbox(connection.id, new Page());
      assert.ok(
        await db.salesJob.findFirst({
          where: { key: { startsWith: "sync-page:" } },
        }),
      );
      await db.salesJob.updateMany({
        where: { status: "PENDING" },
        data: { runAt: new Date(Date.now() + 3600000) },
      });
      const j = await service.enqueue("SYNC", "bad-mailbox-test", {
        connectionId: "missing",
      });
      const claimed = await claimJob();
      assert.equal(claimed?.id, j.id);
      await runJob(claimed!);
      const result = await db.salesJob.findUniqueOrThrow({
        where: { id: j.id },
      });
      assert.equal(result.status, "PENDING");
      assert.equal(result.errorCode, "PROVIDER_FAILURE");
      assert.equal(result.attempts, 1);
      assert.ok(result.runAt > new Date());
    },
  );
  await t.test(
    "atomic job claims, persistent scheduling and expired send leases cannot duplicate delivery",
    async () => {
      await service.enqueue("REMIND", "concurrent-1", {});
      await service.enqueue("REMIND", "concurrent-2", {});
      const [a, b] = await Promise.all([claimJob(), claimJob()]);
      assert.ok(a && b);
      assert.notEqual(a.id, b.id);
      await runJob(a);
      await runJob(b);
      // Independent conversation: an uncertain delivery on the original thread must not be bypassed.
      const leaseThread = await db.mailConversation.create({ data: { connectionId: connection.id, threadId: "lease-isolation", subject: "Kitchen lease test", senderEmail: "lease@example.invalid", assignedToId: sales.id, classification: "Kitchen Remodeling" } });
      await db.mailMessage.create({ data: { conversationId: leaseThread.id, providerMessageId: "lease-inbound", receivedAt: new Date(), fromEmail: leaseThread.senderEmail, toEmail: connection.address, subject: leaseThread.subject, body: "Please remodel my kitchen." } });
      await service.analyzeConversation(leaseThread.id);
      const id = await service.generateDraft(sales, leaseThread.id, "EN");
      await service.reviewDraft(sales, id, "submit", 1);
      await service.reviewDraft(owner, id, "approve", 1);
      await service.requestSend(owner, id, 1);
      await db.salesJob.updateMany({
        where: { key: "send:" + id + ":1" },
        data: {
          status: "RUNNING",
          lockedUntil: new Date(0),
          leaseToken: randomUUID(),
        },
      });
      await db.salesEmailDraft.update({
        where: { id },
        data: { status: "SENDING" },
      });
      await db.mailSendAttempt.create({
        data: {
          draftId: id,
          version: 1,
          idempotencyKey: randomUUID(),
          actorId: owner.id,
        },
      });
      await recoverExpiredJobs();
      assert.equal(
        (await db.salesEmailDraft.findUniqueOrThrow({ where: { id } })).status,
        "FAILED",
      );
      assert.equal(
        (await db.mailSendAttempt.findFirstOrThrow({ where: { draftId: id } }))
          .status,
        "UNCERTAIN",
      );
      const now = new Date();
      await scheduleJobs(now);
      const count = await db.salesJob.count();
      await scheduleJobs(now);
      assert.equal(await db.salesJob.count(), count);
    },
  );
  await t.test(
    "retention deletes old inbox bodies and disconnect prevents synchronization",
    async () => {
      const old = await db.mailMessage.create({
        data: {
          conversationId: thread.id,
          providerMessageId: "old-message",
          receivedAt: new Date(0),
          fromEmail: thread.senderEmail,
          toEmail: connection.address,
          subject: "Old",
          body: "private old body",
        },
      });
      await db.salesJob.updateMany({
        where: { status: "PENDING" },
        data: { runAt: new Date(Date.now() + 3600000) },
      });
      const j = await service.enqueue("RETENTION", "retention-check", {});
      const job = await claimJob();
      assert.equal(job?.id, j.id);
      await runJob(job!);
      assert.equal(
        (await db.mailMessage.findUniqueOrThrow({ where: { id: old.id } }))
          .body,
        "[Email body removed under retention policy]",
      );
      await service.disconnectMailbox(owner, connection.id);
      await assert.rejects(service.syncMailbox(connection.id), /AUTH_REQUIRED/);
    },
  );
});
