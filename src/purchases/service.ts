import { db } from "@/server/db";
import type { Prisma, User } from "@/generated/prisma/client";
import {
  parsePurchases,
  validateDistribution,
  digest,
  type PurchaseData,
  type Allocations,
} from "./validation";
import { z } from "zod";
type TX = Prisma.TransactionClient;
function canonical(value: unknown) {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
async function owner(tx: TX, u: User) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(84651001)::text`;
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${u.id} FOR NO KEY UPDATE`;
  const actor = await tx.user.findUnique({ where: { id: u.id } });
  if (!actor?.active || actor.role !== "OWNER" || actor.passwordChangeRequired)
    throw new Error("ACCESS_DENIED");
}
async function audit(
  tx: TX,
  u: User,
  type: string,
  purchaseId: string,
  metadata: unknown,
) {
  await tx.activity.create({
    data: {
      actorId: u.id,
      type,
      message: "Purchase administration",
      metadata: json({ purchaseId, ...(metadata as object) }),
    },
  });
}
export async function importCSV(u: User, fileName: string, data: Buffer) {
  // Authorization precedes parsing, including when called outside a Server Action.
  return db.$transaction(
    async (tx) => {
      await owner(tx, u);
      const groups = parsePurchases(data),
        sha256 = digest(data);
      const prior = await tx.purchaseDocument.findUnique({ where: { sha256 } });
      if (prior)
        return { documentId: prior.id, imported: 0, repeated: groups.length };
      const used = await tx.purchaseDocument.aggregate({
        _sum: { byteSize: true },
      });
      if ((used._sum.byteSize ?? 0) + data.length > 104857600)
        throw new Error("DOCUMENT_QUOTA");
      const doc = await tx.purchaseDocument.create({
        data: {
          sha256,
          fileName:
            fileName.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 100) ||
            "purchases.csv",
          data: Uint8Array.from(data),
          byteSize: data.length,
          importedById: u.id,
        },
      });
      let imported = 0,
        repeated = 0;
      for (const g of groups) {
        const existing = await tx.importedPurchase.findUnique({
          where: { sourceKey: g.sourceKey },
        });
        if (existing) {
          if (canonical(existing.original) !== canonical(json(g)))
            throw new Error("SOURCE_CONFLICT");
          repeated++;
          continue;
        }
        const p = await tx.importedPurchase.create({
          data: {
            sourceKey: g.sourceKey,
            evidenceKey: g.evidenceKey,
            documentId: doc.id,
            original: json(g),
          },
        });
        await audit(tx, u, "PURCHASE_IMPORTED", p.id, {
          source: g.header.source,
          documentId: doc.id,
        });
        imported++;
      }
      return { documentId: doc.id, imported, repeated };
    },
    { timeout: 20000 },
  );
}
async function validateLinks(tx: TX, allocations: Allocations) {
  for (const a of allocations) {
    if (!a.projectId) continue;
    const p = await tx.project.findUnique({ where: { id: a.projectId } });
    if (!p) throw new Error("ALLOCATION_LINK");
    if (
      a.estimateLineId &&
      !(await tx.estimateLineItem.findFirst({
        where: { id: a.estimateLineId, section: { estimateId: p.estimateId } },
      }))
    )
      throw new Error("ESTIMATE_LINK");
  }
}
export async function reviewPurchase(
  u: User,
  id: string,
  expectedVersion: number,
  input: unknown,
  reason: string,
) {
  z.string().trim().min(5).max(1000).parse(reason);
  z.number().int().nonnegative().parse(expectedVersion);
  return db.$transaction(async (tx) => {
    await owner(tx, u);
    const p = await tx.importedPurchase.findUniqueOrThrow({ where: { id } });
    if (["APPROVED", "REJECTED"].includes(p.status))
      throw new Error("PURCHASE_FINAL");
    if (p.headVersion !== expectedVersion) throw new Error("STALE_VERSION");
    const allocations = validateDistribution(
      p.original as unknown as PurchaseData,
      input,
    );
    await validateLinks(tx, allocations);
    const review = await tx.purchaseReview.create({
      data: {
        purchaseId: id,
        version: p.headVersion + 1,
        allocations: json(allocations),
        reason,
        createdById: u.id,
      },
    });
    await tx.importedPurchase.update({
      where: { id },
      data: { headVersion: review.version, status: "NEEDS_REVIEW" },
    });
    await audit(tx, u, "PURCHASE_REVIEW_SAVED", id, {
      version: review.version,
      reason,
      allocations,
    });
    return review;
  });
}
export async function approvePurchase(
  u: User,
  id: string,
  version: number,
  confirmation: boolean,
) {
  z.literal(true).parse(confirmation);
  z.number().int().positive().parse(version);
  return db.$transaction(
    async (tx) => {
      await owner(tx, u);
      const p = await tx.importedPurchase.findUniqueOrThrow({ where: { id } });
      if (p.status === "APPROVED") {
        if (p.approvedVersion !== version) throw new Error("STALE_VERSION");
        return p;
      }
      if (p.status === "REJECTED" || p.headVersion !== version)
        throw new Error("STALE_VERSION");
      if (
        await tx.importedPurchase.count({
          where: {
            evidenceKey: p.evidenceKey,
            status: "APPROVED",
            id: { not: id },
          },
        })
      )
        throw new Error("DUPLICATE_EVIDENCE");
      const review = await tx.purchaseReview.findUniqueOrThrow({
        where: { purchaseId_version: { purchaseId: id, version } },
      });
      const original = p.original as unknown as PurchaseData;
      const allocations = validateDistribution(original, review.allocations);
      await validateLinks(tx, allocations);
      const projectIds = [
        ...new Set(
          allocations.flatMap((a) => (a.projectId ? [a.projectId] : [])),
        ),
      ].sort();
      for (const projectId of projectIds)
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${projectId} FOR UPDATE`;
      for (const [allocationIndex, a] of allocations.entries()) {
        let ledgerId: string | undefined;
        if (a.projectId) {
          if (a.existingLedgerId) {
            const ledger = await tx.projectCostEntry.findUnique({
              where: { id: a.existingLedgerId },
            });
            if (
              !ledger ||
              ledger.projectId !== a.projectId ||
              ledger.kind !== "ACTUAL" ||
              ledger.category !== a.costType ||
              !ledger.amount.equals(a.amount)
            )
              throw new Error("RECONCILIATION_MISMATCH");
            if (
              await tx.purchasePosting.count({ where: { ledgerId: ledger.id } })
            )
              throw new Error("DUPLICATE_COST");
            ledgerId = ledger.id;
          } else {
            if (
              await tx.projectCostEntry.count({
                where: {
                  projectId: a.projectId,
                  kind: "ACTUAL",
                  sourceReference: original.header.receipt_id,
                },
              })
            )
              throw new Error("EXISTING_RECEIPT_COST");
            const ledger = await tx.projectCostEntry.create({
              data: {
                projectId: a.projectId,
                category: a.costType,
                kind: "ACTUAL",
                amount: a.amount,
                description: original.lines.find((l) => l.line_id === a.lineId)!
                  .description,
                sourceReference: "purchase:" + id + ":" + allocationIndex,
                recordedById: u.id,
                requestKey: "purchase:" + id + ":" + allocationIndex,
              },
            });
            ledgerId = ledger.id;
            await tx.project.update({
              where: { id: a.projectId },
              data: { costsReviewedAt: null, costsReviewedById: null },
            });
            await tx.projectEvent.create({
              data: {
                projectId: a.projectId,
                actorId: u.id,
                type: "PURCHASE_COST_APPROVED",
                metadata: json({
                  purchaseId: id,
                  version,
                  allocationIndex,
                  ledgerId,
                  amount: a.amount,
                  category: a.category,
                  estimateLineId: a.estimateLineId ?? null,
                }),
              },
            });
          }
        }
        await tx.purchasePosting.create({
          data: {
            purchaseId: id,
            reviewVersion: version,
            allocationIndex,
            projectId: a.projectId,
            estimateLineId: a.estimateLineId,
            ledgerId,
            amount: a.amount,
            category: a.category,
            costType: a.costType,
          },
        });
      }
      const result = await tx.importedPurchase.update({
        where: { id },
        data: {
          status: "APPROVED",
          approvedVersion: version,
          approvedById: u.id,
          approvedAt: new Date(),
        },
      });
      await audit(tx, u, "PURCHASE_APPROVED", id, {
        version,
        postingCount: allocations.length,
      });
      return result;
    },
    { timeout: 20000 },
  );
}
export async function rejectPurchase(
  u: User,
  id: string,
  version: number,
  reason: string,
) {
  z.string().trim().min(5).max(1000).parse(reason);
  return db.$transaction(async (tx) => {
    await owner(tx, u);
    const p = await tx.importedPurchase.findUniqueOrThrow({ where: { id } });
    if (p.status === "APPROVED" || p.status === "REJECTED")
      throw new Error("PURCHASE_FINAL");
    if (p.headVersion !== version) throw new Error("STALE_VERSION");
    await tx.importedPurchase.update({
      where: { id },
      data: { status: "REJECTED" },
    });
    await audit(tx, u, "PURCHASE_REJECTED", id, { version, reason });
  });
}
export async function purchaseData(u: User, id?: string) {
  return db.$transaction(async (tx) => {
    await owner(tx, u);
    if (id)
      return tx.importedPurchase.findUniqueOrThrow({
        where: { id },
        include: { reviews: { orderBy: { version: "desc" } }, postings: true },
      });
    return tx.importedPurchase.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  });
}
export async function readDocument(u: User, id: string) {
  return db.$transaction(async (tx) => {
    await owner(tx, u);
    return tx.purchaseDocument.findUniqueOrThrow({ where: { id } });
  });
}

export async function approveBatch(u: User, input: unknown) {
  const items = z
    .array(
      z
        .object({ id: z.string().min(1), version: z.number().int().positive() })
        .strict(),
    )
    .min(1)
    .max(20)
    .parse(input);
  const results: { id: string; approved: boolean; error?: string }[] = [];
  for (const item of items) {
    try {
      await approvePurchase(u, item.id, item.version, true);
      results.push({ id: item.id, approved: true });
    } catch (error) {
      if (error instanceof Error && error.message === "ACCESS_DENIED")
        throw error;
      results.push({
        id: item.id,
        approved: false,
        error:
          "Review this purchase individually; no changes were saved for this item.",
      });
    }
  }
  return results;
}
