"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { requireSalesAI } from "./server/access";
import { requireOwner } from "@/owner/auth";
import * as service from "./server/service";
import { safeError } from "./domain/security";
import { classification, mailKind } from "./domain/intelligence";
const field = (f: FormData, k: string) => String(f.get(k) ?? "");
async function action(path: string, operation: () => Promise<unknown>) {
  let error = "";
  try {
    await operation();
  } catch (e) {
    error = e instanceof z.ZodError ? "INVALID_INPUT" : safeError(e);
  }
  revalidatePath("/ai", "layout");
  revalidatePath("/owner/ai");
  revalidatePath("/customers", "layout");
  redirect(path + (error ? "?error=" + error : "?saved=1"));
}
export async function initialize() {
  const u = await requireOwner();
  await action("/owner/ai", () => service.initializeMock(u));
}
export async function configuration(f: FormData) {
  const u = await requireOwner();
  await action("/owner/ai", () =>
    service.configureAI(u, {
      processingEnabled: f.has("processingEnabled"),
      outboundPaused: f.has("outboundPaused"),
      liveAuthorized: false,
      mailProvider: field(f, "mailProvider"),
      aiProvider: field(f, "aiProvider"),
      model: "",
      aiPaused: f.has("aiPaused"),
      monthlyBudget: field(f, "monthlyBudget") || "10",
      alertAt: field(f, "alertAt") || "5",
      approveRoles: f.getAll("approveRoles"),
      sendRoles: f.getAll("sendRoles"),
      retentionDays: field(f, "retentionDays"),
      pollMinutes: field(f, "pollMinutes"),
      oauthRegion: field(f, "oauthRegion"),
      oauthClientId: field(f, "oauthClientId"),
      oauthSecret: field(f, "oauthSecret"),
      aiKey: field(f, "aiKey"),
      inputCostPerMillion: field(f, "inputCostPerMillion"),
      outputCostPerMillion: field(f, "outputCostPerMillion"),
    }),
  );
}
export async function mailboxAction(f: FormData) {
  const u = await requireOwner();
  const id = field(f, "id");
  await action("/owner/ai", () =>
    field(f, "operation") === "disconnect"
      ? service.disconnectMailbox(u, id)
      : service.mailboxSync(u, id),
  );
}
export async function threadAction(f: FormData) {
  const u = await requireSalesAI();
  const id = field(f, "id");
  await action("/ai/inbox/" + encodeURIComponent(id), async () => {
    switch (field(f, "operation")) {
      case "analyze":
        await service.conversation(u, id);
        return service.analyzeConversation(id);
      case "generate":
        return service.generateDraft(
          u,
          id,
          field(f, "language") === "ES"
            ? "ES"
            : field(f, "language") === "AUTO"
              ? "AUTO"
              : "EN",
          field(f, "purpose") === "FOLLOW_UP" ? "FOLLOW_UP" : "QUALIFY",
        );
      case "link":
        return service.linkCRM(u, id, {
          customerId: field(f, "customerId"),
          leadId: field(f, "leadId"),
          opportunityId: field(f, "opportunityId"),
        });
      case "lead":
        return service.confirmLead(u, id, {
          firstName: field(f, "firstName"),
          lastName: field(f, "lastName"),
        });
      case "assign":
        return service.assignConversation(u, id, field(f, "userId"));
      case "followup":
        return service.followUp(u, id, {
          dueAt: field(f, "dueAt"),
          reason: field(f, "reason"),
        });
      case "contact":
        return service.contactPreference(u, id, f.has("doNotContact"));
      case "mark": {
        const c = await service.conversation(u, id);
        const category = classification.parse(field(f, "classification"));
        await db.$transaction(async (tx) => {
          await tx.mailConversation.update({
            where: { id },
            data: {
              classification: category,
              reviewedAt: new Date(),
              ...(c.intelligence
                ? {
                    intelligence: {
                      ...(c.intelligence as Record<
                        string,
                        import("@/generated/prisma/client").Prisma.JsonValue
                      >),
                      ...service.intelligence(c)!,
                      mailKind: mailKind.parse(
                        field(f, "mailKind") ||
                          (category === "Not a sales lead"
                            ? "OTHER"
                            : "POTENTIAL_CUSTOMER"),
                      ),
                      needsHumanReview: false,
                    },
                  }
                : {}),
              unread: f.has("unread"),
              processed: f.has("processed"),
            },
          });
          await service.audit(
            tx,
            u.id,
            "MAIL_REVIEWED",
            { conversationId: id, category },
            c,
          );
        });
        return;
      }
      default:
        throw new Error("ACCESS_DENIED");
    }
  });
}
export async function draftAction(f: FormData) {
  const u = await requireSalesAI();
  const id = field(f, "id");
  const draft = await db.salesEmailDraft.findUniqueOrThrow({ where: { id } });
  await service.conversation(u, draft.conversationId);
  await action(
    "/ai/inbox/" + encodeURIComponent(draft.conversationId),
    async () => {
      const version = z.coerce
        .number()
        .int()
        .positive()
        .parse(field(f, "version"));
      const operation = field(f, "operation");
      if (operation === "edit")
        return service.editDraft(u, id, {
          expectedVersion: version,
          recipient: field(f, "recipient"),
          subject: field(f, "subject"),
          body: field(f, "body"),
        });
      if (operation === "send") return service.requestSend(u, id, version);
      return service.reviewDraft(
        u,
        id,
        z.enum(["submit", "approve", "reject"]).parse(operation),
        version,
      );
    },
  );
}
export async function complete(f: FormData) {
  const u = await requireSalesAI();
  await action("/ai/follow-ups", () =>
    service.completeFollowUp(u, field(f, "id")),
  );
}

export async function connectZoho() {
  const u = await requireOwner();
  const { cookies } = await import("next/headers");
  const { randomBytes } = await import("node:crypto");
  const { createOAuthState } = await import("./server/oauth-state");
  const { authorizeUrl, callbackUri } = await import("./providers/zoho");
  let url = "";
  try {
    const binding = randomBytes(32).toString("hex");
    const state = await createOAuthState(u, binding);
    const { digest } = await import("./domain/security");
    const s = await db.mailOAuthState.findUniqueOrThrow({
      where: { stateHash: digest(state) },
    });
    (await cookies()).set("flipas_zoho_binding", binding, {
      httpOnly: true,
      sameSite: "lax",
      secure: callbackUri().startsWith("https:"),
      path: "/",
      maxAge: 600,
    });
    url = authorizeUrl(s.region, s.clientId, s.redirectUri, state);
  } catch {
    redirect("/owner/ai?error=AUTH_REQUIRED");
  }
  redirect(url);
}
export async function selectMailbox(f: FormData) {
  const u = await requireOwner();
  const { selectZohoMailbox } = await import("./server/zoho");
  await action("/owner/ai", () =>
    selectZohoMailbox(
      u,
      field(f, "grant"),
      field(f, "accountId"),
      field(f, "folderId"),
      f.has("consent"),
    ),
  );
}
export async function retryRevocation(f: FormData) {
  const u = await requireOwner();
  await action("/owner/ai", async () => {
    await db.$transaction(async (tx) => {
      const job = await tx.salesJob.findUniqueOrThrow({
        where: { id: field(f, "id") },
      });
      if (
        !["REVOKE", "REVOKE_GRANT", "REVOKE_WRITE"].includes(job.type) ||
        job.status !== "FAILED"
      )
        throw new Error("ACCESS_DENIED");
      await tx.salesJob.updateMany({
        where: { id: job.id, status: "FAILED" },
        data: {
          status: "PENDING",
          attempts: 0,
          runAt: new Date(),
          errorCode: null,
          lockedUntil: null,
        },
      });
      await service.audit(tx, u.id, "MAIL_REVOCATION_RETRIED", {
        jobId: job.id,
      });
    });
  });
}

export async function writeConsentAction(f: FormData) {
  const u = await requireOwner();
  const { prepareWriteConsent, revokeWriteConsent } = await import(
    "./server/write-consent"
  );
  await action("/owner/ai", () =>
    field(f, "operation") === "revoke"
      ? revokeWriteConsent(u, field(f, "id"))
      : prepareWriteConsent(u, field(f, "id"), f.has("consent")),
  );
}

export async function connectZohoSending(f: FormData) {
  const u = await requireOwner();
  if (!f.has("consent")) redirect("/owner/ai?error=WRITE_AUTH_REQUIRED");
  const { cookies } = await import("next/headers");
  const { randomBytes } = await import("node:crypto");
  const { createOAuthState } = await import("./server/oauth-state");
  const { writeAuthorizeUrl, callbackUri } = await import("./providers/zoho");
  const { digest } = await import("./domain/security");
  let url = "";
  try {
    const binding = randomBytes(32).toString("hex");
    const state = await createOAuthState(u, binding, field(f, "id"));
    const row = await db.mailOAuthState.findUniqueOrThrow({
      where: { stateHash: digest(state) },
    });
    (await cookies()).set("flipas_zoho_binding", binding, {
      httpOnly: true,
      sameSite: "lax",
      secure: callbackUri().startsWith("https:"),
      path: "/",
      maxAge: 600,
    });
    url = writeAuthorizeUrl(
      row.region,
      row.clientId,
      row.redirectUri,
      state,
      true,
    );
  } catch {
    redirect("/owner/ai?error=WRITE_AUTH_REQUIRED");
  }
  redirect(url);
}
export async function writeConnectionAction(f: FormData) {
  const u = await requireOwner();
  const { testWriteConnection, configureWriteDelivery } = await import(
    "./server/write-oauth"
  );
  await action("/owner/ai", async () => {
    const operation = field(f, "operation");
    if (operation === "test") {
      const result = await testWriteConnection(u, field(f, "id"));
      if (!result.success) throw new Error(result.errorCode ?? "PROVIDER_FAILURE");
      return;
    }
    if (operation === "disable")
      return configureWriteDelivery(u, field(f, "id"), false);
    if (operation !== "enable" || !f.has("deliveryConsent"))
      throw new Error("WRITE_AUTH_REQUIRED");
    const mode = z
      .enum(["SELF_TEST", "APPROVED_REPLIES"])
      .parse(field(f, "mode"));
    return configureWriteDelivery(
      u,
      field(f, "id"),
      true,
      mode === "SELF_TEST",
    );
  });
}
