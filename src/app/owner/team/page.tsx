import { requireOwner } from "@/owner/auth";
import { db } from "@/server/db";
export default async function Team() {
  await requireOwner();
  const users = await db.user.findMany({
    select: { id: true, name: true, email: true, role: true, active: true },
    orderBy: { name: "asc" },
  });
  return (
    <>
      <h1>Team & permissions</h1>
      <section className="panel">
        <p>
          Existing accounts and authentication. No separate owner login. Role
          changes and secure provisioning continue through the existing
          administrator workflow.
        </p>
        <p>
          OWNER: owner reports and financial policies; ADMIN: CRM, catalog and
          estimator review; SALES: scoped CRM and draft preparation, no owner
          routes, reports or policy writes; PROJECT_MANAGER, CREW and CUSTOMER:
          no CRM workspace access.
        </p>
        {users.map((u) => (
          <article className="row" key={u.id}>
            <span>
              <strong>{u.name}</strong>
              <br />
              {u.email}
            </span>
            <span className="badge">
              {u.role} · {u.active ? "Active" : "Disabled"}
            </span>
          </article>
        ))}
      </section>
    </>
  );
}
