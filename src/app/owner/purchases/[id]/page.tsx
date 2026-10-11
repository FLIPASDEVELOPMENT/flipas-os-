import {
  suggestionHistory,
  newSuggestionKey,
} from "@/purchases/classification-service";
import {
  proposedAllocations,
  suggestionSchema,
} from "@/purchases/classification";
import Link from "next/link";
import Decimal from "decimal.js";
import { requireOwner } from "@/owner/auth";
import { db } from "@/server/db";
import { purchaseData } from "@/purchases/service";
import { purchaseAction } from "@/purchases/actions";
import { ReviewForm } from "@/purchases/review-form";
import type { PurchaseData, Allocations } from "@/purchases/validation";
import { Submit } from "@/project-operations/components/submit";
export default async function Purchase({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; suggestion?: string }>;
}) {
  const u = await requireOwner(),
    { id } = await params,
    p = await purchaseData(u, id);
  if (Array.isArray(p)) throw new Error("Invalid purchase");
  const d = p.original as unknown as PurchaseData,
    { notice, suggestion } = await searchParams;
  const suggestions = await suggestionHistory(u, id);
  const chosen = suggestions.find(
    (s) =>
      s.id === suggestion &&
      s.state === "GENERATED" &&
      !s.decisions.length &&
      s.baseVersion === p.headVersion,
  );
  const duplicates = await db.importedPurchase.findMany({
    where: { evidenceKey: p.evidenceKey, id: { not: id } },
    select: { id: true, status: true },
  });
  const projects = await db.project.findMany({
    select: {
      id: true,
      identity: { select: { code: true, name: true } },
      customer: { select: { firstName: true, lastName: true } },
      estimate: {
        select: {
          sections: { select: { lines: { select: { id: true, name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  const head = p.reviews[0];
  const initial =
    chosen && chosen.result
      ? proposedAllocations(suggestionSchema.parse(chosen.result), d)
      : head
        ? (head.allocations as Allocations)
        : d.lines.map((l) => ({
            lineId: l.line_id,
            amount: l.line_total,
            category: "Other" as const,
            costType: "MATERIAL" as const,
          }));
  const final = ["APPROVED", "REJECTED"].includes(p.status);
  const blocked = Boolean(d.native?.blockedReasons.length);
  return (
    <>
      <Link href="/owner/purchases">← Purchase Inbox</Link>
      <h1>
        {d.header.vendor} · {d.header.receipt_id}
      </h1>
      {notice && <p role="status">{notice.slice(0, 500)}</p>}
      <section className="panel">
        <p>
          {p.status} · Current review {p.headVersion} · $
          {d.header.transaction_total} USD
        </p>
        <p>
          {d.header.date} · Source {d.header.source} · External ID{" "}
          {d.header.external_id}
        </p>
        <p>
          Job {d.header.job_name || "Unknown"} · PO{" "}
          {d.header.po_number || "Unknown"} · Store{" "}
          {d.header.store || "Unknown"}
        </p>
        <p>
          AI and deterministic suggestions require OWNER review. No cost is
          recorded until the exact saved review is approved.
        </p>
        <Link href={`/api/owner/purchases/documents/${p.documentId}`}>
          Download original CSV evidence as plain text
        </Link>
        {duplicates.length > 0 && (
          <p role="alert">
            Possible duplicate receipt:{" "}
            {duplicates.map((x) => (
              <Link key={x.id} href={`/owner/purchases/${x.id}`}>
                {x.id} ({x.status}){" "}
              </Link>
            ))}
            . Approval is blocked while a matching import is pending or
            approved. Review the originals and reject a pending duplicate with a
            reason before proceeding.
          </p>
        )}
      </section>
      {d.native && (
        <section className="panel">
          <h2>Original Home Depot transaction summary</h2>
          <p>
            Transaction ID {d.native.transactionId} · Order{" "}
            {d.native.orderNumber || "Not supplied"} · Invoice{" "}
            {d.native.invoiceNumber || "Not supplied"}
          </p>
          <p>
            Project Name: {d.native.projectName || "Not supplied"} · Job Name:{" "}
            {d.native.jobName || "Not supplied"}
          </p>
          <p>
            Date basis: {d.native.dateBasis} · Reported program discount $
            {d.native.programDiscount} · Reported other discount $
            {d.native.otherDiscount}
          </p>
          {d.native.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
          {d.native.blockedReasons.map((w, i) => (
            <p role="alert" key={i}>
              Cost recognition blocked: {w}
            </p>
          ))}
        </section>
      )}
      <div className="operations-grid">
        {d.lines.map((l) => (
          <section className="panel" key={l.line_id}>
            <h2>{l.description}</h2>
            <p>
              {d.native
                ? "Accounting summary unit, not an item quantity"
                : `SKU ${l.sku || "Unknown"} · Quantity ${l.quantity}`}{" "}
              · {d.native ? "Reported pre-tax $" : "Unit $"}
              {l.unit_price}
            </p>
            <p>
              Subtotal ${new Decimal(l.quantity).mul(l.unit_price).toFixed(2)} ·
              Tax ${l.tax} · Discount ${l.discount} · Total ${l.line_total}
            </p>
          </section>
        ))}
      </div>
      <section className="panel">
        <h2>Classification suggestions</h2>
        <p>
          At most four requests per purchase. Itemized AI requests share the
          existing monthly budget; summaries use rules without a provider call.
          Every result requires human review.
        </p>
        {!final && !blocked && (
          <form action={purchaseAction}>
            <input type="hidden" name="operation" value="suggest" />
            <input type="hidden" name="purchaseId" value={id} />
            <input type="hidden" name="version" value={p.headVersion} />
            <input type="hidden" name="requestKey" value={newSuggestionKey()} />
            <Submit>Suggest classification with AI</Submit>
          </form>
        )}
        {suggestions.map((s) => (
          <article key={s.id}>
            <h3>
              {s.state} · {s.provider} · {s.model}
            </h3>
            <p>
              {s.createdAt.toISOString()} · Requested by {s.createdById} ·
              Review version {s.baseVersion}
            </p>
            {s.matchingCandidates.length > 0 && (
              <p>
                Matching evidence: {s.matchingMethod} ·{" "}
                {s.matchingCandidates
                  .map((c) => `${c.code} · ${c.name}`)
                  .join("; ")}
                . Name candidates and conflicts require OWNER confirmation; no
                automatic expense assignment.
              </p>
            )}
            {s.errorCode && (
              <p role="alert">
                {s.errorCode}. No costs were recorded. Check AI Administration
                diagnostics. A new request is never made automatically.
              </p>
            )}
            {s.state === "RUNNING" && (
              <p>
                Running or uncertain after interruption. No automatic retries.
                This request key remains reserved; review manually if it does
                not finish.
              </p>
            )}
            {s.canAbandon && (
              <details>
                <summary>
                  Close interrupted request (no automatic retry)
                </summary>
                <form action={purchaseAction}>
                  <input
                    type="hidden"
                    name="operation"
                    value="abandon-suggestion"
                  />
                  <input type="hidden" name="purchaseId" value={id} />
                  <input type="hidden" name="suggestionId" value={s.id} />
                  <label>
                    Reason
                    <input name="reason" required minLength={5} />
                  </label>
                  <Submit>
                    Close request; preserve counters and reserved costs
                  </Submit>
                </form>
              </details>
            )}
            {s.result &&
              suggestionSchema.parse(s.result).lines.map((l) => (
                <div key={l.lineId}>
                  <p>
                    Line {l.lineId} · Project{" "}
                    {l.projectId ?? "Unknown / review required"} · Category{" "}
                    {l.category ?? "Unknown"} · {l.costType} · Confidence{" "}
                    {Math.round(l.confidence * 100)}%
                  </p>
                  <p>
                    Original estimate line:{" "}
                    {projects
                      .flatMap((p) =>
                        p.estimate.sections.flatMap((s) => s.lines),
                      )
                      .find((x) => x.id === l.estimateLineId)?.name ??
                      "Unknown / not allocated"}{" "}
                    · Possible company overhead:{" "}
                    {l.overhead
                      ? "Yes — OWNER review required"
                      : "Not asserted"}
                  </p>
                  <p>{l.explanation}</p>
                  {l.evidence.map((e, i) => (
                    <p key={i}>
                      {e.field}: “{e.quote}”
                    </p>
                  ))}
                </div>
              ))}
            {s.state === "GENERATED" &&
              !s.decisions.length &&
              s.baseVersion === p.headVersion &&
              !final &&
              !blocked && (
                <Link href={`/owner/purchases/${id}?suggestion=${s.id}`}>
                  Use this suggestion in the review form (does not save or
                  approve)
                </Link>
              )}
            {s.decisions.map((dec) => (
              <p key={dec.id}>
                Rejected suggestion · {dec.actorId} ·{" "}
                {dec.createdAt.toISOString()} · {dec.reason}
              </p>
            ))}
            {s.state === "GENERATED" &&
              !s.decisions.length &&
              s.baseVersion === p.headVersion &&
              !final && (
                <details>
                  <summary>Reject suggestion only</summary>
                  <form action={purchaseAction}>
                    <input
                      type="hidden"
                      name="operation"
                      value="reject-suggestion"
                    />
                    <input type="hidden" name="purchaseId" value={id} />
                    <input type="hidden" name="version" value={p.headVersion} />
                    <input type="hidden" name="suggestionId" value={s.id} />
                    <label>
                      Reason
                      <input name="reason" required minLength={5} />
                    </label>
                    <Submit>Reject suggestion; keep purchase pending</Submit>
                  </form>
                </details>
              )}
            {s.reviews.map((r) => (
              <p key={r.version}>
                OWNER review/correction v{r.version} · {r.createdById} ·{" "}
                {r.createdAt.toISOString()} · {r.reason}
              </p>
            ))}
          </article>
        ))}
      </section>
      {!final && !blocked && (
        <section className="panel">
          <h2>Manual classification and splits</h2>
          <ReviewForm
            key={chosen?.id ?? "manual"}
            purchaseId={id}
            suggestionId={chosen?.id}
            version={p.headVersion}
            initial={initial}
            lines={d.lines.map((l) => ({
              id: l.line_id,
              description: l.description,
            }))}
            projects={projects.map((x) => ({
              id: x.id,
              name: x.identity
                ? `${x.identity.code} · ${x.identity.name}`
                : x.customer.firstName + " " + x.customer.lastName,
              lines: x.estimate.sections.flatMap((s) => s.lines),
            }))}
          />
        </section>
      )}
      {head && (
        <section className="panel">
          <h2>Exact saved review — version {head.version}</h2>
          <p>{head.reason}</p>
          {(head.allocations as Allocations).map((a, i) => (
            <p key={i}>
              Line {a.lineId} · ${a.amount} ·{" "}
              {a.projectId ?? "Company overhead"} · {a.category} · {a.costType}{" "}
              · Estimate line {a.estimateLineId ?? "Not allocated"} ·{" "}
              {a.existingLedgerId
                ? "Link existing cost " + a.existingLedgerId
                : "New recognition"}
            </p>
          ))}
          {!final && !blocked && (
            <form action={purchaseAction}>
              <input type="hidden" name="operation" value="approve" />
              <input type="hidden" name="purchaseId" value={id} />
              <input type="hidden" name="version" value={head.version} />
              <label>
                <input name="confirmation" type="checkbox" required />I approve
                this exact saved version and verified that these costs are not
                already recorded.
              </label>
              <Submit confirm="Record the saved review as actual costs? This approved history cannot be edited or deleted.">
                Approve saved version and record costs
              </Submit>
            </form>
          )}
        </section>
      )}
      {!final && (
        <details className="panel">
          <summary>Reject this import</summary>
          <form action={purchaseAction}>
            <input type="hidden" name="operation" value="reject" />
            <input type="hidden" name="purchaseId" value={id} />
            <input type="hidden" name="version" value={p.headVersion} />
            <label>
              Reason
              <input name="reason" required minLength={5} />
            </label>
            <Submit>Reject without recording costs</Submit>
          </form>
        </details>
      )}
      <details className="panel">
        <summary>Review history</summary>
        {p.reviews.map((r) => (
          <p key={r.id}>
            Version {r.version} · {r.createdAt.toISOString()} · {r.createdById}{" "}
            · {r.reason}
          </p>
        ))}
      </details>
      {p.approvedAt && (
        <p>
          Approved by {p.approvedById} · {p.approvedAt.toISOString()} · Version{" "}
          {p.approvedVersion}
        </p>
      )}
    </>
  );
}
