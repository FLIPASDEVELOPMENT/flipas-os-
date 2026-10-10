import { db } from "@/server/db";
import { hashPassword, verifyPassword } from "@/server/password";
import type { Prisma, User } from "@/generated/prisma/client";
import { authorized } from "@/project-operations/server/service";
import { createAccountInput, passwordInput, roleInput } from "./validation";
type TX = Prisma.TransactionClient;
async function owner(tx: TX, actor: User) {
  // Serialize all OWNER administration, including last-owner checks.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(84641001)::text`;
  const current = await tx.user.findUnique({ where: { id: actor.id } });
  if (
    !current?.active ||
    current.role !== "OWNER" ||
    current.passwordChangeRequired
  )
    throw new Error("ACCESS_DENIED");
}
async function audit(
  tx: TX,
  actorId: string,
  type: string,
  targetId: string,
  detail: Prisma.InputJsonObject = {},
) {
  await tx.activity.create({
    data: {
      actorId,
      type,
      message: "Team administration",
      metadata: { targetId, ...detail },
    },
  });
}
async function revoke(tx: TX, actorId: string, targetId: string) {
  const sessions = await tx.session.deleteMany({ where: { userId: targetId } });
  await audit(tx, actorId, "TEAM_SESSIONS_REVOKED", targetId, {
    count: sessions.count,
  });
}
async function unassign(tx: TX, actorId: string, targetId: string) {
  const projects = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "Project" WHERE id IN (
    SELECT "projectId" FROM "ProjectMember" WHERE "userId" = ${targetId} AND active = true
    UNION SELECT id FROM "Project" WHERE "projectManagerId" = ${targetId}
    UNION SELECT "projectId" FROM "ProjectTask" WHERE "assigneeId" = ${targetId}
  ) ORDER BY id FOR UPDATE`;
  await tx.projectMember.updateMany({
    where: { userId: targetId, active: true },
    data: { active: false },
  });
  await tx.project.updateMany({
    where: { projectManagerId: targetId },
    data: { projectManagerId: null },
  });
  await tx.projectTask.updateMany({
    where: { assigneeId: targetId },
    data: { assigneeId: null, version: { increment: 1 } },
  });
  for (const project of projects)
    await tx.projectEvent.create({
      data: {
        projectId: project.id,
        actorId,
        type: "TEAM_PROJECT_ACCESS_REVOKED",
        metadata: { targetId, reason: "ACCOUNT_STATUS_OR_ROLE_CHANGED" },
      },
    });
}
export async function createAccount(actor: User, input: unknown) {
  const d = createAccountInput.parse(input);
  const passwordHash = await hashPassword(d.password);
  return db.$transaction(async (tx) => {
    await owner(tx, actor);
    if (
      await tx.user.findFirst({
        where: { email: { equals: d.email, mode: "insensitive" } },
      })
    )
      throw new Error("EMAIL_EXISTS");
    const user = await tx.user.create({
      data: {
        name: d.name,
        email: d.email,
        role: d.role,
        passwordHash,
        passwordChangeRequired: true,
      },
      select: { id: true },
    });
    await audit(tx, actor.id, "TEAM_ACCOUNT_CREATED", user.id, {
      role: d.role,
    });
    return user.id;
  });
}
export async function administerAccount(
  actor: User,
  targetId: string,
  operation: string,
  input: unknown,
) {
  return db.$transaction(async (tx) => {
    await owner(tx, actor);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${targetId} FOR NO KEY UPDATE`;
    const target = await tx.user.findUniqueOrThrow({ where: { id: targetId } });
    if (operation === "sessions") {
      await revoke(tx, actor.id, targetId);
      return;
    }
    if (operation === "reset") {
      const password = passwordInput.parse(input);
      await tx.user.update({
        where: { id: targetId },
        data: {
          passwordHash: await hashPassword(password),
          passwordChangeRequired: true,
        },
      });
      await revoke(tx, actor.id, targetId);
      await audit(tx, actor.id, "TEAM_PASSWORD_RESET", targetId);
      return;
    }
    const role = operation === "role" ? roleInput.parse(input) : target.role;
    const active =
      operation === "active" && typeof input === "boolean"
        ? input
        : target.active;
    if (
      !["role", "active"].includes(operation) ||
      (operation === "active" && typeof input !== "boolean")
    )
      throw new Error("INVALID_INPUT");
    if (
      target.role === "OWNER" &&
      target.active &&
      (role !== "OWNER" || !active) &&
      (await tx.user.count({ where: { role: "OWNER", active: true } })) <= 1
    )
      throw new Error("LAST_OWNER");
    if (role === target.role && active === target.active) return;
    await tx.user.update({ where: { id: targetId }, data: { role, active } });
    await revoke(tx, actor.id, targetId);
    // Reactivation never silently restores previous project access.
    if (!active || role !== target.role) await unassign(tx, actor.id, targetId);
    await audit(tx, actor.id, "TEAM_ACCOUNT_CHANGED", targetId, {
      before: { role: target.role, active: target.active },
      after: { role, active },
      assignmentsCleared: !active || role !== target.role,
    });
  });
}
export async function assignProject(
  actor: User,
  targetId: string,
  projectId: string,
  active: boolean,
) {
  return db.$transaction(async (tx) => {
    await owner(tx, actor);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${targetId} FOR NO KEY UPDATE`;
    const target = await tx.user.findUnique({ where: { id: targetId } });
    if (
      !target ||
      (active &&
        (!target.active || !["PROJECT_MANAGER", "CREW"].includes(target.role)))
    )
      throw new Error("INVALID_ASSIGNEE");
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
    const project = await authorized(tx, actor, projectId, true);
    if (active && ["COMPLETED", "CANCELLED"].includes(project.status))
      throw new Error("PROJECT_CLOSED");
    await tx.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: targetId } },
      create: { projectId, userId: targetId, kind: "EMPLOYEE", active },
      update: { active },
    });
    if (!active) {
      await tx.projectTask.updateMany({
        where: { projectId, assigneeId: targetId },
        data: { assigneeId: null, version: { increment: 1 } },
      });
      if (project.projectManagerId === targetId)
        await tx.project.update({
          where: { id: projectId },
          data: { projectManagerId: null },
        });
    }
    await tx.projectEvent.create({
      data: {
        projectId,
        actorId: actor.id,
        type: "TEAM_PROJECT_ASSIGNMENT",
        metadata: { targetId, active },
      },
    });
    await audit(tx, actor.id, "TEAM_PROJECT_ASSIGNMENT", targetId, {
      projectId,
      active,
    });
  });
}
export async function changeOwnPassword(
  actor: User,
  currentPassword: string,
  newPassword: string,
) {
  passwordInput.parse(newPassword);
  if (newPassword === currentPassword) throw new Error("PASSWORD_DIFFERENT");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR NO KEY UPDATE`;
    const current = await tx.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    if (
      !current.active ||
      !(await verifyPassword(currentPassword, current.passwordHash))
    )
      throw new Error("CURRENT_PASSWORD_INVALID");
    await tx.user.update({
      where: { id: actor.id },
      data: {
        passwordHash: await hashPassword(newPassword),
        passwordChangeRequired: false,
      },
    });
    await revoke(tx, actor.id, actor.id);
    await audit(tx, actor.id, "ACCOUNT_PASSWORD_CHANGED", actor.id);
  });
}
