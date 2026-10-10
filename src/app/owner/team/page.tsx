import { requireOwner } from "@/owner/auth";
import { db } from "@/server/db";
import { teamAction } from "@/team/actions";
import { employeeRoles } from "@/team/validation";
import { Submit } from "@/project-operations/components/submit";
function Roles({ defaultRole = "" }: { defaultRole?: string }) {
  return (
    <select name="role" required defaultValue={defaultRole}>
      <option value="" disabled>
        Select employee role
      </option>
      {employeeRoles.map((role) => (
        <option key={role}>{role}</option>
      ))}
    </select>
  );
}
function PasswordFields() {
  return (
    <>
      <label>
        Initial password (12–256 characters)
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={256}
        />
      </label>
      <label>
        Confirm initial password
        <input
          type="password"
          name="confirmation"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={256}
        />
      </label>
    </>
  );
}
export default async function Team({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const actor = await requireOwner();
  const { notice } = await searchParams;
  const users = await db.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      passwordChangeRequired: true,
      _count: {
        select: { sessions: { where: { expiresAt: { gt: new Date() } } } },
      },
    },
    orderBy: { name: "asc" },
  });
  const projects = await db.project.findMany({
    select: {
      id: true,
      status: true,
      projectAddress: true,
      projectManagerId: true,
      customer: { select: { firstName: true, lastName: true } },
      operationsProjectMember: {
        where: { active: true },
        select: { userId: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return (
    <>
      <h1>Team & permissions</h1>
      {notice && (
        <p role="status" className="panel">
          {notice.slice(0, 300)}
        </p>
      )}
      <section className="panel">
        <p>
          OWNER retains financial policies and approvals. ADMIN retains existing
          commercial permissions, but not OWNER project finances. SALES has
          assigned commercial records. PROJECT_MANAGER and CREW have
          project-scoped operations, without restricted financial data. CUSTOMER
          has no operational workspace.
        </p>
        <p>
          No account can be promoted to OWNER here. Disabling or changing a role
          revokes sessions and removes project assignments; reactivation does
          not restore them.
        </p>
        <details>
          <summary>Create employee account</summary>
          <form action={teamAction} className="form">
            <input type="hidden" name="operation" value="create" />
            <label>
              Name
              <input name="name" required maxLength={100} autoComplete="off" />
            </label>
            <label>
              Email
              <input
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="off"
              />
            </label>
            <label>
              Role
              <Roles />
            </label>
            <PasswordFields />
            <p className="wide">
              Supply a unique initial password privately using a secure channel.
              It is never shown again, logged or stored as text. The employee
              must replace it before workspace access. No email is sent.
            </p>
            <Submit>Create employee</Submit>
          </form>
        </details>
      </section>
      <div className="operations-grid">
        {users.map((u) => (
          <article className="panel" key={u.id}>
            <h2>{u.name}</h2>
            <p>
              {u.email} · {u.role} · {u.active ? "Active" : "Disabled"}
            </p>
            <p>
              {u._count.sessions} current sessions ·{" "}
              {u.passwordChangeRequired
                ? "Password setup required"
                : "Password ready"}
              {u.id === actor.id && " · Your account"}
            </p>
            <form action={teamAction}>
              <input type="hidden" name="userId" value={u.id} />
              <input type="hidden" name="operation" value="active" />
              <input type="hidden" name="active" value={String(!u.active)} />
              <Submit confirm="Confirm account status change? Sessions and project assignments may be revoked.">
                {u.active ? "Deactivate" : "Activate"}
              </Submit>
            </form>
            <form action={teamAction}>
              <input type="hidden" name="userId" value={u.id} />
              <input type="hidden" name="operation" value="sessions" />
              <Submit confirm="Sign out every session of this user?">
                Revoke all sessions
              </Submit>
            </form>
            <details>
              <summary>Change employee role</summary>
              <form action={teamAction}>
                <input type="hidden" name="userId" value={u.id} />
                <input type="hidden" name="operation" value="role" />
                <label>
                  Role
                  <Roles
                    defaultRole={
                      ["OWNER", "CUSTOMER"].includes(u.role) ? "" : u.role
                    }
                  />
                </label>
                <Submit confirm="Changing role signs out the user and clears project assignments. The last active OWNER is protected.">
                  Change role
                </Submit>
              </form>
            </details>
            <details>
              <summary>Reset initial password</summary>
              <form action={teamAction}>
                <input type="hidden" name="userId" value={u.id} />
                <input type="hidden" name="operation" value="reset" />
                <PasswordFields />
                <Submit confirm="Replace this password and sign out all sessions? The user must set their own password on next login.">
                  Reset password
                </Submit>
              </form>
            </details>
            {["PROJECT_MANAGER", "CREW"].includes(u.role) && (
              <details>
                <summary>Authorized projects</summary>
                <p>
                  Project membership grants operational access; task assignment
                  remains in Project Workspace.
                </p>
                {projects
                  .filter(
                    (p) =>
                      p.projectManagerId === u.id ||
                      p.operationsProjectMember.some((m) => m.userId === u.id),
                  )
                  .map((p) => (
                    <form key={p.id} action={teamAction}>
                      <input
                        type="hidden"
                        name="operation"
                        value="assignment"
                      />
                      <input type="hidden" name="userId" value={u.id} />
                      <input type="hidden" name="projectId" value={p.id} />
                      <input type="hidden" name="active" value="false" />
                      <p>
                        {p.customer.firstName} {p.customer.lastName} ·{" "}
                        {p.projectAddress} · {p.id}
                      </p>
                      <Submit confirm="Remove access and unassign this user's project tasks?">
                        Remove project access
                      </Submit>
                    </form>
                  ))}
                {u.active && (
                  <form action={teamAction}>
                    <input type="hidden" name="operation" value="assignment" />
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="active" value="true" />
                    <label>
                      Authorize project
                      <select name="projectId" required>
                        <option value="">Select project</option>
                        {projects
                          .filter(
                            (p) =>
                              !["COMPLETED", "CANCELLED"].includes(p.status),
                          )
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.customer.firstName} {p.customer.lastName} ·{" "}
                              {p.projectAddress} · {p.id}
                            </option>
                          ))}
                      </select>
                    </label>
                    <Submit confirm="Grant this user access to the selected project?">
                      Authorize project
                    </Submit>
                  </form>
                )}
              </details>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
