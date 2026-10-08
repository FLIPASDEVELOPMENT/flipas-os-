import { User, Prisma } from "@/generated/prisma/client";
import { requireUser } from "@/server/auth";
import { notFound } from "next/navigation";
import { canUseCRM, canManage } from "@/domain/permissions";
export function assertSalesAI(u: User) {
  if (!u.active || !canUseCRM(u.role)) throw new Error("ACCESS_DENIED");
}
export function conversationScope(u: User): Prisma.MailConversationWhereInput {
  assertSalesAI(u);
  return canManage(u.role) ? {} : { assignedToId: u.id };
}
export async function requireSalesAI() {
  const user = await requireUser();
  if (!user.active || !canUseCRM(user.role)) notFound();
  return user;
}
export function configuredRole(u: User, roles: unknown) {
  assertSalesAI(u);
  return u.role === "OWNER" || (Array.isArray(roles) && roles.includes(u.role));
}
