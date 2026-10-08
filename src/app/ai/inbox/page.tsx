import Link from "next/link";
import { requireSalesAI, conversationScope } from "@/sales-ai/server/access";
import { classification } from "@/sales-ai/domain/intelligence";
import { db } from "@/server/db";
import { DateTime, Mode } from "@/sales-ai/components";
export default async function Inbox({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; state?: string }>;
}) {
  const u = await requireSalesAI(),
    p = await searchParams;
  const q = (p.q ?? "").slice(0, 100);
  const category = classification.safeParse(p.category);
  const rows = await db.mailConversation.findMany({
    where: {
      ...conversationScope(u),
      ...(q
        ? {
            OR: [
              { subject: { contains: q, mode: "insensitive" } },
              { senderEmail: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(category.success ? { classification: category.data } : {}),
      ...(p.state === "unread"
        ? { unread: true }
        : p.state === "unprocessed"
          ? { processed: false }
          : {}),
    },
    include: {
      connection: { select: { provider: true } },
      drafts: {
        select: { status: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return (
    <>
      <h1>AI Inbox</h1>
      <p className="muted">
        Review the commercial purpose before linking a contact. Latest 100
        matching conversations.
      </p>
      <form className="panel form" method="get">
        <label>
          Search sender or subject
          <input name="q" defaultValue={q} maxLength={100} />
        </label>
        <label>
          Classification
          <select name="category" defaultValue={p.category ?? ""}>
            <option value="">All categories</option>
            {classification.options.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          State
          <select name="state" defaultValue={p.state ?? ""}>
            <option value="">All</option>
            <option value="unread">Unread</option>
            <option value="unprocessed">Awaiting review</option>
          </select>
        </label>
        <div>
          <button>Filter inbox</button>
        </div>
      </form>
      <section className="panel">
        {!rows.length && (
          <p className="empty">
            No conversations match. In mock mode the owner initializes the demo
            mailbox, then the worker imports it.
          </p>
        )}
        {rows.map((c) => (
          <Link className="ai-thread row" href={"/ai/inbox/" + c.id} key={c.id}>
            <div>
              <strong>{c.subject}</strong>
              <p className="muted">
                {c.senderName || c.senderEmail} · {c.senderEmail}
              </p>
              <span className="badge">{c.classification}</span>{" "}
              <Mode provider={c.connection.provider} />
            </div>
            <div>
              <DateTime date={c.updatedAt} />
              <p>
                {c.unread ? "● Unread" : "Read"} ·{" "}
                {c.processed ? "Processed" : "Review needed"}
              </p>
              <span className="badge">
                {c.drafts[0]?.status ?? "No reply drafted"}
              </span>
            </div>
          </Link>
        ))}
      </section>
    </>
  );
}
