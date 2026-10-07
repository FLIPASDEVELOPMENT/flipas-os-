import { requireCRM } from "@/server/auth";
import { db } from "@/server/db";
import { customerScope, opportunityScope } from "@/server/crm";
import { canManage } from "@/domain/permissions";
import Builder, { TemplateRow } from "@/estimator/components/builder";
import { catalogDTO } from "@/estimator/server/view";
import EstimatorNav from "@/estimator/components/nav";
import { DraftInput } from "@/estimator/domain/input";
export default async function New() {
  const u = await requireCRM();
  const now = new Date();
  const [customers, opportunities, catalog, templates, settings] =
    await Promise.all([
      db.customer.findMany({
        where: customerScope(u),
        orderBy: { firstName: "asc" },
      }),
      db.opportunity.findMany({
        where: opportunityScope(u),
        include: { lead: true },
      }),
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
    ]);
  const initial: DraftInput = {
    contentVersion: 0,
    customerId: "",
    opportunityId: "",
    category: "General Remodeling",
    projectAddress: "",
    scope: "",
    notes: "",
    inclusions: "",
    exclusions: "",
    durationDays: null,
    expiresAt: "",
    paymentSchedule: [],
    discountRate: "0",
    taxTreatment: "UNREVIEWED",
    taxRate: "0",
    sections: [{ name: "Scope of work", lines: [] }],
  };
  return (
    <>
      <p className="eyebrow">FLIPAS ESTIMATOR</p>
      <h1>New estimate</h1>
      <EstimatorNav />
      {!customers.length ? (
        <section className="panel">
          Create a customer in Customers before estimating.
        </section>
      ) : (
        <Builder
          initial={initial}
          customers={customers.map((c) => ({
            id: c.id,
            name: `${c.firstName} ${c.lastName}`,
            address: [c.address, c.city, c.state, c.zip]
              .filter(Boolean)
              .join(", "),
          }))}
          opportunities={opportunities.map((o) => ({
            id: o.id,
            customerId: o.customerId,
            name: o.lead.serviceType,
          }))}
          catalog={catalog.map(catalogDTO)}
          templates={templates.map((t) => ({
            id: t.id,
            name: t.name,
            category: t.category,
            sections: t.sections as TemplateRow["sections"],
          }))}
          canReview={canManage(u.role)}
          threshold={settings?.significantDiscountThreshold.toString() ?? "0"}
        />
      )}
    </>
  );
}
