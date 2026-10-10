import { currentUser } from "@/server/auth";
import { redirect } from "next/navigation";
import { passwordAction } from "@/team/actions";
import { Submit } from "@/project-operations/components/submit";
export default async function Password({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser({ allowPasswordChange: true });
  if (!user) redirect("/login");
  const { error } = await searchParams;
  return (
    <main className="login panel">
      <h1>Set your own password</h1>
      <p>
        {user.passwordChangeRequired
          ? "Before opening your workspace, replace the initial password supplied privately by OWNER."
          : "Changing your password signs out all current sessions."}
      </p>
      {error && <p role="alert">{error.slice(0, 300)}</p>}
      <form action={passwordAction}>
        <label>
          Current / initial password
          <input
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            required
            maxLength={256}
          />
        </label>
        <label>
          New password
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={256}
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            name="confirmation"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={256}
          />
        </label>
        <Submit>Change password and sign out</Submit>
      </form>
    </main>
  );
}
