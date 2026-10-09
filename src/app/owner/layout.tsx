import WorkspaceLayout from "../(crm)/layout";
import Link from "next/link";
import { requireOwner } from "@/owner/auth";
export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOwner();
  return (
    <WorkspaceLayout>
      <div className="owner-console">
        <p className="eyebrow">OWNER CONSOLE · Executive workspace</p>
        <nav className="estimator-nav">
          {[
            ["/owner", "Executive overview"],
            ["/owner/policies", "Financial policies"],
            ["/owner/approvals", "Approval center"],
            ["/owner/team", "Team & permissions"],
            ["/owner/profitability", "Project profitability"],
            ["/owner/ai", "AI Administration"],
            ["/owner/operations", "Project operations"],
          ].map(([href, label]) => (
            <Link href={href} key={href}>
              {label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
    </WorkspaceLayout>
  );
}
