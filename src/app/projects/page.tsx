import Link from "next/link";
import { requireUser } from "@/server/auth";
import { projectList } from "@/project-operations/server/view";
export default async function Page() {
  const rows = await projectList(await requireUser());
  return (
    <>
      <h1>Project operations</h1>
      <p>
        Projects are created from accepted estimates and matching WON
        opportunities. Original financial snapshots remain preserved.
      </p>
      <div className="operations-grid">
        {rows.map((p) => (
          <article className="panel" key={p.id}>
            <h2>
              <Link href={`/projects/${p.id}`}>
                {p.customer.firstName} {p.customer.lastName}
              </Link>
            </h2>
            <p>
              {p.state} {p.delayed && "· DELAYED"}
            </p>
            <progress
              max={100}
              value={p.progress}
              aria-label="Recorded task progress"
            />
            <p>{p.progress}% recorded task progress</p>
            {p.nextTasks.map((t) => (
              <p key={t.id}>
                {t.title} ·{" "}
                {t.dueAt?.toLocaleDateString("en-US") ?? "Unscheduled"} · {t.assigneeName ?? "Unassigned"}
              </p>
            ))}
            <p>{p.projectAddress || "Address not configured"}</p>
            <p>
              Manager: {p.projectManager?.name ?? "Unassigned"} ·{" "}
              {p._count.tasks} tasks
            </p>
            <p>
              Target:{" "}
              {p.estimatedCompletionDate?.toLocaleDateString("en-US") ??
                "Not scheduled"}
            </p>
          </article>
        ))}
      </div>
      {!rows.length && <p>No accessible projects yet.</p>}
    </>
  );
}
