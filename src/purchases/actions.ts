"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/owner/auth";
import {
  stageImport,
  confirmImport,
  approveBatch,
  reviewPurchase,
  approvePurchase,
  rejectPurchase,
} from "./service";
import {
  suggestPurchase,
  suggestBatch,
  rejectSuggestion,
  abandonSuggestion,
} from "./classification-service";
const messages: Record<string, string> = {
  AI_PAUSED:
    "AI is paused. OWNER must review AI Administration; no cost was recorded.",
  PROCESSING_DISABLED:
    "AI processing is disabled in AI Administration. Email Emergency Pause is a separate control and stays unchanged.",
  AI_CONFIG_REQUIRED:
    "The existing private OpenAI model and verified pricing configuration is required.",
  AI_BUDGET_LIMIT:
    "Shared monthly AI budget reached or insufficient for the reserved request. No automatic retry.",
  AI_EMAIL_LIMIT:
    "Four classification requests already exist for this purchase. Review the preserved suggestions manually; counters are not reset.",
  CLASSIFICATION_RUNNING:
    "A classification is running or its result is uncertain. Do not retry with a new key; inspect its history.",
  CLASSIFICATION_CONTEXT_LIMIT:
    "Classification supports at most 20 lines and 100 projects per request. Review this purchase manually.",
  FILE_LIMIT: "CSV must be nonempty and at most 1 MB.",
  CSV_COLUMNS:
    "Use a Home Depot Pro Xtra Purchase Tracking export or the documented normalized CSV, with at most 500 data rows.",
  UNSUPPORTED_MOVEMENT:
    "This movement is pending evidence review only. Returns, credits or ambiguous totals cannot be approved or recorded as project costs.",
  TOTAL_MISMATCH:
    "Line or transaction totals do not balance. Nothing was imported.",
  SOURCE_CONFLICT:
    "This external ID already has different evidence. Review the original; no data was replaced.",
  STALE_VERSION:
    "The review changed. Reload and approve its exact current version.",
  PURCHASE_FINAL: "This purchase is finalized and cannot be edited or deleted.",
  DUPLICATE_PENDING:
    "Another pending import has the same receipt identity. OWNER must inspect and reject the duplicate with a reason before approving; no automatic merging.",
  DUPLICATE_EVIDENCE:
    "Another approved import has the same vendor, receipt and date. Review the duplicate; do not record it again.",
  EXISTING_RECEIPT_COST:
    "A project cost already uses this receipt. Explicitly link the verified existing ledger entry instead of posting again.",
  RECONCILIATION_MISMATCH:
    "The existing ledger entry must match the project, cost type and exact allocation amount.",
  DUPLICATE_COST: "That cost is already linked to an approved purchase.",
  ESTIMATE_LINK: "Choose a line from this project's original estimate.",
  ALLOCATION_TOTAL:
    "Distribute the exact total of every line, including its tax and discount.",
  ALLOCATION_LINK:
    "Select a valid line/project; company expenses must use General Overhead.",
  DOCUMENT_QUOTA:
    "Document storage quota reached; ask OWNER to review backup/storage capacity.",
};
export async function purchaseAction(form: FormData) {
  const u = await requireOwner(),
    expected =
      process.env.APP_ORIGIN ??
      (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "");
  if (!expected || (await headers()).get("origin") !== new URL(expected).origin)
    throw new Error("ACCESS_DENIED");
  const id = String(form.get("purchaseId") ?? "");
  let notice = "Saved and audited.";
  let previewId: string | undefined;
  try {
    const op = form.get("operation"),
      version = Number(form.get("version"));
    if (op === "abandon-suggestion") {
      await abandonSuggestion(
        u,
        id,
        String(form.get("suggestionId")),
        String(form.get("reason")),
      );
      notice =
        "Interrupted job closed; budget reservations and counters preserved. No automatic retry.";
    } else if (op === "reject-suggestion") {
      await rejectSuggestion(
        u,
        id,
        version,
        String(form.get("suggestionId")),
        String(form.get("reason")),
      );
      notice =
        "Suggestion rejected and preserved in history. Purchase remains pending; costs unchanged.";
    } else if (op === "suggest") {
      const job = await suggestPurchase(
        u,
        id,
        version,
        String(form.get("requestKey")),
      );
      notice = `Suggestion ${job.state}. ${job.errorCode ?? "Review its evidence below; no review or costs were saved."}`;
    } else if (op === "suggest-batch") {
      const jobs = await suggestBatch(
        u,
        form.getAll("suggestions").map((v) => JSON.parse(String(v))),
      );
      notice = jobs
        .map(
          (j) =>
            `${j.id}: ${j.state}${j.errorCode ? " (" + j.errorCode + ")" : ""}`,
        )
        .join("; ");
    } else if (op === "bulk") {
      const result = await approveBatch(
        u,
        form.getAll("reviews").map((v) => JSON.parse(String(v))),
      );
      notice = `Approved ${result.filter((r) => r.approved).length}; blocked ${result.filter((r) => !r.approved).length}. Each item is audited separately. Review blocked items individually.`;
    } else if (op === "confirm-import") {
      const r = await confirmImport(
        u,
        String(form.get("documentId") ?? ""),
        form.get("confirmation") === "on",
      );
      notice = `Imported ${r.imported}; repeated ${r.repeated}. Unsupported movements remain blocked. Costs are unchanged until separate OWNER approval.`;
    } else if (op === "import") {
      const file = form.get("file");
      if (
        !(file instanceof File) ||
        !file.name.toLowerCase().endsWith(".csv") ||
        file.size > 1048576
      )
        throw new Error("FILE_LIMIT");
      previewId = await stageImport(
        u,
        file.name,
        Buffer.from(await file.arrayBuffer()),
      );
      notice =
        "Preview prepared. No purchases or project costs have been recorded.";
    } else if (op === "review")
      await reviewPurchase(
        u,
        id,
        version,
        JSON.parse(String(form.get("allocations"))),
        String(form.get("reason")),
        String(form.get("suggestionId") ?? "") || undefined,
      );
    else if (op === "approve")
      await approvePurchase(u, id, version, form.get("confirmation") === "on");
    else if (op === "reject")
      await rejectPurchase(u, id, version, String(form.get("reason")));
    else throw new Error("INVALID_INPUT");
  } catch (e) {
    notice =
      e instanceof Error
        ? (messages[e.message] ??
          "Unable to save. Check the CSV format, nonnegative USD values, required fields and allocations. No partial changes were saved.")
        : "Unable to save.";
  }
  revalidatePath("/owner/purchases");
  revalidatePath("/owner/profitability");
  revalidatePath("/projects");
  if (previewId)
    redirect("/owner/purchases/imports/" + encodeURIComponent(previewId));
  redirect(
    (id ? "/owner/purchases/" + encodeURIComponent(id) : "/owner/purchases") +
      "?notice=" +
      encodeURIComponent(notice),
  );
}
