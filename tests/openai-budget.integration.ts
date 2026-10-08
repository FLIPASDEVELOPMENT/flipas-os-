import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as service from "../src/sales-ai/server/service";
import { mockIntelligence } from "../src/sales-ai/domain/intelligence";
import { db } from "../src/server/db";
import { runAI, budgetSummary, monthKey } from "../src/sales-ai/server/budget";
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error("Disposable *_test database required");
after(() => db.$disconnect());
process.env.OPENAI_API_KEY = "simulated-not-real";
process.env.OPENAI_MODEL = "simulation-only";
process.env.OPENAI_INPUT_USD_PER_MILLION = "0.4";
process.env.OPENAI_OUTPUT_USD_PER_MILLION = "1.6";
process.env.OPENAI_PRICING_VERIFIED_AT = "2026-10-08";
test("persisted reservations serialize concurrent requests, retain uncertain cost and enforce per-email/pause", async () => {
  await db.salesAISettings.create({
    data: {
      id: "company",
      processingEnabled: true,
      aiProvider: "OPENAI",
      monthlyBudget: "0.03",
      alertAt: "0.01",
    },
  });
  let calls = 0;
  const transport = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 80));
    return Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                body: "Could you share the property address?",
              }),
            },
          ],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 10 },
    });
  };
  const mail = (id: string) => [
    {
      id,
      fromEmail: "test@example.invalid",
      subject: "Kitchen",
      body: "Please remodel my kitchen",
    },
  ];
  const call = (id: string) =>
    runAI(
      "simulation",
      "DRAFT",
      mail(id),
      (p) => p.draft(mail(id), "EN"),
      transport,
    );
  const results = await Promise.allSettled([
    call(randomUUID()),
    call(randomUUID()),
    call(randomUUID()),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(calls, 1);
  assert.equal((await budgetSummary()).spent, "0.000056");
  await db.salesAISettings.update({
    where: { id: "company" },
    data: { monthlyBudget: 10, aiPaused: true },
  });
  await assert.rejects(call("paused"), /AI_PAUSED/);
  assert.equal(calls, 1);
  await db.salesAISettings.update({
    where: { id: "company" },
    data: { aiPaused: false },
  });
  for (let i = 0; i < 4; i++) await call("same-email");
  await assert.rejects(call("same-email"), /AI_EMAIL_LIMIT/);
  let invalidCalls = 0;
  await assert.rejects(
    runAI(
      "simulation",
      "ANALYZE",
      mail("malformed"),
      (p) => p.analyze(mail("malformed")),
      async () => {
        invalidCalls++;
        return Response.json({
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "invalid" }],
            },
          ],
          usage: { input_tokens: 100, output_tokens: 10 },
        });
      },
    ),
    /INVALID_AI_OUTPUT/,
  );
  assert.equal(invalidCalls, 1);
  const invalid = await db.salesAIUsage.findFirstOrThrow({
    where: { messageId: "malformed" },
  });
  assert.equal(invalid.inputTokens, 100);
  assert.equal(invalid.status, "REJECTED");
  assert.equal(invalid.estimatedCost?.toString(), "0.000056");
  await assert.rejects(
    runAI(
      "simulation",
      "ANALYZE",
      mail("timeout"),
      (p) => p.analyze(mail("timeout")),
      async () => {
        throw new Error("simulated timeout");
      },
    ),
    /PROVIDER_FAILURE/,
  );
  const timeout = await db.salesAIUsage.findFirstOrThrow({
    where: { messageId: "timeout" },
  });
  assert.equal(timeout.status, "UNCERTAIN");
  assert.equal(timeout.estimatedCost, null);
  assert.equal((await budgetSummary()).reserved, "0.026400");
  await db.salesAIUsage.create({
    data: {
      provider: "OPENAI",
      model: "simulation",
      conversationId: "simulation",
      monthKey: monthKey(),
      estimatedCost: 10,
      success: true,
    },
  });
  await assert.rejects(call("exhausted"), /AI_BUDGET_LIMIT/);
  assert.ok(
    await db.activity.findFirst({ where: { type: "AI_BUDGET_ALERT" } }),
  );
  const owner = await db.user.create({
    data: {
      name: "Test owner",
      email: randomUUID() + "@example.invalid",
      passwordHash: "not-a-login",
      role: "OWNER",
    },
  });
  await service.initializeMock(owner);
  const connection = await db.mailConnection.findFirstOrThrow({
    where: { provider: "MOCK" },
  });
  await service.syncMailbox(connection.id);
  const c = await db.mailConversation.findFirstOrThrow({
    where: { connectionId: connection.id },
    include: { messages: true },
  });
  const facts = mockIntelligence(
    c.messages.map((m) => ({
      id: m.id,
      fromEmail: m.fromEmail,
      subject: m.subject,
      body: m.body,
    })),
  );
  await db.mailConversation.update({
    where: { id: c.id },
    data: {
      classification: "Kitchen Remodeling",
      intelligence: {
        ...facts,
        analysisProvider: "OPENAI",
        mailKind: "ADVERTISEMENT",
      },
      reviewedAt: new Date(),
    },
  });
  await assert.rejects(
    service.confirmLead(owner, c.id, {
      firstName: "Test",
      lastName: "Customer",
    }),
    /HUMAN_REVIEW_REQUIRED/,
  );
  await db.mailConversation.update({
    where: { id: c.id },
    data: {
      intelligence: {
        ...facts,
        analysisProvider: "OPENAI",
        mailKind: "POTENTIAL_CUSTOMER",
        needsHumanReview: true,
      },
      reviewedAt: null,
    },
  });
  await assert.rejects(
    service.confirmLead(owner, c.id, {
      firstName: "Test",
      lastName: "Customer",
    }),
    /HUMAN_REVIEW_REQUIRED/,
  );
  await assert.rejects(
    service.generateDraft(owner, c.id, "ES"),
    /HUMAN_REVIEW_REQUIRED/,
  );
  const sales = await db.user.create({
    data: {
      name: "Sales",
      email: randomUUID() + "@example.invalid",
      passwordHash: "not-a-login",
      role: "SALES",
    },
  });
  await assert.rejects(service.configureAI(sales, {}));
});
