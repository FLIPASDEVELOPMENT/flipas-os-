import Link from "next/link";
import { requireOwner } from "@/owner/auth";
import { purchaseData } from "@/purchases/service";
import { purchaseAction } from "@/purchases/actions";
import { newSuggestionKey } from "@/purchases/classification-service";
import type { PurchaseData } from "@/purchases/validation";
import { Submit } from "@/project-operations/components/submit";
export default async function Page() {
  const rows = await purchaseData(await requireOwner());
  if (!Array.isArray(rows)) throw new Error("Invalid inbox");
  const eligible = rows
    .filter(
      (p) =>
        !["APPROVED", "REJECTED"].includes(p.status) &&
        !(p.original as unknown as PurchaseData).native?.blockedReasons.length,
    )
    .slice(0, 20);
  return (
    <>
      <Link href="/owner/purchases">← Purchase Inbox</Link>
      <h1>Request classification suggestions</h1>
      <p>
        Select at most five purchases. Requests run sequentially with individual
        results and shared AI budget reservations. Nothing is approved or
        recorded as costs. Returns and unsupported movements are excluded.
      </p>
      <form action={purchaseAction}>
        <input type="hidden" name="operation" value="suggest-batch" />
        {eligible.map((p) => (
          <label key={p.id}>
            <input
              type="checkbox"
              name="suggestions"
              value={JSON.stringify({
                id: p.id,
                version: p.headVersion,
                requestKey: newSuggestionKey(),
              })}
            />
            {(p.original as unknown as PurchaseData).header.job_name ||
              "Unknown job"}{" "}
            · {(p.original as unknown as PurchaseData).header.receipt_id} ·
            Review {p.headVersion}
          </label>
        ))}
        <Submit>Request selected suggestions (maximum five)</Submit>
      </form>
    </>
  );
}
