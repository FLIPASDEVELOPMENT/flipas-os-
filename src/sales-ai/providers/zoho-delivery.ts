import { z } from "zod";
import { regionEndpoints } from "./zoho";
import { unsafeReply } from "../domain/security";
import { realDeliveryEnabled, writeScopes } from "../domain/delivery";
/** Pure preparation for review and mock HTTP tests. It does not fetch or read tokens. */
export function prepareZohoDelivery(input: {
  replyToMessageId?: string;
  region: string;
  accountId: string;
  address: string;
  expectedRecipient: string;
  recipient: string;
  subject: string;
  body: string;
}) {
  const data = z
    .object({
      replyToMessageId: z
        .string()
        .regex(/^\d{1,30}$/)
        .optional(),
      region: z.enum(["US", "EU"]),
      accountId: z.string().regex(/^\d{1,30}$/),
      address: z.email(),
      expectedRecipient: z.email(),
      recipient: z.email(),
      subject: z
        .string()
        .min(1)
        .max(500)
        .regex(/^[^\r\n]+$/),
      body: z.string().min(1).max(15000),
    })
    .parse(input);
  if (
    data.recipient.toLowerCase() !== data.expectedRecipient.toLowerCase() ||
    unsafeReply(data.subject + "\n" + data.body)
  )
    throw new Error("RECIPIENT_MISMATCH");
  return {
    url:
      regionEndpoints(data.region).mail +
      `/api/accounts/${data.accountId}/messages` +
      (data.replyToMessageId ? `/${data.replyToMessageId}` : ""),
    method: "POST",
    scopes: [...writeScopes],
    body: {
      ...(data.replyToMessageId ? { action: "reply" } : {}),
      fromAddress: data.address,
      toAddress: data.recipient,
      subject: data.subject,
      content: data.body,
      mailFormat: "plaintext",
      askReceipt: "no",
      encoding: "UTF-8",
    },
  };
}
export function assertRealDeliveryEnabled(): void {
  if (!realDeliveryEnabled()) throw new Error("LIVE_DISABLED");
}

/** One POST, no automatic retries and no token-bearing redirect. Acceptance is not delivery. */
export async function postZohoDelivery(
  input: Parameters<typeof prepareZohoDelivery>[0],
  token: string,
  idempotencyKey: string,
  signal?: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<{ messageId: string }> {
  assertRealDeliveryEnabled();
  const request = prepareZohoDelivery(input);
  try {
    const response = await transport(request.url, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request.body),
    });
    // Only explicit authentication/rate-limit rejections are known not to have accepted delivery.
    if ([401, 403, 429].includes(response.status))
      throw new Error("SEND_REJECTED");
    if (!response.ok) throw new Error("SEND_UNCERTAIN");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("SEND_UNCERTAIN");
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 65536) throw new Error("SEND_UNCERTAIN");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const ack = z
      .object({
        status: z.object({ code: z.union([z.literal(200), z.literal(201)]) }),
        data: z.unknown().optional(),
      })
      .safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!ack.success) throw new Error("SEND_UNCERTAIN");
    // The public send page does not guarantee a messageId. Never fabricate a provider ID.
    const reference = z
      .object({ messageId: z.string().regex(/^\d{1,30}$/) })
      .safeParse(ack.data.data);
    return {
      messageId: reference.success
        ? reference.data.messageId
        : `zoho-ack:${idempotencyKey}`,
    };
  } catch (e) {
    if (e instanceof Error && e.message === "SEND_REJECTED") throw e;
    throw new Error("SEND_UNCERTAIN");
  }
}
