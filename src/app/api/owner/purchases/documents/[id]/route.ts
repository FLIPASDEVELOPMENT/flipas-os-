import { currentUser } from "@/server/auth";
import { readDocument } from "@/purchases/service";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const u = await currentUser();
  if (!u) return new Response("Authentication required", { status: 401 });
  if (u.role !== "OWNER") return new Response("Forbidden", { status: 403 });
  try {
    const doc = await readDocument(u, (await params).id);
    return new Response(Uint8Array.from(doc.data), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="purchase-${doc.id}.csv.txt"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response("Document unavailable", { status: 404 });
  }
}
