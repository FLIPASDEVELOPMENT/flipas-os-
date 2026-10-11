import Link from "next/link";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/owner/auth";
import {
  projectIdentityData,
  editProjectIdentity,
} from "@/purchases/classification-service";
import { Submit } from "@/project-operations/components/submit";
async function save(form: FormData) {
  "use server";
  const u = await requireOwner(),
    expected =
      process.env.APP_ORIGIN ??
      (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "");
  if (!expected || (await headers()).get("origin") !== new URL(expected).origin)
    throw new Error("ACCESS_DENIED");
  let notice = "Project label and alias saved; permanent code unchanged.";
  try {
    await editProjectIdentity(
      u,
      String(form.get("projectId")),
      String(form.get("name")),
      String(form.get("alias") ?? ""),
      String(form.get("reason")),
    );
  } catch {
    notice =
      "Cannot save. Check required name/reason and that the alias does not belong to another project or permanent code.";
  }
  revalidatePath("/projects");
  revalidatePath("/owner/purchases");
  redirect("/owner/purchases/projects?notice=" + encodeURIComponent(notice));
}
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const rows = await projectIdentityData(await requireOwner()),
    { notice } = await searchParams;
  return (
    <>
      <Link href="/owner/purchases">← Purchase Inbox</Link>
      <h1>Permanent project codes & historical aliases</h1>
      <p>
        Tell the cashier only the short code, for example F042. Codes are
        global, permanent and never reused. Name-only matches require review.
        Existing project IDs and financial snapshots are unchanged.
      </p>
      {notice && <p role="status">{notice}</p>}
      {rows.map((p) => (
        <section className="panel" key={p.projectId}>
          <h2>
            {p.code} · {p.name}
          </h2>
          <p>
            Cashier Job Name: <strong>{p.code}</strong>
          </p>
          <p>
            Confirmed historical aliases:{" "}
            {p.aliases.map((a) => a.alias).join(" · ") || "None"}
          </p>
          <form action={save}>
            <input type="hidden" name="projectId" value={p.projectId} />
            <label>
              Project display name
              <input
                name="name"
                defaultValue={p.name}
                required
                maxLength={160}
              />
            </label>
            <label>
              Confirm a historical Job Name alias (optional)
              <input name="alias" maxLength={200} />
            </label>
            <label>
              Reason
              <input name="reason" required minLength={5} maxLength={1000} />
            </label>
            <Submit>Save name and confirm alias</Submit>
          </form>
        </section>
      ))}
    </>
  );
}
