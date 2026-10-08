import Link from "next/link";
import Decimal from "decimal.js";
import { requireOwner } from "@/owner/auth";
import { ownerSummary } from "@/owner/service";
const usd = (s: string) => "$" + new Decimal(s).toFixed(2);
export default async function Executive() {
  const s = await ownerSummary(await requireOwner());
  return (
    <>
      <h1>Your business, in view</h1>
      <p className="muted">
        Live database records. Accepted contracts are bookings, not received
        revenue. Monthly metrics use America/New_York calendar months.
      </p>
      <div className="owner-cards">
        {[
          [
            "Accepted contracts this month",
            usd(s.monthlyAcceptedContractValue),
          ],
          ["Monthly revenue plan", usd(s.policy.monthlyProjectedRevenue)],
          ["Open pipeline value", usd(s.pipelineValue)],
          ["Customers", String(s.customers)],
          ["Open leads", String(s.leads)],
          ["Projects", String(s.projects.length)],
          ["Pending approvals", String(s.pending)],
          ["Monthly fixed overhead", usd(s.policy.monthlyFixedOverhead)],
        ].map(([label, value]) => (
          <section className="panel" key={label}>
            <span className="muted">{label}</span>
            <strong>{value}</strong>
          </section>
        ))}
      </div>
      <section className="panel">
        <h2>Active financial policy · Version {s.policy.version}</h2>
        <p>
          Target gross margin{" "}
          {new Decimal(s.policy.targetMargin).mul(100).toString()}% · Minimum{" "}
          {new Decimal(s.policy.minimumMargin).mul(100).toString()}%
        </p>
        <p>
          Automatic project overhead:{" "}
          {new Decimal(s.policy.monthlyFixedOverhead)
            .div(s.policy.monthlyProjectedRevenue)
            .mul(100)
            .toFixed(4)}
          % of tax-exclusive contract value.
        </p>
        <Link href="/owner/policies" className="button">
          Review financial policies
        </Link>
      </section>
      <section className="panel">
        <h2>Owner actions</h2>
        <div className="button-row">
          <Link href="/owner/approvals" className="button secondary">
            Review pricing exceptions
          </Link>
          <Link href="/owner/profitability" className="button secondary">
            Inspect project profitability
          </Link>
        </div>
      </section>
    </>
  );
}
