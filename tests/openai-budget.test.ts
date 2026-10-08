import { test } from "node:test";
import assert from "node:assert/strict";
import { cost, withinBudget, monthKey } from "../src/sales-ai/server/budget";
import { openaiConfig } from "../src/sales-ai/server/openai-config";
import {
  OpenAISalesAI,
  minimalInquiry,
} from "../src/sales-ai/providers/openai";
import { mockIntelligence } from "../src/sales-ai/domain/intelligence";
const mail = [
  {
    id: "test",
    fromEmail: "private@example.invalid",
    subject: "Kitchen",
    body: "I want to remodel my kitchen. Budget $15,000.",
  },
];
test("budget calculation uses decimal ceiling, blocks at limit and accounts for concurrent reservations", () => {
  assert.equal(cost(1000000, 1000000, "0.40", "1.60"), "2.000000");
  assert.equal(cost(1, 0, "0.40", "1.60"), "0.000001");
  assert.equal(withinBudget("10", "0", "10"), false);
  assert.equal(withinBudget("9.99", "0.02", "10"), false);
  assert.equal(withinBudget("9.98", "0.02", "10"), true);
  assert.equal(monthKey(new Date("2026-11-01T00:00:00Z")), "2026-11");
});
test("OpenAI configuration requires explicit private key/model/positive prices/verification date", () => {
  assert.throws(() => openaiConfig({}), /AI_CONFIG_REQUIRED/);
  const env = {
    OPENAI_API_KEY: "simulated-only",
    OPENAI_MODEL: "test-model",
    OPENAI_INPUT_USD_PER_MILLION: "0.4",
    OPENAI_OUTPUT_USD_PER_MILLION: "1.6",
    OPENAI_PRICING_VERIFIED_AT: "2026-10-08",
  };
  assert.equal(openaiConfig(env).model, "test-model");
  assert.throws(
    () => openaiConfig({ ...env, OPENAI_INPUT_USD_PER_MILLION: "0" }),
    /AI_CONFIG_REQUIRED/,
  );
});
test("SDK has no retries; invalid output still reports billable usage; sender is excluded", async () => {
  let requests = 0,
    observed = 0;
  const p = new OpenAISalesAI("simulation", "test-model", async () => {
    requests++;
    return new Response("rate limit", { status: 429 });
  });
  await assert.rejects(p.analyze(mail), /RATE_LIMIT/);
  assert.equal(requests, 1);
  assert.ok(
    !JSON.stringify(minimalInquiry(mail)).includes("private@example.invalid"),
  );
  const invalid = new OpenAISalesAI(
    "simulation",
    "test-model",
    async () =>
      Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "invalid json" }],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 10 },
      }),
    async (i, o) => {
      observed = i + o;
    },
  );
  await assert.rejects(invalid.analyze(mail), /INVALID_AI_OUTPUT/);
  assert.equal(observed, 110);
});
test("advertising cannot become a commercial lead; uncertain responses require review", async () => {
  const p = new OpenAISalesAI("simulation", "test-model", async () =>
    Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                ...mockIntelligence(mail),
                mailKind: "ADVERTISEMENT",
                email: null,
                needsHumanReview: false,
              }),
            },
          ],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
  );
  const result = await p.analyze(mail);
  assert.equal(result.value.category, "Not a sales lead");
  assert.equal(result.value.needsHumanReview, true);
});

test("unsupported urgency and service facts remain unknown instead of being invented", async () => {
  const p = new OpenAISalesAI("simulation", "test-model", async () =>
    Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                ...mockIntelligence(mail),
                email: null,
                urgency: "URGENT",
                requestedServices: ["Bathroom Remodeling"],
              }),
            },
          ],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
  );
  const result = await p.analyze(mail);
  assert.equal(result.value.urgency, "UNKNOWN");
  assert.deepEqual(result.value.requestedServices, []);
});
