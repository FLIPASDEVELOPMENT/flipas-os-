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
  searchParams: Promise<{ notice?: string }>;
}) {
  const u = await requireOwner(),
    { id } = await params,
    p = await purchaseData(u, id);
  if (Array.isArray(p)) throw new Error("Invalid purchase");
  const d = p.original as unknown as PurchaseData,
    { notice } = await searchParams;
  const duplicates = await db.importedPurchase.findMany({
    where: { evidenceKey: p.evidenceKey, id: { not: id } },
    select: { id: true, status: true },
  });
  const projects = await db.project.findMany({
    select: {
      id: true,
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
  const initial = head
    ? (head.allocations as Allocations)
    : d.lines.map((l) => ({
        lineId: l.line_id,
        amount: l.line_total,
        category: "Other" as const,
        costType: "MATERIAL" as const,
      }));
  const final = ["APPROVED", "REJECTED"].includes(p.status);
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
          No AI suggestion in 5A. Project and category require OWNER
          classification.
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
            . Approval is blocked if another matching receipt is already
            approved.
          </p>
        )}
      </section>
      <div className="operations-grid">
        {d.lines.map((l) => (
          <section className="panel" key={l.line_id}>
            <h2>{l.description}</h2>
            <p>
              SKU {l.sku || "Unknown"} · Quantity {l.quantity} · Unit $
              {l.unit_price}
            </p>
            <p>
              Subtotal ${new Decimal(l.quantity).mul(l.unit_price).toFixed(2)} ·
              Tax ${l.tax} · Discount ${l.discount} · Total ${l.line_total}
            </p>
          </section>
        ))}
      </div>
      {!final && (
        <section className="panel">
          <h2>Manual classification and splits</h2>
          <ReviewForm
            purchaseId={id}
            version={p.headVersion}
            initial={initial}
            lines={d.lines.map((l) => ({
              id: l.line_id,
              description: l.description,
            }))}
            projects={projects.map((x) => ({
              id: x.id,
              name: x.customer.firstName + " " + x.customer.lastName,
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
          {!final && (
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
