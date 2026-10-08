import Link from "next/link";
import { requireSalesAI, conversationScope } from "@/sales-ai/server/access";
import { opportunityScope } from "@/server/crm";
import { db } from "@/server/db";
import { DateTime, Mode } from "@/sales-ai/components";
export default async function SalesOverview() {
  const u = await requireSalesAI(),
    scope = conversationScope(u);
  const [
    potential,
    reviews,
    drafts,
    overdue,
    attention,
    stalled,
    connections,
    settings,
  ] = await Promise.all([
    db.mailConversation.count({
      where: {
        ...scope,
        leadId: null,
        classification: { notIn: ["UNREVIEWED", "Not a sales lead"] },
      },
    }),
    db.mailConversation.count({ where: { ...scope, processed: false } }),
    db.salesEmailDraft.count({
      where: { conversation: scope, status: "PENDING_REVIEW" },
    }),
    db.salesFollowUp.count({
      where: {
        conversation: scope,
        completedAt: null,
        dueAt: { lt: new Date() },
      },
    }),
    db.mailConversation.findMany({
      where: { ...scope, classification: { not: "Not a sales lead" } },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    db.opportunity.findMany({
      where: {
        ...opportunityScope(u),
        stage: { notIn: ["WON", "LOST"] },
        updatedAt: { lt: new Date(new Date().getTime() - 14 * 86400000) },
      },
      include: { customer: true },
      take: 10,
    }),
    db.mailConnection.findMany({
      where: u.role === "SALES" ? { conversations: { some: scope } } : {},
      select: {
        id: true,
        provider: true,
        address: true,
        connected: true,
        lastSyncAt: true,
        lastError: true,
      },
    }),
    db.salesAISettings.findUnique({
      where: { id: "company" },
      select: { processingEnabled: true, outboundPaused: true },
    }),
  ]);
  return (
    <>
      <h1>Sales intelligence</h1>
      <p className="muted">
        Stored business data. Recommendations require your review. Mail uses
        development mock data until the Zoho connector is authorized.
      </p>
      {!settings && (
        <section className="panel">
          <p>
            The owner can initialize development mail in{" "}
            <Link href="/owner/ai">AI Administration</Link>.
          </p>
        </section>
      )}
      <div className="owner-cards">
        {[
          [potential, "Potential leads to confirm"],
          [reviews, "Messages awaiting review"],
          [drafts, "Replies awaiting approval"],
          [overdue, "Overdue follow-ups"],
        ].map(([v, label]) => (
          <section className="panel" key={label}>
            <span className="muted">{label}</span>
            <strong>{v}</strong>
          </section>
        ))}
      </div>
      <div className="columns">
        <section className="panel">
          <h2>Conversations requiring attention</h2>
          {attention.length === 0 && (
            <p className="empty">No sales conversations yet.</p>
          )}
          {attention.map((c) => (
            <Link href={"/ai/inbox/" + c.id} className="row" key={c.id}>
              <span>
                {c.subject}
                <br />
                <small className="muted">
                  {c.classification} ·{" "}
                  {c.leadId
                    ? "CRM linked"
                    : "Confirm contact and project details"}
                </small>
              </span>
              <span className="badge">{c.unread ? "Unread" : "Reviewed"}</span>
            </Link>
          ))}
        </section>
        <section className="panel">
          <h2>Stalled opportunities</h2>
          <p className="muted">
            Open opportunities without a record update for 14 days. This is a
            reminder, not an automatic pipeline change.
          </p>
          {stalled.length === 0 && (
            <p className="empty">None currently match this definition.</p>
          )}
          {stalled.map((o) => (
            <Link href="/pipeline" className="row" key={o.id}>
              <span>
                {o.customer.firstName} {o.customer.lastName}
              </span>
              <span className="badge">{o.stage}</span>
            </Link>
          ))}
        </section>
      </div>
      <section className="panel">
        <h2>Mail health</h2>
        <p>
          Processing: {settings?.processingEnabled ? "enabled" : "disabled"} ·
          Outbound:{" "}
          {settings?.outboundPaused === false
            ? "explicit approved requests only"
            : "paused"}
        </p>
        {connections.map((c) => (
          <div className="row" key={c.id}>
            <span>
              {c.address} <Mode provider={c.provider} />
              <br />
              <small>
                {c.connected ? "Connected" : "Disconnected"} ·{" "}
                {c.lastError ?? "No reported error"}
              </small>
            </span>
            <span>
              {c.lastSyncAt ? (
                <DateTime date={c.lastSyncAt} />
              ) : (
                "Not synchronized"
              )}
            </span>
          </div>
        ))}
      </section>
    </>
  );
}
