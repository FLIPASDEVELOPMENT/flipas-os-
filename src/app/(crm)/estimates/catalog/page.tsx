import { requireCRM } from "@/server/auth";
import { canManage } from "@/domain/permissions";
import { db } from "@/server/db";
import CatalogForm from "@/estimator/components/catalog-form";
import EstimatorNav from "@/estimator/components/nav";
import { initializeAction } from "@/estimator/server/actions";
import { catalogDTO } from "@/estimator/server/view";
export default async function Catalog({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const u = await requireCRM();
  const { error } = await searchParams;
  const [categories, items] = await Promise.all([
    db.serviceCategory.findMany({ orderBy: { name: "asc" } }),
    db.serviceItem.findMany({
      include: { history: { orderBy: { createdAt: "desc" }, take: 10 } },
      orderBy: { name: "asc" },
    }),
  ]);
  const admin = canManage(u.role);
  return (
    <>
      <p className="eyebrow">FLIPAS ESTIMATOR</p>
      <h1>Central pricing catalog</h1>
      <EstimatorNav />
      {error && <p className="error">{error}</p>}
      <p className="muted">
        All costs are per unit. Margin fields use ratios: 0.30 means 30%. Every
        change records before/after values; old estimates retain their
        snapshots.
      </p>
      {admin && (
        <form action={initializeAction}>
          <button>
            Initialize missing categories and scope templates (no prices)
          </button>
        </form>
      )}
      {admin && !!categories.length && (
        <section className="panel" style={{ marginTop: 24 }}>
          <h2>Create service item</h2>
          <CatalogForm categories={categories} />
        </section>
      )}
      {items.map((item) => (
        <section className="panel" key={item.id} style={{ marginTop: 24 }}>
          <h2>
            {item.name}{" "}
            <span className="badge">{item.active ? "Active" : "Inactive"}</span>
          </h2>
          {admin ? (
            <details>
              <summary>Edit authorized pricing</summary>
              <CatalogForm item={catalogDTO(item)} categories={categories} />
            </details>
          ) : (
            <p>
              {item.unit} · Material ${item.materialCost.toFixed(2)} · Labor $
              {item.laborCost.toFixed(2)} · Target ratio{" "}
              {item.targetMargin.toString()}
            </p>
          )}
          <details>
            <summary>
              Pricing history ({item.history.length} latest changes)
            </summary>
            {item.history.map((h) => (
              <article key={h.id} className="history-entry">
                <p>
                  {h.createdAt.toISOString()} UTC · {h.reason}
                </p>
                <details>
                  <summary>Before / after snapshot</summary>
                  <pre>
                    {JSON.stringify(
                      { before: h.before, after: h.after },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </article>
            ))}
          </details>
        </section>
      ))}
      {!items.length && (
        <section className="panel" style={{ marginTop: 24 }}>
          <p>
            No company pricing has been invented. Owner/Admin should enter
            approved cost and margin values.
          </p>
        </section>
      )}
    </>
  );
}
