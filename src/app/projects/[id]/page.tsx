import { ProjectSections } from "@/project-operations/components/sections";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectCalendar } from "@/project-operations/components/calendar";
import { requireUser } from "@/server/auth";
import { workspace } from "@/project-operations/server/view";
import { db } from "@/server/db";
import {
  OperationForm as Form,
  EvidenceForm,
  type Field,
} from "@/project-operations/components/form";
import {
  states,
  managers,
  projectManagerRoles,
  taskAssigneeRoles,
} from "@/project-operations/domain/rules";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; month?: string; tab?: string }>;
}) {
  const query = await searchParams;
  const u = await requireUser(),
    { id } = await params,
    w = await workspace(u, id).catch(() => notFound()),
    notice = (await searchParams).notice,
    manage = managers.includes(u.role),
    finance = w.financial;
  const f = (
    name: string,
    type?: string,
    value?: string | number,
    optional = false,
  ): Field => ({ name, type, value, optional });
  const choices = (name: string, values: string[]): Field => ({
    name,
    options: values.map((value) => ({ value, label: value })),
  });
  const hidden = (name: string, value: string | number) =>
    f(name, "hidden", value);
  const form = (op: string, title: string, fields: Field[]) => (
    <Form projectId={id} operation={op} title={title} fields={fields} />
  );
  const assignee: Field = {
    name: "assigneeId",
    label: "Task assignee",
    optional: true,
    options: w.users
      .filter(
        (x) =>
          taskAssigneeRoles.some((role) => role === x.role) &&
          w.members.some((m) => m.userId === x.id && m.active),
      )
      .map((x) => ({ value: x.id, label: x.name })),
  };
  const allWorkers = manage
    ? await db.user.findMany({
        where: {
          active: true,
          role: { in: ["OWNER", "ADMIN", "PROJECT_MANAGER", "CREW"] },
        },
        select: { id: true, name: true, role: true },
      })
    : [];
  const templateRows = manage
    ? await db.operationsTemplate.findMany({
        where: { active: true },
        select: { id: true, name: true, version: true },
      })
    : [];
  return (
    <>
      <Link href="/projects">← Projects</Link>
      <h1>
        {w.project.customer.firstName} {w.project.customer.lastName}
      </h1>
      <p>
        {w.project.state} ·{" "}
        {w.project.projectAddress ||
          w.project.estimate?.projectAddress ||
          "Address not configured"}
      </p>
      {notice && (
        <p role="status" className="panel">
          {notice.slice(0, 300)}
        </p>
      )}
      <details className="project-overview">
        <summary>
          {u.role === "CREW" ? "My progress" : "Project summary"}:{" "}
          {w.summary.progress}% · {w.summary.overdueTasks} overdue tasks · View
          alerts
        </summary>
        <div className="project-summary operations-grid">
          <article className="panel">
            <h2>
              {u.role === "CREW" ? "My task progress" : "Project progress"}
            </h2>
            <progress max={100} value={w.summary.progress} />
            <strong>{w.summary.progress}%</strong>
            <p>
              {w.summary.completedTasks}/{w.summary.taskCount} tasks complete ·{" "}
              {w.summary.completedStages}/{w.summary.stageCount} stages complete
            </p>
          </article>
          <article className="panel">
            <h2>Operational alerts</h2>
            <p>
              {w.summary.overdueTasks} overdue tasks ·{" "}
              {w.summary.pendingMaterials} pending materials
            </p>
            <p>
              {w.summary.pendingInspections} pending required inspections ·{" "}
              {w.summary.blockingDefects} blocking defects
            </p>
            <p>
              Target:{" "}
              {w.project.estimatedCompletionDate?.toLocaleDateString("en-US") ??
                "Not scheduled"}
            </p>
          </article>
        </div>
      </details>
      <ProjectSections
        crew={u.role === "CREW"}
        key={query.tab ?? (u.role === "CREW" ? "tasks" : "scope")}
        initialTab={query.tab ?? (u.role === "CREW" ? "tasks" : "scope")}
      >
        <section id="scope" className="panel">
          <h2>Approved scope and project</h2>
          <p>
            Opportunity: {w.project.opportunity.stage} · Estimate:{" "}
            {w.project.estimate?.number ?? "Legacy project"}
          </p>
          <p className="preserve-lines">
            {(w.project.originalScopeSnapshot as { scope?: string })?.scope ||
              w.project.estimate?.scope ||
              "No scope recorded"}
          </p>
          <p>Inclusions: {w.project.estimate?.inclusions || "Not recorded"}</p>
          <p>Exclusions: {w.project.estimate?.exclusions || "Not recorded"}</p>
          {manage && (
            <>
              {form("details", "Project details", [
                f("address", undefined, w.project.projectAddress),
                f("startDate", "date"),
                f("completionDate", "date"),
                {
                  name: "managerId",
                  label: "Project Manager",
                  value: w.project.projectManagerId ?? undefined,
                  options: [
                    { value: "", label: "Select Project Manager" },
                    ...allWorkers
                      .filter((x) =>
                        projectManagerRoles.some((role) => role === x.role),
                      )
                      .map((x) => ({
                        value: x.id,
                        label: x.name,
                      })),
                  ],
                },
              ])}
              {form("state", "Change project state", [
                choices("state", [...states]),
                f("reason", "textarea"),
                f("exception", "textarea", undefined, true),
              ])}
              {form("template", "Apply execution template", [
                {
                  name: "templateId",
                  options: templateRows.map((t) => ({
                    value: t.id,
                    label: `${t.name} · v${t.version}`,
                  })),
                },
              ])}
            </>
          )}
        </section>
        <section id="schedule" className="panel">
          <h2>Schedule · calendar and list</h2>
          <p>
            Planned:{" "}
            {w.project.startDate?.toLocaleDateString() ?? "Unscheduled"} →{" "}
            {w.project.estimatedCompletionDate?.toLocaleDateString() ??
              "Unscheduled"}
          </p>
          <div className="operations-grid">
            {w.stages.map((s) => (
              <article key={s.id}>
                <h3>{s.title}</h3>
                <p>
                  {s.plannedStart?.toLocaleDateString() ?? "Unscheduled"} →{" "}
                  {s.plannedEnd?.toLocaleDateString() ?? "Unscheduled"}
                  {s.plannedEnd &&
                    s.plannedEnd < new Date() &&
                    !s.actualEnd &&
                    " · DELAYED"}
                </p>
                <p>
                  Actual: {s.actualStart?.toLocaleDateString() ?? "—"} →{" "}
                  {s.actualEnd?.toLocaleDateString() ?? "—"}
                </p>
                {manage &&
                  form("stage-edit", "Edit stage", [
                    hidden("stageId", s.id),
                    f("title", undefined, s.title),
                    f("plannedStart", "date"),
                    f("plannedEnd", "date"),
                    f("actualStart", "date", undefined, true),
                    f("actualEnd", "date", undefined, true),
                  ])}
              </article>
            ))}
          </div>
          {manage &&
            form("stage", "Add stage", [
              f("title"),
              f("plannedStart", "date"),
              f("plannedEnd", "date"),
              f("position", "number", w.stages.length),
            ])}
          <form method="get">
            <input type="hidden" name="tab" value="schedule" />
            <label>
              Calendar month
              <input
                type="month"
                name="month"
                defaultValue={
                  query.month ?? new Date().toISOString().slice(0, 7)
                }
              />
            </label>
            <button>View month</button>
          </form>
          <ProjectCalendar
            tasks={w.tasks.map((t) => ({
              ...t,
              plannedStart:
                t.plannedStart ??
                w.stages.find((s) => s.id === t.stageId)?.plannedStart,
              assigneeName: w.users.find((x) => x.id === t.assigneeId)?.name,
              dependencyCount: w.dependencies.filter((d) => d.taskId === t.id)
                .length,
            }))}
            month={
              /^\d{4}-\d{2}$/.test(query.month ?? "")
                ? query.month!
                : new Date().toISOString().slice(0, 7)
            }
          />
          <details>
            <summary>Schedule list</summary>
            <ul>
              {w.tasks
                .filter((t) => t.dueAt)
                .map((t) => (
                  <li key={t.id}>
                    <time dateTime={t.dueAt!.toISOString()}>
                      {t.dueAt!.toLocaleDateString()}
                    </time>{" "}
                    · {t.title} · {t.status}
                  </li>
                ))}
            </ul>
          </details>
        </section>
        <section id="tasks">
          <h2>
            {u.role === "CREW" ? "My assigned tasks" : "Tasks and checklists"}
          </h2>
          {manage && (
            <p>
              Task assignees must be active members of this project. If a worker
              is missing, first{" "}
              <Link href={`/projects/${id}?tab=crew`}>
                assign them in Project Crew
              </Link>
              , then return here. Creating an account alone does not authorize
              project access.
            </p>
          )}
          {!w.tasks.length && (
            <p>
              No assigned tasks yet. A project manager can apply an execution
              template or add a task.
            </p>
          )}
          <div className="operations-grid">
            {w.tasks.map((t) => (
              <article key={t.id} className="panel task-card">
                <h3>{t.title}</h3>
                {u.role !== "SALES" &&
                  form("task-progress", "Record progress", [
                    hidden("taskId", t.id),
                    hidden("version", t.version),
                    f("progress", "number", t.progress),
                    f("note", "textarea", t.completionNote, true),
                  ])}
                <p className="muted">
                  Stage:{" "}
                  {w.stages.find((s) => s.id === t.stageId)?.title ??
                    "Unstaged"}{" "}
                  · Assigned:{" "}
                  {w.users.find((x) => x.id === t.assigneeId)?.name ??
                    "Unassigned"}
                </p>
                <details className="task-context">
                  <summary>Dependencies and recorded completion</summary>
                  <p className="muted">
                    Prerequisites:{" "}
                    {w.dependencies
                      .filter((d) => d.taskId === t.id)
                      .map(
                        (d) =>
                          w.tasks.find((x) => x.id === d.prerequisiteId)
                            ?.title ?? "Restricted prerequisite",
                      )
                      .join(", ") || "None"}
                  </p>
                  <p className="muted">
                    Recorded by:{" "}
                    {w.taskHistory[t.id]?.actorName ?? "No progress record"} ·
                    Supervisor completion approval: not recorded at task level.
                    Project inspection approval is separate.
                  </p>
                </details>
                <progress
                  max={100}
                  value={t.progress}
                  aria-label={`${t.title} progress`}
                />
                <p>
                  {t.priority} · {t.status} · {t.progress}% · Due{" "}
                  {t.dueAt?.toLocaleDateString() ?? "Unscheduled"}
                </p>
                {u.role !== "SALES" && (
                  <>
                    <EvidenceForm projectId={id} target="taskId" id={t.id} />
                    <details className="task-checklist">
                      <summary>
                        Checklist ·{" "}
                        {
                          w.checklists.filter(
                            (c) => c.taskId === t.id && c.completedAt,
                          ).length
                        }
                        /{w.checklists.filter((c) => c.taskId === t.id).length}{" "}
                        complete
                      </summary>
                      {w.checklists
                        .filter((c) => c.taskId === t.id)
                        .map((c) => (
                          <div key={c.id}>
                            <p>
                              {c.completedAt ? "✓" : "○"} {c.title}{" "}
                              {c.required && "(required)"}
                            </p>
                            {form("checklist", "Checklist result", [
                              hidden("checklistId", c.id),
                              choices("completed", ["true", "false"]),
                            ])}
                          </div>
                        ))}
                    </details>
                  </>
                )}
                <details>
                  <summary>Progress history and photos</summary>
                  {w.taskHistory[t.id]?.entries.map((entry, i) => (
                    <p key={i}>
                      {entry.at.toLocaleString("en-US")} · {entry.actorName} ·{" "}
                      {entry.progress}% · {entry.note}
                    </p>
                  ))}
                  {!w.taskHistory[t.id] && <p>No progress update recorded.</p>}
                  <div className="evidence-thumbnails">
                    {w.evidence
                      .filter((e) => e.taskId === t.id)
                      .map((e) => (
                        <a key={e.id} href={`/api/project-evidence/${e.id}`}>
                          <Image
                            src={`/api/project-evidence/${e.id}`}
                            alt={`Evidence: ${e.fileName}`}
                            width={120}
                            height={90}
                            unoptimized
                            loading="lazy"
                          />
                          {e.fileName}
                        </a>
                      ))}
                  </div>
                </details>
                {manage && (
                  <>
                    {form("task-edit", "Edit task", [
                      hidden("taskId", t.id),
                      hidden("version", t.version),
                      f("title", undefined, t.title),
                      assignee,
                      f("dueAt", "date"),
                    ])}
                    {form("checklist-create", "Add checklist item", [
                      hidden("taskId", t.id),
                      f("title"),
                      choices("required", ["true", "false"]),
                    ])}
                  </>
                )}
              </article>
            ))}
          </div>
          {manage && (
            <>
              {form("task", "Add task", [
                f("title"),
                {
                  name: "stageId",
                  optional: true,
                  options: w.stages.map((s) => ({
                    value: s.id,
                    label: s.title,
                  })),
                },
                assignee,
                f("dueAt", "date"),
                choices("priority", ["NORMAL", "HIGH", "CRITICAL", "LOW"]),
              ])}
              {form("dependency", "Add prerequisite", [
                {
                  name: "taskId",
                  options: w.tasks.map((t) => ({
                    value: t.id,
                    label: t.title,
                  })),
                },
                {
                  name: "prerequisiteId",
                  options: w.tasks.map((t) => ({
                    value: t.id,
                    label: t.title,
                  })),
                },
              ])}
            </>
          )}
        </section>
        <section id="crew" className="panel">
          <h2>Crew and work hours</h2>
          {w.members.map((m) => (
            <p key={m.id}>
              {w.users.find((x) => x.id === m.userId)?.name ?? "Inactive user"}{" "}
              · {m.kind} · {m.active ? "Assigned" : "Removed"}
            </p>
          ))}
          {manage &&
            form("member", "Assign or remove crew", [
              {
                name: "userId",
                label: "Project crew member",
                options: allWorkers.map((x) => ({
                  value: x.id,
                  label: x.name,
                })),
              },
              choices("kind", ["EMPLOYEE", "SUBCONTRACTOR"]),
              choices("active", ["true", "false"]),
            ])}
          {u.role !== "SALES" &&
            form("time", "Record work hours", [
              u.role === "CREW"
                ? hidden("workerId", u.id)
                : {
                    name: "workerId",
                    options: w.users.map((x) => ({
                      value: x.id,
                      label: x.name,
                    })),
                  },
              f("workDate", "date"),
              f("minutes", "number"),
              f("description", "textarea"),
            ])}
          {w.time.map((t) => (
            <p key={t.id}>
              {t.workDate.toLocaleDateString()} · {t.minutes} minutes ·{" "}
              {t.description}
            </p>
          ))}
        </section>
        <section id="materials" className="panel">
          <h2>Materials and deliveries</h2>
          {w.materials.map((m) => (
            <p key={m.id}>
              {m.name} · {m.receivedQuantity}/{m.quantity} {m.unit} ·{" "}
              {m.supplier} · {m.status}
            </p>
          ))}
          {manage &&
            form("material", "Request material", [
              f("name"),
              f("quantity"),
              choices("unit", ["EACH", "SQFT", "LINEAR_FT", "FLAT"]),
              f("supplier", undefined, "", true),
            ])}
        </section>
        <section id="logs" className="panel">
          <h2>Daily job logs</h2>
          {u.role !== "SALES" &&
            form("daily-log", "Add daily log", [
              f("workDate", "date"),
              f("summary", "textarea"),
              f("incidents", "textarea", "", true),
              {
                name: "workers",
                label: "Workers present (select all that apply)",
                value: u.role === "CREW" ? u.id : "",
                options: w.users
                  .filter((x) =>
                    w.members.some((m) => m.userId === x.id && m.active),
                  )
                  .map((x) => ({ value: x.id, label: x.name })),
                optional: true,
              },
            ])}
          {w.logs.map((l) => (
            <article key={l.id}>
              <h3>
                {l.workDate.toLocaleDateString()} · version {l.version}
              </h3>
              <p>{l.summary}</p>
              <p>Incidents: {l.incidents || "None recorded"}</p>
              {u.role !== "SALES" && (
                <>
                  <EvidenceForm projectId={id} target="logId" id={l.id} />
                  {form("daily-log", "Append corrected log", [
                    hidden("replacesId", l.id),
                    f(
                      "workDate",
                      "date",
                      l.workDate.toISOString().slice(0, 10),
                    ),
                    f("summary", "textarea", l.summary),
                    f("incidents", "textarea", l.incidents, true),
                    {
                      name: "workers",
                      label: "Workers present",
                      value: (l.workers as string[]).join(","),
                      options: w.users
                        .filter((x) =>
                          w.members.some((m) => m.userId === x.id && m.active),
                        )
                        .map((x) => ({ value: x.id, label: x.name })),
                      optional: true,
                    },
                  ])}
                </>
              )}
            </article>
          ))}
        </section>
        <section id="quality" className="panel">
          <h2>Inspections and handover</h2>
          <p>
            Closure requires approved mandatory inspections, resolved blocking
            defects and completed mandatory checklists.
          </p>
          {w.inspections.map((i) => (
            <article key={i.id}>
              <h3>
                {i.title} · {i.status} {i.required && "· Required"}
              </h3>
              <p>{i.notes}</p>
              {manage && (
                <>
                  <EvidenceForm
                    projectId={id}
                    target="inspectionId"
                    id={i.id}
                  />
                  {form("inspection-review", "Review inspection", [
                    hidden("inspectionId", i.id),
                    choices("status", ["APPROVED", "FAILED"]),
                    f("notes", "textarea"),
                  ])}
                </>
              )}
            </article>
          ))}
          {w.defects.map((d) => (
            <article key={d.id}>
              <p>
                {d.title} · {d.blocking ? "BLOCKING" : "Nonblocking"} ·{" "}
                {d.resolvedAt ? "Resolved" : "Open"}
              </p>
              {manage &&
                !d.resolvedAt &&
                form("defect-resolve", "Resolve defect", [
                  hidden("defectId", d.id),
                  f("resolution", "textarea"),
                ])}
            </article>
          ))}
          {manage && (
            <>
              {form("inspection", "Add inspection", [
                f("title"),
                choices("required", ["true", "false"]),
              ])}
              {form("defect", "Report defect", [
                f("title"),
                choices("blocking", ["true", "false"]),
              ])}
            </>
          )}
          <h3>Evidence</h3>
          {w.evidence.map((e) => (
            <p key={e.id}>
              <a href={`/api/project-evidence/${e.id}`}>{e.fileName}</a> ·{" "}
              {Math.ceil(e.byteSize / 1024)} KB
            </p>
          ))}
        </section>
        <section id="changes" className="panel">
          <h2>Scope change requests</h2>
          {w.requestedChanges.map((c) => (
            <p key={c.id}>
              {c.title} · v{c.version} · {c.status} · {c.scope} · schedule
              impact {c.scheduleDays} days
            </p>
          ))}
          {manage &&
            form("change-request", "Request scope change", [
              f("title"),
              f("reason", "textarea"),
              f("scope", "textarea"),
              f("scheduleDays", "number", 0),
            ])}
          <p>
            Requests are not authorization to execute changed scope. OWNER must
            review the financial version, approve it and apply it separately.
          </p>
        </section>
        {finance && (
          <section id="financial" className="panel">
            <h2>Restricted project costs</h2>
            <p>
              Original contract ${finance.originalRevenue} · Original estimated
              cost ${finance.originalEstimatedCost}
            </p>
            <p>
              Applied changes: revenue ${finance.approvedRevenue} · estimated
              cost ${finance.approvedCost}
            </p>
            <p>
              Committed ${finance.committed} · Recorded actual costs $
              {finance.actual}
            </p>
            <p>
              {finance.profit === null
                ? "Profitability is provisional: completion and OWNER cost reconciliation are required."
                : `Reconciled recorded project contribution: $${finance.profit}. This is not company net profit.`}
            </p>
            {form("cost", "Record cost", [
              choices("category", [
                "LABOR",
                "MATERIAL",
                "SUBCONTRACTOR",
                "OTHER",
              ]),
              choices("kind", ["ACTUAL", "COMMITTED"]),
              f("amount"),
              f("sourceReference"),
              f("description", "textarea"),
            ])}
            {finance.costs.map((c) => (
              <p key={c.id}>
                {c.category} · {c.kind} · ${c.amount} · {c.sourceReference}
              </p>
            ))}
            {form("purchase", "Request purchase", [
              {
                name: "materialId",
                options: w.materials.map((m) => ({
                  value: m.id,
                  label: m.name,
                })),
              },
              f("quantity"),
              f("unitCost"),
            ])}
            {finance.purchases.map((p) => (
              <article key={p.id}>
                <p>
                  Purchase {p.id} · {p.status} · {p.quantity} × ${p.unitCost}
                </p>
                {form("purchase-state", "Update purchase", [
                  hidden("purchaseId", p.id),
                  choices("status", [
                    "APPROVED",
                    "ORDERED",
                    "DELIVERED",
                    "CANCELLED",
                  ]),
                ])}
              </article>
            ))}
            {form("change-create", "Create change order", [
              f("title"),
              f("reason", "textarea"),
              f("scope", "textarea"),
              f("priceDelta"),
              f("costDelta"),
              f("scheduleDays", "number", 0),
            ])}
            {finance.changes.map((c) => (
              <article key={c.id}>
                <h3>
                  {c.title} · v{c.version} · {c.status}
                </h3>
                <p>
                  {c.scope} · Price delta ${c.priceDelta} · Cost delta $
                  {c.costDelta} · {c.scheduleDays} days
                </p>
                {u.role === "OWNER" &&
                  ["change-approve", "change-reject", "change-apply"].map(
                    (op) => (
                      <div key={op}>
                        {form(op, op.replaceAll("-", " "), [
                          hidden("changeId", c.id),
                          hidden("version", c.version),
                          f("reason", "textarea"),
                        ])}
                      </div>
                    ),
                  )}
                {c.status === "DRAFT" &&
                  form("change-revise", "Revise change order", [
                    hidden("changeId", c.id),
                    f("title", undefined, c.title),
                    f("reason", "textarea", c.reason),
                    f("scope", "textarea", c.scope),
                    f("priceDelta", undefined, c.priceDelta),
                    f("costDelta", undefined, c.costDelta),
                    f("scheduleDays", "number", c.scheduleDays),
                  ])}
              </article>
            ))}
            {u.role === "OWNER" &&
              form("cost-review", "Confirm cost reconciliation", [
                choices("confirmation", ["false", "true"]),
              ])}
            <p>
              Reconciliation confirms all invoices, labor and other costs have
              been recorded; it does not change the original estimate.
            </p>
          </section>
        )}
        <section id="history" className="panel">
          <h2>Immutable activity history</h2>
          {w.events.map((e) => (
            <p key={e.id}>
              {e.createdAt.toLocaleString()} · {e.type}
            </p>
          ))}
        </section>
      </ProjectSections>
    </>
  );
}
