import { currentUser } from "@/server/auth";
import { readEvidence } from "@/project-operations/server/evidence";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const u = await currentUser();
  if (!u) return new Response("Authentication required", { status: 401 });
  try {
    const e = await readEvidence(u, (await params).id);
    return new Response(new Uint8Array(e.data), {
      headers: {
        "Content-Type": e.mimeType,
        "Content-Disposition": `attachment; filename="evidence.${e.mimeType.split("/")[1]}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch {
    return new Response("Evidence unavailable", { status: 404 });
  }
}
