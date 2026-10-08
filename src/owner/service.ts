import { businessMonthStart } from "./calendar";
import { User, Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { financialPolicyInput, isOwner, policySnapshot } from "./policy";
export function assertOwner(user: { role: string; active: boolean }) {
  if (!isOwner(user)) throw new Error("OWNER access required");
}
export async function activePolicy(tx: Prisma.TransactionClient = db) {
  const head = await tx.financialPolicyHead.findUniqueOrThrow({
    where: { id: "company" },
    include: { policy: true },
  });
  return policySnapshot(head.policy);
}
export async function saveFinancialPolicy(user: User, input: unknown) {
  assertOwner(user);
  const data = financialPolicyInput.parse(input);
  return db.$transaction(
    async (tx) => {
      const current = await activePolicy(tx);
      if (current.version !== data.expectedVersion)
        throw new Error("Policy changed; reload before saving");
      const { expectedVersion, ...fields } = data;
      const policy = await tx.financialPolicy.create({
        data: { ...fields, version: expectedVersion + 1, createdById: user.id },
      });
      await tx.financialPolicyHead.update({
        where: { id: "company" },
        data: { policyId: policy.id },
      });
      await tx.activity.create({
        data: {
          actorId: user.id,
          type: "FINANCIAL_POLICY_CHANGED",
          message: `Owner activated financial policy version ${policy.version}`,
          metadata: {
            before: current,
            after: policySnapshot(policy),
            reason: data.reason,
          },
        },
      });
      return policy;
    },
    { isolationLevel: "Serializable" },
  );
}
export async function ownerSummary(user: User) {
  assertOwner(user);
  const now = new Date();
  const start = businessMonthStart(now);
  const [policy, customers, leads, pipeline, projects, accepted, pending] =
    await Promise.all([
      activePolicy(),
      db.customer.count(),
      db.lead.count({
        where: { status: { notIn: ["UNQUALIFIED", "CONVERTED"] } },
      }),
      db.opportunity.aggregate({
        where: { stage: { notIn: ["WON", "LOST"] } },
        _sum: { estimatedValue: true },
        _count: true,
      }),
      db.project.findMany({
        include: {
          customer: true,
          estimate: {
            select: {
              number: true,
              allocatedOverhead: true,
              financialPolicySnapshot: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      db.estimate.aggregate({
        where: { status: "ACCEPTED", acceptedAt: { gte: start } },
        _sum: { sellingPrice: true },
        _count: true,
      }),
      db.estimateApproval.count({ where: { status: "PENDING" } }),
    ]);
  return {
    policy,
    customers,
    leads,
    pipelineValue: pipeline._sum.estimatedValue?.toString() ?? "0",
    opportunities: pipeline._count,
    projects,
    monthlyAcceptedContractValue: accepted._sum.sellingPrice?.toString() ?? "0",
    pending,
  };
}
