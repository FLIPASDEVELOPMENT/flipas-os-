import Link from "next/link";
import { db } from "@/server/db";
import { requireCRM } from "@/server/auth";
import { leadScope, customerScope } from "@/server/crm";
import { LeadForm } from "@/components/lead-form";
export default async function Leads() {
  const u = await requireCRM();
  const [leads, customers, users] = await Promise.all([
    db.lead.findMany({
      where: leadScope(u),
      include: { customer: true, assignedTo: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.customer.findMany({
      where: customerScope(u),
      orderBy: { firstName: "asc" },
    }),
    db.user.findMany({
      where:
        u.role === "SALES"
          ? { id: u.id }
          : { active: true, role: { in: ["OWNER", "ADMIN", "SALES"] } },
      select: { id: true, name: true },
    }),
  ]);
  return (
    <>
      <h1>Leads</h1>
      <p className="muted">
        Turn every remodeling inquiry into a clear next step. Latest 200
        records.
      </p>
      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>Customer / service</th>
              <th>Source</th>
              <th>Status</th>
              <th>Score</th>
              <th>Salesperson</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td>
                  <Link href={`/leads/${l.id}`}>
                    {l.customer.firstName} {l.customer.lastName}
                    <br />
                    <small className="muted">{l.serviceType}</small>
                  </Link>
                </td>
                <td>{l.source}</td>
                <td>
                  <span className="badge">{l.status}</span>
                </td>
                <td>{l.leadScore}</td>
                <td>{l.assignedTo?.name ?? "Unassigned"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!leads.length && <p className="empty">No leads yet.</p>}
      </section>
      <section className="panel">
        <h2>Create lead</h2>
        {customers.length ? (
          <LeadForm customers={customers} users={users} />
        ) : (
          <p>
            Add a customer first in <Link href="/customers">Customers</Link>.
          </p>
        )}
      </section>
    </>
  );
}
