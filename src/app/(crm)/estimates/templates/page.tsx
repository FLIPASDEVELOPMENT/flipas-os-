import { requireCRM } from "@/server/auth";
import { canManage } from "@/domain/permissions";
import { db } from "@/server/db";
import { templateAction } from "@/estimator/server/actions";
import EstimatorNav from "@/estimator/components/nav";
export default async function Templates({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const u = await requireCRM();
  const { error } = await searchParams;
  const templates = await db.estimateTemplate.findMany({
    orderBy: { name: "asc" },
  });
  return (
    <>
      <h1>Scope templates</h1>
      <EstimatorNav />
      {error && <p className="error">{error}</p>}
      <section className="panel">
        <p>
          Kitchen, bathroom and flooring checklists initialize from Pricing
          catalog. They contain no invented company pricing. Each estimate can
          change all copied scope.
        </p>
        <p className="muted">
          Owner/Admin configuration uses structured JSON. Optional serviceItemId
          links a checklist row to a catalog service; otherwise the builder
          creates an editable custom row requiring approval.
        </p>
      </section>
      {templates.map((t) => (
        <section className="panel" key={t.id}>
          <h2>{t.name}</h2>
          {canManage(u.role) ? (
            <form action={templateAction}>
              <label>
                Template configuration JSON
                <textarea
                  className="json-editor"
                  name="payload"
                  required
                  defaultValue={JSON.stringify(
                    {
                      id: t.id,
                      name: t.name,
                      category: t.category,
                      active: t.active,
                      sections: t.sections,
                    },
                    null,
                    2,
                  )}
                />
              </label>
              <p>
                <button>Save template</button>
              </p>
            </form>
          ) : (
            <pre>{JSON.stringify(t.sections, null, 2)}</pre>
          )}
        </section>
      ))}
      {canManage(u.role) && (
        <section className="panel">
          <h2>Add custom scope template</h2>
          <form action={templateAction}>
            <label>
              Template configuration JSON
              <textarea
                className="json-editor"
                name="payload"
                required
                defaultValue={JSON.stringify(
                  {
                    name: "New scope template",
                    category: "General Remodeling",
                    active: true,
                    sections: [
                      {
                        name: "Scope",
                        items: [{ name: "Required service", unit: "EACH" }],
                      },
                    ],
                  },
                  null,
                  2,
                )}
              />
            </label>
            <p>
              <button>Create template</button>
            </p>
          </form>
        </section>
      )}
    </>
  );
}
