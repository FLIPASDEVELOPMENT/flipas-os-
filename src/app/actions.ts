"use server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { requireCRM, tokenHash } from "@/server/auth";
import { hashPassword, verifyPassword } from "@/server/password";
import { formData } from "@/server/validation";
import * as crm from "@/server/crm";
async function assertOrigin() {
  const origin = (await headers()).get("origin");
  const expected =
    process.env.APP_ORIGIN ??
    (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : null);
  if (!expected || !origin || origin !== new URL(expected).origin)
    throw new Error("Request origin denied");
}
export async function login(form: FormData) {
  await assertOrigin();
  const parsed = z
    .object({
      email: z
        .email()
        .max(254)
        .transform((v) => v.toLowerCase()),
      password: z.string().min(1).max(256),
    })
    .safeParse(formData(form));
  if (!parsed.success) redirect("/login?error=credentials");
  const { email, password } = parsed.data;
  const key = tokenHash(email);
  const now = new Date();
  const attempt = await db.$transaction(async (tx) => {
    await tx.loginAttempt.upsert({
      where: { key },
      create: { key, count: 0 },
      update: {},
    });
    // Row lock makes attempt consumption atomic across concurrent requests.
    await tx.$queryRaw`SELECT id FROM "LoginAttempt" WHERE key = ${key} FOR UPDATE`;
    const row = await tx.loginAttempt.findUniqueOrThrow({ where: { key } });
    const fresh = now.getTime() - row.windowStart.getTime() > 15 * 60 * 1000;
    if (!fresh && row.count >= 10) return false;
    await tx.loginAttempt.update({
      where: { key },
      data: {
        count: fresh ? 1 : row.count + 1,
        windowStart: fresh ? now : row.windowStart,
      },
    });
    return true;
  });
  if (!attempt) redirect("/login?error=limited");
  const user = await db.user.findUnique({ where: { email } });
  const dummy = await hashPassword("constant-time-missing-account");
  const valid = await verifyPassword(password, user?.passwordHash ?? dummy);
  if (!user || !user.active || !valid) redirect("/login?error=credentials");
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const granted = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR NO KEY UPDATE`;
    const current = await tx.user.findUnique({ where: { id: user.id } });
    if (!current?.active || current.passwordHash !== user.passwordHash)
      return false;
    await tx.session.create({
      data: { tokenHash: tokenHash(token), userId: user.id, expiresAt },
    });
    await tx.activity.create({
      data: { type: "LOGIN", message: "User signed in", actorId: user.id },
    });
    return true;
  });
  if (!granted) redirect("/login?error=credentials");
  (await cookies()).set("flipas_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  redirect(
    user.passwordChangeRequired
      ? "/account/password"
      : user.role === "PROJECT_MANAGER" || user.role === "CREW"
        ? "/projects"
        : "/",
  );
}
export async function logout() {
  await assertOrigin();
  const jar = await cookies();
  const token = jar.get("flipas_session")?.value;
  if (token)
    await db.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  jar.delete("flipas_session");
  redirect("/login");
}
export async function createCustomer(form: FormData) {
  await assertOrigin();
  const u = await requireCRM();
  const c = await crm.createCustomer(u, formData(form));
  revalidatePath("/", "layout");
  redirect(`/customers/${c.id}`);
}
export async function saveLead(form: FormData) {
  await assertOrigin();
  const u = await requireCRM();
  const id = z
    .string()
    .max(100)
    .parse(form.get("id") ?? "");
  const lead = await crm.saveLead(u, formData(form), id || undefined);
  revalidatePath("/", "layout");
  redirect(`/leads/${lead.id}`);
}
export async function createOpportunity(form: FormData) {
  await assertOrigin();
  const user = await requireCRM();
  const id = z
    .string()
    .max(100)
    .parse(form.get("id") ?? "");
  if (id) await crm.updateOpportunity(user, formData(form), id);
  else await crm.createOpportunity(user, formData(form));
  revalidatePath("/", "layout");
  redirect("/pipeline");
}
export async function moveStage(form: FormData) {
  await assertOrigin();
  await crm.moveStage(await requireCRM(), formData(form));
  revalidatePath("/", "layout");
}
export async function addNote(form: FormData) {
  await assertOrigin();
  await crm.addNote(await requireCRM(), formData(form));
  revalidatePath("/", "layout");
}
