import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { requireCRM } from "@/server/auth";
import { leadScope } from "@/server/crm";
import { LeadForm } from "@/components/lead-form";
import { addNote, createOpportunity } from "@/app/actions";
export default async function Detail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const u = await requireCRM();
  const { id } = await params;
  const lead = await db.lead.findFirst({
    where: { id, ...leadScope(u) },
    include: {
      customer: true,
      opportunity: true,
      activities: {
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { name: true } } },
        take: 100,
      },
    },
  });
  if (!lead) notFound();
  const users = await db.user.findMany({
    where:
      u.role === "SALES"
        ? { id: u.id }
        : { active: true, role: { in: ["OWNER", "ADMIN", "SALES"] } },
    select: { id: true, name: true },
  });
  return (
    <>
      <p className="eyebrow">Lead workspace</p>
      <h1>
        {lead.customer.firstName} {lead.customer.lastName}
      </h1>
      <p className="muted">
        {lead.serviceType} · Score {lead.leadScore}
      </p>
      <section className="panel">
        <h2>Lead details</h2>
        <LeadForm customers={[lead.customer]} users={users} lead={lead} />
      </section>
      {
        <section className="panel">
          <h2>
            {lead.opportunity ? "Opportunity details" : "Create opportunity"}
          </h2>
          <form className="form" action={createOpportunity}>
            <input type="hidden" name="leadId" value={id} />
            <input type="hidden" name="id" value={lead.opportunity?.id ?? ""} />
            <label>
              Estimated value (USD)
              <input
                defaultValue={lead.opportunity?.estimatedValue?.toString()}
                name="estimatedValue"
                type="number"
                step="0.01"
                min="0"
              />
            </label>
            <label>
              Probability (%)
              <input
                name="probability"
                type="number"
                min="0"
                max="100"
                defaultValue={lead.opportunity?.probability ?? 0}
              />
            </label>
            <label>
              Next action
              <input
                defaultValue={lead.opportunity?.nextAction ?? ""}
                name="nextAction"
                maxLength={2000}
              />
            </label>
            <label>
              Next action date
              <input
                defaultValue={lead.opportunity?.nextActionDate
                  ?.toISOString()
                  .slice(0, 10)}
                name="nextActionDate"
                type="date"
              />
            </label>
            <button>
              {lead.opportunity ? "Save opportunity" : "Create opportunity"}
            </button>
          </form>
        </section>
      }
      <div className="columns">
        <section className="panel">
          <h2>Add a note</h2>
          <form action={addNote}>
            <input type="hidden" name="leadId" value={id} />
            <input type="hidden" name="id" value={lead.opportunity?.id ?? ""} />
            <label>
              Note
              <textarea name="message" required maxLength={2000} />
            </label>
            <p>
              <button>Save note</button>
            </p>
          </form>
        </section>
        <section className="panel">
          <h2>Activity timeline</h2>
          <div className="timeline">
            {lead.activities.map((a) => (
              <article key={a.id}>
                <strong>{a.type.replaceAll("_", " ")}</strong>
                <p style={{ whiteSpace: "pre-wrap" }}>{a.message}</p>
                <small className="muted">
                  {a.actor?.name ?? "System"} · {a.createdAt.toISOString()} UTC
                </small>
              </article>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
