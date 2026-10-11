import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import type { User, Prisma } from "@/generated/prisma/client";
import { owner, audit } from "./service";
import {
  aliasKey,
  jobCode,
  matchProject,
  rulesSuggestion,
  sourceView,
  suggestionSchema,
  validateSuggestion,
  CLASSIFIER_VERSION,
  type Candidate,
} from "./classification";
import type { PurchaseData, Allocations } from "./validation";
import { runAI } from "@/sales-ai/server/budget";
import { OpenAISalesAI } from "@/sales-ai/providers/openai";
import { safeError } from "@/sales-ai/domain/security";
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export async function projectIdentityData(u: User) {
  return db.$transaction(async (tx) => {
    await owner(tx, u);
    return tx.projectIdentity.findMany({
      include: { aliases: true },
      orderBy: { number: "asc" },
    });
  });
}
export async function editProjectIdentity(
  u: User,
  projectId: string,
  name: string,
  alias: string,
  reason: string,
) {
  const label = z.string().trim().min(1).max(160).parse(name),
    why = z.string().trim().min(5).max(1000).parse(reason);
  return db.$transaction(async (tx) => {
    await owner(tx, u);
    const identity = await tx.projectIdentity.findUniqueOrThrow({
      where: { projectId },
    });
    const add = async (text: string, historical = false) => {
      if (!text.trim()) return;
      z.string().max(200).parse(text);
      // Historical names remain exact aliases. Reserved code-like labels cannot hijack another code.
      const code = jobCode(text);
      if (code && code !== identity.code)
        throw new Error("ALIAS_CODE_CONFLICT");
      const normalized = aliasKey(text),
        existing = await tx.projectAlias.findUnique({
          where: { projectId_normalized: { projectId, normalized } },
        });
      if (
        !historical &&
        (await tx.projectAlias.findFirst({
          where: { normalized, projectId: { not: projectId } },
        }))
      )
        throw new Error("ALIAS_CONFLICT");
      if (!existing)
        await tx.projectAlias.create({
          data: {
            projectId,
            alias: text,
            normalized,
            confirmedById: u.id,
            reason: why,
          },
        });
    };
    if (identity.name !== label) await add(identity.name, true);
    await add(alias);
    await tx.projectIdentity.update({
      where: { projectId },
      data: { name: label },
    });
    await tx.activity.create({
      data: {
        actorId: u.id,
        type: "PROJECT_IDENTITY_UPDATED",
        message: "Project name and historical aliases reviewed",
        metadata: json({
          projectId,
          code: identity.code,
          previousName: identity.name,
          name: label,
          alias,
          reason: why,
        }),
      },
    });
  });
}
export async function suggestionHistory(u: User, id: string) {
  return db.$transaction(async (tx) => {
    await owner(tx, u);
    const jobs = await tx.purchaseSuggestion.findMany({
      where: { purchaseId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        decisions: true,
        reviews: {
          select: {
            version: true,
            reason: true,
            createdAt: true,
            createdById: true,
            allocations: true,
          },
        },
      },
    });
    const now = Date.now();
    return jobs.map((job) => {
      const parsed = z
        .object({
          match: z.object({
            candidates: z.array(z.string()),
            ambiguous: z.boolean(),
            method: z.string(),
          }),
          candidates: z.array(
            z.object({
              projectId: z.string(),
              code: z.string(),
              name: z.string(),
            }),
          ),
        })
        .safeParse(job.input);
      const matchingCandidates = parsed.success
        ? parsed.data.candidates.filter((c) =>
            parsed.data.match.candidates.includes(c.projectId),
          )
        : [];
      return {
        ...job,
        canAbandon:
          job.state === "RUNNING" && now - job.createdAt.getTime() >= 300000,
        matchingCandidates,
        matchingMethod: parsed.success ? parsed.data.match.method : "UNKNOWN",
      };
    });
  });
}
async function context(tx: Prisma.TransactionClient, d: PurchaseData) {
  const rows = await tx.projectIdentity.findMany({
    take: 101,
    orderBy: { number: "asc" },
    include: {
      aliases: true,
      project: {
        select: {
          estimate: {
            select: {
              sections: {
                select: { lines: { select: { id: true, name: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (rows.length > 100) throw new Error("CLASSIFICATION_CONTEXT_LIMIT");
  const candidates: Candidate[] = rows.map((r) => ({
    projectId: r.projectId,
    code: r.code,
    name: r.name,
    aliases: r.aliases.map((a) => a.alias),
    lines: r.project.estimate.sections
      .flatMap((s) => s.lines)
      .slice(0, 40)
      .map((l) => ({ id: l.id, name: l.name.slice(0, 160) })),
  }));
  const match = matchProject(
    [d.header.job_name, d.native?.projectName ?? "", d.header.po_number],
    candidates,
  );
  // Only exact item matches, OWNER-approved corrections, same deterministically verified project.
  const examples: {
    reviewId: string;
    projectId: string;
    description: string;
    sku: string;
    category: string;
    costType: string;
    estimateLineId: string | null;
  }[] = [];
  if (match.projectId && !d.native) {
    const postings = await tx.purchasePosting.findMany({
      where: { projectId: match.projectId, purchase: { status: "APPROVED" } },
      take: 100,
      orderBy: { createdAt: "desc" },
      include: { purchase: { include: { reviews: true } } },
    });
    for (const post of postings) {
      const review = post.purchase.reviews.find(
        (r) => r.version === post.reviewVersion,
      );
      if (!review) continue;
      const allocations = review.allocations as Allocations,
        a = allocations[post.allocationIndex],
        prior = post.purchase.original as unknown as PurchaseData;
      if (prior.native || !a) continue;
      const line = prior.lines.find((l) => l.line_id === a.lineId);
      if (
        !line ||
        !d.lines.some(
          (l) =>
            (l.sku && line.sku && aliasKey(l.sku) === aliasKey(line.sku)) ||
            aliasKey(l.description) === aliasKey(line.description),
        )
      )
        continue;
      if (a.category === "Other") continue;
      examples.push({
        reviewId: review.id,
        projectId: match.projectId,
        description: sourceView(prior).lines.find(
          (l) => l.lineId === line.line_id,
        )!.description,
        sku: line.sku.slice(0, 100),
        category: a.category,
        costType: a.costType,
        estimateLineId: a.estimateLineId ?? null,
      });
      if (examples.length === 5) break;
    }
  }
  return {
    candidates,
    match,
    examples,
    untrusted_purchase: sourceView(d),
    classifierVersion: CLASSIFIER_VERSION,
  };
}
/** Explicit OWNER request only; committing a job before network IO gives durable idempotency. No costs or review writes here. */
export async function suggestPurchase(
  u: User,
  id: string,
  baseVersion: number,
  requestKey: string,
  transport: import("@/sales-ai/providers/openai").AITransport = fetch,
) {
  z.number().int().nonnegative().parse(baseVersion);
  z.string().uuid().parse(requestKey);
  const start = await db.$transaction(async (tx) => {
    await owner(tx, u);
    const prior = await tx.purchaseSuggestion.findUnique({
      where: { purchaseId_requestKey: { purchaseId: id, requestKey } },
    });
    if (prior) return { job: prior, reused: true };
    const p = await tx.importedPurchase.findUniqueOrThrow({ where: { id } }),
      d = p.original as unknown as PurchaseData;
    if (["APPROVED", "REJECTED"].includes(p.status))
      throw new Error("PURCHASE_FINAL");
    if (p.headVersion !== baseVersion) throw new Error("STALE_VERSION");
    if (d.native?.blockedReasons.length)
      throw new Error("UNSUPPORTED_MOVEMENT");
    if (d.lines.length > 20) throw new Error("CLASSIFICATION_CONTEXT_LIMIT");
    const settings = await tx.salesAISettings.findUnique({
      where: { id: "company" },
    });
    if (!settings?.processingEnabled || settings.aiPaused)
      throw new Error(settings?.aiPaused ? "AI_PAUSED" : "PROCESSING_DISABLED");
    if (
      await tx.purchaseSuggestion.findFirst({
        where: { purchaseId: id, state: "RUNNING" },
      })
    )
      throw new Error("CLASSIFICATION_RUNNING");
    if ((await tx.purchaseSuggestion.count({ where: { purchaseId: id } })) >= 4)
      throw new Error("AI_EMAIL_LIMIT");
    const input = await context(tx, d);
    const job = await tx.purchaseSuggestion.create({
      data: {
        purchaseId: id,
        baseVersion,
        requestKey,
        createdById: u.id,
        provider: d.native ? "RULES" : settings.aiProvider,
        model:
          !d.native && settings.aiProvider === "OPENAI"
            ? /^[a-zA-Z0-9._-]{1,100}$/.test(process.env.OPENAI_MODEL ?? "")
              ? process.env.OPENAI_MODEL!
              : "unconfigured"
            : CLASSIFIER_VERSION,
        input: json(input),
      },
    });
    await audit(tx, u, "PURCHASE_SUGGESTION_REQUESTED", id, {
      suggestionId: job.id,
      baseVersion,
    });
    return { job, reused: false, d, input };
  });
  if (start.reused || !start.d || !start.input) return start.job;
  const { job, d, input } = start;
  let result: ReturnType<typeof rulesSuggestion> | undefined,
    provider = "RULES",
    model = CLASSIFIER_VERSION,
    errorCode: string | undefined;
  try {
    // Summary exports cannot support item classification. Deterministic evidence is sufficient; no provider charge.
    if (d.native) result = rulesSuggestion(d, input.candidates);
    else {
      const config = await db.salesAISettings.findUniqueOrThrow({
        where: { id: "company" },
      });
      provider = config.aiProvider;
      model =
        config.aiProvider === "OPENAI"
          ? (process.env.OPENAI_MODEL ?? "unconfigured")
          : CLASSIFIER_VERSION;
      const response = await runAI(
        "purchase:" + id,
        "PURCHASE_CLASSIFY",
        [
          {
            id: "purchase:" + id,
            subject: "Purchase classification",
            body: "Bounded purchase classification request",
            fromEmail: "",
            direction: "INBOUND",
          },
        ],
        async (engine) => {
          if (engine instanceof OpenAISalesAI) {
            const r = await engine.classifyPurchase(input, suggestionSchema);
            // Validation inside the budget wrapper ensures rejected output is still metered correctly.
            return {
              ...r,
              value: validateSuggestion(r.value, d, input.candidates),
            };
          }
          return {
            value: rulesSuggestion(d, input.candidates),
            provider: "MOCK" as const,
            model: CLASSIFIER_VERSION,
            inputTokens: 0,
            outputTokens: 0,
          };
        },
        transport,
      );
      result = response.value;
      provider = response.provider;
      model = response.model;
    }
    result = validateSuggestion(result, d, input.candidates);
  } catch (e) {
    errorCode =
      e instanceof z.ZodError ? "INVALID_AI_OUTPUT_SCHEMA" : safeError(e);
  }
  const finished = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(84651001)::text`;
    // A concurrent deactivation or role change must prevent disclosure and usable suggestions.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${u.id} FOR NO KEY UPDATE`;
    const actor = await tx.user.findUnique({ where: { id: u.id } }),
      p = await tx.importedPurchase.findUniqueOrThrow({ where: { id } });
    const authorized =
      actor?.active && actor.role === "OWNER" && !actor.passwordChangeRequired;
    const stale =
      !authorized ||
      p.headVersion !== baseVersion ||
      ["APPROVED", "REJECTED"].includes(p.status);
    const currentJob = await tx.purchaseSuggestion.findUniqueOrThrow({
      where: { id: job.id },
    });
    if (currentJob.state !== "RUNNING")
      return { saved: currentJob, authorized };
    const saved = await tx.purchaseSuggestion.update({
      where: { id: job.id },
      data: {
        completedAt: new Date(),
        state: stale ? "STALE" : errorCode ? "FAILED" : "GENERATED",
        provider,
        model,
        result: result ? json(result) : undefined,
        errorCode: errorCode ?? (stale ? "STALE_VERSION" : null),
      },
    });
    await audit(tx, u, "PURCHASE_SUGGESTION_COMPLETED", id, {
      suggestionId: job.id,
      state: saved.state,
      provider,
      model,
      errorCode: saved.errorCode,
    });
    return { saved, authorized };
  });
  if (!finished.authorized) throw new Error("ACCESS_DENIED");
  return finished.saved;
}
export async function suggestBatch(u: User, items: unknown) {
  const rows = z
    .array(
      z.strictObject({
        id: z.string().min(1),
        version: z.number().int().nonnegative(),
        requestKey: z.string().uuid(),
      }),
    )
    .min(1)
    .max(5)
    .parse(items);
  await db.$transaction(async (tx) => owner(tx, u));
  if (new Set(rows.map((x) => x.id)).size !== rows.length)
    throw new Error("INVALID_INPUT");
  const results = [];
  for (const row of rows) {
    try {
      const job = await suggestPurchase(u, row.id, row.version, row.requestKey);
      results.push({ id: row.id, state: job.state, errorCode: job.errorCode });
    } catch (e) {
      results.push({ id: row.id, state: "BLOCKED", errorCode: safeError(e) });
    }
  }
  return results;
}
export const newSuggestionKey = () => randomUUID();

export async function rejectSuggestion(
  u: User,
  id: string,
  version: number,
  suggestionId: string,
  reason: string,
) {
  z.string().trim().min(5).max(1000).parse(reason);
  return db.$transaction(async (tx) => {
    await owner(tx, u);
    const p = await tx.importedPurchase.findUniqueOrThrow({ where: { id } });
    const s = await tx.purchaseSuggestion.findUniqueOrThrow({
      where: { id: suggestionId },
    });
    if (
      p.headVersion !== version ||
      s.purchaseId !== id ||
      s.baseVersion !== version ||
      s.state !== "GENERATED" ||
      ["APPROVED", "REJECTED"].includes(p.status)
    )
      throw new Error("STALE_VERSION");
    const prior = await tx.purchaseSuggestionDecision.findUnique({
      where: { suggestionId },
    });
    if (prior) return prior;
    const decision = await tx.purchaseSuggestionDecision.create({
      data: { suggestionId, actorId: u.id, reason },
    });
    await audit(tx, u, "PURCHASE_SUGGESTION_REJECTED", id, {
      suggestionId,
      reason,
    });
    return decision;
  });
}
/** OWNER may close an interrupted job after five minutes, but must not release AI cost reservations or reset counters. */
export async function abandonSuggestion(
  u: User,
  id: string,
  suggestionId: string,
  reason: string,
) {
  z.string().trim().min(5).max(1000).parse(reason);
  return db.$transaction(async (tx) => {
    await owner(tx, u);
    const s = await tx.purchaseSuggestion.findUniqueOrThrow({
      where: { id: suggestionId },
    });
    if (
      s.purchaseId !== id ||
      s.state !== "RUNNING" ||
      Date.now() - s.createdAt.getTime() < 300000
    )
      throw new Error("CLASSIFICATION_RUNNING");
    const saved = await tx.purchaseSuggestion.update({
      where: { id: suggestionId },
      data: {
        state: "FAILED",
        completedAt: new Date(),
        errorCode: "AI_RESPONSE_FAILED",
      },
    });
    await audit(tx, u, "PURCHASE_SUGGESTION_ABANDONED", id, {
      suggestionId,
      reason,
      reservationsPreserved: true,
    });
    return saved;
  });
}
