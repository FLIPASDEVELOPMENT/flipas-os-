import { requireUser } from "@/server/auth";
import { canUseCRM } from "@/domain/permissions";
import { WorkspaceShell } from "@/components/workspace-shell";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  return (
    <WorkspaceShell user={user}>
      {canUseCRM(user.role) ? (
        children
      ) : (
        <section className="panel">
          <h1>Workspace access pending</h1>
          <p>
            Your role does not have access to the sales workspace. Open Projects
            for assigned field operations.
          </p>
        </section>
      )}
    </WorkspaceShell>
  );
}
