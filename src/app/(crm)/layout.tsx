import Link from "next/link";
import { requireUser } from "@/server/auth";
import { canUseCRM } from "@/domain/permissions";
import { logout } from "../actions";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          FLIPAS OS<span style={{ color: "#d17b52" }}> ▪</span>
        </div>
        <p className="muted" style={{ color: "#b2c2bd" }}>
          AI-Powered Remodeling Operations
        </p>
        <nav>
          {[
            ["/", "Dashboard"],
            ["/leads", "Leads"],
            ["/pipeline", "Pipeline"],
            ["/customers", "Customers"],
            ["/estimates", "Estimates"],
            ["/projects", "Projects"],
            ["/ai", "AI Center"],
            ["/settings", "Settings"],
          ].map(([url, label]) => (
            <Link key={url} href={url}>
              {label}
            </Link>
          ))}
        </nav>
        <p>{user.name}</p>
        <p className="muted" style={{ color: "#b2c2bd" }}>
          {user.role.replaceAll("_", " ")}
        </p>
        <form action={logout}>
          <button>Sign out</button>
        </form>
      </aside>
      <main className="main">
        <header className="top">
          <span className="eyebrow">Flipas Home Remodeling · Florida</span>
          <span className="muted">Operations workspace</span>
        </header>
        {canUseCRM(user.role) ? (
          children
        ) : (
          <section className="panel">
            <h1>Workspace access pending</h1>
            <p>
              Your role does not have access to the Phase 1 sales workspace.
              Contact the owner.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
