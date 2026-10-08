import Link from "next/link";
import { requireOwner } from "@/owner/auth";
import { db } from "@/server/db";
import { ownerApprovalAction } from "@/owner/actions";
export default async function Approvals({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireOwner();
  const { error } = await searchParams;
  const requests = await db.estimateApproval.findMany({
    where: { status: "PENDING" },
    include: { estimate: { include: { customer: true } } },
    orderBy: { createdAt: "asc" },
  });
  return (
    <>
      <h1>Approval center</h1>
      <p className="muted">
        Review exact saved revisions, pricing exceptions and discounts. Approval
        does not release or send a proposal.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!requests.length && (
        <section className="panel">No pending estimate approvals.</section>
      )}
      {requests.map((r) => (
        <section className="panel" key={r.id}>
          <h2>
            {r.estimate.number} · {r.estimate.customer.firstName}{" "}
            {r.estimate.customer.lastName}
          </h2>
          <p>
            Net price ${r.estimate.sellingPrice.toString()} · Direct cost $
            {r.estimate.directCost.toString()} · Discount $
            {r.estimate.discountAmount.toString()}
          </p>
          <p>
            Flags: {(r.reasons as string[]).join(" · ")} · Content version{" "}
            {r.contentVersion}
          </p>
          <Link
            href={`/estimates/${r.estimateId}`}
            className="button secondary"
          >
            Inspect frozen financial details and proposal
          </Link>
          <form action={ownerApprovalAction} className="form">
            <input type="hidden" name="id" value={r.estimateId} />
            <label className="wide">
              Review rationale
              <textarea name="rationale" required maxLength={2000} />
            </label>
            <button name="decision" value="approve">
              Approve exact version
            </button>
            <button name="decision" value="reject" className="secondary">
              Return to draft
            </button>
          </form>
        </section>
      ))}
    </>
  );
}
