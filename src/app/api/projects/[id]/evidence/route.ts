import { currentUser } from "@/server/auth";
import { uploadEvidence } from "@/project-operations/server/evidence";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const u = await currentUser();
  if (!u) return new Response("Authentication required", { status: 401 });
  const configured = new URL(process.env.APP_ORIGIN ?? "http://localhost:3000")
    .origin;
  if (request.headers.get("origin") !== configured)
    return new Response("Origin not allowed", { status: 403 });
  const { id } = await params;
  let notice = "Evidence uploaded and audited";
  let tab = "quality";
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing upload");
    let total = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 6 * 1024 * 1024) {
        await reader.cancel();
        return new Response("Upload exceeds 6 MB request limit", {
          status: 413,
        });
      }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    const form = await new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") ?? "" },
      body: bytes,
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Missing photo");
    const links: Record<string, string> = {};
    for (const name of ["taskId", "logId", "inspectionId"])
      if (form.get(name)) links[name] = String(form.get(name));
    tab = links.taskId ? "tasks" : links.logId ? "logs" : "quality";
    await uploadEvidence(
      u,
      id,
      { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name },
      links,
    );
  } catch {
    notice =
      "Evidence rejected. Check image type, 5 MB size limit, storage quota and permission for this record.";
  }
  return Response.redirect(
    new URL(
      `/projects/${encodeURIComponent(id)}?tab=${tab}&notice=${encodeURIComponent(notice)}`,
      configured,
    ),
    303,
  );
}
