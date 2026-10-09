import Decimal from "decimal.js";
import { requireOwner } from "@/owner/auth";
import { ownerSummary } from "@/owner/service";
export default async function Profitability() {
  const s = await ownerSummary(await requireOwner());
  return (
    <>
      <h1>Project profitability</h1>
      <p className="muted">
        Contract and estimated costs come from accepted estimates. Recorded
        actual cost is not final; actual margin is unavailable until a job-cost
        completion and OWNER reconciliation have been recorded.
      </p>
      {!s.projects.length && (
        <section className="panel">
          No projects yet. Accept an estimate and use the controlled WON
          opportunity handoff.
        </section>
      )}
      {s.projects.map((p) => {
        const overhead = p.estimate?.allocatedOverhead.toString() ?? "0";
        const actual = p.operationsProjectCostEntry
          .filter((c) => c.kind === "ACTUAL")
          .reduce(
            (sum, c) => sum.plus(c.amount.toString()),
            new Decimal(p.actualCost.toString()),
          );
        const delta = p.operationsProjectChangeOrder.reduce(
          (sum, c) => sum.plus(c.priceDelta.toString()),
          new Decimal(0),
        );
        const reconciled = p.status === "COMPLETED" && !!p.costsReviewedAt;
        const gross = new Decimal(p.contractValue.toString()).minus(
          p.estimatedCost.toString(),
        );
        return (
          <section className="panel" key={p.id}>
            <h2>
              {p.customer.firstName} {p.customer.lastName} ·{" "}
              {p.estimate?.number ?? "Existing project"}
            </h2>
            <p className="badge">{p.status}</p>
            <div className="financial-grid">
              {[
                ["Contract excluding tax", p.contractValue.toString()],
                ["Estimated direct cost", p.estimatedCost.toString()],
                ["Estimated gross profit", gross.toFixed(2)],
                ["Snapshotted overhead", overhead],
                [
                  "Estimated profit after overhead",
                  gross.minus(overhead).toFixed(2),
                ],
                ["Applied change order revenue", delta.toFixed(2)],
                [
                  reconciled
                    ? "Reconciled actual cost"
                    : "Recorded actual cost (provisional)",
                  actual.toFixed(2),
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <span className="muted">{label}</span>
                  <strong>${value}</strong>
                </div>
              ))}
            </div>
            <p>
              {reconciled
                ? `Reconciled recorded project contribution: $${new Decimal(p.contractValue.toString()).plus(delta).minus(actual).toFixed(2)}. Company net profit is not determined by this figure.`
                : "Actual profitability unavailable: complete and reconcile all project costs first."}
            </p>
            <p>
              Estimated gross margin:{" "}
              {p.contractValue.isZero()
                ? "N/A"
                : gross.div(p.contractValue.toString()).mul(100).toFixed(2) +
                  "%"}
            </p>
          </section>
        );
      })}
    </>
  );
}
