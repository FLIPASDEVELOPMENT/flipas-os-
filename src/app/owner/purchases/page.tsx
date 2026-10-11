import Link from "next/link";
import { requireOwner } from "@/owner/auth";
import { purchaseData } from "@/purchases/service";
import { purchaseAction } from "@/purchases/actions";
import { Submit } from "@/project-operations/components/submit";
import type { PurchaseData } from "@/purchases/validation";
export default async function Purchases({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const u = await requireOwner(),
    data = await purchaseData(u);
  if (!Array.isArray(data)) throw new Error("Invalid inbox");
  const { notice } = await searchParams;
  return (
    <>
      <h1>Purchases & integrations</h1>
      <p>
        Import → review → approve exact version → record costs. No automatic
        classification or accounting writes.
      </p>
      {notice && <p role="status">{notice.slice(0, 500)}</p>}
      <nav className="estimator-nav">
        <Link href="/owner/purchases/batch">
          Review multiple saved classifications
        </Link>
        <Link href="/owner/purchases/projects">Project codes & aliases</Link>
        <Link href="/owner/purchases/classify">
          Suggest classifications in a bounded batch
        </Link>
        <Link href="/owner/purchases/reports">Approved expense reports</Link>
        <Link href="/owner/profitability">Project profitability</Link>
      </nav>
      <section className="panel">
        <h2>Import Home Depot Pro Xtra or normalized CSV</h2>
        <p>
          USD only; up to 500 lines and 1 MB. Home Depot Purchase Tracking CSV
          headers are detected after initial metadata. Preview before
          confirming. Returns/credits are retained pending and cannot record
          costs. Inventory consumption and PDF/image receipts are not supported
          in 5A.
        </p>
        <form action={purchaseAction}>
          <input name="operation" value="import" type="hidden" />
          <label>
            CSV file
            <input type="file" name="file" accept=".csv,text/csv" required />
          </label>
          <Submit>Preview CSV import</Submit>
        </form>
      </section>
      <section className="panel">
        <h2>Integration status</h2>
        <p>
          Home Depot Pro Xtra Purchase Tracking CSV: available. Manual /
          Lowe&apos;s / QuickBooks normalized CSV: available. No live
          connectors.
        </p>
        <p>
          Home Depot API, Lowe&apos;s API and Intuit OAuth: NOT CONFIGURED /
          DISABLED. Classification uses the existing AI Administration provider,
          pause and shared budget. No automatic synchronization or accounting
          writes.
        </p>
      </section>
      <h2>Purchase Inbox — latest 200</h2>
      <div className="operations-grid">
        {data.map((p) => {
          const d = p.original as unknown as PurchaseData;
          return (
            <article className="panel" key={p.id}>
              <h3>{d.header.vendor}</h3>
              <p>
                {d.header.date} · Receipt {d.header.receipt_id} ·{" "}
                {d.header.source}
              </p>
              <p>
                ${d.header.transaction_total} USD · {p.status} · Review{" "}
                {p.headVersion}
              </p>
              <p>
                {d.header.job_name || "No job name"} · PO{" "}
                {d.header.po_number || "Not provided"}
              </p>
              <Link href={`/owner/purchases/${p.id}`}>Review purchase</Link>
            </article>
          );
        })}
      </div>
      {!data.length && (
        <p>No imports yet. No project cost changes until OWNER approval.</p>
      )}
    </>
  );
}
