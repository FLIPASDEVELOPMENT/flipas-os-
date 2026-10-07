import { requireCRM } from "@/server/auth";
export default async function Page() {
  await requireCRM();
  return (
    <>
      <h1>Projects</h1>
      <section className="panel">
        <span className="badge">Phase 2 · Not enabled</span>
        <p>
          Project creation from won opportunities and task management are
          planned for Phase 2.
        </p>
      </section>
    </>
  );
}
