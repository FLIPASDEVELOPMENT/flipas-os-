import { handoffDiagnostic } from "../domain/handoff";
import { activePolicy } from "@/owner/service";
import { parsePolicy, policyLine, projectOverhead } from "@/owner/policy";
import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import { Prisma, User } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { canUseCRM, canManage } from "@/domain/permissions";
import { customerScope, opportunityScope } from "@/server/crm";
import {
  catalogInput,
  draftInput,
  settingsInput,
  LineInput,
  DraftInput,
} from "../domain/input";
import { calculateEstimate } from "../domain/calculations";
import { categories, scopeTemplates } from "../domain/templates";
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
type TX = Prisma.TransactionClient;
const crm = (u: User) => {
  if (!u.active || !canUseCRM(u.role)) throw new Error("Access denied");
};
const admin = (u: User) => {
  crm(u);
  if (!canManage(u.role)) throw new Error("Owner/Admin required");
};
export const estimateScope = (u: User): Prisma.EstimateWhereInput =>
  canManage(u.role)
    ? {}
    : { OR: [{ creatorId: u.id }, { opportunity: { ownerId: u.id } }] };
export const includeEstimate = {
  sections: {
    orderBy: { position: "asc" as const },
    include: { lines: { orderBy: { position: "asc" as const } } },
  },
  customer: true,
  opportunity: true,
  approvals: { orderBy: { createdAt: "desc" as const } },
};
export type FullEstimate = Prisma.EstimateGetPayload<{
  include: typeof includeEstimate;
}>;
async function getEstimate(tx: TX, u: User, id: string) {
  crm(u);
  const e = await tx.estimate.findFirst({
    where: { id, ...estimateScope(u) },
    include: includeEstimate,
  });
  if (!e) throw new Error("Estimate unavailable");
  return e;
}
export async function readEstimate(u: User, id: string) {
  return getEstimate(db, u, id);
}
async function audit(
  tx: TX,
  u: User,
  e: { customerId: string; opportunityId?: string | null; id?: string },
  type: string,
  metadata: unknown,
) {
  await tx.activity.create({
    data: {
      actorId: u.id,
      customerId: e.customerId,
      opportunityId: e.opportunityId,
      type,
      message: type.replaceAll("_", " "),
      metadata: json({ estimateId: e.id, ...(metadata as object) }),
    },
  });
}
export async function initializeCatalog(u: User) {
  admin(u);
  return db.$transaction(async (tx) => {
    for (const name of categories)
      await tx.serviceCategory.upsert({
        where: { name },
        create: { name },
        update: {},
      });
    for (const t of scopeTemplates)
      await tx.estimateTemplate.upsert({
        where: { name: t.name },
        create: {
          name: t.name,
          category: t.category,
          sections: json([
            {
              name: t.category,
              items: t.items.map((name) => ({ name, unit: "EACH" })),
            },
          ]),
        },
        update: {},
      });
    await tx.estimatorSettings.upsert({
      where: { id: "company" },
      create: { id: "company" },
      update: {},
    });
    await tx.activity.create({
      data: {
        type: "ESTIMATOR_INITIALIZED",
        message:
          "Scope-only catalog categories/templates initialized; no company prices created",
        actorId: u.id,
      },
    });
  });
}
export async function saveCatalog(u: User, input: unknown) {
  admin(u);
  const d = catalogInput.parse(input);
  if (
    new Decimal(d.targetMargin).gte(1) ||
    new Decimal(d.minimumMargin).gte(1) ||
    new Decimal(d.targetMargin).lt(d.minimumMargin)
  )
    throw new Error("Target margin must meet minimum and be below 100%");
  if (d.effectiveTo && new Date(d.effectiveTo) <= new Date(d.effectiveFrom))
    throw new Error("Effective end must follow start");
  return db.$transaction(
    async (tx) => {
      const before = d.id
        ? await tx.serviceItem.findUniqueOrThrow({ where: { id: d.id } })
        : null;
      const { id, reason, ...rest } = d;
      const data = {
        ...rest,
        effectiveFrom: new Date(d.effectiveFrom),
        effectiveTo: d.effectiveTo ? new Date(d.effectiveTo) : null,
        defaultMarkup: "0",
      };
      const item = id
        ? await tx.serviceItem.update({ where: { id }, data })
        : await tx.serviceItem.create({ data });
      await tx.catalogPriceHistory.create({
        data: {
          serviceItemId: item.id,
          actorId: u.id,
          before: json(before ?? {}),
          after: json(item),
          reason,
        },
      });
      await tx.activity.create({
        data: {
          type: "CATALOG_PRICE_CHANGED",
          actorId: u.id,
          message: `Catalog updated: ${item.name}`,
          metadata: json({ serviceItemId: item.id, reason }),
        },
      });
      return item;
    },
    { isolationLevel: "Serializable" },
  );
}
export async function saveSettings(u: User, input: unknown) {
  admin(u);
  const data = settingsInput.parse(input);
  return db.$transaction(async (tx) => {
    const old = await tx.estimatorSettings.findUnique({
      where: { id: "company" },
    });
    const saved = await tx.estimatorSettings.upsert({
      where: { id: "company" },
      create: data,
      update: data,
    });
    await tx.activity.create({
      data: {
        type: "ESTIMATOR_SETTINGS_CHANGED",
        message: "Estimator business information and approval policy updated",
        actorId: u.id,
        metadata: json({ before: old, after: saved }),
      },
    });
    return saved;
  });
}
export async function saveTemplate(u: User, input: unknown) {
  admin(u);
  const { z } = await import("zod");
  const data = z
    .object({
      id: z.string().optional(),
      name: z.string().min(1).max(200),
      category: z.enum(categories as [string, ...string[]]),
      active: z.boolean(),
      sections: z
        .array(
          z.object({
            name: z.string().min(1).max(200),
            items: z
              .array(
                z.object({
                  name: z.string().min(1).max(200),
                  unit: catalogInput.shape.unit,
                  serviceItemId: z.string().optional(),
                }),
              )
              .max(100),
          }),
        )
        .min(1)
        .max(30),
    })
    .parse(input);
  return db.$transaction(async (tx) => {
    for (const sec of data.sections)
      for (const item of sec.items)
        if (
          item.serviceItemId &&
          !(await tx.serviceItem.findUnique({
            where: { id: item.serviceItemId },
          }))
        )
          throw new Error("Template catalog item missing");
    const { id, ...rest } = data;
    const t = id
      ? await tx.estimateTemplate.update({
          where: { id },
          data: { ...rest, sections: json(rest.sections) },
        })
      : await tx.estimateTemplate.create({
          data: { ...rest, sections: json(rest.sections) },
        });
    await tx.activity.create({
      data: {
        type: "ESTIMATE_TEMPLATE_UPDATED",
        message: `Template updated: ${t.name}`,
        actorId: u.id,
      },
    });
    return t;
  });
}
const canonical = (l: {
  materialCost: Decimal.Value;
  laborCost: Decimal.Value;
  subcontractorCost: Decimal.Value;
  otherDirectCost: Decimal.Value;
  overheadAllocation: Decimal.Value;
  targetMargin: Decimal.Value;
  minimumMargin: Decimal.Value;
  unit: LineInput["unit"];
}) => ({
  materialCost: l.materialCost.toString(),
  laborCost: l.laborCost.toString(),
  subcontractorCost: l.subcontractorCost.toString(),
  otherDirectCost: l.otherDirectCost.toString(),
  overheadAllocation: l.overheadAllocation.toString(),
  targetMargin: l.targetMargin.toString(),
  minimumMargin: l.minimumMargin.toString(),
  unit: l.unit,
});
async function resolveLines(
  tx: TX,
  data: DraftInput,
  existing?: FullEstimate | null,
) {
  const now = new Date();
  const previous = new Map(
    existing?.sections.flatMap((s) => s.lines).map((l) => [l.id, l]),
  );
  const sections = [];
  for (const section of data.sections) {
    const lines = [];
    for (const line of section.lines) {
      let resolved = line;
      if (line.serviceItemId) {
        const snapshot = line.snapshotId ? previous.get(line.snapshotId) : null;
        if (snapshot && snapshot.serviceItemId === line.serviceItemId)
          resolved = { ...line, ...canonical(snapshot) };
        else {
          const item = await tx.serviceItem.findFirst({
            where: {
              id: line.serviceItemId,
              active: true,
              effectiveFrom: { lte: now },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
            },
          });
          if (!item) throw new Error("Catalog item is not currently effective");
          resolved = { ...line, ...canonical(item) };
        }
      }
      lines.push(resolved);
    }
    sections.push({ ...section, lines });
  }
  return sections;
}
export async function saveDraft(u: User, input: unknown) {
  crm(u);
  const data = draftInput.parse(input);
  return db.$transaction(
    async (tx) => {
      const existing = data.id ? await getEstimate(tx, u, data.id) : null;
      if (
        existing &&
        (existing.status !== "DRAFT" ||
          existing.contentVersion !== data.contentVersion)
      )
        throw new Error(
          "This draft changed or is frozen; reload before editing",
        );
      if (
        existing &&
        (existing.customerId !== data.customerId ||
          existing.opportunityId !== (data.opportunityId || null))
      )
        throw new Error("Use duplicate for a different customer/opportunity");
      const customer = await tx.customer.findFirst({
        where: { id: data.customerId, ...customerScope(u) },
      });
      if (!customer) throw new Error("Customer unavailable");
      const opportunity = data.opportunityId
        ? await tx.opportunity.findFirst({
            where: { id: data.opportunityId, ...opportunityScope(u) },
          })
        : null;
      if (
        data.opportunityId &&
        (!opportunity || opportunity.customerId !== customer.id)
      )
        throw new Error("Opportunity and customer must match");
      const settings = await tx.estimatorSettings.findUnique({
        where: { id: "company" },
      });
      const sections = await resolveLines(tx, data, existing);
      const policy = existing
        ? parsePolicy(existing.financialPolicySnapshot)
        : await activePolicy(tx);
      if (policy)
        for (const section of sections)
          section.lines = section.lines.map((line) => policyLine(line, policy));
      const totals = calculateEstimate(
        sections.flatMap((s) => s.lines),
        data.discountRate,
        data.taxRate,
        data.taxTreatment,
        policy?.significantDiscountThreshold ??
          settings?.significantDiscountThreshold.toString() ??
          "0",
      );
      if (
        data.paymentSchedule.length &&
        !data.paymentSchedule
          .reduce((a, p) => a.plus(p.percentage), new Decimal(0))
          .eq(1)
      )
        throw new Error("Payment milestone percentages must sum to 100%");
      if (policy) {
        totals.allocatedOverhead = projectOverhead(totals.sellingPrice, policy);
        totals.contributionProfit = new Decimal(totals.grossProfit)
          .minus(totals.allocatedOverhead)
          .toFixed(2);
      }
      const patch = {
        financialPolicySnapshot: json(policy ?? {}),
        customerId: customer.id,
        opportunityId: opportunity?.id ?? null,
        category: data.category,
        projectAddress: data.projectAddress,
        scope: data.scope,
        notes: data.notes,
        inclusions: data.inclusions,
        exclusions: data.exclusions,
        durationDays: data.durationDays,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        paymentSchedule: json(data.paymentSchedule),
        discountRate: data.discountRate,
        taxRate: data.taxRate,
        taxTreatment: data.taxTreatment,
        significantDiscountThreshold:
          policy?.significantDiscountThreshold ??
          settings?.significantDiscountThreshold ??
          "0",
        discountAmount: totals.discountAmount,
        directCost: totals.directCost,
        sellingPrice: totals.sellingPrice,
        grossProfit: totals.grossProfit,
        grossMargin: totals.grossMargin ?? "0",
        taxAmount: totals.taxAmount,
        totalInvestment: totals.totalInvestment,
        allocatedOverhead: totals.allocatedOverhead,
        contributionProfit: totals.contributionProfit,
        approvalReasons: json(totals.reasons),
        customerSnapshot: json({
          name: `${customer.firstName} ${customer.lastName}`,
          email: customer.email,
          phone: customer.phone,
        }),
        businessSnapshot: json({
          companyName: settings?.companyName ?? "Flipas Home Remodeling",
          contactInfo: settings?.contactInfo ?? "",
          brandingColor: settings?.brandingColor ?? "#172b30",
          terms: settings?.terms ?? "",
        }),
      };
      let estimate;
      if (existing) {
        if (
          !canManage(u.role) &&
          (existing.taxTreatment !== data.taxTreatment ||
            !existing.taxRate.eq(data.taxRate))
        )
          throw new Error("Owner/Admin must review tax treatment");
        await tx.estimateLineItem.deleteMany({
          where: { section: { estimateId: existing.id } },
        });
        await tx.estimateSection.deleteMany({
          where: { estimateId: existing.id },
        });
        estimate = await tx.estimate.update({
          where: { id: existing.id },
          data: { ...patch, contentVersion: { increment: 1 } },
        });
      } else {
        if (!canManage(u.role) && data.taxTreatment !== "UNREVIEWED")
          throw new Error("Owner/Admin must review taxes");
        const counter = await tx.estimateCounter.upsert({
          where: { id: "estimates" },
          create: { id: "estimates", value: 1 },
          update: { value: { increment: 1 } },
        });
        const number = `F-${new Date().getUTCFullYear()}-${String(counter.value).padStart(6, "0")}-R1`;
        estimate = await tx.estimate.create({
          data: {
            ...patch,
            number,
            seriesId: randomUUID(),
            creatorId: u.id,
            contentVersion: 1,
          },
        });
      }
      let cursor = 0;
      for (const [position, sec] of sections.entries()) {
        const section = await tx.estimateSection.create({
          data: { estimateId: estimate.id, name: sec.name, position },
        });
        for (const [index, line] of sec.lines.entries()) {
          const calc = totals.lines[cursor++];
          await tx.estimateLineItem.create({
            data: {
              sectionId: section.id,
              serviceItemId: line.serviceItemId || null,
              name: line.name,
              description: line.description,
              position: index,
              quantity: line.quantity,
              ...canonical(line),
              markup: "0",
              unitCost: calc.unitCost,
              totalCost: calc.totalCost,
              allocatedOverhead: calc.allocatedOverhead,
              calculatedUnitPrice: calc.calculatedUnitPrice,
              unitPrice: calc.unitPrice,
              calculatedPrice: calc.calculatedPrice,
              sellingPrice: calc.sellingPrice,
              taxable: line.taxable,
              overrideReason: calc.manualOverride ? line.overrideReason : null,
              overriddenById: calc.manualOverride ? u.id : null,
            },
          });
        }
      }
      await audit(tx, u, estimate, "ESTIMATE_DRAFT_SAVED", {
        contentVersion: estimate.contentVersion,
        totals,
        sections,
      });
      return estimate.id;
    },
    { isolationLevel: "Serializable", timeout: 20000 },
  );
}
export function toDraft(e: FullEstimate): DraftInput {
  return {
    id: e.id,
    contentVersion: e.contentVersion,
    customerId: e.customerId,
    opportunityId: e.opportunityId ?? "",
    category: e.category,
    projectAddress: e.projectAddress,
    scope: e.scope,
    notes: e.notes,
    inclusions: e.inclusions,
    exclusions: e.exclusions,
    durationDays: e.durationDays,
    expiresAt: e.expiresAt?.toISOString().slice(0, 10) ?? "",
    paymentSchedule: e.paymentSchedule as DraftInput["paymentSchedule"],
    discountRate: e.discountRate.toString(),
    taxRate: e.taxRate.toString(),
    taxTreatment: e.taxTreatment as DraftInput["taxTreatment"],
    sections: e.sections.map((s) => ({
      name: s.name,
      lines: s.lines.map((l) => ({
        snapshotId: l.id,
        serviceItemId: l.serviceItemId ?? "",
        name: l.name,
        description: l.description,
        quantity: l.quantity.toString(),
        ...canonical(l),
        overrideUnitPrice: l.overrideReason ? l.unitPrice.toString() : "",
        overrideReason: l.overrideReason ?? "",
        taxable: l.taxable,
      })),
    })),
  };
}
export async function copyEstimate(
  u: User,
  id: string,
  revision: boolean,
  selectedOpportunityId?: string,
) {
  crm(u);
  await readEstimate(u, id);
  // Clone snapshots first, including custom costs; no catalog refresh during revisions.
  return db.$transaction(
    async (tx) => {
      const source = await getEstimate(tx, u, id);
      if (selectedOpportunityId) {
        const current = await tx.user.findUnique({
          where: { id: u.id },
          select: { active: true, role: true },
        });
        if (
          !current?.active ||
          current.role !== "OWNER" ||
          revision ||
          source.status !== "ACCEPTED"
        )
          throw new Error("OWNER accepted-estimate draft-copy required");
        const selected = await tx.opportunity.findFirst({
          where: {
            id: selectedOpportunityId,
            customerId: source.customerId,
            stage: "WON",
            project: null,
          },
          select: { id: true },
        });
        if (!selected)
          throw new Error(
            "Selected opportunity is not eligible: require exact same customer ID, WON and no existing project",
          );
      }
      if (source.status === "DRAFT" && revision)
        throw new Error("Save/submit this draft before revising");
      const latest = await tx.estimate.findFirst({
        where: { seriesId: source.seriesId },
        orderBy: { revision: "desc" },
      });
      if (
        revision &&
        (await tx.estimate.findFirst({
          where: { seriesId: source.seriesId, status: "DRAFT" },
        }))
      )
        throw new Error("An editable revision already exists");
      const counter = revision
        ? null
        : await tx.estimateCounter.upsert({
            where: { id: "estimates" },
            create: { id: "estimates", value: 1 },
            update: { value: { increment: 1 } },
          });
      const nextRevision = revision ? (latest?.revision ?? 0) + 1 : 1;
      const {
        id: omitId,
        createdAt: omitCreated,
        updatedAt: omitUpdated,
        sections: omitSections,
        customer: omitCustomer,
        opportunity: omitOpportunity,
        approvals: omitApprovals,
        ...fields
      } = source;
      void omitId;
      void omitCreated;
      void omitUpdated;
      void omitSections;
      void omitCustomer;
      void omitOpportunity;
      void omitApprovals;
      const base = revision
        ? (source.number ?? source.id).replace(/-R\d+$/, "")
        : `F-${new Date().getUTCFullYear()}-${String(counter!.value).padStart(6, "0")}`;
      const clone = await tx.estimate.create({
        data: {
          ...fields,
          ...(selectedOpportunityId
            ? { opportunityId: selectedOpportunityId }
            : {}),
          paymentSchedule: json(fields.paymentSchedule),
          customerSnapshot: json(fields.customerSnapshot),
          businessSnapshot: json(fields.businessSnapshot),
          approvalReasons: json(fields.approvalReasons),
          financialPolicySnapshot: json(fields.financialPolicySnapshot),
          number: `${base}-R${nextRevision}`,
          seriesId: revision ? source.seriesId : randomUUID(),
          revision: nextRevision,
          status: "DRAFT",
          contentVersion: 1,
          creatorId: u.id,
          acceptedAt: null,
          acceptanceReference: null,
          taxTreatment: canManage(u.role) ? source.taxTreatment : "UNREVIEWED",
        },
      });
      for (const section of source.sections) {
        const sec = await tx.estimateSection.create({
          data: {
            estimateId: clone.id,
            name: section.name,
            position: section.position,
          },
        });
        for (const l of section.lines) {
          const { id, createdAt, updatedAt, sectionId, ...line } = l;
          void id;
          void createdAt;
          void updatedAt;
          void sectionId;
          await tx.estimateLineItem.create({
            data: { ...line, sectionId: sec.id },
          });
        }
      }
      await audit(
        tx,
        u,
        clone,
        revision ? "ESTIMATE_REVISION_CREATED" : "ESTIMATE_DUPLICATED",
        {
          sourceId: id,
          ...(selectedOpportunityId
            ? { selectedOpportunityId, approvalRequired: true }
            : {}),
        },
      );
      return clone.id;
    },
    { isolationLevel: "Serializable", timeout: 20000 },
  );
}
export async function submitEstimate(
  u: User,
  id: string,
  contentVersion: number,
) {
  crm(u);
  return db.$transaction(
    async (tx) => {
      const e = await getEstimate(tx, u, id);
      if (e.status !== "DRAFT" || e.contentVersion !== contentVersion)
        throw new Error("Draft changed; reload");
      if (!e.sections.some((s) => s.lines.length))
        throw new Error("Add at least one priced item");
      await tx.estimateApproval.create({
        data: {
          estimateId: id,
          contentVersion: e.contentVersion,
          requesterId: u.id,
          reasons: e.approvalReasons as Prisma.InputJsonValue,
        },
      });
      await tx.estimate.update({ where: { id }, data: { status: "REVIEW" } });
      await audit(tx, u, e, "ESTIMATE_SUBMITTED", { contentVersion });
    },
    { isolationLevel: "Serializable" },
  );
}
export async function decideEstimate(
  u: User,
  id: string,
  approve: boolean,
  rationale: string,
) {
  admin(u);
  if (!rationale.trim() || rationale.length > 2000)
    throw new Error("Provide a review rationale");
  return db.$transaction(
    async (tx) => {
      const e = await getEstimate(tx, u, id);
      if (e.status !== "REVIEW")
        throw new Error("Estimate is not awaiting review");
      const request = e.approvals.find(
        (a) => a.status === "PENDING" && a.contentVersion === e.contentVersion,
      );
      if (!request) throw new Error("Review request missing");
      if (approve) {
        if (e.taxTreatment === "UNREVIEWED")
          throw new Error(
            "Reject to draft and review tax treatment before approval",
          );
        if (e.totalInvestment.lte(0))
          throw new Error(
            "A released proposal must have a positive investment",
          );
        const business = e.businessSnapshot as {
          contactInfo?: string;
          terms?: string;
        };
        if (
          !business.contactInfo?.trim() ||
          !business.terms?.trim() ||
          !e.projectAddress.trim() ||
          !e.scope.trim() ||
          !e.expiresAt ||
          !e.paymentSchedule ||
          !(e.paymentSchedule as unknown[]).length
        )
          throw new Error(
            "Complete company contact, reviewed terms, address, scope, expiry and payment milestones before approval",
          );
        if (e.expiresAt <= new Date())
          throw new Error("Expiration must be in the future");
      }
      await tx.estimateApproval.update({
        where: { id: request.id },
        data: {
          status: approve ? "APPROVED" : "REJECTED",
          reviewerId: u.id,
          rationale,
          decidedAt: new Date(),
        },
      });
      await tx.estimate.update({
        where: { id },
        data: { status: approve ? "APPROVED" : "DRAFT" },
      });
      await audit(
        tx,
        u,
        e,
        approve ? "ESTIMATE_APPROVED" : "ESTIMATE_REJECTED",
        { requestId: request.id, reasons: request.reasons, rationale },
      );
    },
    { isolationLevel: "Serializable" },
  );
}
export async function transitionEstimate(
  u: User,
  id: string,
  action: "release" | "accept",
  reference: string,
) {
  admin(u);
  return db.$transaction(
    async (tx) => {
      const e = await getEstimate(tx, u, id);
      if (action === "release") {
        if (
          e.status !== "APPROVED" ||
          !e.approvals.some(
            (a) =>
              a.status === "APPROVED" && a.contentVersion === e.contentVersion,
          )
        )
          throw new Error("Exact revision needs approval");
        if (!e.expiresAt || e.expiresAt <= new Date())
          throw new Error("Proposal expired");
        await tx.estimate.update({ where: { id }, data: { status: "SENT" } });
      } else {
        if (e.status !== "SENT" || !reference.trim() || reference.length > 2000)
          throw new Error(
            "Provide evidence of customer acceptance for a released proposal",
          );
        if (!e.expiresAt || e.expiresAt <= new Date())
          throw new Error("Proposal expired; create a revision");
        await tx.estimate.update({
          where: { id },
          data: {
            status: "ACCEPTED",
            acceptedAt: new Date(),
            acceptanceReference: reference,
          },
        });
      }
      await audit(
        tx,
        u,
        e,
        action === "release"
          ? "ESTIMATE_MANUALLY_RELEASED"
          : "ESTIMATE_ACCEPTED",
        { reference, delivery: "No automatic customer delivery" },
      );
    },
    { isolationLevel: "Serializable" },
  );
}
export async function handoffProject(u: User, id: string) {
  admin(u);
  try {
    return await db.$transaction(
      async (tx) => {
        const e = await getEstimate(tx, u, id);
        const diagnostic = handoffDiagnostic(e);
        if (diagnostic.code !== "READY")
          throw new Error(`${diagnostic.code}: ${diagnostic.message}`);
        const existing = await tx.project.findUnique({
          where: { opportunityId: e.opportunityId! },
        });
        if (existing) {
          if (existing.estimateId !== e.id)
            throw new Error(
              "Project already linked to another accepted revision",
            );
          return existing.id;
        }
        const project = await tx.project.create({
          data: {
            customerId: e.customerId,
            opportunityId: e.opportunityId!,
            estimateId: e.id,
            originalScopeSnapshot: {
              scope: e.scope,
              inclusions: e.inclusions,
              exclusions: e.exclusions,
              estimateId: e.id,
              contentVersion: e.contentVersion,
            },
            projectAddress: e.projectAddress,
            contractValue: e.sellingPrice,
            estimatedCost: e.directCost,
            actualCost: "0",
            estimatedGrossProfit: e.grossProfit,
            actualGrossProfit: "0",
          },
        });
        await audit(tx, u, e, "PROJECT_HANDOFF_CREATED", {
          projectId: project.id,
          totalInvestment: e.totalInvestment.toString(),
          allocatedOverhead: e.allocatedOverhead.toString(),
        });
        return project.id;
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2002", "P2034"].includes(error.code)
    ) {
      const e = await readEstimate(u, id);
      const project = await db.project.findUnique({
        where: { opportunityId: e.opportunityId ?? "" },
      });
      if (project?.estimateId === id) return project.id;
    }
    throw error;
  }
}
