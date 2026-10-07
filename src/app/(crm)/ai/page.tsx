import { requireCRM } from "@/server/auth";
export default async function Page() {
  await requireCRM();
  return (
    <>
      <h1>AI Center</h1>
      <section className="panel">
        <span className="badge">Phase 2 · Not enabled</span>
        <p>
          Recommendations, actions awaiting approval and agent activity will be
          enabled in Phase 2. No AI actions are executed and no development
          recommendations are presented as real results.
        </p>
      </section>
    </>
  );
}
