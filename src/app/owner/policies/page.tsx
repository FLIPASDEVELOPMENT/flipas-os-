import { requireOwner } from "@/owner/auth";
import { activePolicy } from "@/owner/service";
import { policyAction } from "@/owner/actions";
import { db } from "@/server/db";
import Decimal from "decimal.js";
export default async function Policies({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireOwner();
  const p = await activePolicy();
  const history = await db.financialPolicy.findMany({
    orderBy: { version: "desc" },
    include: { createdBy: { select: { name: true } } },
    take: 50,
  });
  const q = await searchParams;
  return (
    <>
      <h1>Financial policies</h1>
      <p className="muted">
        Every save creates an immutable, audited version. Existing estimates
        retain their policy snapshot; new estimates inherit the active version.
      </p>
      {q.error && (
        <p role="alert" className="error">
          {q.error}
        </p>
      )}
      {q.saved && <p role="status">Financial policy saved.</p>}
      <section className="panel">
        <h2>Active version {p.version}</h2>
        <form action={policyAction} className="form">
          <input type="hidden" name="expectedVersion" value={p.version} />
          {[
            [
              "monthlyProjectedRevenue",
              "Monthly projected revenue (USD)",
              p.monthlyProjectedRevenue,
            ],
            [
              "monthlyFixedOverhead",
              "Monthly fixed overhead (USD)",
              p.monthlyFixedOverhead,
            ],
            [
              "targetMarginPercent",
              "Target gross margin (%)",
              new Decimal(p.targetMargin).mul(100).toString(),
            ],
            [
              "minimumMarginPercent",
              "Minimum gross margin (%)",
              new Decimal(p.minimumMargin).mul(100).toString(),
            ],
            [
              "significantDiscountThresholdPercent",
              "Discount review threshold (%) — 0 reviews all discounts",
              new Decimal(p.significantDiscountThreshold).mul(100).toString(),
            ],
          ].map(([name, label, value]) => (
            <label key={name}>
              {label}
              <input
                type="number"
                name={name}
                min="0"
                max={
                  name.includes("Margin") || name.includes("Threshold")
                    ? "99.99"
                    : undefined
                }
                step={
                  name.includes("Margin") || name.includes("Threshold")
                    ? "0.01"
                    : "0.01"
                }
                defaultValue={value}
                required
              />
            </label>
          ))}
          <label className="wide">
            Reason for this policy change
            <textarea name="reason" required maxLength={2000} />
          </label>
          <p className="wide">
            Automatic allocation = contract value excluding tax × fixed monthly
            overhead ÷ projected monthly revenue. Current rate:{" "}
            {new Decimal(p.monthlyFixedOverhead)
              .div(p.monthlyProjectedRevenue)
              .mul(100)
              .toFixed(4)}
            %. This replaces per-line overhead in new policy-backed estimate
            totals to avoid double counting. It is a planning allocation, not an
            actual expense.
          </p>
          <button>Save new policy version</button>
        </form>
      </section>
      <section className="panel">
        <h2>Version history</h2>
        {history.map((v) => (
          <article className="row" key={v.id}>
            <div>
              <strong>Version {v.version}</strong>
              <p>{v.reason}</p>
              <small>
                {new Intl.DateTimeFormat("en-US", {
                  timeZone: "America/New_York",
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(v.createdAt)}{" "}
                ET ·{" "}
                {v.createdBy?.name ??
                  "Owner-requested migration initialization"}
              </small>
            </div>
            <div>
              Revenue ${v.monthlyProjectedRevenue.toString()}
              <br />
              Fixed overhead ${v.monthlyFixedOverhead.toString()}
              <br />
              Target{" "}
              {new Decimal(v.targetMargin.toString()).mul(100).toString()}% ·
              Minimum{" "}
              {new Decimal(v.minimumMargin.toString()).mul(100).toString()}%
              <br />
              Discount threshold {v.significantDiscountThreshold.toString()}
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
