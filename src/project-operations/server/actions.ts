"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { mutate, saveTemplate, initializeTemplates } from "./service";
const numbers = new Set([
  "version",
  "minutes",
  "progress",
  "position",
  "scheduleDays",
]);
const booleans = new Set([
  "active",
  "completed",
  "required",
  "blocking",
  "confirmation",
]);
export async function projectAction(form: FormData) {
  const u = await requireUser(),
    projectId = String(form.get("projectId") ?? ""),
    operation = String(form.get("operation") ?? "");
  const input: Record<string, unknown> = {};
  for (const [key, value] of form) {
    if (
      ["projectId", "operation"].includes(key) ||
      key.startsWith("$ACTION") ||
      typeof value !== "string"
    )
      continue;
    if (
      value === "" &&
      [
        "stageId",
        "assigneeId",
        "replacesId",
        "actualStart",
        "actualEnd",
      ].includes(key)
    )
      continue;
    input[key] = numbers.has(key)
      ? Number(value)
      : booleans.has(key)
        ? value === "true"
        : key === "workers"
          ? value
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean)
          : value;
  }
  if (form.has("workers"))
    input.workers = form
      .getAll("workers")
      .flatMap((v) => String(v).split(","))
      .map((v) => v.trim())
      .filter(Boolean);
  if (!input.requestKey) input.requestKey = randomUUID();
  let message = "Saved and audited";
  try {
    await mutate(u, projectId, operation, input);
  } catch (e) {
    message = safeError(e);
  }
  revalidatePath("/projects");
  revalidatePath("/owner/operations");
  redirect(
    `/projects/${encodeURIComponent(projectId)}?notice=${encodeURIComponent(message)}`,
  );
}
const errors: Record<string, string> = {
  INVALID_TRANSITION:
    "This state transition is not allowed. Review the project lifecycle.",
  INVALID_DATES: "End dates must not precede start dates.",
  INVALID_ASSIGNEE: "Choose an active assigned worker with an eligible role.",
  PROJECT_LINK_MISMATCH: "The selected record does not belong to this project.",
  NEGATIVE_REVISED_BUDGET:
    "This change would produce a negative revised budget. Review the amounts.",
  PURCHASE_COMMITMENT_ALREADY_TRACKED:
    "This purchase commitment is already included. Do not add it again as a manual commitment.",
  PROJECT_NOT_COMPLETED:
    "Complete the project before confirming cost reconciliation.",
  CHANGE_FINANCIAL_REVIEW_REQUIRED:
    "This scope request needs a financial revision before OWNER approval. Review amounts and create a revision first.",
  ACCESS_DENIED: "You do not have permission for this project or operation.",
  QUALITY_GATE_REQUIRED:
    "Closure requires approved mandatory inspections, completed checklists and no blocking defects. Only OWNER may justify an exception.",
  STALE_VERSION: "This record changed. Reload and review the current version.",
  DEPENDENCY_PENDING: "Complete the prerequisite tasks first.",
  COMPLETION_EVIDENCE_REQUIRED:
    "Record completion notes, required checklist results and photo evidence first.",
  PROJECT_CLOSED: "This project is closed; operational changes are blocked.",
  DAILY_HOURS_LIMIT:
    "Recorded work exceeds 16 hours for this worker on this date.",
  CHANGE_FROZEN:
    "This change order is frozen. Create a new revision of a draft.",
  APPROVAL_REQUIRED: "The exact change order version needs OWNER approval.",
  DUPLICATE_COST_REFERENCE: "This cost source has already been recorded.",
  FILE_QUOTA_LIMIT: "Evidence storage quota reached. Contact OWNER.",
  TEMPLATE_ALREADY_APPLIED:
    "This project already has a template snapshot. Customize its stages and tasks instead.",
};
function safeError(e: unknown) {
  const code = e instanceof Error ? e.message : "";
  return (
    errors[code] ??
    "The operation was rejected. Check required fields, dates, project links and permissions. No changes were saved."
  );
}
export async function templateAction(form: FormData) {
  const u = await requireUser();
  let message = "Template saved";
  try {
    if (form.get("initialize")) await initializeTemplates(u);
    else
      await saveTemplate(
        u,
        String(form.get("name")),
        JSON.parse(String(form.get("definition"))),
      );
  } catch {
    message = "Template rejected. Check permissions and the stages/tasks JSON.";
  }
  revalidatePath("/projects/templates");
  redirect(`/projects/templates?notice=${encodeURIComponent(message)}`);
}
