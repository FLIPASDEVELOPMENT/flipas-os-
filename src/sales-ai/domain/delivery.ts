/** Approval is not delivery permission. Production mail stays locked in this release. */
export const REAL_EMAIL_DELIVERY_ENABLED = false;
export const writeScopes = [
  "ZohoMail.accounts.READ",
  "ZohoMail.messages.CREATE",
] as const;
export function deliveryBlock(
  provider: string,
  paused: boolean,
  writeConsented = false,
) {
  if (paused) return "OUTBOUND_PAUSED";
  if (provider !== "MOCK")
    return writeConsented ? "LIVE_DISABLED" : "WRITE_AUTH_REQUIRED";
  return null;
}
