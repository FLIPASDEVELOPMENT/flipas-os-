import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import * as service from "../src/sales-ai/server/service";
import {
  MockMailProvider,
  type IncomingMail,
} from "../src/sales-ai/providers/mail";
import {
  prepareWriteConsent,
  revokeWriteConsent,
} from "../src/sales-ai/server/write-consent";
import { writeScopes } from "../src/sales-ai/domain/delivery";
import { prepareZohoDelivery } from "../src/sales-ai/providers/zoho-delivery";
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error("Disposable *_test database required");
process.env.MAIL_ENCRYPTION_KEY = randomBytes(32).toString("hex");
after(() => db.$disconnect());
test("commercial context, CRM identity, follow-ups, write consent and delivery regression", async (t) => {
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
  const connectionId = await service.initializeMock(owner);
  const base: IncomingMail = {
    messageId: "pedro-1",
    threadId: "pedro",
    fromEmail: "pedro@example.invalid",
    fromName: "Pedro Navaja",
    toEmail: "sales@example.invalid",
    subject: "Kitchen remodeling – Tampa",
    body: "Hello, I am Pedro Navaja. My kitchen remodel is in Tampa. My budget is $18,000-$25,000 and I want to start in 4-6 weeks. Cabinets, countertops, backsplash and LED.",
    receivedAt: new Date(),
    attachments: [],
  };
  const poll = (rows: IncomingMail[], cursor: string) => ({
    ...new MockMailProvider(),
    listMessages: async () => ({ messages: rows, nextCursor: cursor }),
    send: async () => ({ messageId: "mock" }),
    disconnect: async () => {},
  });
  await service.syncMailbox(connectionId, poll([base], "page1"));
  const c = await db.mailConversation.findUniqueOrThrow({
    where: { connectionId_threadId: { connectionId, threadId: "pedro" } },
  });
  await service.analyzeConversation(c.id);
  await t.test(
    "Pedro draft does not ask for known email, budget or timeline and verified CRM is unchanged",
    async () => {
      const customer = await db.customer.create({
        data: {
          firstName: "Verified",
          lastName: "Pedro",
          email: base.fromEmail,
          city: "Tampa",
          address: "Verified property address",
        },
      });
      const lead = await db.lead.create({
        data: {
          customerId: customer.id,
          serviceType: "Kitchen Remodeling",
          source: "OTHER",
          assignedToId: owner.id,
          budgetMin: 18000,
          budgetMax: 25000,
          desiredStartDate: new Date("2026-11-12"),
        },
      });
      await service.linkCRM(owner, c.id, {
        customerId: customer.id,
        leadId: lead.id,
        opportunityId: "",
      });
      await service.analyzeConversation(c.id);
      const info = service.intelligence(
        await service.conversation(owner, c.id),
      )!;
      assert.equal(info.questions.length, 1);
      const draft = await service.generateDraft(owner, c.id, "AUTO");
      const version = await db.salesEmailVersion.findFirstOrThrow({
        where: { draftId: draft },
      });
      assert.equal((version.body.match(/\?/g) ?? []).length, 1);
      assert.doesNotMatch(version.body, /email|budget|weeks|address/i);
      assert.equal(
        (await db.customer.findUniqueOrThrow({ where: { id: customer.id } }))
          .firstName,
        "Verified",
      );
      assert.equal(
        (
          await db.lead.findUniqueOrThrow({ where: { id: lead.id } })
        ).budgetMin?.toString(),
        "18000",
      );
      const wrong = await db.customer.create({
        data: {
          firstName: "Wrong",
          lastName: "Contact",
          email: "wrong@example.invalid",
        },
      });
      await assert.rejects(
        service.linkCRM(owner, c.id, {
          customerId: wrong.id,
          leadId: "",
          opportunityId: "",
        }),
        /RECIPIENT_MISMATCH/,
      );
      await assert.rejects(
        service.linkCRM(sales, c.id, {
          customerId: customer.id,
          leadId: lead.id,
          opportunityId: "",
        }),
        /ACCESS_DENIED/,
      );
    },
  );
  await t.test(
    "follow-up drafts depend on a scheduled pipeline event; duplicate and closed actions are blocked",
    async () => {
      await assert.rejects(
        service.generateDraft(owner, c.id, "EN", "FOLLOW_UP"),
        /FOLLOW_UP_EVENT_REQUIRED/,
      );
      const linked = await service.conversation(owner, c.id);
      const opportunity = await db.opportunity.create({
        data: {
          customerId: linked.customerId!,
          leadId: linked.leadId!,
          ownerId: owner.id,
          stage: "FOLLOW_UP",
          nextAction: "Confirm consultation",
          nextActionDate: new Date("2026-10-20T15:00:00Z"),
        },
      });
      await service.linkCRM(owner, c.id, {
        customerId: linked.customerId!,
        leadId: linked.leadId!,
        opportunityId: opportunity.id,
      });
      assert.equal(
        (await service.pipelineSuggestion(owner, c.id))?.reason,
        "Confirm consultation",
      );
      await service.generateDraft(owner, c.id, "EN", "FOLLOW_UP");
      await assert.rejects(
        service.generateDraft(owner, c.id, "EN", "FOLLOW_UP"),
        /FOLLOW_UP_DUPLICATE/,
      );
      const task = {
        dueAt: "2026-10-20T15:00:00Z",
        reason: "Confirm consultation",
      };
      await service.followUp(owner, c.id, task);
      await assert.rejects(
        service.followUp(owner, c.id, task),
        /FOLLOW_UP_DUPLICATE/,
      );
      await db.opportunity.update({
        where: { id: opportunity.id },
        data: { stage: "LOST" },
      });
      await assert.rejects(
        service.generateDraft(owner, c.id, "EN"),
        /FOLLOW_UP_CLOSED/,
      );
      await assert.rejects(
        service.followUp(owner, c.id, task),
        /FOLLOW_UP_CLOSED/,
      );
      await db.opportunity.update({
        where: { id: opportunity.id },
        data: { stage: "FOLLOW_UP" },
      });
    },
  );
  await t.test(
    "new mail invalidates approval; foreign thread senders cannot inherit CRM identity",
    async () => {
      const draft = await service.generateDraft(owner, c.id, "EN");
      await service.reviewDraft(owner, draft, "submit", 1);
      await service.reviewDraft(owner, draft, "approve", 1);
      await service.syncMailbox(
        connectionId,
        poll(
          [
            {
              ...base,
              messageId: "pedro-2",
              body: "Please clarify consultation arrangements.",
            },
          ],
          "page2",
        ),
      );
      assert.equal(
        (await db.salesEmailDraft.findUniqueOrThrow({ where: { id: draft } }))
          .status,
        "PENDING_REVIEW",
      );
      await service.syncMailbox(
        connectionId,
        poll(
          [
            {
              ...base,
              messageId: "foreign",
              fromEmail: "foreign@example.invalid",
            },
          ],
          "page3",
        ),
      );
      const foreign = await db.mailConversation.findFirstOrThrow({
        where: { senderEmail: "foreign@example.invalid" },
      });
      assert.notEqual(foreign.id, c.id);
      assert.equal(foreign.customerId, null);
    },
  );
  await t.test(
    "opt-out prevents replies, approval and tasks; only OWNER can resume",
    async () => {
      await service.syncMailbox(
        connectionId,
        poll(
          [
            {
              ...base,
              messageId: "opt-out",
              body: "Please do not contact me.",
            },
          ],
          "page4",
        ),
      );
      assert.equal(
        (await service.conversation(owner, c.id)).doNotContact,
        true,
      );
      await assert.rejects(
        service.generateDraft(owner, c.id, "EN"),
        /CONTACT_SUPPRESSED|HUMAN_REVIEW_REQUIRED/,
      );
      await assert.rejects(
        service.followUp(owner, c.id, {
          dueAt: "2026-10-20T15:00:00Z",
          reason: "Contact",
        }),
        /CONTACT_SUPPRESSED/,
      );
      await assert.rejects(
        service.contactPreference(sales, c.id, false),
        /OWNER access required/,
      );
      await service.contactPreference(owner, c.id, false);
    },
  );
  await t.test(
    "OWNER write consent is separate, audited and revocable, never a token or activation",
    async () => {
      const zoho = await db.mailConnection.create({
        data: {
          provider: "ZOHO",
          ownerId: owner.id,
          accountId: "12345",
          address: "owner@example.invalid",
          folderId: "55",
          connected: true,
          consented: true,
        },
      });
      await assert.rejects(
        prepareWriteConsent(sales, zoho.id, true),
        /OWNER access required/,
      );
      await assert.rejects(
        prepareWriteConsent(owner, zoho.id, false),
        /WRITE_AUTH_REQUIRED/,
      );
      await prepareWriteConsent(owner, zoho.id, true);
      assert.deepEqual(
        (
          await db.mailWriteConsent.findUniqueOrThrow({
            where: { connectionId: zoho.id },
          })
        ).scopes,
        [...writeScopes],
      );
      assert.equal(
        (await db.mailConnection.findUniqueOrThrow({ where: { id: zoho.id } }))
          .tokenCipher,
        null,
      );
      assert.equal((await service.salesSettings()).liveAuthorized, false);
      await revokeWriteConsent(owner, zoho.id);
      assert.ok(
        (
          await db.mailWriteConsent.findUniqueOrThrow({
            where: { connectionId: zoho.id },
          })
        ).revokedAt,
      );
      assert.equal((await service.salesSettings()).outboundPaused, true);
    },
  );
  await t.test(
    "Zoho request preparation can be simulated once; duplicate delivery remains blocked",
    async () => {
      await service.analyzeConversation(c.id);
      const draft = await service.generateDraft(owner, c.id, "EN");
      await service.reviewDraft(owner, draft, "submit", 1);
      await service.reviewDraft(owner, draft, "approve", 1);
      await db.salesAISettings.update({
        where: { id: "company" },
        data: { outboundPaused: false },
      });
      await service.requestSend(owner, draft, 1);
      let calls = 0;
      class SimulatedZoho extends MockMailProvider {
        async send(
          _id: string,
          message: {
            recipient: string;
            subject: string;
            body: string;
            idempotencyKey: string;
          },
        ) {
          const prepared = prepareZohoDelivery({
            region: "US",
            accountId: "123",
            address: "sales@example.invalid",
            expectedRecipient: base.fromEmail,
            ...message,
          });
          assert.equal(prepared.body.toAddress, base.fromEmail);
          calls++;
          return { messageId: "simulation-only-" + message.idempotencyKey };
        }
      }
      await service.sendApproved(draft, 1, owner.id, new SimulatedZoho());
      await assert.rejects(
        service.sendApproved(draft, 1, owner.id, new SimulatedZoho()),
      );
      const duplicateDraft = await service.generateDraft(owner, c.id, "EN");
      await service.reviewDraft(owner, duplicateDraft, "submit", 1);
      await service.reviewDraft(owner, duplicateDraft, "approve", 1);
      await assert.rejects(
        service.requestSend(owner, duplicateDraft, 1),
        /Send already attempted/,
      );
      assert.equal(calls, 1);
    },
  );
});
