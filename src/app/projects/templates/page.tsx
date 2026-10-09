import { notFound } from "next/navigation";
import { TemplateEditor } from "@/project-operations/components/template-editor";
import {
  templateDefinition,
  templates,
} from "@/project-operations/domain/rules";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { templateAction } from "@/project-operations/server/actions";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const notice = (await searchParams).notice;
  const u = await requireUser();
  if (!["OWNER", "ADMIN"].includes(u.role)) notFound();
  const rows = await db.operationsTemplate.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });
  return (
    <>
      <h1>Editable execution templates</h1>
      {notice && (
        <p role="status" className="panel">
          {notice.slice(0, 300)}
        </p>
      )}
      <p>
        Changes create a new version. Existing project snapshots stay unchanged.
        Edit stages and task titles; each task generates a mandatory checklist.
      </p>
      <form action={templateAction}>
        <input type="hidden" name="initialize" value="true" />
        <button>Initialize missing Kitchen, Bathroom and LVP templates</button>
      </form>
      {rows.map((t) => (
        <section className="panel" key={t.id}>
          <h2>
            {t.name} · version {t.version}
          </h2>
          <TemplateEditor
            name={t.name}
            initial={templateDefinition.parse(t.definition).stages}
            recommended={
              templates.find((stock) => stock.name === t.name)?.stages
            }
          />
        </section>
      ))}
    </>
  );
}
