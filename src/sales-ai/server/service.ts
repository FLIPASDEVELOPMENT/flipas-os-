import { openaiEvidenceMessages } from "../providers/openai";
import { runAI } from "./budget";
import { openaiConfig } from "./openai-config";
import { zohoProvider } from "./zoho";
import { estimatedUsageCost } from "../domain/usage";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Prisma, User } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { assertOwner } from "@/owner/service";
import { customerScope, leadScope, opportunityScope } from "@/server/crm";
import { assertSalesAI, conversationScope, configuredRole } from "./access";
import {
  digest,
  encryptSecret,
  unsafeReply,
  textOnly,
  allowedAttachment,
} from "../domain/security";
import {
  Intelligence,
  intelligenceSchema,
  validateEvidence,
  AnalysisMessage,
} from "../domain/intelligence";
import { validateDraft } from "../providers/ai";
import { MockMailProvider, MailProvider, mailMessage } from "../providers/mail";
export const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
type TX = Prisma.TransactionClient;
export async function salesSettings(tx: TX = db) {
  return tx.salesAISettings.findUniqueOrThrow({ where: { id: "company" } });
}
export async function audit(
  tx: TX,
  userId: string | null,
  type: string,
  metadata: unknown,
  c: {
    customerId?: string | null;
    leadId?: string | null;
    opportunityId?: string | null;
  } = {},
) {
  if (c.leadId)
    await tx.lead.updateMany({
      where: { id: c.leadId },
      data: { updatedAt: new Date() },
    });
  if (c.opportunityId)
    await tx.opportunity.updateMany({
      where: { id: c.opportunityId },
      data: { updatedAt: new Date() },
    });
  await tx.activity.create({
    data: {
      actorId: userId,
      type,
      message: type.replaceAll("_", " "),
      metadata: json(metadata),
      customerId: c.customerId,
      leadId: c.leadId,
      opportunityId: c.opportunityId,
    },
  });
}
export async function conversation(u: User, id: string, tx: TX = db) {
  assertSalesAI(u);
  const c = await tx.mailConversation.findFirst({
    where: { id, ...conversationScope(u) },
    include: {
      connection: true,
      messages: { orderBy: { receivedAt: "asc" }, take: 100 },
      drafts: {
        include: {
          versions: { orderBy: { version: "desc" }, take: 1 },
          attempts: true,
        },
        orderBy: { createdAt: "desc" },
      },
      followUps: { orderBy: { dueAt: "asc" } },
    },
  });
  if (!c) throw new Error("ACCESS_DENIED");
  return c;
}
export async function enqueue(
  type: string,
  key: string,
  payload: unknown,
  runAt = new Date(),
  tx: TX = db,
) {
  return tx.salesJob.upsert({
    where: { key },
    create: { type, key, payload: json(payload), runAt },
    update: {},
  });
}
export async function initializeMock(u: User) {
  assertOwner(u);
  return db.$transaction(async (tx) => {
    await tx.salesAISettings.upsert({
      where: { id: "company" },
      create: { id: "company", processingEnabled: true },
      update: {},
    });
    const c = await tx.mailConnection.upsert({
      where: {
        provider_accountId: { provider: "MOCK", accountId: "development-only" },
      },
      create: {
        provider: "MOCK",
        ownerId: u.id,
        accountId: "development-only",
        address: "sales@example.invalid",
        folderId: "mock-inbox",
        consented: true,
      },
      update: { connected: true },
    });
    await enqueue(
      "SYNC",
      `manual-sync:${c.id}:${randomUUID()}`,
      { connectionId: c.id },
      new Date(),
      tx,
    );
    await audit(tx, u.id, "AI_MOCK_INITIALIZED", {
      connectionId: c.id,
      developmentOnly: true,
    });
    return c.id;
  });
}
export const configInput = z.object({
  processingEnabled: z.boolean(),
  outboundPaused: z.boolean(),
  liveAuthorized: z.boolean(),
  mailProvider: z.enum(["MOCK", "ZOHO"]),
  aiProvider: z.enum(["MOCK", "OPENAI"]),
  model: z.string().max(100),
  aiPaused: z.boolean().default(false),
  monthlyBudget: z.coerce.number().positive().max(1000).default(10),
  alertAt: z.coerce.number().positive().max(1000).default(5),
  approveRoles: z.array(z.enum(["OWNER", "ADMIN", "SALES"])),
  sendRoles: z.array(z.enum(["OWNER", "ADMIN", "SALES"])),
  retentionDays: z.coerce.number().int().min(7).max(3650),
  pollMinutes: z.coerce.number().int().min(1).max(1440),
  oauthRegion: z.enum(["US", "EU", "IN", "AU", "JP", "CA", "SA", "CN"]),
  oauthClientId: z.string().max(300),
  oauthSecret: z.string().max(2000),
  aiKey: z.string().max(2000),
  inputCostPerMillion: z
    .string()
    .regex(/^\d{1,8}(\.\d{1,6})?$/)
    .or(z.literal("")),
  outputCostPerMillion: z
    .string()
    .regex(/^\d{1,8}(\.\d{1,6})?$/)
    .or(z.literal("")),
});
export async function configureAI(u: User, input: unknown) {
  assertOwner(u);
  const d = configInput.parse(input);
  if (d.alertAt > d.monthlyBudget) throw new Error("AI_CONFIG_REQUIRED");
  if (d.liveAuthorized) throw new Error("LIVE_DISABLED");
  if (d.mailProvider === "ZOHO" && !["US", "EU"].includes(d.oauthRegion))
    throw new Error("REGION_UNSUPPORTED");
  if (d.aiKey) throw new Error("AI_CONFIG_REQUIRED");
  if (d.aiProvider === "OPENAI") openaiConfig();
  const {
    oauthSecret,
    aiKey: _unusedKey,
    inputCostPerMillion,
    outputCostPerMillion,
    ...rest
  } = d;
  void _unusedKey;
  return db.$transaction(async (tx) => {
    const old = await tx.salesAISettings.findUnique({
      where: { id: "company" },
    });
    const fields = {
      ...rest,

      approveRoles: json(d.approveRoles),
      sendRoles: json(d.sendRoles),
      inputCostPerMillion: inputCostPerMillion || null,
      outputCostPerMillion: outputCostPerMillion || null,
      ...(oauthSecret ? { oauthSecretCipher: encryptSecret(oauthSecret) } : {}),
      aiKeyCipher: null,
    };
    await tx.salesAISettings.upsert({
      where: { id: "company" },
      create: fields,
      update: fields,
    });
    await audit(tx, u.id, "AI_CONFIGURATION_CHANGED", {
      processingEnabled: d.processingEnabled,
      outboundPaused: d.outboundPaused,
      approveRoles: d.approveRoles,
      sendRoles: d.sendRoles,
      retentionDays: d.retentionDays,
      previousPaused: old?.outboundPaused ?? true,
      aiPaused: d.aiPaused,
      monthlyBudget: d.monthlyBudget,
      alertAt: d.alertAt,
      previousBudget: old?.monthlyBudget.toString() ?? null,
      previousAiPaused: old?.aiPaused ?? null,
      previousAlertAt: old?.alertAt.toString() ?? null,
      aiProvider: d.aiProvider,
      previousAiProvider: old?.aiProvider ?? null,
    });
  });
}
export async function syncMailbox(
  id: string,
  provider?: MailProvider,
  signal?: AbortSignal,
) {
  const connection = await db.mailConnection.findUniqueOrThrow({
    where: { id },
  });
  const settings = await salesSettings();
  if (!settings.processingEnabled) throw new Error("PROCESSING_DISABLED");
  if (!connection.connected || !connection.consented || !connection.folderId)
    throw new Error("AUTH_REQUIRED");
  if (connection.provider === "ZOHO" && settings.mailProvider !== "ZOHO")
    throw new Error("PROCESSING_DISABLED");
  if (!["MOCK", "ZOHO"].includes(connection.provider))
    throw new Error("LIVE_DISABLED");
  provider ??=
    connection.provider === "ZOHO"
      ? await zohoProvider(id)
      : new MockMailProvider();
  signal?.throwIfAborted();
  const page = await provider.listMessages(id, connection.syncCursor, signal);
  signal?.throwIfAborted();
  if (
    page.messages.length > 100 ||
    (page.more &&
      (!page.nextCursor || page.nextCursor === connection.syncCursor))
  )
    throw new Error("PROVIDER_REJECTED");
  await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MailConnection" WHERE "id"=${id} FOR UPDATE`;
      const current = await tx.mailConnection.findUniqueOrThrow({
        where: { id },
      });
      const activeSettings = await tx.salesAISettings.findUniqueOrThrow({
        where: { id: "company" },
      });
      if (
        !current.connected ||
        !current.consented ||
        current.folderId !== connection.folderId ||
        current.syncCursor !== connection.syncCursor
      )
        throw new Error("AUTH_REQUIRED");
      if (
        !activeSettings.processingEnabled ||
        (current.provider === "ZOHO" && activeSettings.mailProvider !== "ZOHO")
      )
        throw new Error("PROCESSING_DISABLED");
      for (const raw of page.messages) {
        signal?.throwIfAborted();
        const m = mailMessage.parse(raw);
        const c = await tx.mailConversation.upsert({
          where: {
            connectionId_threadId: { connectionId: id, threadId: m.threadId },
          },
          create: {
            connectionId: id,
            threadId: m.threadId,
            subject: m.subject,
            senderEmail: m.fromEmail,
            senderName: m.fromName,
            assignedToId: connection.ownerId,
          },
          update: {},
        });
        const exists = await tx.mailMessage.findUnique({
          where: {
            conversationId_providerMessageId: {
              conversationId: c.id,
              providerMessageId: m.messageId,
            },
          },
        });
        if (exists) continue;
        await tx.mailMessage.create({
          data: {
            conversationId: c.id,
            providerMessageId: m.messageId,
            receivedAt: m.receivedAt,
            fromEmail: m.fromEmail,
            toEmail: m.toEmail,
            subject: m.subject,
            body: textOnly(m.body),
            attachments: json(
              m.attachments.map((a) => ({
                ...a,
                allowed: allowedAttachment(a.name, a.size),
                downloaded: false,
              })),
            ),
          },
        });
        await tx.mailConversation.update({
          where: { id: c.id },
          data: {
            unread: true,
            processed: false,
            reviewedAt: null,
            updatedAt: new Date(),
          },
        });
        await enqueue(
          "ANALYZE",
          `analyze:${c.id}:${m.messageId}`,
          { conversationId: c.id },
          new Date(),
          tx,
        );
      }
      await tx.mailConnection.update({
        where: { id },
        data: {
          syncCursor: page.nextCursor,
          lastSyncAt: new Date(),
          lastError: null,
        },
      });
      if (page.more)
        await enqueue(
          "SYNC",
          `sync-page:${id}:${digest(page.nextCursor!)}`,
          { connectionId: id },
          new Date(),
          tx,
        );
      await audit(tx, null, "MAIL_SYNCHRONIZED", {
        connectionId: id,
        provider: connection.provider,
        messageCount: page.messages.length,
      });
    },
    { isolationLevel: "Serializable", timeout: 20000 },
  );
}
export async function analyzeConversation(id: string, signal?: AbortSignal) {
  const settings = await salesSettings();
  if (!settings.processingEnabled) throw new Error("PROCESSING_DISABLED");
  const c = await db.mailConversation.findUniqueOrThrow({
    where: { id },
    include: {
      messages: {
        where: { direction: "INBOUND" },
        orderBy: { receivedAt: "desc" },
        take: 50,
      },
    },
  });
  const messages: AnalysisMessage[] = c.messages
    .slice()
    .reverse()
    .map((m) => ({
      id: m.id,
      fromEmail: m.fromEmail,
      subject: m.subject,
      body: m.body,
    }));
  if (!messages.length) return;
  const result = await runAI(id, "ANALYZE", messages, (provider) =>
    provider.analyze(messages, signal),
  );
  signal?.throwIfAborted();
  const info = validateEvidence(
    result.value,
    result.provider === "OPENAI" ? openaiEvidenceMessages(messages) : messages,
  );
  await db.$transaction(async (tx) => {
    await tx.mailConversation.update({
      where: { id },
      data: {
        classification: info.category,
        intelligence: json({
          ...info,
          analysisProvider: result.provider,
          analysisModel: result.model,
        }),
        analyzedAt: new Date(),
        reviewedAt: null,
        processed: true,
      },
    });
    if (result.provider === "MOCK")
      await tx.salesAIUsage.create({
        data: {
          provider: result.provider,
          model: result.model,
          conversationId: id,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          success: true,
          estimatedCost: usageCost(settings, result),
        },
      });
    await audit(tx, null, "SALES_AI_ANALYZED", {
      conversationId: id,
      provider: result.provider,
      category: info.category,
    });
  });
}
export async function matchingCustomers(u: User, id: string) {
  const c = await conversation(u, id);
  return db.customer.findMany({
    where: {
      ...customerScope(u),
      email: { equals: c.senderEmail, mode: "insensitive" },
    },
    select: { id: true, firstName: true, lastName: true, email: true },
    take: 20,
  });
}
export async function linkCRM(u: User, id: string, input: unknown) {
  assertSalesAI(u);
  const d = z
    .object({
      customerId: z.string().min(1),
      leadId: z.string(),
      opportunityId: z.string(),
    })
    .parse(input);
  return db.$transaction(
    async (tx) => {
      await conversation(u, id, tx);
      const customer = await tx.customer.findFirst({
        where: { id: d.customerId, ...customerScope(u) },
      });
      if (!customer) throw new Error("ACCESS_DENIED");
      const lead = d.leadId
        ? await tx.lead.findFirst({
            where: { id: d.leadId, customerId: customer.id, ...leadScope(u) },
          })
        : null;
      const opportunity = d.opportunityId
        ? await tx.opportunity.findFirst({
            where: {
              id: d.opportunityId,
              customerId: customer.id,
              ...opportunityScope(u),
            },
          })
        : null;
      if (
        (d.leadId && !lead) ||
        (d.opportunityId &&
          (!opportunity || (lead && opportunity.leadId !== lead.id)))
      )
        throw new Error("CRM links must reference the same customer and lead");
      await tx.mailConversation.update({
        where: { id },
        data: {
          customerId: customer.id,
          leadId: lead?.id ?? opportunity?.leadId ?? null,
          opportunityId: opportunity?.id ?? null,
        },
      });
      await audit(
        tx,
        u.id,
        "MAIL_CRM_LINKED",
        { conversationId: id },
        {
          customerId: customer.id,
          leadId: lead?.id ?? opportunity?.leadId ?? null,
          opportunityId: opportunity?.id ?? null,
        },
      );
    },
    { isolationLevel: "Serializable" },
  );
}
export async function confirmLead(u: User, id: string, input: unknown) {
  const d = z
    .object({
      firstName: z.string().trim().min(1).max(100),
      lastName: z.string().trim().min(1).max(100),
    })
    .parse(input);
  return db.$transaction(
    async (tx) => {
      const c = await conversation(u, id, tx);
      assertCommercialReview(c);
      if (
        c.classification === "Not a sales lead" ||
        c.classification === "UNREVIEWED"
      )
        throw new Error(
          "Review commercial classification before creating a lead",
        );
      if (c.leadId) return c.leadId;
      const matches = await tx.customer.findMany({
        where: { email: { equals: c.senderEmail, mode: "insensitive" } },
        take: 2,
      });
      if (matches.length)
        throw new Error(
          "Existing or ambiguous customer match; link the CRM record explicitly",
        );
      const customer = await tx.customer.create({
        data: { ...d, email: c.senderEmail },
      });
      const lead = await tx.lead.create({
        data: {
          customerId: customer.id,
          serviceType: c.classification,
          source: "OTHER",
          assignedToId: c.assignedToId,
          description: "Human-confirmed commercial email inquiry",
        },
      });
      await tx.mailConversation.update({
        where: { id },
        data: { customerId: customer.id, leadId: lead.id },
      });
      await audit(
        tx,
        u.id,
        "EMAIL_LEAD_CONFIRMED",
        { conversationId: id, source: "MAIL" },
        { customerId: customer.id, leadId: lead.id },
      );
      return lead.id;
    },
    { isolationLevel: "Serializable" },
  );
}
export async function assignConversation(u: User, id: string, userId: string) {
  assertOwner(u);
  const assignee = await db.user.findFirst({
    where: {
      id: userId,
      active: true,
      role: { in: ["OWNER", "ADMIN", "SALES"] },
    },
  });
  if (!assignee) throw new Error("Choose an active sales representative");
  await db.$transaction(async (tx) => {
    const c = await conversation(u, id, tx);
    await tx.mailConversation.update({
      where: { id },
      data: { assignedToId: userId },
    });
    await audit(
      tx,
      u.id,
      "MAIL_ASSIGNMENT_CHANGED",
      { conversationId: id, assignedToId: userId },
      c,
    );
  });
}
export async function generateDraft(
  u: User,
  id: string,
  language: "EN" | "ES" | "AUTO",
  purpose: "QUALIFY" | "FOLLOW_UP" = "QUALIFY",
) {
  const c = await conversation(u, id);
  const settings = await salesSettings();
  if (!settings.processingEnabled) throw new Error("PROCESSING_DISABLED");
  if (
    c.classification === "Not a sales lead" ||
    c.classification === "UNREVIEWED"
  )
    throw new Error("Review sales classification first");
  assertCommercialReview(c);
  const messages = c.messages
    .filter((m) => m.direction === "INBOUND")
    .slice(-5)
    .map((m) => ({
      id: m.id,
      fromEmail: m.fromEmail,
      subject: m.subject,
      body: m.body,
    }));
  const replyLanguage =
    language === "AUTO"
      ? intelligence(c)?.language === "ES"
        ? "ES"
        : "EN"
      : language;
  const result = await runAI(id, "DRAFT", messages, (provider) =>
    provider.draft(messages, replyLanguage, purpose),
  );
  const body = validateDraft(result.value);
  return db.$transaction(async (tx) => {
    const draft = await tx.salesEmailDraft.create({
      data: { conversationId: id },
    });
    await tx.salesEmailVersion.create({
      data: {
        draftId: draft.id,
        version: 1,
        recipient: c.senderEmail,
        subject: ("Re: " + c.subject.replace(/[\r\n]/g, " ")).slice(0, 500),
        body,
        bodyHash: digest(body),
        actorId: u.id,
        source: result.provider,
      },
    });
    if (result.provider === "MOCK")
      await tx.salesAIUsage.create({
        data: {
          provider: result.provider,
          model: result.model,
          conversationId: id,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          success: true,
          estimatedCost: usageCost(settings, result),
        },
      });
    await audit(
      tx,
      u.id,
      "EMAIL_DRAFT_GENERATED",
      { draftId: draft.id, version: 1, provider: result.provider },
      c,
    );
    return draft.id;
  });
}
const replyInput = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  recipient: z.email().max(300),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .regex(/^[^\r\n]*$/),
  body: z.string().trim().min(1).max(15000),
});
export async function editDraft(u: User, id: string, input: unknown) {
  const d = replyInput.parse(input);
  return db.$transaction(
    async (tx) => {
      const old = await tx.salesEmailDraft.findUniqueOrThrow({ where: { id } });
      const c = await conversation(u, old.conversationId, tx);
      if (
        ["SENDING", "SENT"].includes(old.status) ||
        old.version !== d.expectedVersion
      )
        throw new Error("Draft changed or already sending; reload");
      if (d.recipient.toLowerCase() !== c.senderEmail.toLowerCase())
        throw new Error("Recipient must match the authorized conversation");
      const version = old.version + 1;
      await tx.salesEmailVersion.create({
        data: {
          draftId: id,
          version,
          recipient: d.recipient,
          subject: d.subject,
          body: d.body,
          bodyHash: digest(d.body),
          actorId: u.id,
          source: "HUMAN_EDIT",
        },
      });
      await tx.salesEmailDraft.update({
        where: { id },
        data: {
          version,
          status: "EDITED",
          approvedVersion: null,
          approvedById: null,
          approvedAt: null,
          requestedById: null,
          lastError: null,
        },
      });
      await audit(
        tx,
        u.id,
        "EMAIL_DRAFT_EDITED",
        { draftId: id, version, approvalInvalidated: true },
        c,
      );
    },
    { isolationLevel: "Serializable" },
  );
}
export async function reviewDraft(
  u: User,
  id: string,
  action: "submit" | "approve" | "reject",
  version: number,
) {
  return db.$transaction(
    async (tx) => {
      const d = await tx.salesEmailDraft.findUniqueOrThrow({
        where: { id },
        include: { versions: { where: { version }, take: 1 } },
      });
      const c = await conversation(u, d.conversationId, tx);
      const settings = await salesSettings(tx);
      if (d.version !== version) throw new Error("Draft changed; reload");
      if (action === "submit") {
        if (!["GENERATED", "EDITED", "REJECTED"].includes(d.status))
          throw new Error("Draft is not editable");
        await tx.salesEmailDraft.update({
          where: { id },
          data: {
            status: "PENDING_REVIEW",
            approvedVersion: null,
            approvedById: null,
            approvedAt: null,
          },
        });
      } else {
        if (!configuredRole(u, settings.approveRoles))
          throw new Error("ACCESS_DENIED");
        if (d.status !== "PENDING_REVIEW")
          throw new Error("Draft must be submitted for review");
        if (
          action === "approve" &&
          unsafeReply(d.versions[0].subject + "\n" + d.versions[0].body)
        )
          throw new Error(
            "Remove pricing, discount, contractual claims or sensitive content before approval",
          );
        await tx.salesEmailDraft.update({
          where: { id },
          data: {
            status: action === "approve" ? "APPROVED" : "REJECTED",
            approvedVersion: action === "approve" ? version : null,
            approvedById: action === "approve" ? u.id : null,
            approvedAt: action === "approve" ? new Date() : null,
          },
        });
      }
      await audit(
        tx,
        u.id,
        `EMAIL_DRAFT_${action.toUpperCase()}`,
        { draftId: id, version },
        c,
      );
    },
    { isolationLevel: "Serializable" },
  );
}
export async function requestSend(u: User, id: string, version: number) {
  return db.$transaction(
    async (tx) => {
      const d = await tx.salesEmailDraft.findUniqueOrThrow({
        where: { id },
        include: { attempts: true },
      });
      const c = await conversation(u, d.conversationId, tx);
      const settings = await salesSettings(tx);
      if (!configuredRole(u, settings.sendRoles))
        throw new Error("ACCESS_DENIED");
      if (settings.outboundPaused) throw new Error("OUTBOUND_PAUSED");
      if (!settings.processingEnabled) throw new Error("PROCESSING_DISABLED");
      if (
        d.status !== "APPROVED" ||
        d.version !== version ||
        d.approvedVersion !== version
      )
        throw new Error("Exact message version must be approved");
      if (
        d.attempts.some(
          (a) => a.status === "UNCERTAIN" || a.version === version,
        )
      )
        throw new Error(
          "Send already attempted; uncertain outcomes must be verified externally",
        );
      if (c.connection.provider !== "MOCK") throw new Error("LIVE_DISABLED");
      const key = `send:${id}:${version}`;
      const queued = await tx.salesJob.findUnique({ where: { key } });
      if (queued && ["PENDING", "RUNNING"].includes(queued.status)) return;
      if (queued?.status === "COMPLETED") throw new Error("SEND_UNCERTAIN");
      await tx.salesEmailDraft.update({
        where: { id },
        data: { requestedById: u.id },
      });
      if (queued)
        await tx.salesJob.update({
          where: { id: queued.id },
          data: {
            status: "PENDING",
            attempts: 0,
            runAt: new Date(),
            payload: json({ draftId: id, version, userId: u.id }),
            errorCode: null,
            completedAt: null,
            leaseToken: null,
            lockedUntil: null,
          },
        });
      else
        await enqueue(
          "SEND",
          key,
          { draftId: id, version, userId: u.id },
          new Date(),
          tx,
        );
      await audit(
        tx,
        u.id,
        "EMAIL_SEND_REQUESTED",
        { draftId: id, version, provider: c.connection.provider },
        c,
      );
    },
    { isolationLevel: "Serializable" },
  );
}
export async function sendApproved(
  id: string,
  version: number,
  userId: string,
  provider: MailProvider = new MockMailProvider(),
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const claimed = await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "SalesAISettings" WHERE "id"='company' FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const d = await tx.salesEmailDraft.findUniqueOrThrow({
        where: { id },
        include: { versions: { where: { version } }, attempts: true },
      });
      const c = await conversation(user, d.conversationId, tx);
      const settings = await salesSettings(tx);
      if (settings.outboundPaused) throw new Error("OUTBOUND_PAUSED");
      if (!settings.processingEnabled) throw new Error("PROCESSING_DISABLED");
      if (!configuredRole(user, settings.sendRoles))
        throw new Error("ACCESS_DENIED");
      if (
        d.status !== "APPROVED" ||
        d.approvedVersion !== version ||
        d.version !== version ||
        d.requestedById !== user.id
      )
        throw new Error("ACCESS_DENIED");
      const approver = await tx.user.findUnique({
        where: { id: d.approvedById ?? "" },
      });
      if (!approver || !configuredRole(approver, settings.approveRoles))
        throw new Error("ACCESS_DENIED");
      if (
        d.attempts.some(
          (a) => a.status === "UNCERTAIN" || a.version === version,
        )
      )
        throw new Error("SEND_UNCERTAIN");
      if (c.connection.provider !== "MOCK") throw new Error("LIVE_DISABLED");
      if (!c.connection.connected || !c.connection.consented)
        throw new Error("AUTH_REQUIRED");
      const content = d.versions[0];
      if (
        !content ||
        unsafeReply(content.subject + "\n" + content.body) ||
        content.recipient.toLowerCase() !== c.senderEmail.toLowerCase()
      )
        throw new Error("ACCESS_DENIED");
      const key = digest(`${id}:${version}`);
      const attempt = await tx.mailSendAttempt.create({
        data: { draftId: id, version, idempotencyKey: key, actorId: userId },
      });
      await tx.salesEmailDraft.update({
        where: { id },
        data: { status: "SENDING" },
      });
      await audit(
        tx,
        userId,
        "EMAIL_SENDING",
        { draftId: id, version, attemptId: attempt.id },
        c,
      );
      return { attempt, c, content };
    },
    { isolationLevel: "Serializable" },
  );
  try {
    signal?.throwIfAborted();
    const result = await provider.send(
      claimed.c.connectionId,
      {
        recipient: claimed.content.recipient,
        subject: claimed.content.subject,
        body: claimed.content.body,
        replyToMessageId: claimed.c.messages.at(-1)?.providerMessageId,
        idempotencyKey: claimed.attempt.idempotencyKey,
      },
      signal,
    );
    signal?.throwIfAborted();
    await db.$transaction(async (tx) => {
      await tx.mailSendAttempt.update({
        where: { id: claimed.attempt.id },
        data: { status: "SENT", providerMessageId: result.messageId },
      });
      await tx.salesEmailDraft.update({
        where: { id },
        data: { status: "SENT", lastError: null },
      });
      await tx.mailMessage.upsert({
        where: {
          conversationId_providerMessageId: {
            conversationId: claimed.c.id,
            providerMessageId: result.messageId,
          },
        },
        create: {
          conversationId: claimed.c.id,
          providerMessageId: result.messageId,
          receivedAt: new Date(),
          direction: "OUTBOUND",
          fromEmail: claimed.c.connection.address,
          toEmail: claimed.content.recipient,
          subject: claimed.content.subject,
          body: claimed.content.body,
        },
        update: {},
      });
      await audit(
        tx,
        userId,
        "EMAIL_SENT",
        {
          draftId: id,
          version,
          providerMessageId: result.messageId,
          provider: claimed.c.connection.provider,
        },
        claimed.c,
      );
    });
  } catch {
    await db.$transaction(async (tx) => {
      await tx.mailSendAttempt.update({
        where: { id: claimed.attempt.id },
        data: { status: "UNCERTAIN", errorCode: "SEND_UNCERTAIN" },
      });
      await tx.salesEmailDraft.update({
        where: { id },
        data: { status: "FAILED", lastError: "SEND_UNCERTAIN" },
      });
      await audit(
        tx,
        userId,
        "EMAIL_SEND_UNCERTAIN",
        { draftId: id, version },
        claimed.c,
      );
    });
    throw new Error("SEND_UNCERTAIN");
  }
}
export async function followUp(u: User, id: string, input: unknown) {
  const data = z
    .object({
      dueAt: z
        .string()
        .datetime({ offset: true })
        .transform((v) => new Date(v)),
      reason: z.string().trim().min(1).max(1000),
    })
    .parse(input);
  return db.$transaction(async (tx) => {
    const c = await conversation(u, id, tx);
    await tx.salesFollowUp.create({
      data: {
        conversationId: id,
        assignedToId: c.assignedToId,
        dueAt: data.dueAt,
        reason: data.reason,
        suggested: false,
      },
    });
    await audit(
      tx,
      u.id,
      "SALES_FOLLOW_UP_CREATED",
      { conversationId: id, dueAt: data.dueAt.toISOString() },
      c,
    );
  });
}
export async function completeFollowUp(u: User, id: string) {
  return db.$transaction(async (tx) => {
    const f = await tx.salesFollowUp.findUniqueOrThrow({ where: { id } });
    const c = await conversation(u, f.conversationId, tx);
    if (f.completedAt) return;
    await tx.salesFollowUp.update({
      where: { id },
      data: { completedAt: new Date() },
    });
    await audit(tx, u.id, "SALES_FOLLOW_UP_COMPLETED", { followUpId: id }, c);
  });
}
export async function mailboxSync(u: User, id: string) {
  assertOwner(u);
  await enqueue("SYNC", `manual-sync:${id}:${randomUUID()}`, {
    connectionId: id,
  });
}
export async function disconnectMailbox(u: User, id: string) {
  assertOwner(u);
  await db.$transaction(async (tx) => {
    const c = await tx.mailConnection.findUniqueOrThrow({ where: { id } });
    await tx.mailConnection.update({
      where: { id },
      data: {
        connected: false,
        consented: false,
        ...(c.provider === "ZOHO"
          ? { lastError: "REVOCATION_PENDING" }
          : {
              tokenCipher: null,
              oauthSecretCipher: null,
              tokenExpiresAt: null,
            }),
      },
    });
    if (c.provider === "ZOHO" && c.tokenCipher)
      await enqueue(
        "REVOKE",
        `revoke:${id}:${randomUUID()}`,
        { connectionId: id },
        new Date(),
        tx,
      );
    await audit(tx, u.id, "MAIL_DISCONNECTED", { connectionId: id });
  });
}
export function intelligence(c: {
  intelligence: Prisma.JsonValue | null;
}): Intelligence | null {
  const result = intelligenceSchema.safeParse(c.intelligence);
  return result.success ? result.data : null;
}

function usageCost(
  settings: {
    inputCostPerMillion: Prisma.Decimal | null;
    outputCostPerMillion: Prisma.Decimal | null;
  },
  usage: { provider: string; inputTokens: number; outputTokens: number },
) {
  return estimatedUsageCost(
    {
      input: settings.inputCostPerMillion?.toString() ?? null,
      output: settings.outputCostPerMillion?.toString() ?? null,
    },
    usage,
  );
}

function assertCommercialReview(c: {
  intelligence: Prisma.JsonValue | null;
  reviewedAt: Date | null;
}) {
  const i = intelligence(c);
  const raw = c.intelligence as { analysisProvider?: string } | null;
  if (raw?.analysisProvider !== "OPENAI") return;
  if (
    !i ||
    !["POTENTIAL_CUSTOMER", "EXISTING_CUSTOMER"].includes(i.mailKind) ||
    (i.needsHumanReview && !c.reviewedAt)
  )
    throw new Error("HUMAN_REVIEW_REQUIRED");
}
