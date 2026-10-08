import { z } from "zod";
export const mailMessage = z.object({
  messageId: z.string().max(200),
  threadId: z.string().max(200),
  fromEmail: z.email(),
  fromName: z.string().max(200),
  toEmail: z.email(),
  subject: z.string().max(500),
  body: z.string().max(30000),
  receivedAt: z.coerce.date(),
  attachments: z
    .array(
      z.object({ name: z.string().max(200), size: z.number().nonnegative() }),
    )
    .max(20),
});
export type IncomingMail = z.infer<typeof mailMessage>;
export interface MailProvider {
  listMessages(
    connectionId: string,
    cursor: string | null,
    signal?: AbortSignal,
  ): Promise<{
    messages: IncomingMail[];
    nextCursor: string | null;
    more?: boolean;
  }>;
  send(
    connectionId: string,
    message: {
      recipient: string;
      subject: string;
      body: string;
      replyToMessageId?: string;
      idempotencyKey: string;
    },
    signal?: AbortSignal,
  ): Promise<{ messageId: string }>;
  disconnect(connectionId: string): Promise<void>;
}
export const mockMessages: IncomingMail[] = [
  {
    messageId: "development-kitchen-1",
    threadId: "development-kitchen",
    fromEmail: "customer@example.invalid",
    fromName: "Development customer",
    toEmail: "sales@example.invalid",
    subject: "DEVELOPMENT ONLY — Kitchen remodeling inquiry",
    body: "We would like a kitchen remodeling estimate. Our budget is $15,000. Please let us know what information you need.",
    receivedAt: new Date("2026-10-07T12:00:00Z"),
    attachments: [],
  },
  {
    messageId: "development-newsletter-1",
    threadId: "development-newsletter",
    fromEmail: "newsletter@example.invalid",
    fromName: "Development newsletter",
    toEmail: "sales@example.invalid",
    subject: "DEVELOPMENT ONLY — Newsletter",
    body: "Subscribe to our newsletter. Unsubscribe here.",
    receivedAt: new Date("2026-10-07T12:00:00Z"),
    attachments: [],
  },
];
export class MockMailProvider implements MailProvider {
  async listMessages(_connectionId: string, cursor: string | null) {
    return {
      messages: cursor ? [] : mockMessages,
      nextCursor: "development-mock-page-1",
    };
  }
  async send(_connectionId: string, m: { idempotencyKey: string }) {
    return { messageId: `mock-${m.idempotencyKey}` };
  }
  async disconnect() {}
}
