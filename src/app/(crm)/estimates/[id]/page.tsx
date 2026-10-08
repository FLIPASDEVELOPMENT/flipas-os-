import { parsePolicy, builderPolicy } from "@/owner/policy";
import Link from "next/link";
import Decimal from "decimal.js";
import { notFound } from "next/navigation";
import { requireCRM } from "@/server/auth";
import { db } from "@/server/db";
import { canManage } from "@/domain/permissions";
import { readEstimate, toDraft } from "@/estimator/server/service";
import { catalogDTO } from "@/estimator/server/view";
import { estimateAction } from "@/estimator/server/actions";
import Builder, { TemplateRow } from "@/estimator/components/builder";
import EstimatorNav from "@/estimator/components/nav";
export default async function Detail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const u = await requireCRM();
  const { id } = await params;
  const { error } = await searchParams;
  let e;
  try {
    e = await readEstimate(u, id);
  } catch {
    notFound();
  }
  const isAdmin = canManage(u.role);
  const now = new Date();
  const [catalog, templates, settings, versions, project] = await Promise.all([
    db.serviceItem.findMany({
      where: {
        active: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      orderBy: { name: "asc" },
    }),
    db.estimateTemplate.findMany({ where: { active: true } }),
    db.estimatorSettings.findUnique({ where: { id: "company" } }),
    db.estimate.findMany({
      where: { seriesId: e.seriesId },
      select: { id: true, number: true, revision: true, status: true },
      orderBy: { revision: "asc" },
    }),
    e.opportunityId
      ? db.project.findUnique({ where: { opportunityId: e.opportunityId } })
      : null,
  ]);
  const action = (name: string, label: string) => (
    <form action={estimateAction}>
      <input name="id" type="hidden" value={id} />
      <input name="contentVersion" type="hidden" value={e.contentVersion} />
      <button name="action" value={name}>
        {label}
      </button>
    </form>
  );
  return (
    <>
      <p className="eyebrow">
        FLIPAS ESTIMATOR · {e.customer.firstName} {e.customer.lastName}
      </p>
      <h1>
        {e.number ?? "Legacy estimate"}{" "}
        <span className="badge">{e.status}</span>
      </h1>
      <EstimatorNav />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        <div className="estimator-toolbar">
          <div>
            <p className="muted">
              Revision {e.revision} · Saved content version {e.contentVersion}
            </p>
            <p>
              {e.category} · {e.projectAddress}
            </p>
          </div>
          <div className="button-row">
            <Link
              className="button secondary"
              href={`/proposals/${id}`}
              target="_blank"
            >
              Customer preview
            </Link>
            <a className="button secondary" href={`/api/estimates/${id}/pdf`}>
              Download PDF
            </a>
          </div>
        </div>
        <p className="muted">
          No automatic customer delivery. A draft PDF is labeled as unreleased.
        </p>
        <div className="button-row">
          {action("duplicate", "Duplicate")}
          {e.status !== "DRAFT" && action("revise", "Create revision")}
          {e.status === "DRAFT" &&
            action("submit", "Submit saved draft for approval")}
          {isAdmin &&
            e.status === "APPROVED" &&
            action("release", "Release approved proposal (no delivery)")}
          {isAdmin &&
            e.status === "ACCEPTED" &&
            !project &&
            action("handoff", "Create initial project from WON opportunity")}
          {project && (
            <Link className="button secondary" href="/projects">
              View initial project
            </Link>
          )}
        </div>
      </section>
      {e.status === "DRAFT" ? (
        <Builder
          key={e.contentVersion}
          initial={toDraft(e)}
          policy={builderPolicy(parsePolicy(e.financialPolicySnapshot))}
          customers={[
            {
              id: e.customerId,
              name: `${e.customer.firstName} ${e.customer.lastName}`,
              address: e.projectAddress,
            },
          ]}
          opportunities={
            e.opportunity
              ? [
                  {
                    id: e.opportunity.id,
                    customerId: e.customerId,
                    name: "Linked opportunity",
                  },
                ]
              : []
          }
          catalog={catalog.map(catalogDTO)}
          templates={templates.map((t) => ({
            id: t.id,
            name: t.name,
            category: t.category,
            sections: t.sections as TemplateRow["sections"],
          }))}
          canReview={isAdmin}
          threshold={settings?.significantDiscountThreshold.toString() ?? "0"}
        />
      ) : (
        <section className="panel">
          <h2>Frozen internal financial snapshot · USD</h2>
          <div className="financial-grid">
            {[
              ["Direct cost", e.directCost],
              ["Overhead", e.allocatedOverhead],
              ["Selling price (net of tax)", e.sellingPrice],
              ["Discount", e.discountAmount],
              ["Tax", e.taxAmount],
              ["Investment", e.totalInvestment],
              ["Gross profit", e.grossProfit],
              ["Profit after overhead", e.contributionProfit],
            ].map(([name, value]) => (
              <div key={String(name)}>
                <span className="muted">{String(name)}</span>
                <strong>${String(value)}</strong>
              </div>
            ))}
            <div>
              <span className="muted">Gross margin</span>
              <strong>
                {e.sellingPrice.isZero()
                  ? "N/A"
                  : `${new Decimal(e.grossMargin.toString()).mul(100).toFixed(2)}%`}
              </strong>
            </div>
          </div>
          <p>Approval flags: {(e.approvalReasons as string[]).join(" · ")}</p>
          <p>
            Tax treatment: {e.taxTreatment} · Rate{" "}
            {new Decimal(e.taxRate.toString()).mul(100).toString()}%
          </p>
        </section>
      )}
      {e.status !== "DRAFT" && (
        <section className="panel">
          <h2>Internal line review</h2>
          <p>Internal notes: {e.notes || "None"}</p>
          {e.sections.map((section) => (
            <div key={section.id}>
              <h3>{section.name}</h3>
              {section.lines.map((line) => (
                <article className="estimate-line" key={line.id}>
                  <strong>{line.name}</strong>
                  <p>
                    {line.quantity.toString()} {line.unit} · Unit direct cost $
                    {line.unitCost.toString()} · Extended direct cost $
                    {line.totalCost.toString()} · Allocated overhead $
                    {line.allocatedOverhead.toString()}
                  </p>
                  <p>
                    Material ${line.materialCost.toString()} · Labor $
                    {line.laborCost.toString()} · Subcontractor $
                    {line.subcontractorCost.toString()} · Other $
                    {line.otherDirectCost.toString()}
                  </p>
                  <p>
                    Target margin {line.targetMargin.toString()} · Minimum
                    margin {line.minimumMargin.toString()} · Calculated unit
                    price ${line.calculatedUnitPrice.toString()} · Selling unit
                    price ${line.unitPrice.toString()}
                  </p>
                  <p>
                    Override reason: {line.overrideReason || "None"} · Actor:{" "}
                    {line.overriddenById || "None"} · Taxable:{" "}
                    {line.taxable ? "Yes" : "No"}
                  </p>
                </article>
              ))}
            </div>
          ))}
        </section>
      )}
      {isAdmin && e.status === "REVIEW" && (
        <section className="panel">
          <h2>Review exact saved version</h2>
          <p>
            Inspect the financial snapshot, tax treatment and proposal before
            approving. Exceptions are included in this review.
          </p>
          <form action={estimateAction} className="form">
            <input name="id" type="hidden" value={id} />
            <label className="wide">
              Review rationale
              <textarea name="rationale" required maxLength={2000} />
            </label>
            <button name="action" value="approve">
              Approve release and listed exceptions
            </button>
            <button className="secondary" name="action" value="reject">
              Reject and return to draft
            </button>
          </form>
        </section>
      )}
      {isAdmin && e.status === "SENT" && (
        <section className="panel">
          <h2>Record external customer acceptance</h2>
          <p>
            This records acceptance received outside FLIPAS OS; it does not
            represent an electronic signature.
          </p>
          <form action={estimateAction}>
            <input name="id" type="hidden" value={id} />
            <label>
              Evidence/reference
              <input
                name="reference"
                required
                maxLength={2000}
                placeholder="Signed contract reference, date and source"
              />
            </label>
            <p>
              <button name="action" value="accept">
                Record acceptance
              </button>
            </p>
          </form>
        </section>
      )}
      <section className="panel">
        <h2>Version history</h2>
        {versions.map((v) => (
          <Link key={v.id} className="row" href={`/estimates/${v.id}`}>
            {v.number ?? "Legacy"}
            <span className="badge">{v.status}</span>
          </Link>
        ))}
      </section>
      <section className="panel">
        <h2>Approval history</h2>
        {e.approvals.map((a) => (
          <article className="row" key={a.id}>
            <span>
              {a.status} · Content {a.contentVersion}
              <br />
              {a.rationale}
              <br />
              <small>{(a.reasons as string[]).join(" · ")}</small>
            </span>
            <span className="muted">
              {a.createdAt.toISOString()} UTC
              <br />
              Reviewer: {a.reviewerId ?? "Pending"}
            </span>
          </article>
        ))}
        {!e.approvals.length && (
          <p className="empty">No review requests yet.</p>
        )}
      </section>
    </>
  );
}
