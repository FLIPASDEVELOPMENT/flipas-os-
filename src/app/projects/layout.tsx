import Link from "next/link";
import { requireUser } from "@/server/auth";
import { logout } from "../actions";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const u = await requireUser();
  if (!["OWNER", "ADMIN", "SALES", "PROJECT_MANAGER", "CREW"].includes(u.role))
    return (
      <main>
        <h1>Project access unavailable</h1>
      </main>
    );
  return (
    <div className="operations-shell">
      <header className="operations-nav">
        <Link href="/projects">FLIPAS · Projects</Link>
        {["OWNER", "ADMIN", "SALES"].includes(u.role) && (
          <Link href="/">CRM</Link>
        )}
        {u.role === "OWNER" && (
          <Link href="/owner/operations">Operations dashboard</Link>
        )}
        {["OWNER", "ADMIN"].includes(u.role) && (
          <Link href="/projects/templates">Execution templates</Link>
        )}
        <span>
          {u.name} · {u.role}
        </span>
        <form action={logout}>
          <button>Sign out</button>
        </form>
      </header>
      <main>{children}</main>
    </div>
  );
}
