import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mockIntelligence,
  validateEvidence,
} from "../src/sales-ai/domain/intelligence";
import {
  contextualReply,
  replyContext,
  validateContextualReply,
  hasForward,
  followUpSuggestion,
} from "../src/sales-ai/domain/context";
import { MockSalesAI } from "../src/sales-ai/providers/ai";
import {
  OpenAISalesAI,
  minimalInquiry,
} from "../src/sales-ai/providers/openai";
import { deliveryBlock, writeScopes } from "../src/sales-ai/domain/delivery";
import {
  prepareZohoDelivery,
  assertRealDeliveryEnabled,
} from "../src/sales-ai/providers/zoho-delivery";
import {
  authorizeUrl,
  writeAuthorizeUrl,
} from "../src/sales-ai/providers/zoho";

const pedro = (language: "EN" | "ES") => [
  {
    id: "pedro-regression",
    fromEmail: "pedro@example.invalid",
    subject: "Kitchen remodeling – Tampa",
    body:
      language === "EN"
        ? "Hello, I am Pedro Navaja. I want to remodel my kitchen in Tampa. My budget is $18,000-$25,000 and I want to start in 4-6 weeks. Cabinets, countertops, backsplash and LED."
        : "Hola, soy Pedro Navaja. Quiero remodelar mi cocina en Tampa. Mi presupuesto es $18,000-$25,000 y quiero comenzar en 4-6 semanas. Gabinetes, countertops, backsplash y LED.",
  },
];
for (const language of ["EN", "ES"] as const) {
  test(`Pedro regression ${language}: evidenced known facts, materials and only two necessary questions`, async () => {
    const messages = pedro(language);
    const facts = validateEvidence(mockIntelligence(messages), messages);
    assert.equal(facts.customerName, "Pedro Navaja");
    assert.equal(facts.projectLocation, "Tampa");
    assert.equal(facts.budget, "$18,000-$25,000");
    assert.equal(
      facts.timeline,
      language === "EN" ? "4-6 weeks" : "4-6 semanas",
    );
    assert.equal(facts.materials.length, 4);
    const context = replyContext(facts, {}, language);
    assert.equal(context.questions.length, 2);
    const mock = await new MockSalesAI().draft(
      messages,
      language,
      "QUALIFY",
      context,
    );
    assert.equal((mock.value.match(/\?/g) ?? []).length, 2);
    assert.doesNotMatch(
      mock.value,
      /email|correo|budget|presupuesto|weeks|semanas|free|gratis/i,
    );
    let calls = 0;
    const openai = new OpenAISalesAI(
      "simulation-only",
      "simulation-model",
      async (_url, init) => {
        const request = JSON.parse(String(init.body));
        assert.equal(request.store, false);
        assert.equal(request.text.format.strict, true);
        if (calls++ === 0)
          return Response.json({
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({ ...facts, email: null }),
                  },
                ],
              },
            ],
            usage: { input_tokens: 10, output_tokens: 10 },
          });
        assert.deepEqual(
          JSON.parse(request.input).verified_context.questions,
          context.questions,
        );
        return Response.json({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({ body: mock.value }),
                },
              ],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 10 },
        });
      },
    );
    const realAdapter = await openai.analyze(messages);
    assert.equal(realAdapter.value.budget, facts.budget);
    assert.equal(
      (await openai.draft(messages, language, "QUALIFY", context)).value,
      mock.value,
    );
    assert.equal(calls, 2); // mocked HTTP only
  });
}
test("verified CRM supersedes inferred context without mutating evidence; known address is not requested", () => {
  const facts = mockIntelligence(pedro("EN"));
  const context = replyContext(
    facts,
    {
      customerName: "Verified Customer",
      city: "Verified City",
      address: "Verified address",
      budget: "Confirmed range",
      timeline: "Confirmed date",
      serviceType: "Kitchen Remodeling",
    },
    "EN",
  );
  assert.equal(context.known.name, "Verified Customer");
  assert.equal(context.questions.length, 1);
  assert.equal(facts.customerName, "Pedro Navaja");
  assert.doesNotMatch(
    context.questions.join(" "),
    /email|budget|timeline|address|scope/i,
  );
});
test("reply and forward history is bounded; forwarded names are not promoted to sender identity", () => {
  const forwarded = [
    {
      ...pedro("EN")[0],
      subject: "Fwd: Kitchen inquiry",
      body: "Please review this inquiry.\n-----Forwarded message-----\nFrom: Someone Else\nI am Someone Else. Budget $99,000.",
    },
  ];
  assert.equal(hasForward(forwarded), true);
  assert.equal(mockIntelligence(forwarded).customerName, null);
  const history = Array.from({ length: 8 }, (_, n) => ({
    ...pedro("EN")[0],
    id: String(n),
    direction: n % 2 ? "OUTBOUND" : "INBOUND",
  }));
  assert.equal(minimalInquiry(history).length, 6);
  assert.equal(minimalInquiry(history).at(-1)?.direction, "OUTBOUND");
});
test("advertising and unrelated notices do not force a remodeling sale", () => {
  for (const body of [
    "I'm a marketing specialist offering a custom website for your remodeling business",
    "Password reset automated notification",
    "Subscribe to our newsletter",
  ]) {
    const facts = mockIntelligence([
      { ...pedro("EN")[0], subject: "Message", body },
    ]);
    assert.equal(facts.category, "Not a sales lead");
  }
});
test("fabricated materials, extra questions, invented greetings and free/availability claims are rejected", () => {
  const messages = pedro("EN");
  const facts = mockIntelligence(messages);
  assert.throws(() =>
    validateEvidence({ ...facts, materials: ["marble"] }, messages),
  );
  const context = replyContext(facts, {}, "EN");
  const valid = contextualReply(context, "EN");
  for (const unsafe of [
    valid + " What is your email?",
    "Dear Invented Name, " + valid,
    "Your consultation is free. " + valid,
    "We are available tomorrow. " + valid,
    valid + " Please share your budget.",
  ])
    assert.throws(() => validateContextualReply(unsafe, context));
  assert.equal(validateContextualReply(valid, context), valid);
});
test("follow-up suggestions require an actual scheduled event and never closed opportunities", () => {
  const date = new Date("2026-10-10T14:00:00Z");
  assert.deepEqual(
    followUpSuggestion("FOLLOW_UP", "Confirm consultation", date),
    { reason: "Confirm consultation", dueAt: date, stage: "FOLLOW_UP" },
  );
  for (const stage of [undefined, "WON", "LOST"])
    assert.equal(followUpSuggestion(stage, "Confirm", date), null);
  assert.equal(followUpSuggestion("NEW", null, null), null);
});
test("read and prospective write scopes are separate; production sending remains blocked", () => {
  const read = new URL(
    authorizeUrl(
      "EU",
      "synthetic-client",
      "http://localhost:3000/api/owner/zoho/callback",
      "opaque",
    ),
  );
  assert.ok(!read.searchParams.get("scope")!.includes("CREATE"));
  assert.throws(
    () => writeAuthorizeUrl("EU", "id", "uri", "state", false),
    /WRITE_AUTH_REQUIRED/,
  );
  const write = new URL(writeAuthorizeUrl("EU", "id", "uri", "state", true));
  assert.equal(write.origin, "https://accounts.zoho.eu");
  assert.equal(write.searchParams.get("scope"), writeScopes.join(","));
  assert.equal(deliveryBlock("ZOHO", true, true), "OUTBOUND_PAUSED");
  assert.equal(deliveryBlock("ZOHO", false), "WRITE_AUTH_REQUIRED");
  assert.equal(deliveryBlock("ZOHO", false, true), "LIVE_DISABLED");
  assert.throws(assertRealDeliveryEnabled, /LIVE_DISABLED/);
  const input = {
    region: "EU",
    accountId: "456",
    address: "sales@example.invalid",
    expectedRecipient: "pedro@example.invalid",
    recipient: "pedro@example.invalid",
    subject: "Re: Kitchen",
    body: "Thank you for the details.",
  };
  const prepared = prepareZohoDelivery(input);
  assert.equal(prepared.url, "https://mail.zoho.eu/api/accounts/456/messages");
  assert.equal(prepared.body.mailFormat, "plaintext");
  assert.ok(
    !("ccAddress" in prepared.body) && !("bccAddress" in prepared.body),
  );
  assert.throws(() =>
    prepareZohoDelivery({ ...input, recipient: "wrong@example.invalid" }),
  );
  assert.throws(() =>
    prepareZohoDelivery({
      ...input,
      subject: "Hello\r\nBcc: attacker@example.invalid",
    }),
  );
});
test("known address and consultation availability do not generate repeated questions", () => {
  const messages = [
    {
      ...pedro("EN")[0],
      body:
        pedro("EN")[0].body +
        " My property address is 123 Test Street. I am available Tuesday afternoon.",
    },
  ];
  const facts = validateEvidence(mockIntelligence(messages), messages);
  assert.equal(facts.propertyAddress, "123 Test Street");
  assert.equal(facts.consultationAvailability, "Tuesday afternoon");
  const context = replyContext(facts, {}, "EN");
  assert.equal(context.questions.length, 0);
  assert.equal(
    validateContextualReply(contextualReply(context, "EN"), context).includes(
      "?",
    ),
    false,
  );
});
test("reply history retains explicit prior budget and timeline with original message evidence", () => {
  const first = pedro("EN")[0];
  const messages = [
    first,
    {
      ...first,
      id: "reply",
      subject: "Re: Kitchen remodeling",
      body: "Thanks, could we discuss the next steps?",
    },
  ];
  const facts = validateEvidence(mockIntelligence(messages), messages);
  assert.equal(facts.budget, "$18,000-$25,000");
  assert.equal(facts.timeline, "4-6 weeks");
  assert.equal(
    facts.evidence.find((e) => e.field === "budget")?.messageId,
    first.id,
  );
});
