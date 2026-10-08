import { currentUser } from "@/server/auth";
import { isOwner } from "@/owner/policy";
import { ownerSummary } from "@/owner/service";
export async function GET() {
  const user = await currentUser();
  if (!user)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!isOwner(user))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json(await ownerSummary(user), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
