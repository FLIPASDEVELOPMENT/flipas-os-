import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { db } from "./db";
import { canUseCRM } from "@/domain/permissions";
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function currentUser(
  options: { allowPasswordChange?: boolean } = {},
) {
  const token = (await cookies()).get("flipas_session")?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: true },
  });
  return session &&
    session.expiresAt > new Date() &&
    session.user.active &&
    (options.allowPasswordChange || !session.user.passwordChangeRequired)
    ? session.user
    : null;
}
export async function requireUser() {
  const user = await currentUser({ allowPasswordChange: true });
  if (!user) redirect("/login");
  if (user.passwordChangeRequired) redirect("/account/password");
  return user;
}
export async function requireCRM() {
  const user = await requireUser();
  if (!canUseCRM(user.role)) throw new Error("Access denied");
  return user;
}
