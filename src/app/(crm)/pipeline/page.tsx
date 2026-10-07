import Link from "next/link";
import { Stage } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { requireCRM } from "@/server/auth";
import { opportunityScope } from "@/server/crm";
import { moveStage } from "@/app/actions";
const lanes: [string, Stage[]][] = [
  ["New", ["NEW"]],
  ["Contacted", ["CONTACTED"]],
  ["Qualifying", ["QUALIFYING"]],
  ["Site visit", ["SITE_VISIT_SCHEDULED"]],
  ["Estimate", ["ESTIMATE_IN_PROGRESS", "ESTIMATE_SENT"]],
  ["Follow up", ["FOLLOW_UP"]],
  ["Negotiation", ["NEGOTIATION"]],
  ["Won", ["WON"]],
  ["Lost", ["LOST"]],
];
export default async function Pipeline() {
  const u = await requireCRM();
  const items = await db.opportunity.findMany({
    where: opportunityScope(u),
    include: { customer: true, lead: true },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  return (
    <>
      <h1>Sales pipeline</h1>
      <p className="muted">
        Every move is recorded in the activity log. Latest 500 opportunities.
      </p>
      <div className="kanban">
        {lanes.map(([label, stages]) => (
          <section className="lane" key={label}>
            <h2>
              {label}{" "}
              <span className="badge">
                {items.filter((o) => stages.includes(o.stage)).length}
              </span>
            </h2>
            {items
              .filter((o) => stages.includes(o.stage))
              .map((o) => (
                <article className="deal" key={o.id}>
                  <Link href={`/leads/${o.leadId}`}>
                    <strong>
                      {o.customer.firstName} {o.customer.lastName}
                    </strong>
                  </Link>
                  <p className="muted">{o.lead.serviceType}</p>
                  <strong>
                    {o.estimatedValue
                      ? `$${o.estimatedValue.toFixed(2)}`
                      : "Value pending"}
                  </strong>
                  <p>
                    <span className="badge">Lead score {o.lead.leadScore}</span>
                  </p>
                  <p className="muted">
                    {o.nextAction ?? "Set the next action during qualification"}
                    <br />
                    {o.nextActionDate?.toISOString().slice(0, 10)}
                  </p>
                  <form action={moveStage}>
                    <input name="id" type="hidden" value={o.id} />
                    <label>
                      Stage
                      <select name="stage" defaultValue={o.stage}>
                        {Object.values(Stage).map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                    <button>Move stage</button>
                  </form>
                </article>
              ))}
          </section>
        ))}
      </div>
    </>
  );
}
