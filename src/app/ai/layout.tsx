import Link from "next/link";
import WorkspaceLayout from "../(crm)/layout";
import { requireSalesAI } from "@/sales-ai/server/access";
export default async function AILayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSalesAI();
  return (
    <WorkspaceLayout>
      <p className="eyebrow">AI Sales workspace · Human decisions first</p>
      <nav className="estimator-nav">
        {[
          ["/ai", "Sales overview"],
          ["/ai/inbox", "Inbox"],
          ["/ai/follow-ups", "Follow-ups"],
        ].map(([href, label]) => (
          <Link href={href} key={href}>
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </WorkspaceLayout>
  );
}
