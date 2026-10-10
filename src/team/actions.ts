"use server";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/owner/auth";
import { currentUser } from "@/server/auth";
import {
  createAccount,
  administerAccount,
  assignProject,
  changeOwnPassword,
} from "./service";
async function origin() {
  const expected =
    process.env.APP_ORIGIN ??
    (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "");
  if (!expected || (await headers()).get("origin") !== new URL(expected).origin)
    throw new Error("ACCESS_DENIED");
}
const messages: Record<string, string> = {
  EMAIL_EXISTS: "This email already has an account.",
  LAST_OWNER: "The last active OWNER cannot be disabled or demoted.",
  ACCESS_DENIED: "Your session does not permit this action.",
  INVALID_ASSIGNEE: "Select an active PROJECT_MANAGER or CREW account.",
  PROJECT_CLOSED: "This project is closed.",
  PASSWORD_DIFFERENT: "Choose a new password different from the current one.",
  CURRENT_PASSWORD_INVALID: "The current password is incorrect.",
};
function message(error: unknown) {
  return error instanceof Error
    ? (messages[error.message] ??
        "Unable to save. Check required fields, password confirmation and current permissions, then reload.")
    : "Unable to save.";
}
export async function teamAction(form: FormData) {
  await origin();
  const actor = await requireOwner();
  let notice = "Saved. Changes are audited; passwords are never displayed.";
  try {
    const operation = String(form.get("operation"));
    const id = String(form.get("userId") ?? "");
    if (operation === "create")
      await createAccount(actor, {
        name: form.get("name"),
        email: form.get("email"),
        role: form.get("role"),
        password: form.get("password"),
        confirmation: form.get("confirmation"),
      });
    else if (operation === "assignment") {
      if (!["true", "false"].includes(String(form.get("active"))))
        throw new Error("INVALID_INPUT");
      await assignProject(
        actor,
        id,
        String(form.get("projectId")),
        form.get("active") === "true",
      );
    } else if (operation === "reset") {
      if (form.get("password") !== form.get("confirmation"))
        throw new Error("INVALID_INPUT");
      await administerAccount(actor, id, operation, form.get("password"));
    } else if (operation === "role")
      await administerAccount(actor, id, operation, form.get("role"));
    else if (operation === "sessions")
      await administerAccount(actor, id, operation, null);
    else if (
      operation === "active" &&
      ["true", "false"].includes(String(form.get("active")))
    )
      await administerAccount(
        actor,
        id,
        operation,
        form.get("active") === "true",
      );
    else throw new Error("INVALID_INPUT");
  } catch (error) {
    notice = message(error);
  }
  revalidatePath("/owner/team");
  revalidatePath("/projects");
  redirect("/owner/team?notice=" + encodeURIComponent(notice));
}
export async function passwordAction(form: FormData) {
  await origin();
  const actor = await currentUser({ allowPasswordChange: true });
  if (!actor) redirect("/login");
  let error = "";
  try {
    if (form.get("password") !== form.get("confirmation"))
      throw new Error("INVALID_INPUT");
    await changeOwnPassword(
      actor,
      String(form.get("currentPassword") ?? ""),
      String(form.get("password") ?? ""),
    );
  } catch (failure) {
    error = message(failure);
  }
  if (error) redirect("/account/password?error=" + encodeURIComponent(error));
  (await cookies()).delete("flipas_session");
  redirect("/login?changed=1");
}
