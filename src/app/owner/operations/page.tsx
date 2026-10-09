import Link from "next/link";
import { requireOwner } from "@/owner/auth";
import { db } from "@/server/db";
import { projectList } from "@/project-operations/server/view";
export default async function Page() {
  const u = await requireOwner(),
    rows = await projectList(u),
    open = {
      project: {
        status: {
          notIn: ["COMPLETED", "CANCELLED"] as ("COMPLETED" | "CANCELLED")[],
        },
      },
    };
  const [critical, materials, changes, crews] = await Promise.all([
    db.projectTask.count({
      where: { ...open, priority: "CRITICAL", completedAt: null },
    }),
    db.projectMaterial.count({ where: { ...open, status:{in:["NEEDED","PARTIAL"]} } }),
    db.projectChangeOrder.count({ where: { ...open, status: "DRAFT" } }),
    db.projectMember.count({ where: { ...open, active: true } }),
  ]);
  const budgetRows = await db.project.findMany({
    where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
    select: {
      id: true,
      actualCost: true,
      estimatedCost: true,
      operationsProjectCostEntry: {
        where: { kind: "ACTUAL" },
        select: { amount: true },
      },
      operationsProjectChangeOrder: {
        where: { status: "APPLIED" },
        select: { costDelta: true },
      },
    },
  });
  const deviations = budgetRows.filter((p) =>
    p.operationsProjectCostEntry
      .reduce((sum, c) => sum.add(c.amount), p.actualCost)
      .greaterThan(
        p.operationsProjectChangeOrder.reduce(
          (sum, c) => sum.add(c.costDelta),
          p.estimatedCost,
        ),
      ),
  ).length;
  return (
    <>
      <h1>OWNER · Operations dashboard</h1>
      <div className="operations-grid">
        {[
          [
            "Active projects",
            rows.filter((p) => !["COMPLETED", "CANCELLED"].includes(p.state))
              .length,
          ],
          ["Delayed projects", rows.filter((p) => p.delayed).length],
          ["Critical tasks", critical],
          ["Pending materials", materials],
          ["Pending change orders", changes],
          ["Crew assignments", crews],
          ["Recorded cost overruns", deviations],
        ].map(([name, value]) => (
          <article className="panel" key={name}>
            <h2>{name}</h2>
            <strong>{value}</strong>
          </article>
        ))}
      </div>
      <p>
        Financial results remain provisional until OWNER reconciliation. Open a
        project to review recorded commitments, actual costs and approved
        changes.
      </p>
      {rows.map((p) => (
        <p key={p.id}>
          <Link href={`/projects/${p.id}`}>
            {p.customer.firstName} {p.customer.lastName}
          </Link>{" "}
          · {p.state} {p.delayed && "· DELAYED"}
        </p>
      ))}
    </>
  );
}
