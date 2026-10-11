import Link from "next/link";
import { requireOwner } from "@/owner/auth";
import { importPreview } from "@/purchases/service";
import { purchaseAction } from "@/purchases/actions";
import { Submit } from "@/project-operations/components/submit";
import Decimal from "decimal.js";

export default async function Preview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireOwner(),
    { id } = await params,
    data = await importPreview(user, id);
  const ambiguous = data.purchases.filter((p) =>
    data.purchases.some(
      (other) =>
        other.sourceKey !== p.sourceKey && other.evidenceKey === p.evidenceKey,
    ),
  ).length;
  return (
    <>
      <Link href="/owner/purchases">← Purchase Inbox</Link>
      <h1>Review CSV import before confirming</h1>
      <p>
        {data.fileName} · Format {data.format}
      </p>
      <section className="panel">
        <p>
          {data.validRows} valid rows · {data.pendingRows} unsupported/ambiguous
          movements retained pending · {data.rejected.length} rejected rows ·{" "}
          {data.duplicateRows} exact repeated rows skipped.
        </p>
        <p>
          {data.matches.length} existing records may match. Import retries do
          not create duplicates. Shared online order numbers alone do not prove
          duplication.
        </p>
        {ambiguous > 0 && (
          <p role="alert">
            {ambiguous} incoming movements share a transaction identity but have
            different evidence. They are retained separately and blocked for
            cost recognition.
          </p>
        )}
        <p>
          No project costs or accounting writes. This confirmation creates
          pending purchases only. Cost recognition requires a separate
          reviewed-version approval.
        </p>
        {data.format === "HOME_DEPOT_PRO_XTRA_V1" && (
          <p>
            Home Depot Purchase Tracking export is transaction-level evidence,
            not an itemized receipt. Discounts are preserved as reported. Tax is
            a derived difference, not a verified tax rate. Receipt Added Date is
            explicitly distinguished from purchase Date.
          </p>
        )}
        <Link href={`/api/owner/purchases/documents/${id}`}>
          Download original evidence as untrusted plain text
        </Link>
      </section>
      <details className="panel">
        <summary>
          Warnings and rejected rows (
          {data.warnings.length + data.rejected.length})
        </summary>
        {data.warnings.map((w, i) => (
          <p key={`w${i}`}>
            Row {w.row || "—"}: {w.message}
          </p>
        ))}
        {data.rejected.map((w, i) => (
          <p key={`r${i}`} role="alert">
            Row {w.row}: {w.message}
          </p>
        ))}
      </details>
      <div className="operations-grid">
        {data.purchases.map((p) => (
          <article className="panel" key={p.sourceKey}>
            <h2>
              {p.native
                ? `Transaction ${p.native.transactionId}`
                : p.header.receipt_id}
            </h2>
            <p>
              {p.header.date}
              {p.native ? ` (${p.native.dateBasis})` : ""} · $
              {p.header.transaction_total} USD
            </p>
            <p>
              Project Name: {p.native?.projectName || "Not supplied"} · Job
              Name: {p.header.job_name || "Not supplied"}
            </p>
            <p>
              Order:{" "}
              {p.native?.orderNumber || p.header.po_number || "Not supplied"} ·{" "}
              {p.header.store}
            </p>
            {p.lines.map((line) => (
              <p key={line.line_id}>
                {line.description} · Pre-tax $
                {new Decimal(line.quantity).mul(line.unit_price).toFixed(2)} ·
                Tax/difference ${line.tax} · Total ${line.line_total}
              </p>
            ))}
            {p.native?.blockedReasons.map((reason, i) => (
              <p role="alert" key={i}>
                PENDING — cost recognition blocked: {reason}
              </p>
            ))}
            {data.matches
              .filter(
                (m) =>
                  m.sourceKey === p.sourceKey ||
                  m.evidenceKey === p.evidenceKey,
              )
              .map((m) => (
                <p key={m.id}>
                  Possible existing match:{" "}
                  <Link href={`/owner/purchases/${m.id}`}>
                    {m.id} · {m.status}
                  </Link>
                </p>
              ))}
          </article>
        ))}
      </div>
      {data.purchases.length > 0 ? (
        <form action={purchaseAction}>
          <input type="hidden" name="operation" value="confirm-import" />
          <input type="hidden" name="documentId" value={id} />
          <label>
            <input type="checkbox" name="confirmation" required /> I reviewed
            the preview, verified USD currency, warnings and rejected rows.
            Import the listed movements as pending only.
          </label>
          <Submit>Confirm import — no costs recorded</Submit>
        </form>
      ) : (
        <p role="alert">
          No valid or retainable movements. Correct the rejected rows and upload
          again.
        </p>
      )}
    </>
  );
}
