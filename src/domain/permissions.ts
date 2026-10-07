export type Role =
  "OWNER" | "ADMIN" | "SALES" | "PROJECT_MANAGER" | "CREW" | "CUSTOMER";
export function canUseCRM(role: Role) {
  return ["OWNER", "ADMIN", "SALES"].includes(role);
}
export function canManage(role: Role) {
  return role === "OWNER" || role === "ADMIN";
}
export function canAccess(role: Role, userId: string, ownerId: string | null) {
  return canManage(role) || (role === "SALES" && userId === ownerId);
}
export function canOverridePrice(role: Role) {
  return canManage(role);
}
export function requiresApproval(risk: "LOW" | "MEDIUM" | "HIGH") {
  return risk !== "LOW";
}
