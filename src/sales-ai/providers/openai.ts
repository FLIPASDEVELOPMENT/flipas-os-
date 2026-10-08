import {
  hasForward,
  validateContextualReply,
  type ReplyContext,
  type VerifiedCRM,
} from "../domain/context";
import OpenAI from "openai";
import { z } from "zod";
import { textOnly } from "../domain/security";
import {
  intelligenceSchema,
  mailKind,
  validateEvidence,
  AnalysisMessage,
} from "../domain/intelligence";
import {
  SalesAIProvider,
  AIResult,
  SALES_AI_BOUNDARY,
  validateDraft,
} from "./ai";
const replySchema = z.strictObject({ body: z.string().min(1).max(15000) });
// Storage schema retains legacy defaults; API schema requires every field explicitly.
export const openaiIntelligenceSchema = intelligenceSchema
  .extend({
    mailKind,
    customerName: z.string().min(1).max(1000).nullable(),
    phone: z.string().min(1).max(1000).nullable(),
    projectLocation: z.string().min(1).max(1000).nullable(),
    budget: z.string().min(1).max(1000).nullable(),
    timeline: z.string().min(1).max(1000).nullable(),
    propertyAddress: z.string().min(1).max(1000).nullable(),
    consultationAvailability: z.string().min(1).max(1000).nullable(),
    materials: z.array(z.string().min(1).max(200)).max(20),
    evidence: z
      .array(
        z.strictObject({
          field: z.string().min(1).max(100),
          messageId: z.string().min(1),
          quote: z.string().min(1).max(1000),
        }),
      )
      .max(30),
    language: z.enum(["EN", "ES", "UNKNOWN"]),
    needsHumanReview: z.boolean(),
  })
  .strict();
const responseSchema = z.object({
  status: z.string(),
  output: z.array(
    z.object({
      type: z.string(),
      status: z.string().optional(),
      role: z.string().optional(),
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
export class OpenAIOutputError extends Error {
  constructor(
    code: string,
    readonly diagnostics: {
      stage:
        | "API"
        | "ENVELOPE"
        | "COMPLETION"
        | "FORMAT"
        | "SCHEMA"
        | "EVIDENCE"
        | "SAFETY";
      invalidFields?: string[];
      httpStatus?: number;
    },
  ) {
    super(code);
  }
}
function fields(error: z.ZodError, allowed: string[]) {
  return [
    ...new Set(
      error.issues.map((issue) =>
        typeof issue.path[0] === "string" && allowed.includes(issue.path[0])
          ? issue.path[0]
          : "response",
      ),
    ),
  ];
}
export type AITransport = (
  input: string,
  init: RequestInit,
) => Promise<Response>;
export function minimalInquiry(messages: AnalysisMessage[]) {
  return messages.slice(-6).map((m) => ({
    id: m.id,
    direction: m.direction ?? "INBOUND",
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
/** The evidence view must be identical at the adapter and persistence boundaries. */
export function openaiEvidenceMessages(
  messages: AnalysisMessage[],
): AnalysisMessage[] {
  return minimalInquiry(messages).map((m) => ({
    ...m,
    fromEmail: messages.find((original) => original.id === m.id)!.fromEmail,
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
    context?: VerifiedCRM | ReplyContext,
  ): Promise<AIResult<T>> {
    const timeout = AbortSignal.timeout(45000);
    const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
    if (
      Buffer.byteLength(
        JSON.stringify({
          inquiry: minimalInquiry(messages),
          context: context ?? null,
        }),
        "utf8",
      ) > 45000
    )
      throw new Error("AI_REQUEST_LIMIT");
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
            verified_context: context ?? null,
          }),
          max_output_tokens: 1500,
          text: {
            format: {
              type: "json_schema",
              name: "sales_recommendation",
              schema: z.toJSONSchema(schema),
              strict: true,
            },
          },
        },
        { signal: abort },
      );
    } catch (e) {
      if (e instanceof OpenAI.APIConnectionTimeoutError || abort.aborted)
        throw new Error("JOB_TIMEOUT");
      if (e instanceof OpenAI.APIConnectionError)
        throw new Error("PROVIDER_FAILURE");
      if (e instanceof OpenAI.APIError) {
        if (e.status === 429) throw new Error("RATE_LIMIT");
        if (e.status === 401) throw new Error("AUTH_REQUIRED");
        if (e.status === 403)
          throw new OpenAIOutputError("AI_API_PERMISSION_DENIED", {
            stage: "API",
            httpStatus: 403,
          });
        if (e.status === 404)
          throw new OpenAIOutputError("AI_MODEL_UNAVAILABLE", {
            stage: "API",
            httpStatus: 404,
          });
        if (e.status === 400)
          throw new OpenAIOutputError("AI_API_REQUEST_REJECTED", {
            stage: "API",
            httpStatus: 400,
          });
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
    // Lifecycle failures may legitimately omit usage or output. Preserve their cause.
    const lifecycle = z.object({ status: z.string() }).safeParse(response);
    if (lifecycle.success && lifecycle.data.status !== "completed")
      throw new OpenAIOutputError(
        lifecycle.data.status === "incomplete"
          ? "AI_OUTPUT_INCOMPLETE"
          : "AI_RESPONSE_FAILED",
        { stage: "COMPLETION" },
      );
    const envelope = responseSchema.safeParse(response);
    if (!envelope.success)
      throw new OpenAIOutputError("INVALID_AI_OUTPUT_ENVELOPE", {
        stage: "ENVELOPE",
        invalidFields: fields(envelope.error, ["status", "output", "usage"]),
      });
    const raw = envelope.data;
    if (raw.status === "incomplete")
      throw new OpenAIOutputError("AI_OUTPUT_INCOMPLETE", {
        stage: "COMPLETION",
      });
    if (raw.status !== "completed")
      throw new OpenAIOutputError("AI_RESPONSE_FAILED", {
        stage: "COMPLETION",
      });
    if (raw.output.some((v) => v.type !== "message" && v.type !== "reasoning"))
      throw new OpenAIOutputError("INVALID_AI_OUTPUT_SCHEMA", {
        stage: "SCHEMA",
        invalidFields: ["output"],
      });
    const messagesOutput = raw.output.filter((v) => v.type === "message");
    if (messagesOutput.some((v) => v.status && v.status !== "completed"))
      throw new OpenAIOutputError("AI_OUTPUT_INCOMPLETE", {
        stage: "COMPLETION",
      });
    if (
      messagesOutput.length !== 1 ||
      messagesOutput.some((v) => v.role && v.role !== "assistant")
    )
      throw new OpenAIOutputError("INVALID_AI_OUTPUT_SCHEMA", {
        stage: "SCHEMA",
        invalidFields: ["output"],
      });
    const content = messagesOutput.flatMap((v) => v.content ?? []);
    if (content.some((v) => v.type === "refusal"))
      throw new OpenAIOutputError("AI_OUTPUT_REFUSED", { stage: "SAFETY" });
    if (!content.length || content.some((v) => v.type !== "output_text"))
      throw new OpenAIOutputError("INVALID_AI_OUTPUT_SCHEMA", {
        stage: "SCHEMA",
        invalidFields: ["output"],
      });
    let decoded: unknown;
    try {
      decoded = JSON.parse(content.map((v) => v.text ?? "").join(""));
    } catch {
      throw new OpenAIOutputError("INVALID_AI_OUTPUT_FORMAT", {
        stage: "FORMAT",
      });
    }
    const parsed = schema.safeParse(decoded);
    if (!parsed.success)
      throw new OpenAIOutputError("INVALID_AI_OUTPUT_SCHEMA", {
        stage: "SCHEMA",
        invalidFields: fields(
          parsed.error,
          Object.keys(openaiIntelligenceSchema.shape).concat("body"),
        ),
      });
    const value = parsed.data;
    return {
      value,
      provider: "OPENAI",
      model: this.model,
      inputTokens: raw.usage.input_tokens,
      outputTokens: raw.usage.output_tokens,
    };
  }
  async analyze(
    messages: AnalysisMessage[],
    signal?: AbortSignal,
    crm?: VerifiedCRM,
  ) {
    const result = await this.structured(
      messages,
      openaiIntelligenceSchema,
      "Classify mailKind as POTENTIAL_CUSTOMER, EXISTING_CUSTOMER, SUPPLIER, ADVERTISEMENT, SPAM or OTHER. Classify unsolicited website/marketing offers as ADVERTISEMENT even when they mention remodeling. Set category to Not a sales lead for suppliers, advertisements, spam and other unrelated mail. language is EN, ES or UNKNOWN. needsHumanReview is true if uncertain. Return email null (sender is resolved locally). Return source MAIL. Cite exact input message IDs and literal quotes for every non-null extracted fact. Each customerName, phone, projectLocation, budget and timeline must be a literal substring of its evidence quote; do not normalize, translate or reformat those values. Missing scalar facts are null, not empty strings or labels such as unknown. Evidence field names must match the JSON property names exactly. Extract explicit propertyAddress and consultationAvailability with literal evidence matching those field names; absent facts are null. Extract requested materials into materials with literal evidence named materials. Use verified CRM only as context; extraction fields still require email evidence. Use all supplied conversation history, but never attribute a quoted or forwarded name to the current sender. Avoid questions about already supplied facts; at most three questions. Use empty arrays, never null, for absent array facts. Keep literal quotes short and output concise. Budget only if explicitly stated. Treat newsletters and unrelated mail as Not a sales lead.",
      signal,
      crm,
    );
    const sanitized = openaiEvidenceMessages(messages);
    let value;
    try {
      value = validateEvidence(
        result.value.email === null
          ? result.value
          : { ...result.value, email: null },
        sanitized,
      );
    } catch {
      throw new OpenAIOutputError("INVALID_AI_OUTPUT_EVIDENCE", {
        stage: "EVIDENCE",
      });
    }
    value.email = messages.at(-1)?.fromEmail ?? null;
    if (
      value.urgency !== "UNKNOWN" &&
      !value.evidence.some(
        (e) =>
          e.field === "urgency" &&
          /\b(?:urgent|urgente|asap|as soon as possible|cuanto antes|inmediatamente|emergency|emergencia)\b/i.test(
            e.quote,
          ),
      )
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
      value.mailKind === "OTHER" ||
      value.language === "UNKNOWN" ||
      hasForward(messages);
    if (!["POTENTIAL_CUSTOMER", "EXISTING_CUSTOMER"].includes(value.mailKind))
      value.category = "Not a sales lead";
    return { ...result, value };
  }
  async draft(
    messages: AnalysisMessage[],
    language: "EN" | "ES",
    purpose: "QUALIFY" | "FOLLOW_UP" = "QUALIFY",
    context?: ReplyContext,
  ) {
    const result = await this.structured(
      messages,
      replySchema,
      `Draft only a short neutral ${purpose === "FOLLOW_UP" ? "follow-up" : "qualifying"} reply in ${language === "ES" ? "Spanish" : "English"}. Ask about missing scope, property address and timeline or visit availability. No prices, links, discounts, guarantees, free consultation claims, availability promises or contracts. ${context ? "Use known facts and the supplied follow-up event, if present, to acknowledge the inquiry without repeating sensitive numbers. A scheduled next action is not confirmation of a customer appointment; never promise or invent a date. Include exactly the locally supplied questions, verbatim, and no other questions or requests for information. Do not ask for email, budget, timeline or scope already known. Use a neutral greeting; no invented name. Keep the reply warm, professional and under 1800 characters." : ""}`,
      undefined,
      context,
    );
    try {
      return {
        ...result,
        value: context
          ? validateContextualReply(validateDraft(result.value.body), context)
          : validateDraft(result.value.body),
      };
    } catch {
      throw new OpenAIOutputError("INVALID_AI_OUTPUT_UNSAFE", {
        stage: "SAFETY",
      });
    }
  }
}
