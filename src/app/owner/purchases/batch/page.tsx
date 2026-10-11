import Link from "next/link";
import { requireOwner } from "@/owner/auth";
import { db } from "@/server/db";
import { purchaseAction } from "@/purchases/actions";
import { Submit } from "@/project-operations/components/submit";
import type { PurchaseData, Allocations } from "@/purchases/validation";
export default async function Batch() {
  await requireOwner();
  const rows = await db.importedPurchase.findMany({
    where: { status: "NEEDS_REVIEW" },
    include: { reviews: { orderBy: { version: "desc" }, take: 1 } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  return (
    <>
      <Link href="/owner/purchases">← Purchase Inbox</Link>
      <h1>Review saved classifications</h1>
      <p>
        Up to 20 pending saved reviews. Check each exact version below. Approved
        items commit independently; blocked items remain pending. No checkbox is
        selected automatically.
      </p>
      <form action={purchaseAction}>
        <input name="operation" value="bulk" type="hidden" />
        {rows.map((p) => {
          const d = p.original as unknown as PurchaseData,
            r = p.reviews[0];
          return (
            r && (
              <section key={p.id} className="panel">
                <h2>
                  {d.header.vendor} · Receipt {d.header.receipt_id}
                </h2>
                <p>
                  {d.header.date} · ${d.header.transaction_total} · Review
                  version {r.version}
                </p>
                {(r.allocations as Allocations).map((a, i) => (
                  <p key={i}>
                    {d.lines.find((l) => l.line_id === a.lineId)?.description} ·
                    ${a.amount} · Project {a.projectId ?? "Company overhead"} ·{" "}
                    {a.category} · {a.costType} · Estimate line{" "}
                    {a.estimateLineId ?? "Not allocated"} ·{" "}
                    {a.existingLedgerId
                      ? "Existing ledger " + a.existingLedgerId
                      : "New cost"}
                  </p>
                ))}
                <Link href={`/owner/purchases/${p.id}`}>
                  Open evidence and correction history
                </Link>
                <label>
                  <input
                    type="checkbox"
                    name="reviews"
                    value={JSON.stringify({ id: p.id, version: r.version })}
                  />
                  I reviewed the evidence, verified no duplicate cost and
                  approve this exact saved version.
                </label>
              </section>
            )
          );
        })}
        <Submit confirm="Approve only the explicitly selected saved versions? Each item records separately; blocked items will remain pending.">
          Approve selected saved reviews
        </Submit>
      </form>
    </>
  );
}
