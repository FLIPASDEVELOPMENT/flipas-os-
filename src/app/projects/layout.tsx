import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth";
import { WorkspaceShell } from "@/components/workspace-shell";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  if (
    !["OWNER", "ADMIN", "SALES", "PROJECT_MANAGER", "CREW"].includes(user.role)
  )
    notFound();
  return (
    <WorkspaceShell user={user} operations>
      {children}
    </WorkspaceShell>
  );
}
