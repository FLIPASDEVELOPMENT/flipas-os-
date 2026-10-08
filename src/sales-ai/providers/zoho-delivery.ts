import { z } from "zod";
import { regionEndpoints } from "./zoho";
import { unsafeReply } from "../domain/security";
import { REAL_EMAIL_DELIVERY_ENABLED, writeScopes } from "../domain/delivery";
/** Pure preparation for review and mock HTTP tests. It does not fetch or read tokens. */
export function prepareZohoDelivery(input: {
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
      `/api/accounts/${data.accountId}/messages`,
    method: "POST",
    scopes: [...writeScopes],
    body: {
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
export function assertRealDeliveryEnabled(): never {
  // Intentionally no environment-variable override or default network transport.
  if (!REAL_EMAIL_DELIVERY_ENABLED) throw new Error("LIVE_DISABLED");
  throw new Error("LIVE_DISABLED");
}
