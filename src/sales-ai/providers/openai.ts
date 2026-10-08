import OpenAI from "openai";
import { z } from "zod";
import { textOnly } from "../domain/security";
import {
  intelligenceSchema,
  validateEvidence,
  AnalysisMessage,
} from "../domain/intelligence";
import {
  SalesAIProvider,
  AIResult,
  SALES_AI_BOUNDARY,
  validateDraft,
} from "./ai";
const replySchema = z.object({ body: z.string().min(1).max(15000) });
const responseSchema = z.object({
  status: z.literal("completed"),
  output: z.array(
    z.object({
      type: z.string(),
      content: z
        .array(z.object({ type: z.string(), text: z.string().optional() }))
        .optional(),
    }),
  ),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});
export type AITransport = (
  input: string,
  init: RequestInit,
) => Promise<Response>;
export function minimalInquiry(messages: AnalysisMessage[]) {
  return messages.slice(-3).map((m) => ({
    id: m.id,

    subject: m.subject.slice(0, 500),
    body: textOnly(m.body)
      .slice(0, 3000)
      .replace(
        /(?:password|api[_ -]?key|secret|authorization)\s*[:=]\s*\S+/gi,
        "[sensitive text removed]",
      )
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "[credential removed]")
      .replace(/\bsk-[A-Za-z0-9_-]{10,}/g, "[credential removed]"),
  }));
}
/** Official SDK; fixed endpoint, no retries, no tools, no storage. */
export class OpenAISalesAI implements SalesAIProvider {
  constructor(
    private key: string,
    private model: string,
    private transport: AITransport = fetch,
    private onUsage?: (input: number, output: number) => Promise<void>,
  ) {
    if (!key || !model) throw new Error("AUTH_REQUIRED");
  }
  private async structured<T>(
    messages: AnalysisMessage[],
    schema: z.ZodType<T>,
    task: string,
    signal?: AbortSignal,
  ): Promise<AIResult<T>> {
    const timeout = AbortSignal.timeout(45000);
    const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: unknown;
    try {
      const client = new OpenAI({
        apiKey: this.key,
        baseURL: "https://api.openai.com/v1",
        logLevel: "off",
        maxRetries: 0,
        timeout: 45000,
        fetch: (input, init) =>
          this.transport(String(input), { ...init, redirect: "error" }),
      });
      response = await client.responses.create(
        {
          model: this.model,
          store: false,
          tools: [],
          instructions: SALES_AI_BOUNDARY + " " + task,
          input: JSON.stringify({
            untrusted_inquiry: minimalInquiry(messages),
          }),
          max_output_tokens: 1500,
          text: {
            format: {
              type: "json_schema",
              name: "sales_recommendation",
              schema: z.toJSONSchema(schema),
              strict: false,
            },
          },
        },
        { signal: abort },
      );
    } catch (e) {
      if (e instanceof OpenAI.APIError) {
        if (e.status === 429) throw new Error("RATE_LIMIT");
        if (e.status === 401 || e.status === 403)
          throw new Error("AUTH_REQUIRED");
        throw new Error("PROVIDER_REJECTED");
      }
      throw new Error(abort.aborted ? "JOB_TIMEOUT" : "PROVIDER_FAILURE");
    }
    const usage = (
      response as { usage?: { input_tokens: number; output_tokens: number } }
    ).usage;
    if (
      usage &&
      Number.isSafeInteger(usage.input_tokens) &&
      Number.isSafeInteger(usage.output_tokens) &&
      usage.input_tokens >= 0 &&
      usage.output_tokens >= 0
    )
      await this.onUsage?.(usage.input_tokens, usage.output_tokens);
    let raw: z.infer<typeof responseSchema>;
    let value: T;
    try {
      raw = responseSchema.parse(response);
      if (
        raw.output.some((v) => v.type !== "message" && v.type !== "reasoning")
      )
        throw new Error("Tool call rejected");
      const content = raw.output.flatMap((v) => v.content ?? []);
      if (content.some((v) => v.type !== "output_text"))
        throw new Error("Model refusal");
      const text = content.map((v) => v.text ?? "").join("");
      value = schema.parse(JSON.parse(text));
    } catch {
      throw new Error("INVALID_AI_OUTPUT");
    }
    return {
      value,
      provider: "OPENAI",
      model: this.model,
      inputTokens: raw.usage.input_tokens,
      outputTokens: raw.usage.output_tokens,
    };
  }
  async analyze(messages: AnalysisMessage[], signal?: AbortSignal) {
    const result = await this.structured(
      messages,
      intelligenceSchema,
      "Classify mailKind as POTENTIAL_CUSTOMER, EXISTING_CUSTOMER, SUPPLIER, ADVERTISEMENT, SPAM or OTHER. Classify unsolicited website/marketing offers as ADVERTISEMENT even when they mention remodeling. Set category to Not a sales lead for suppliers, advertisements, spam and other unrelated mail. language is EN, ES or UNKNOWN. needsHumanReview is true if uncertain. Return email null (sender is resolved locally). Return source MAIL. Cite exact input message IDs and quotes for every non-null extracted fact. Budget only if explicitly stated. Treat newsletters and unrelated mail as Not a sales lead.",
      signal,
    );
    const sanitized = minimalInquiry(messages).map((m) => ({
      ...m,
      fromEmail: "",
    }));
    const value = validateEvidence(
      result.value.email === null
        ? result.value
        : { ...result.value, email: null },
      sanitized,
    );
    value.email = messages.at(-1)?.fromEmail ?? null;
    if (
      value.urgency !== "UNKNOWN" &&
      !value.evidence.some((e) => e.field === "urgency")
    )
      value.urgency = "UNKNOWN";
    value.requestedServices = value.requestedServices.filter((service) =>
      value.evidence.some(
        (e) =>
          e.field === "requestedServices" &&
          e.quote.toLowerCase().includes(service.toLowerCase()),
      ),
    );

    value.needsHumanReview =
      value.needsHumanReview ||
      value.confidence < 0.75 ||
      value.mailKind === "OTHER";
    if (!["POTENTIAL_CUSTOMER", "EXISTING_CUSTOMER"].includes(value.mailKind))
      value.category = "Not a sales lead";
    return { ...result, value };
  }
  async draft(
    messages: AnalysisMessage[],
    language: "EN" | "ES",
    purpose: "QUALIFY" | "FOLLOW_UP" = "QUALIFY",
  ) {
    const result = await this.structured(
      messages,
      replySchema,
      `Draft only a short neutral ${purpose === "FOLLOW_UP" ? "follow-up" : "qualifying"} reply in ${language === "ES" ? "Spanish" : "English"}. Ask about missing scope, property address and timeline or visit availability. No prices, links, discounts, guarantees or contracts.`,
    );
    return { ...result, value: validateDraft(result.value.body) };
  }
}
