import Link from "next/link";
import { db } from "@/server/db";
import { requireSalesAI, conversationScope } from "@/sales-ai/server/access";
import { complete } from "@/sales-ai/actions";
import { DateTime, Notice } from "@/sales-ai/components";
export default async function FollowUps({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const u = await requireSalesAI(),
    p = await searchParams;
  const rows = await db.salesFollowUp.findMany({
    where: { conversation: conversationScope(u) },
    include: { conversation: { select: { id: true, subject: true } } },
    orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }],
    take: 100,
  });
  const users = await db.user.findMany({
    where: { id: { in: rows.map((r) => r.assignedToId) } },
    select: { id: true, name: true },
  });
  return (
    <>
      <h1>Follow-up manager</h1>
      <p className="muted">
        Reminders never send a customer email. Open a conversation to draft a
        reply and request approval.
      </p>
      <Notice {...p} />
      <section className="panel">
        <h2>Due and overdue</h2>
        {!rows.some((f) => !f.completedAt) && (
          <p className="empty">No open follow-ups.</p>
        )}
        {rows
          .filter((f) => !f.completedAt)
          .map((f) => (
            <div className="row" key={f.id}>
              <div>
                <Link href={"/ai/inbox/" + f.conversationId}>
                  <strong>{f.conversation.subject}</strong>
                </Link>
                <p>{f.reason}</p>
                <small>
                  {users.find((u) => u.id === f.assignedToId)?.name ??
                    "Assigned representative"}{" "}
                  · <DateTime date={f.dueAt} />
                </small>
              </div>
              <div>
                {f.dueAt < new Date() && <p className="error">Overdue</p>}
                <form action={complete}>
                  <input type="hidden" name="id" value={f.id} />
                  <button>Mark completed</button>
                </form>
              </div>
            </div>
          ))}
      </section>
      <section className="panel">
        <h2>Completed history</h2>
        {rows
          .filter((f) => f.completedAt)
          .map((f) => (
            <div className="row" key={f.id}>
              <Link href={"/ai/inbox/" + f.conversationId}>
                {f.conversation.subject} · {f.reason}
              </Link>
              <DateTime date={f.completedAt!} />
            </div>
          ))}
      </section>
    </>
  );
}
