import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  OpenAISalesAI,
  openaiIntelligenceSchema,
  OpenAIOutputError,
  openaiEvidenceMessages,
} from "../src/sales-ai/providers/openai";
import {
  validateEvidence,
  mockIntelligence,
} from "../src/sales-ai/domain/intelligence";
import { safeError } from "../src/sales-ai/domain/security";
const messages = [
  {
    id: "synthetic-kitchen",
    fromEmail: "test@example.invalid",
    subject: "Kitchen Remodeling Estimate – Tampa, FL",
    body: "Hello, I would like an estimate for remodeling my kitchen. Could we arrange a visit?",
  },
];
const facts = {
  ...mockIntelligence(messages),
  email: null,
  mailKind: "POTENTIAL_CUSTOMER",
  language: "EN",
  needsHumanReview: true,
  projectLocation: "Tampa, FL",
  evidence: [
    {
      field: "projectLocation",
      messageId: messages[0].id,
      quote: "Kitchen Remodeling Estimate – Tampa, FL",
    },
  ],
};
const envelope = (value: unknown, status = "completed") => ({
  status,
  output: [
    {
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify(value) }],
    },
  ],
  usage: { input_tokens: 100, output_tokens: 100 },
});
const provider = (
  raw: unknown,
  onUsage?: (i: number, o: number) => Promise<void>,
) =>
  new OpenAISalesAI(
    "simulation-only",
    "gpt-4.1-mini",
    async () => Response.json(raw),
    onUsage,
  );
test("strict API schema requires all fields and excludes legacy defaults", () => {
  const schema = z.toJSONSchema(openaiIntelligenceSchema) as {
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(
    [...schema.required].sort(),
    Object.keys(schema.properties).sort(),
  );
  assert.ok(!JSON.stringify(schema).includes('"default"'));
});
test("valid kitchen request keeps absent personal data unknown and requires exact location evidence", async () => {
  const result = await provider(envelope(facts)).analyze(messages);
  assert.equal(result.value.category, "Kitchen Remodeling");
  assert.equal(result.value.mailKind, "POTENTIAL_CUSTOMER");
  assert.equal(result.value.projectLocation, "Tampa, FL");
  for (const field of ["customerName", "phone", "budget", "timeline"] as const)
    assert.equal(result.value[field], null);
  assert.equal(result.value.urgency, "UNKNOWN");
  assert.equal(result.value.needsHumanReview, true);
});
test("incomplete, invalid JSON, missing fields, fabricated evidence and refusals fail distinctly with observed usage", async () => {
  let tokens = 0;
  await assert.rejects(
    provider(envelope(facts, "incomplete"), async (i, o) => {
      tokens = i + o;
    }).analyze(messages),
    /AI_OUTPUT_INCOMPLETE/,
  );
  assert.equal(tokens, 200);
  const malformed = envelope(facts);
  malformed.output[0].content[0].text = "{unfinished";
  await assert.rejects(
    provider(malformed).analyze(messages),
    /INVALID_AI_OUTPUT_FORMAT/,
  );
  const missing = { ...facts } as Record<string, unknown>;
  delete missing.phone;
  await assert.rejects(
    provider(envelope(missing)).analyze(messages),
    (error) => {
      assert.ok(error instanceof OpenAIOutputError);
      assert.equal(error.message, "INVALID_AI_OUTPUT_SCHEMA");
      assert.deepEqual(error.diagnostics.invalidFields, ["phone"]);
      return true;
    },
  );
  await assert.rejects(
    provider(envelope({ ...facts, budget: "$99,000" })).analyze(messages),
    /INVALID_AI_OUTPUT_EVIDENCE/,
  );
  const refusal = {
    ...envelope(facts),
    output: [{ type: "message", content: [{ type: "refusal" }] }],
  };
  await assert.rejects(
    provider(refusal).analyze(messages),
    /AI_OUTPUT_REFUSED/,
  );
  await assert.rejects(
    provider({ ...envelope(facts), usage: null }).analyze(messages),
    /INVALID_AI_OUTPUT_ENVELOPE/,
  );
});
test("API errors preserve safe configuration/permission/rate classifications without provider details", async () => {
  for (const [status, code] of [
    [400, "AI_API_REQUEST_REJECTED"],
    [401, "AUTH_REQUIRED"],
    [403, "AI_API_PERMISSION_DENIED"],
    [404, "AI_MODEL_UNAVAILABLE"],
    [429, "RATE_LIMIT"],
  ] as const) {
    const p = new OpenAISalesAI(
      "simulation-only",
      "test-model",
      async () =>
        new Response("untrusted private provider details", { status }),
    );
    await assert.rejects(p.analyze(messages), new RegExp(code));
    assert.equal(safeError(new Error(code)), code);
  }
  assert.equal(
    safeError(new Error("untrusted private provider details")),
    "PROVIDER_FAILURE",
  );
});

test("HTML evidence uses the same canonical text at both validation boundaries", async () => {
  const htmlMessages = [
    { ...messages[0], body: "I need kitchen remodeling in <b>Tampa, FL</b>." },
  ];
  const htmlFacts = {
    ...facts,
    evidence: [
      {
        field: "projectLocation",
        messageId: messages[0].id,
        quote: "kitchen remodeling in  Tampa, FL ",
      },
    ],
  };
  const result = await provider(envelope(htmlFacts)).analyze(htmlMessages);
  assert.throws(
    () => validateEvidence(result.value, htmlMessages),
    /INVALID_AI_OUTPUT/,
  );
  assert.equal(
    validateEvidence(result.value, openaiEvidenceMessages(htmlMessages))
      .projectLocation,
    "Tampa, FL",
  );
});
test("lifecycle errors without usage, message incompleteness and reasoning remain distinct", async () => {
  await assert.rejects(
    provider({ status: "incomplete", usage: null }).analyze(messages),
    /AI_OUTPUT_INCOMPLETE/,
  );
  await assert.rejects(
    provider({ status: "failed", usage: null }).analyze(messages),
    /AI_RESPONSE_FAILED/,
  );
  const partial = envelope(facts);
  await assert.rejects(
    provider({
      ...partial,
      output: [{ ...partial.output[0], status: "incomplete" }],
    }).analyze(messages),
    /AI_OUTPUT_INCOMPLETE/,
  );
  const reasoning = {
    type: "reasoning",
    content: [{ type: "output_text", text: "not an answer" }],
  };
  assert.equal(
    (
      await provider({
        ...partial,
        output: [reasoning, ...partial.output],
      }).analyze(messages)
    ).value.projectLocation,
    "Tampa, FL",
  );
  await assert.rejects(
    provider({ ...partial, output: [reasoning] }).analyze(messages),
    /INVALID_AI_OUTPUT_SCHEMA/,
  );
});
test("strict nested schema, nulls, enums and additional fields are enforced", async () => {
  const schema = z.toJSONSchema(openaiIntelligenceSchema);
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.type === "object") {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual(
        [...(node.required as string[])].sort(),
        Object.keys(node.properties as object).sort(),
      );
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(schema);
  for (const invalid of [
    { ...facts, mailKind: "LEAD" },
    { ...facts, confidence: null },
    { ...facts, extra: true },
  ])
    await assert.rejects(
      provider(envelope(invalid)).analyze(messages),
      /INVALID_AI_OUTPUT_SCHEMA/,
    );
});
