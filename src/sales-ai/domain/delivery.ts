/** Server-only deployment gate. Missing/false never enables network delivery. */
export function realDeliveryEnabled() {
  return process.env.ZOHO_SEND_ENABLED === "true";
}
export const writeScopes = [
  "ZohoMail.accounts.READ",
  "ZohoMail.messages.CREATE",
] as const;
export function deliveryBlock(
  provider: string,
  paused: boolean,
  writeAuthorized = false,
  mailboxEnabled = false,
) {
  if (paused) return "OUTBOUND_PAUSED";
  if (provider !== "MOCK") {
    if (!writeAuthorized) return "WRITE_AUTH_REQUIRED";
    if (!realDeliveryEnabled() || !mailboxEnabled) return "LIVE_DISABLED";
  }
  return null;
}
