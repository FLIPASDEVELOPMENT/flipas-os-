"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/owner/auth";
import {
  importCSV,
  approveBatch,
  reviewPurchase,
  approvePurchase,
  rejectPurchase,
} from "./service";
const messages: Record<string, string> = {
  FILE_LIMIT: "CSV must be nonempty and at most 1 MB.",
  CSV_COLUMNS: "Use the documented CSV headers and at most 500 lines.",
  TOTAL_MISMATCH:
    "Line or transaction totals do not balance. Nothing was imported.",
  SOURCE_CONFLICT:
    "This external ID already has different evidence. Review the original; no data was replaced.",
  STALE_VERSION:
    "The review changed. Reload and approve its exact current version.",
  PURCHASE_FINAL: "This purchase is finalized and cannot be edited or deleted.",
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
  try {
    const op = form.get("operation"),
      version = Number(form.get("version"));
    if (op === "bulk") {
      const result = await approveBatch(
        u,
        form.getAll("reviews").map((v) => JSON.parse(String(v))),
      );
      notice = `Approved ${result.filter((r) => r.approved).length}; blocked ${result.filter((r) => !r.approved).length}. Each item is audited separately. Review blocked items individually.`;
    } else if (op === "import") {
      const file = form.get("file");
      if (
        !(file instanceof File) ||
        !file.name.toLowerCase().endsWith(".csv") ||
        file.size > 1048576
      )
        throw new Error("FILE_LIMIT");
      const r = await importCSV(
        u,
        file.name,
        Buffer.from(await file.arrayBuffer()),
      );
      notice = `Imported ${r.imported}; repeated ${r.repeated}. Costs are unchanged until approval.`;
    } else if (op === "review")
      await reviewPurchase(
        u,
        id,
        version,
        JSON.parse(String(form.get("allocations"))),
        String(form.get("reason")),
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
  redirect(
    (id ? "/owner/purchases/" + encodeURIComponent(id) : "/owner/purchases") +
      "?notice=" +
      encodeURIComponent(notice),
  );
}
