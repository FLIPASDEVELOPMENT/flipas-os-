import Link from "next/link";
import { requireCRM } from "@/server/auth";
import { db } from "@/server/db";
import { estimateScope } from "@/estimator/server/service";
import EstimatorNav from "@/estimator/components/nav";
export default async function Estimates() {
  const user = await requireCRM();
  const rows = await db.estimate.findMany({
    where: estimateScope(user),
    include: { customer: true },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return (
    <>
      <p className="eyebrow">FLIPAS ESTIMATOR</p>
      <h1>Estimates & proposals</h1>
      <p className="muted">
        Connected scope, controlled pricing and a clear approval trail. Latest
        200 versions.
      </p>
      <EstimatorNav />
      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>Estimate / revision</th>
              <th>Customer</th>
              <th>Stage</th>
              <th>Investment</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link href={`/estimates/${e.id}`}>
                    {e.number ?? "Legacy draft"}
                    <br />
                    Revision {e.revision}
                  </Link>
                </td>
                <td>
                  {e.customer.firstName} {e.customer.lastName}
                </td>
                <td>
                  <span className="badge">{e.status}</span>
                </td>
                <td>${e.totalInvestment.toFixed(2)}</td>
                <td>{e.updatedAt.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="empty">
            No estimates yet. Configure your catalog or create a draft from a
            scope checklist.
          </p>
        )}
      </section>
    </>
  );
}
