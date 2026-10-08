import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
export const digest = (v: string) =>
  createHash("sha256").update(v).digest("hex");
function key() {
  const s = process.env.MAIL_ENCRYPTION_KEY;
  if (!s || !/^[a-fA-F0-9]{64}$/.test(s))
    throw new Error(
      "MAIL_ENCRYPTION_KEY must be a securely configured 32-byte hex key",
    );
  return Buffer.from(s, "hex");
}
export function encryptSecret(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    data.toString("hex"),
  ].join(":");
}
export function decryptSecret(value: string) {
  const [version, iv, tag, data] = value.split(":");
  if (version !== "v1") throw new Error("Unsupported secret format");
  const cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "hex"));
  cipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    cipher.update(Buffer.from(data, "hex")),
    cipher.final(),
  ]).toString("utf8");
}
export function textOnly(html: string) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .slice(0, 30000);
}
export function unsafeReply(text: string) {
  return /\$\s*\d|\b\d+\s*%|discount|descuento|guarantee|garant[ií]|warranty|insured|licensed|contractually|system prompt|api[_ ]?key|password|internal cost|\b(?:USD|dollars?|pricing|price|precios?|contract|contrato|percent)\b|https?:\/\/|www\./i.test(
    text,
  );
}
export function allowedAttachment(name: string, size: number) {
  return (
    size <= 5 * 1024 * 1024 && size >= 0 && /\.(pdf|png|jpe?g|txt)$/i.test(name)
  );
}
const businessErrors: Record<string, string> = {
  "Review commercial classification before creating a lead": "NOT_COMMERCIAL",
  "Review sales classification first": "NOT_COMMERCIAL",
  "Existing or ambiguous customer match; link the CRM record explicitly":
    "MATCH_REQUIRES_CONFIRMATION",
  "CRM links must reference the same customer and lead": "CRM_LINK_MISMATCH",
  "Choose an active sales representative": "ASSIGNEE_REQUIRED",
  "Draft changed or already sending; reload": "DRAFT_CHANGED",
  "Draft changed; reload": "DRAFT_CHANGED",
  "Recipient must match the authorized conversation": "RECIPIENT_MISMATCH",
  "Draft is not editable": "DRAFT_NOT_REVIEWABLE",
  "Draft must be submitted for review": "DRAFT_NOT_REVIEWABLE",
  "Remove pricing, discount, contractual claims or sensitive content before approval":
    "UNSAFE_REPLY",
  "Exact message version must be approved": "APPROVAL_REQUIRED",
  "Send already attempted; uncertain outcomes must be verified externally":
    "DELIVERY_ALREADY_ATTEMPTED",
  "Live mail remains locked until official API verification and explicit owner activation":
    "LIVE_DISABLED",
  "Zoho connector not enabled yet": "LIVE_DISABLED",
  "Live AI adapter not enabled yet": "LIVE_DISABLED",
};
export function safeError(e: unknown) {
  if (!(e instanceof Error)) return "PROVIDER_FAILURE";
  if (businessErrors[e.message]) return businessErrors[e.message];
  return /^(REGION_UNSUPPORTED|REVOCATION_PENDING|JOB_TIMEOUT|RATE_LIMIT|AUTH_REQUIRED|TOKEN_REFRESH_FAILED|PROVIDER_REJECTED|SEND_UNCERTAIN|PROCESSING_DISABLED|OUTBOUND_PAUSED|LIVE_DISABLED|LEASE_EXPIRED|INVALID_AI_OUTPUT|ACCESS_DENIED)$/.test(
    e.message,
  )
    ? e.message
    : "PROVIDER_FAILURE";
}
