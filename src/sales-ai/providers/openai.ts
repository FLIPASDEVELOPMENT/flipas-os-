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
  return messages.slice(-5).map((m) => ({
    id: m.id,
    fromEmail: m.fromEmail,
    subject: m.subject.slice(0, 500),
    body: textOnly(m.body)
      .slice(0, 6000)
      .replace(
        /(?:password|api[_ -]?key|secret|authorization)\s*[:=]\s*\S+/gi,
        "[sensitive text removed]",
      )
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "[credential removed]"),
  }));
}
/** Verified against official openai/openai-python Responses source; no SDK/tools or arbitrary base URL. */
export class OpenAISalesAI implements SalesAIProvider {
  constructor(
    private key: string,
    private model: string,
    private transport: AITransport = fetch,
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
    let response: Response;
    try {
      response = await this.transport("https://api.openai.com/v1/responses", {
        method: "POST",
        redirect: "error",
        signal: abort,
        headers: {
          Authorization: "Bearer " + this.key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          store: false,
          tools: [],
          instructions: SALES_AI_BOUNDARY + " " + task,
          input: JSON.stringify({
            untrusted_inquiry: minimalInquiry(messages),
          }),
          max_output_tokens: 2500,
          text: {
            format: {
              type: "json_schema",
              name: "sales_recommendation",
              schema: z.toJSONSchema(schema),
              strict: false,
            },
          },
        }),
      });
    } catch {
      throw new Error(abort.aborted ? "JOB_TIMEOUT" : "PROVIDER_FAILURE");
    }
    if (!response.ok) {
      if (response.status === 429) throw new Error("RATE_LIMIT");
      if (response.status === 401 || response.status === 403)
        throw new Error("AUTH_REQUIRED");
      throw new Error("PROVIDER_REJECTED");
    }
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > 150000) throw new Error("INVALID_AI_OUTPUT");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("INVALID_AI_OUTPUT");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 150000) {
        await reader.cancel();
        throw new Error("INVALID_AI_OUTPUT");
      }
      chunks.push(value);
    }
    let raw: z.infer<typeof responseSchema>;
    let value: T;
    try {
      raw = responseSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
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
      "Return source MAIL. Cite exact input message IDs and quotes for every non-null extracted fact. Budget only if explicitly stated. Treat newsletters and unrelated mail as Not a sales lead.",
      signal,
    );
    return { ...result, value: validateEvidence(result.value, messages) };
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
