import { requireCRM } from "@/server/auth";
export default async function Settings() {
  const u = await requireCRM();
  return (
    <>
      <h1>Settings</h1>
      <section className="panel">
        <h2>Account</h2>
        <p>
          {u.name} · {u.email}
        </p>
        <span className="badge">{u.role}</span>
        <p className="muted">
          Account provisioning is available through the administrator CLI.
          Contact your owner for access changes.
        </p>
      </section>
      <section className="panel">
        <h2>Workspace policy</h2>
        <p>USD · UTC timestamps · Florida operations</p>
        <p>
          No external AI providers or communication integrations are enabled.
        </p>
      </section>
    </>
  );
}
