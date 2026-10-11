import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  jobCode,
  matchProject,
  rulesSuggestion,
  validateSuggestion,
  proposedAllocations,
  sourceView,
  suggestionSchema,
  type Candidate,
} from "../src/purchases/classification";
import { previewCSV } from "../src/purchases/home-depot";
import { sample } from "./purchases.fixture";
import { OpenAISalesAI } from "../src/sales-ai/providers/openai";
const candidates: Candidate[] = [
  {
    projectId: "p1",
    code: "F042",
    name: "Angela Kitchen Remodel",
    aliases: ["old angela job"],
    lines: [{ id: "l1", name: "Backsplash tile" }],
  },
  {
    projectId: "p2",
    code: "F043",
    name: "Angela Kitchen Remodel",
    aliases: [],
    lines: [],
  },
];
const d = () =>
  previewCSV(
    sample({ description: "Backsplash tile", job_name: "F042 Angela" }),
  ).purchases[0];
test("short codes are bounded, case tolerant, permanent-width and support growth", () => {
  for (const s of ["F042", "F-042", "f042", "F042 Angela"])
    assert.equal(jobCode(s), "F042");
  assert.equal(jobCode("F1000 New job"), "F1000");
  for (const s of [
    "AF042",
    "ref F042",
    "F0420x",
    "F042Angela",
    "F0042",
    "F000",
    "F42",
    "F-42",
    "F042-other",
  ])
    assert.equal(jobCode(s), null);
  assert.equal(matchProject(["F042 Angela"], candidates).projectId, "p1");
  assert.equal(
    matchProject(["F999", "old angela job"], candidates).projectId,
    null,
  );
  assert.equal(matchProject(["F042", "F043"], candidates).projectId, null);
});
test("only confirmed exact aliases resolve; ambiguous names never silently assign", () => {
  assert.equal(
    matchProject([" OLD   ANGELA JOB "], candidates).projectId,
    "p1",
  );
  assert.equal(
    matchProject(["old angela job xxx"], candidates).projectId,
    null,
  );
  assert.equal(
    matchProject(["Angela Kitchen Remodel"], candidates).ambiguous,
    true,
  );
  assert.equal(
    matchProject(["Angela Kitchen Remodel"], candidates).projectId,
    null,
  );
});
test("native summary has no invented materials, estimate lines or amounts", () => {
  const receipt = previewCSV(
    readFileSync(
      new URL(
        "../docs/examples/home-depot-pro-xtra-synthetic.csv",
        import.meta.url,
      ),
    ),
  ).purchases.find((p) => !p.native?.blockedReasons.length)!;
  const s = rulesSuggestion(receipt, candidates);
  assert.equal(s.lines[0].category, null);
  assert.equal(s.lines[0].costType, "OTHER");
  assert.deepEqual(validateSuggestion(s, receipt, candidates), s);
  assert.throws(() =>
    validateSuggestion(
      { ...s, lines: s.lines.map((l) => ({ ...l, category: "Tile" })) },
      receipt,
      candidates,
    ),
  );
  assert.equal(
    proposedAllocations(s, receipt)[0].amount,
    receipt.lines[0].line_total,
  );
  assert.equal("transaction_total" in sourceView(receipt), false);
});
test("item evidence is literal, IDs belong to original snapshot, facts cannot be invented", () => {
  const receipt = d(),
    s = rulesSuggestion(receipt, candidates);
  const line = s.lines[0];
  line.category = "Tile";
  line.costType = "MATERIAL";
  line.estimateLineId = "l1";
  line.evidence.push({ field: "description", quote: "Backsplash tile" });
  assert.deepEqual(validateSuggestion(s, receipt, candidates), s);
  for (const patch of [
    { projectId: "p2" },
    { explanation: "Invented amount $999.00" },
    { estimateLineId: "other-revision" },
    { category: "Cabinets" },
    { costType: "LABOR" },
    { evidence: [{ field: "description", quote: "invented product" }] },
  ])
    assert.throws(() =>
      validateSuggestion(
        { ...s, lines: [{ ...line, ...patch }] },
        receipt,
        candidates,
      ),
    );
  assert.throws(() => suggestionSchema.parse({ ...s, amount: "1.00" }));
  assert.throws(() =>
    validateSuggestion({ ...s, lines: [] }, receipt, candidates),
  );
});
test("purchase SDK sends strict schema/no tools/no storage, preserves parser failures with mocks", async () => {
  const receipt = d(),
    result = rulesSuggestion(receipt, candidates);
  let calls = 0;
  const transport = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    assert.equal(body.store, false);
    assert.deepEqual(body.tools, []);
    assert.equal(body.text.format.strict, true);
    assert.match(body.instructions, /untrusted/);
    assert.equal(body.text.format.schema.additionalProperties, false);
    assert.equal(
      body.text.format.schema.properties.lines.items.required.includes(
        "projectId",
      ),
      true,
    );
    calls++;
    return Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: JSON.stringify(result) }],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 80 },
    });
  };
  const engine = new OpenAISalesAI(
    "test-fake-key",
    "test-fake-model",
    transport,
  );
  assert.deepEqual(
    (
      await engine.classifyPurchase(
        { untrusted_purchase: sourceView(receipt) },
        suggestionSchema,
      )
    ).value,
    result,
  );
  assert.equal(calls, 1);
  for (const [status, text, code] of [
    ["incomplete", "{}", "AI_OUTPUT_INCOMPLETE"],
    ["completed", "bad-json", "INVALID_AI_OUTPUT_FORMAT"],
    [
      "completed",
      JSON.stringify({ needsHumanReview: true }),
      "INVALID_AI_OUTPUT_SCHEMA",
    ],
  ]) {
    const bad = new OpenAISalesAI(
      "test-fake-key",
      "test-fake-model",
      async () =>
        Response.json({
          status,
          output: [
            { type: "message", content: [{ type: "output_text", text }] },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
    );
    await assert.rejects(
      bad.classifyPurchase({}, suggestionSchema),
      new RegExp(code),
    );
  }
});
