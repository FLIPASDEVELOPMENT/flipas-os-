import { revokeZohoConnection, revokePendingGrant } from "./zoho";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { Prisma, SalesJob } from "@/generated/prisma/client";
import {
  enqueue,
  syncMailbox,
  analyzeConversation,
  sendApproved,
  audit,
  assertContactAllowed,
} from "./service";
import { withDeadline } from "../domain/deadline";
import { safeError } from "../domain/security";
export async function scheduleJobs(now = new Date()) {
  const settings = await db.salesAISettings.findUnique({
    where: { id: "company" },
  });
  if (!settings) return;
  const expiredGrants = await db.mailOAuthGrant.findMany({
    where: { expiresAt: { lt: now } },
    select: { id: true },
  });
  for (const g of expiredGrants)
    await enqueue("REVOKE_GRANT", `revoke-grant:${g.id}`, { grantId: g.id });
  await db.mailOAuthState.deleteMany({ where: { expiresAt: { lt: now } } });
  if (settings.processingEnabled) {
    const connections = await db.mailConnection.findMany({
      where: { connected: true, consented: true, folderId: { not: null } },
    });
    for (const c of connections) {
      if (c.provider === "ZOHO" && settings.mailProvider !== "ZOHO") continue;
      const slot = Math.floor(now.getTime() / (settings.pollMinutes * 60000));
      await enqueue("SYNC", `sync:${c.id}:${slot}`, { connectionId: c.id });
    }
  }
  await enqueue("REMIND", `remind:${Math.floor(now.getTime() / 3600000)}`, {});
  await enqueue("RETENTION", `retention:${now.toISOString().slice(0, 10)}`, {});
}
export async function recoverExpiredJobs() {
  const expired = await db.salesJob.findMany({
    where: { status: "RUNNING", lockedUntil: { lt: new Date() } },
  });
  for (const job of expired)
    await db.$transaction(async (tx) => {
      const current = await tx.salesJob.findFirst({
        where: {
          id: job.id,
          status: "RUNNING",
          leaseToken: job.leaseToken,
          lockedUntil: { lt: new Date() },
        },
      });
      if (!current) return;
      if (job.type === "SEND") {
        const data = job.payload as { draftId: string; version: number };
        await tx.mailSendAttempt.updateMany({
          where: {
            draftId: data.draftId,
            version: data.version,
            status: "STARTED",
          },
          data: { status: "UNCERTAIN", errorCode: "LEASE_EXPIRED" },
        });
        await tx.salesEmailDraft.updateMany({
          where: { id: data.draftId, status: "SENDING" },
          data: { status: "FAILED", lastError: "SEND_UNCERTAIN" },
        });
        await tx.salesJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            errorCode: "SEND_UNCERTAIN",
            lockedUntil: null,
          },
        });
      } else
        await tx.salesJob.update({
          where: { id: job.id },
          data: {
            status: job.attempts < 4 ? "PENDING" : "FAILED",
            runAt: new Date(),
            lockedUntil: null,
            errorCode: "LEASE_EXPIRED",
          },
        });
    });
}
export async function claimJob() {
  const token = randomUUID();
  const jobs = await db.$queryRaw<
    SalesJob[]
  >`UPDATE "SalesJob" SET "status"='RUNNING',"leaseToken"=${token},"lockedUntil"=NOW()+INTERVAL '120 seconds',"attempts"="attempts"+1,"updatedAt"=NOW() WHERE "id"=(SELECT "id" FROM "SalesJob" WHERE "status"='PENDING' AND "runAt"<=NOW() ORDER BY "runAt","createdAt" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
  return jobs[0] ?? null;
}
export async function runJob(job: SalesJob) {
  const p = job.payload as Record<string, string | number>;
  try {
    await withDeadline(async (signal) => {
      switch (job.type) {
        case "REVOKE_GRANT":
          await revokePendingGrant(String(p.grantId));
          break;
        case "REVOKE":
          await revokeZohoConnection(String(p.connectionId));
          break;
        case "SYNC":
          await syncMailbox(String(p.connectionId), undefined, signal);
          break;
        case "ANALYZE":
          await analyzeConversation(String(p.conversationId), signal);
          break;
        case "SEND":
          await sendApproved(
            String(p.draftId),
            Number(p.version),
            String(p.userId),
            undefined,
            signal,
          );
          break;
        case "REMIND": {
          const overdue = await db.salesFollowUp.findMany({
            where: { completedAt: null, dueAt: { lt: new Date() } },
            include: { conversation: true },
            take: 100,
          });
          for (const f of overdue) {
            signal.throwIfAborted();
            try {
              await assertContactAllowed(f.conversation);
            } catch (e) {
              if (
                !["CONTACT_SUPPRESSED", "FOLLOW_UP_CLOSED"].includes(
                  safeError(e),
                )
              )
                throw e;
              await db.salesFollowUp.update({
                where: { id: f.id },
                data: { completedAt: new Date() },
              });
              continue;
            }
            const key = `overdue:${f.id}`;
            await db.$transaction(async (tx) => {
              const exists = await tx.activity.findFirst({
                where: {
                  type: "FOLLOW_UP_OVERDUE",
                  metadata: { path: ["key"], equals: key },
                },
              });
              if (!exists)
                await audit(
                  tx,
                  null,
                  "FOLLOW_UP_OVERDUE",
                  { key, followUpId: f.id },
                  f.conversation,
                );
            });
          }
          break;
        }
        case "RETENTION": {
          const settings = await db.salesAISettings.findUniqueOrThrow({
            where: { id: "company" },
          });
          const cutoff = new Date(
            Date.now() - settings.retentionDays * 86400000,
          );
          await db.mailMessage.updateMany({
            where: { receivedAt: { lt: cutoff } },
            data: {
              body: "[Email body removed under retention policy]",
              attachments: [],
            },
          });
          await db.mailConversation.updateMany({
            where: { updatedAt: { lt: cutoff } },
            data: { intelligence: Prisma.DbNull },
          });
          break;
        }
        default:
          throw new Error("Unsupported job type");
      }
    });
    await db.salesJob.updateMany({
      where: { id: job.id, status: "RUNNING", leaseToken: job.leaseToken },
      data: { status: "COMPLETED", completedAt: new Date(), lockedUntil: null },
    });
  } catch (e) {
    const errorCode = safeError(e);
    const retry =
      job.type !== "SEND" &&
      job.attempts < 4 &&
      ![
        "AI_BUDGET_LIMIT",
        "AI_EMAIL_LIMIT",
        "AI_REQUEST_LIMIT",
        "AI_CONFIG_REQUIRED",
        "AI_PAUSED",
        "INVALID_AI_OUTPUT",
        "INVALID_AI_OUTPUT_FORMAT",
        "INVALID_AI_OUTPUT_SCHEMA",
        "INVALID_AI_OUTPUT_ENVELOPE",
        "INVALID_AI_OUTPUT_EVIDENCE",
        "INVALID_AI_OUTPUT_UNSAFE",
        "AI_OUTPUT_INCOMPLETE",
        "AI_OUTPUT_REFUSED",
        "AI_RESPONSE_FAILED",
        "AI_API_PERMISSION_DENIED",
        "AI_MODEL_UNAVAILABLE",
        "AI_API_REQUEST_REJECTED",
        "HUMAN_REVIEW_REQUIRED",
      ].includes(errorCode);
    await db.salesJob.updateMany({
      where: { id: job.id, status: "RUNNING", leaseToken: job.leaseToken },
      data: {
        status: retry ? "PENDING" : "FAILED",
        errorCode,
        runAt: new Date(
          Date.now() + Math.min(600000, 5000 * 2 ** job.attempts),
        ),
        lockedUntil: null,
      },
    });
    if (job.type === "SYNC")
      await db.mailConnection.updateMany({
        where: { id: String(p.connectionId) },
        data: { lastError: errorCode },
      });
  }
}
export async function workerTick() {
  await recoverExpiredJobs();
  await scheduleJobs();
  const job = await claimJob();
  if (job) await runJob(job);
  return !!job;
}
