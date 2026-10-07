import { requireCRM } from "@/server/auth";
export default async function Page() {
  await requireCRM();
  return (
    <>
      <h1>Estimates</h1>
      <section className="panel">
        <span className="badge">Phase 2 · Not enabled</span>
        <p>
          The pricing catalog and snapshot estimate builder are planned for
          Phase 2. No estimates can be created or sent yet.
        </p>
      </section>
    </>
  );
}
