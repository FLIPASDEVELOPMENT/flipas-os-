import Link from "next/link";
import Decimal from "decimal.js";
import { requireOwner } from "@/owner/auth";
import { db } from "@/server/db";
import type { PurchaseData } from "@/purchases/validation";
export default async function Reports() {
  await requireOwner();
  const rows = await db.purchasePosting.findMany({
    include: { purchase: true },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const groups = new Map<string, Decimal>();
  for (const r of rows) {
    const p = r.purchase.original as unknown as PurchaseData;
    const key = [
      r.projectId ?? "Company overhead",
      p.header.vendor,
      r.category,
      p.header.date.slice(0, 7),
      r.estimateLineId ?? "No estimate line",
    ].join(" · ");
    groups.set(
      key,
      (groups.get(key) ?? new Decimal(0)).add(r.amount.toString()),
    );
  }
  return (
    <>
      <Link href="/owner/purchases">← Purchase Inbox</Link>
      <h1>Approved expense reports</h1>
      <p>
        Up to 1,000 approved allocations, grouped by project, vendor, category,
        purchase month and original estimate line. Linked existing costs are
        included as evidence, never posted twice.
      </p>
      <p>
        Company overhead is recorded separately and does not change the
        versioned Financial Policy or project overhead snapshots. Project
        profitability remains provisional until existing cost reconciliation is
        complete.
      </p>
      <Link href="/owner/profitability">Existing project profitability</Link>
      {[...groups].map(([key, total]) => (
        <section className="panel" key={key}>
          <p>{key}</p>
          <strong>${total.toFixed(2)} USD</strong>
        </section>
      ))}
      {!rows.length && <p>No approved purchase expenses.</p>}
    </>
  );
}
