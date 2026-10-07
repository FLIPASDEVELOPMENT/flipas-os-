import Link from "next/link";
import { requireCRM } from "@/server/auth";
import { db } from "@/server/db";
import { customerScope } from "@/server/crm";
export default async function Projects() {
  const u = await requireCRM();
  const projects = await db.project.findMany({
    where: { customer: customerScope(u) },
    include: { customer: true, estimate: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return (
    <>
      <h1>Initial project handoffs</h1>
      <p className="muted">
        Created from an accepted estimate and WON opportunity. Full project
        management is reserved for a later phase.
      </p>
      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Accepted estimate</th>
              <th>Contract net of tax</th>
              <th>Estimated direct cost</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.customer.firstName} {p.customer.lastName}
                </td>
                <td>
                  <Link href={`/estimates/${p.estimateId}`}>
                    {p.estimate.number ?? p.estimateId}
                  </Link>
                </td>
                <td>${p.contractValue.toFixed(2)}</td>
                <td>${p.estimatedCost.toFixed(2)}</td>
                <td>{p.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!projects.length && (
          <p className="empty">No controlled project handoffs yet.</p>
        )}
      </section>
    </>
  );
}
