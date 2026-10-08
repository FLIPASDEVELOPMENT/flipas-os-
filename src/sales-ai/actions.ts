"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { requireSalesAI } from "./server/access";
import { requireOwner } from "@/owner/auth";
import * as service from "./server/service";
import { safeError } from "./domain/security";
import { classification } from "./domain/intelligence";
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
      model: field(f, "model"),
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
      case "generate":
        return service.generateDraft(
          u,
          id,
          field(f, "language") === "ES" ? "ES" : "EN",
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
      case "mark": {
        const c = await service.conversation(u, id);
        const category = classification.parse(field(f, "classification"));
        await db.$transaction(async (tx) => {
          await tx.mailConversation.update({
            where: { id },
            data: {
              classification: category,
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
