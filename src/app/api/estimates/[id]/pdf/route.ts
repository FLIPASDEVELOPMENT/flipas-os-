import { currentUser } from "@/server/auth";
import { canUseCRM } from "@/domain/permissions";
import { readEstimate } from "@/estimator/server/service";
import { proposalDTO } from "@/estimator/domain/proposal";
import { proposalPDF } from "@/estimator/server/pdf";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return new Response("Authentication required", { status: 401 });
  if (!canUseCRM(user.role))
    return new Response("Access denied", { status: 403 });
  let estimate;
  try {
    estimate = await readEstimate(user, (await params).id);
  } catch {
    return new Response("Estimate unavailable", { status: 404 });
  }
  const bytes = await proposalPDF(proposalDTO(estimate));
  const name = (estimate.number ?? estimate.id).replace(/[^a-zA-Z0-9_-]/g, "_");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
