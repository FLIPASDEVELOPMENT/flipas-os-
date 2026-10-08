import { User } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { readEstimate } from "./service";
import { scopeTemplates } from "../domain/templates";
// Internal, authenticated, read-only context. No provider or mutation capability is exposed.
export async function estimatorAnalysisContext(user: User, estimateId: string) {
  const estimate = await readEstimate(user, estimateId);
  const previousJobs = await db.project.findMany({
    where: { customerId: estimate.customerId },
    take: 20,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      contractValue: true,
      estimatedCost: true,
      actualCost: true,
      status: true,
    },
  });
  return {
    estimateId,
    contentVersion: estimate.contentVersion,
    category: estimate.category,
    requirements: {
      scope: estimate.scope,
      address: estimate.projectAddress,
      inclusions: estimate.inclusions,
      exclusions: estimate.exclusions,
    },
    sections: estimate.sections.map((s) => ({
      name: s.name,
      items: s.lines.map((l) => ({
        name: l.name,
        description: l.description,
        quantity: l.quantity.toString(),
        unit: l.unit,
        directCost: l.totalCost.toString(),
        sellingPrice: l.sellingPrice.toString(),
        minimumMargin: l.minimumMargin.toString(),
      })),
    })),
    profitability: {
      margin: estimate.grossMargin.toString(),
      flags: estimate.approvalReasons,
    },
    templateChecklists: scopeTemplates,
    historicalJobs: previousJobs.map((p) => ({
      ...p,
      contractValue: p.contractValue.toString(),
      estimatedCost: p.estimatedCost.toString(),
      actualCost: p.actualCost.toString(),
      actualCostsFinal: false,
    })),
    followUpQuestions: [
      !estimate.scope && "What is the complete scope?",
      !estimate.projectAddress && "What is the project address?",
      !estimate.durationDays && "What is the expected duration?",
      estimate.taxTreatment === "UNREVIEWED" &&
        "Has the owner reviewed tax treatment?",
    ].filter(Boolean),
    authority:
      "READ_ONLY; suggestions require human review; no pricing, approval or delivery tools",
  };
}
