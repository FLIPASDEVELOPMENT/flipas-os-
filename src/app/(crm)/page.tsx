import Link from "next/link";
import { db } from "@/server/db";
import { requireCRM } from "@/server/auth";
import { leadScope, opportunityScope, customerScope } from "@/server/crm";
export default async function Dashboard() {
  const u = await requireCRM();
  const [leads, pipeline, estimates, projects, hot, tasks, activities] =
    await Promise.all([
      db.lead.count({
        where: {
          ...leadScope(u),
          status: { in: ["NEW", "CONTACTED", "QUALIFIED"] },
        },
      }),
      db.opportunity.aggregate({
        where: { ...opportunityScope(u), stage: { notIn: ["WON", "LOST"] } },
        _sum: { estimatedValue: true },
      }),
      db.estimate.count({
        where: {
          customer: customerScope(u),
          status: { in: ["DRAFT", "SENT"] },
        },
      }),
      db.project.count({
        where: {
          customer: customerScope(u),
          status: { notIn: ["COMPLETED", "CANCELLED"] },
        },
      }),
      db.lead.findMany({
        where: {
          ...leadScope(u),
          leadScore: { gte: 70 },
          status: { notIn: ["UNQUALIFIED", "CONVERTED"] },
        },
        include: { customer: true },
        orderBy: { leadScore: "desc" },
        take: 6,
      }),
      db.opportunity.findMany({
        where: {
          ...opportunityScope(u),
          stage: { notIn: ["WON", "LOST"] },
          nextActionDate: { lte: new Date() },
        },
        include: { customer: true },
        take: 8,
        orderBy: { nextActionDate: "asc" },
      }),
      db.activity.findMany({
        where: { customer: customerScope(u) },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
    ]);
  return (
    <>
      <p className="eyebrow">Your business at a glance</p>
      <h1>Operations overview</h1>
      <p className="muted">One connected view of your remodeling pipeline.</p>
      <div className="cards">
        {[
          ["Active leads", leads],
          [
            "Pipeline value",
            `$${pipeline._sum.estimatedValue?.toFixed(2) ?? "0.00"}`,
          ],
          ["Open estimates", estimates],
          ["Active projects", projects],
        ].map(([label, value]) => (
          <section className="panel" key={label}>
            <span className="muted">{label}</span>
            <div className="metric">{value}</div>
          </section>
        ))}
      </div>
      <div className="columns">
        <section className="panel">
          <h2>Hot leads</h2>
          {hot.map((l) => (
            <Link className="row" key={l.id} href={`/leads/${l.id}`}>
              <span>
                {l.customer.firstName} {l.customer.lastName}
                <br />
                <small className="muted">{l.serviceType}</small>
              </span>
              <span className="badge">Score {l.leadScore}</span>
            </Link>
          ))}
          {!hot.length && (
            <p className="empty">No leads with a score of 70 or higher.</p>
          )}
        </section>
        <section className="panel">
          <h2>Tasks requiring attention</h2>
          {tasks.map((o) => (
            <Link className="row" href="/pipeline" key={o.id}>
              <span>
                {o.customer.firstName} {o.customer.lastName}
                <br />
                {o.nextAction}
              </span>
              <span className="muted">
                {o.nextActionDate?.toISOString().slice(0, 10)}
              </span>
            </Link>
          ))}
          {!tasks.length && (
            <p className="empty">No overdue opportunity actions.</p>
          )}
        </section>
        <section className="panel">
          <h2>Recent activity</h2>
          {activities.map((a) => (
            <div className="row" key={a.id}>
              <span>{a.message}</span>
              <small className="muted">
                {a.createdAt.toISOString().slice(0, 16)} UTC
              </small>
            </div>
          ))}
          {!activities.length && (
            <p className="empty">Activity will appear as your team works.</p>
          )}
        </section>
        <section className="panel">
          <h2>AI recommendations</h2>
          <p className="empty">
            Agents are not enabled. Provider integration and approvals are
            planned for Phase 2.
          </p>
        </section>
      </div>
    </>
  );
}
