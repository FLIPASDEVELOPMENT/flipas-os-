import Link from "next/link";
import { FollowUpForm } from "@/sales-ai/follow-up-form";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { customerScope, leadScope, opportunityScope } from "@/server/crm";
import { requireSalesAI, configuredRole } from "@/sales-ai/server/access";
import {
  conversation,
  intelligence,
  matchingCustomers,
} from "@/sales-ai/server/service";
import { threadAction, draftAction } from "@/sales-ai/actions";
import { classification, mailKind } from "@/sales-ai/domain/intelligence";
import { DateTime, Mode, Notice } from "@/sales-ai/components";
function ThreadFields({ id, operation }: { id: string; operation: string }) {
  return (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="operation" value={operation} />
    </>
  );
}
export default async function Thread({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const u = await requireSalesAI(),
    { id } = await params,
    p = await searchParams;
  const c = await conversation(u, id).catch(() => null);
  if (!c) notFound();
  const info = intelligence(c);
  const mockAnalysis =
    !!c.intelligence &&
    typeof c.intelligence === "object" &&
    !Array.isArray(c.intelligence) &&
    c.intelligence.analysisProvider === "MOCK";
  const [settings, customers, leads, opportunities, matches, team] =
    await Promise.all([
      db.salesAISettings.findUnique({
        where: { id: "company" },
        select: { approveRoles: true, sendRoles: true, outboundPaused: true },
      }),
      db.customer.findMany({
        where: customerScope(u),
        select: { id: true, firstName: true, lastName: true, email: true },
        orderBy: { firstName: "asc" },
        take: 200,
      }),
      db.lead.findMany({
        where: leadScope(u),
        select: { id: true, customerId: true, serviceType: true },
        take: 200,
      }),
      db.opportunity.findMany({
        where: opportunityScope(u),
        select: { id: true, customerId: true, stage: true },
        take: 200,
      }),
      matchingCustomers(u, id),
      u.role === "OWNER"
        ? db.user.findMany({
            where: { active: true, role: { in: ["OWNER", "ADMIN", "SALES"] } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);
  return (
    <>
      <div className="estimator-toolbar">
        <div>
          <h1>{c.subject}</h1>
          <p className="muted">
            {c.senderName} &lt;{c.senderEmail}&gt;
          </p>
        </div>
        <Mode provider={c.connection.provider} />
      </div>
      <Notice {...p} />
      <div className="columns">
        <section className="panel">
          <h2>Commercial review</h2>
          <p>
            Mail classification: {info?.mailKind ?? "Unreviewed"} ·{" "}
            {info?.needsHumanReview
              ? "Human review required"
              : "Recommendation reviewed"}
          </p>
          <form action={threadAction}>
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="operation" value="analyze" />
            <button>Analyze this conversation again</button>
            <p className="muted">
              Uses one AI request when OpenAI is selected; four requests maximum
              per latest email, including drafts. Does not change existing
              replies.
            </p>
          </form>
          <form action={threadAction} className="form">
            <ThreadFields id={id} operation="mark" />
            <label>
              Mail type
              <select name="mailKind" defaultValue={info?.mailKind ?? "OTHER"}>
                {mailKind.options.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="wide">
              Classification
              <select
                name="classification"
                defaultValue={
                  c.classification === "UNREVIEWED" ? "Other" : c.classification
                }
              >
                {classification.options.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="checkbox-label">
              <input name="unread" type="checkbox" defaultChecked={c.unread} />
              Unread
            </label>
            <label className="checkbox-label">
              <input
                name="processed"
                type="checkbox"
                defaultChecked={c.processed}
              />
              Processed
            </label>
            <button>Save review</button>
          </form>
          {u.role === "OWNER" && (
            <form action={threadAction} className="form ai-section">
              <ThreadFields id={id} operation="assign" />
              <label>
                Representative
                <select name="userId" defaultValue={c.assignedToId}>
                  {team.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <button className="secondary">Assign conversation</button>
              </div>
            </form>
          )}
        </section>
        <section className="panel">
          <h2>AI recommendations</h2>
          {!info ? (
            <p className="muted">Awaiting analysis by the worker.</p>
          ) : (
            <>
              <p>{info.summary}</p>
              <p className="muted">
                Confidence {Math.round(info.confidence * 100)}% · Recommendation
                only
                {mockAnalysis ? " · Development heuristic" : ""}
              </p>
              <dl className="ai-details">
                {[
                  ["Name", info.customerName],
                  ["Email", info.email],
                  ["Phone", info.phone],
                  ["Location", info.projectLocation],
                  ["Budget (explicit)", info.budget],
                  ["Timeline", info.timeline],
                  ["Urgency", info.urgency],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value ?? "Not provided"}</dd>
                  </div>
                ))}
              </dl>
              <p>
                Missing:{" "}
                {info.missingInformation.join(", ") || "None identified"}
              </p>
              <ul>
                {info.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
              {info.recommendedTemplate && (
                <p>
                  Suggested scope:{" "}
                  <Link href="/estimates/templates">
                    {info.recommendedTemplate}
                  </Link>
                  . Create an estimate only after verifying the project.
                </p>
              )}
              <details>
                <summary>Evidence references</summary>
                {info.evidence.map((e, i) => (
                  <p key={i}>
                    {e.field} · message {e.messageId}
                    <br />“{e.quote}”
                  </p>
                ))}
              </details>
            </>
          )}
        </section>
      </div>
      <section className="panel">
        <h2>Message history</h2>
        {c.messages.map((m) => (
          <article className="ai-message" key={m.id}>
            <div className="row">
              <strong>
                {m.direction === "OUTBOUND"
                  ? "Approved outbound reply"
                  : "Inbound"}{" "}
                · {m.fromEmail}
              </strong>
              <DateTime date={m.receivedAt} />
            </div>
            <p className="ai-body">{m.body}</p>
            {Array.isArray(m.attachments) && m.attachments.length > 0 && (
              <p className="muted">
                {m.attachments.length} attachment(s) recorded as metadata. Files
                are not downloaded or executed.
              </p>
            )}
          </article>
        ))}
      </section>
      <section className="panel">
        <h2>CRM connection</h2>
        <p>
          Customer:{" "}
          {c.customerId ? (
            <Link href={"/customers/" + c.customerId}>
              Open customer record
            </Link>
          ) : (
            "Not linked"
          )}{" "}
          · Lead:{" "}
          {c.leadId ? (
            <Link href={"/leads/" + c.leadId}>Open lead</Link>
          ) : (
            "Not linked"
          )}{" "}
          · Opportunity:{" "}
          {c.opportunityId ? (
            <Link href="/pipeline">Open pipeline</Link>
          ) : (
            "Not linked"
          )}
        </p>
        {matches.length > 0 && (
          <p className="ai-success">
            {matches.length} accessible exact email match(es). Confirm the right
            record below; no automatic merging.
          </p>
        )}
        <form action={threadAction} className="form">
          <ThreadFields id={id} operation="link" />
          <label>
            Existing customer
            <select
              name="customerId"
              required
              defaultValue={c.customerId ?? ""}
            >
              <option value="">Choose and confirm contact</option>
              {customers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.firstName} {t.lastName} · {t.email ?? "No email"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Lead (must belong to customer)
            <select name="leadId" defaultValue={c.leadId ?? ""}>
              <option value="">No lead</option>
              {leads.map((t) => (
                <option key={t.id} value={t.id}>
                  {customers.find((x) => x.id === t.customerId)?.firstName} ·{" "}
                  {t.serviceType}
                </option>
              ))}
            </select>
          </label>
          <label>
            Opportunity (same customer and lead)
            <select name="opportunityId" defaultValue={c.opportunityId ?? ""}>
              <option value="">No opportunity</option>
              {opportunities.map((t) => (
                <option key={t.id} value={t.id}>
                  {customers.find((x) => x.id === t.customerId)?.firstName} ·{" "}
                  {t.stage}
                </option>
              ))}
            </select>
          </label>
          <div>
            <button>Confirm CRM link</button>
          </div>
        </form>
        {!c.leadId && (
          <details className="ai-section">
            <summary>Confirm a new commercial lead</summary>
            <p className="muted">
              Use verified names. Existing email matches must be linked above.
              This action creates a contact and lead, never an opportunity or
              estimate.
            </p>
            <form className="form" action={threadAction}>
              <ThreadFields id={id} operation="lead" />
              <label>
                Verified first name
                <input name="firstName" required maxLength={100} />
              </label>
              <label>
                Verified last name
                <input name="lastName" required maxLength={100} />
              </label>
              <button>Confirm and create lead</button>
            </form>
          </details>
        )}
      </section>
      <section className="panel">
        <h2>Follow-up</h2>
        <p className="muted">
          Suggested: check back in two business days after reviewing the
          inquiry. Set the actual due time yourself.
        </p>
        <FollowUpForm id={id} />
        {c.followUps.map((f) => (
          <div className="row" key={f.id}>
            <span>
              {f.reason} · {f.completedAt ? "Completed" : "Open"}
            </span>
            <DateTime date={f.dueAt} />
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Replies & approvals</h2>
        <p className="muted">
          Approve the exact visible version. Editing clears approval. Sending
          requires a separate authorized request.
        </p>
        <form action={threadAction} className="button-row">
          <ThreadFields id={id} operation="generate" />
          <label>
            Reply language
            <select name="language" defaultValue="AUTO">
              <option value="AUTO">Customer language (automatic)</option>
              <option value="EN">English</option>
              <option value="ES">Español</option>
            </select>
          </label>
          <label>
            Reply type
            <select name="purpose">
              <option value="QUALIFY">Qualifying questions</option>
              <option value="FOLLOW_UP">Follow-up</option>
            </select>
          </label>
          <button>Draft qualifying reply</button>
        </form>
        {c.drafts.map((d) => {
          const v = d.versions[0];
          if (!v) return null;
          const editable = !["SENDING", "SENT"].includes(d.status);
          return (
            <article key={d.id} className="ai-section">
              <div className="row">
                <strong>
                  Version {d.version} <span className="badge">{d.status}</span>
                </strong>
                <small>
                  {d.approvedAt ? (
                    <>
                      Approved version {d.approvedVersion} ·{" "}
                      <DateTime date={d.approvedAt} />
                    </>
                  ) : (
                    "No current approval"
                  )}
                </small>
              </div>
              {d.lastError && (
                <p className="error">
                  {d.lastError} · Verify delivery outside FLIPAS before any new
                  attempt.
                </p>
              )}
              <form action={draftAction} className="form">
                <input type="hidden" name="id" value={d.id} />
                <input type="hidden" name="version" value={d.version} />
                <input type="hidden" name="operation" value="edit" />
                <label>
                  Recipient
                  <input name="recipient" defaultValue={v.recipient} readOnly />
                </label>
                <label>
                  Subject
                  <input
                    name="subject"
                    defaultValue={v.subject}
                    readOnly={!editable}
                    required
                    maxLength={500}
                  />
                </label>
                <label className="wide">
                  Exact reply text
                  <textarea
                    name="body"
                    rows={7}
                    defaultValue={v.body}
                    readOnly={!editable}
                    required
                    maxLength={15000}
                  />
                </label>
                {editable && <button>Save edit & invalidate approval</button>}
              </form>
              <form action={draftAction} className="button-row ai-section">
                <input type="hidden" name="id" value={d.id} />
                <input type="hidden" name="version" value={d.version} />
                {["GENERATED", "EDITED", "REJECTED"].includes(d.status) && (
                  <button name="operation" value="submit">
                    Submit version {d.version} for review
                  </button>
                )}
                {d.status === "PENDING_REVIEW" &&
                  settings &&
                  configuredRole(u, settings.approveRoles) && (
                    <>
                      <button name="operation" value="approve">
                        Approve version {d.version}
                      </button>
                      <button
                        className="secondary"
                        name="operation"
                        value="reject"
                      >
                        Reject
                      </button>
                    </>
                  )}
                {d.status === "APPROVED" &&
                  settings &&
                  configuredRole(u, settings.sendRoles) && (
                    <button
                      name="operation"
                      value="send"
                      disabled={settings.outboundPaused}
                    >
                      {c.connection.provider === "MOCK"
                        ? "Simulate approved send"
                        : "Send approved reply"}
                      {settings.outboundPaused ? " (paused)" : ""}
                    </button>
                  )}
              </form>
              {d.attempts.map((a) => (
                <p key={a.id} className="muted">
                  Version {a.version} · Delivery {a.status} ·{" "}
                  {a.providerMessageId ?? "No confirmed provider identifier"}
                </p>
              ))}
            </article>
          );
        })}
      </section>
    </>
  );
}
