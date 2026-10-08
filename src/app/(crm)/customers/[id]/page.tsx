import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCRM } from "@/server/auth";
import { conversationScope } from "@/sales-ai/server/access";
import { db } from "@/server/db";
import { customerScope, leadScope, opportunityScope } from "@/server/crm";
export default async function Customer({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const u = await requireCRM();
  const { id } = await params;
  const c = await db.customer.findFirst({
    where: { id, ...customerScope(u) },
    include: {
      leads: { where: leadScope(u) },
      opportunities: { where: opportunityScope(u) },
      activities: {
        where:
          u.role === "SALES"
            ? {
                OR: [
                  { lead: { assignedToId: u.id } },
                  { opportunity: { ownerId: u.id } },
                ],
              }
            : {},
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });
  if (!c) notFound();
  const mail = await db.mailConversation.findMany({
    where: { customerId: c.id, ...conversationScope(u) },
    select: { id: true, subject: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });
  return (
    <>
      <p className="eyebrow">Customer record</p>
      <h1>
        {c.firstName} {c.lastName}
      </h1>
      <div className="columns">
        <section className="panel">
          <h2>Contact information</h2>
          <p>
            {c.email ?? "No email"}
            <br />
            {c.phone ?? "No phone"}
          </p>
          <p>
            {c.address}
            <br />
            {c.city}, {c.state} {c.zip}
          </p>
          <p>{c.notes}</p>
        </section>
        <section className="panel">
          <h2>Connected records</h2>
          {c.leads.map((l) => (
            <Link className="row" href={`/leads/${l.id}`} key={l.id}>
              {l.serviceType}
              <span className="badge">{l.status}</span>
            </Link>
          ))}
          {c.opportunities.map((o) => (
            <Link className="row" href="/pipeline" key={o.id}>
              Opportunity<span className="badge">{o.stage}</span>
            </Link>
          ))}
          <p className="muted">
            Estimate and project workflows arrive in Phase 2.
          </p>
        </section>
      </div>
      <section className="panel">
        <h2>Customer email history</h2>
        {mail.length === 0 && (
          <p className="muted">No linked email conversations.</p>
        )}
        {mail.map((m) => (
          <Link className="row" key={m.id} href={"/ai/inbox/" + m.id}>
            <span>{m.subject}</span>
            <small>{m.updatedAt.toISOString()}</small>
          </Link>
        ))}
      </section>
      <section className="panel">
        <h2>Activity</h2>
        {c.activities.map((a) => (
          <div className="row" key={a.id}>
            <span>{a.message}</span>
            <small>{a.createdAt.toISOString()} UTC</small>
          </div>
        ))}
      </section>
    </>
  );
}
