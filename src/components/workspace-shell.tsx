import Link from "next/link";
import type { User } from "@/generated/prisma/client";
import { logout } from "@/app/actions";
import { canUseCRM } from "@/domain/permissions";
export function WorkspaceShell({
  user,
  children,
  operations = false,
}: {
  user: User;
  children: React.ReactNode;
  operations?: boolean;
}) {
  const links = canUseCRM(user.role)
    ? [
        ["/", "Dashboard"],
        ["/customers", "Customers"],
        ["/leads", "Leads"],
        ["/pipeline", "Pipeline"],
        ["/estimates", "Estimates"],
        ["/projects", "Projects"],
        ["/ai", "AI Center"],
        ["/settings", "Settings"],
      ]
    : [["/projects", "Projects"]];
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          FLIPAS OS<span style={{ color: "#d17b52" }}> ▪</span>
        </div>
        <p className="muted" style={{ color: "#b2c2bd" }}>
          AI-Powered Remodeling Operations
        </p>
        <nav aria-label="Main navigation">
          {user.role === "OWNER" && <Link href="/owner">Owner console</Link>}
          {links.map(([href, label]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
          {operations && ["OWNER", "ADMIN"].includes(user.role) && (
            <Link href="/projects/templates">Execution templates</Link>
          )}
          {operations && user.role === "OWNER" && (
            <Link href="/owner/operations">Operations dashboard</Link>
          )}
        </nav>
        <p>{user.name}</p>
        <p className="muted" style={{ color: "#b2c2bd" }}>
          {user.role.replaceAll("_", " ")}
        </p>
        <form action={logout}>
          <button>Sign out</button>
        </form>
      </aside>
      <main className={`main${operations ? " operations-shell" : ""}`}>
        <header className="top">
          <span className="eyebrow">Flipas Home Remodeling · Florida</span>
          <span className="muted">Operations workspace</span>
        </header>
        {children}
      </main>
    </div>
  );
}
