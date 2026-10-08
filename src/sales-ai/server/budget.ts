import { safeError } from "../domain/security";
import Decimal from "decimal.js";
import { db } from "@/server/db";
import {
  minimalInquiry,
  OpenAISalesAI,
  OpenAIOutputError,
} from "../providers/openai";
import { MockSalesAI, type AIResult } from "../providers/ai";
import type { AnalysisMessage } from "../domain/intelligence";
import { openaiConfig } from "./openai-config";
export const INPUT_TOKEN_BOUND = 60000;
export const OUTPUT_TOKEN_BOUND = 1500;
export const EMAIL_REQUEST_LIMIT = 4;
export function monthKey(now = new Date()) {
  return now.toISOString().slice(0, 7);
}
export function cost(
  input: number,
  output: number,
  inputRate: string,
  outputRate: string,
) {
  return new Decimal(input)
    .times(inputRate)
    .plus(new Decimal(output).times(outputRate))
    .div(1000000)
    .toDecimalPlaces(6, Decimal.ROUND_CEIL)
    .toFixed(6);
}
export function withinBudget(used: string, reserved: string, limit: string) {
  return (
    new Decimal(used).lt(limit) && new Decimal(used).plus(reserved).lte(limit)
  );
}
export async function budgetSummary() {
  const key = monthKey();
  const rows = await db.salesAIUsage.findMany({
    where: {
      provider: "OPENAI",
      OR: [
        { monthKey: key },
        {
          monthKey: "",
          createdAt: {
            gte: new Date(key + "-01T00:00:00Z"),
            lt: new Date(
              new Date(key + "-01T00:00:00Z").setUTCMonth(Number(key.slice(5))),
            ),
          },
        },
      ],
    },
    select: {
      estimatedCost: true,
      reservedCost: true,
      status: true,
      inputTokens: true,
      outputTokens: true,
      id: true,
    },
  });
  let spent = new Decimal(0),
    reserved = new Decimal(0);
  for (const row of rows) {
    if (row.estimatedCost !== null)
      spent = spent.plus(row.estimatedCost.toString());
    else if (["RESERVED", "UNCERTAIN"].includes(row.status))
      reserved = reserved.plus(row.reservedCost.toString());
    else reserved = reserved.plus(10); // Unknown historical provider usage fails closed.
  }
  return {
    month: key,
    spent: spent.toFixed(6),
    reserved: reserved.toFixed(6),
    effective: spent.plus(reserved).toFixed(6),
    requests: rows.length,
    inputTokens: rows.reduce((n, r) => n + r.inputTokens, 0),
    outputTokens: rows.reduce((n, r) => n + r.outputTokens, 0),
  };
}
/** Reserve before network calls; a row lock serializes every worker and server request. */
export async function runAI<T>(
  conversationId: string,
  operation: string,
  messages: AnalysisMessage[],
  call: (provider: OpenAISalesAI | MockSalesAI) => Promise<AIResult<T>>,
  transport: import("../providers/openai").AITransport = fetch,
) {
  const settings = await db.salesAISettings.findUniqueOrThrow({
    where: { id: "company" },
  });
  if (settings.aiPaused) throw new Error("AI_PAUSED");
  if (!settings.processingEnabled) throw new Error("PROCESSING_DISABLED");
  if (settings.aiProvider === "MOCK") return call(new MockSalesAI());
  if (settings.aiProvider !== "OPENAI") throw new Error("AI_CONFIG_REQUIRED");
  const config = openaiConfig();
  if (
    !messages.length ||
    Buffer.byteLength(JSON.stringify(minimalInquiry(messages)), "utf8") > 45000
  )
    throw new Error("AI_REQUEST_LIMIT");
  const key = monthKey(),
    messageId = messages.at(-1)!.id;
  const reserve = cost(
    INPUT_TOKEN_BOUND,
    OUTPUT_TOKEN_BOUND,
    config.inputRate,
    config.outputRate,
  );
  const usage = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "MailMessage" WHERE "id" = ${messageId} FOR UPDATE`;
    await tx.salesAIBudgetMonth.upsert({
      where: { id: key },
      create: { id: key },
      update: {},
    });
    await tx.$queryRaw`SELECT "id" FROM "SalesAIBudgetMonth" WHERE "id" = ${key} FOR UPDATE`;
    const active = await tx.salesAISettings.findUniqueOrThrow({
      where: { id: "company" },
    });
    if (
      active.aiPaused ||
      active.aiProvider !== "OPENAI" ||
      !active.processingEnabled
    )
      throw new Error("AI_PAUSED");
    const attempts = await tx.salesAIUsage.count({
      where: { provider: "OPENAI", messageId },
    });
    if (attempts >= EMAIL_REQUEST_LIMIT) throw new Error("AI_EMAIL_LIMIT");
    const rows = await tx.salesAIUsage.findMany({
      where: {
        provider: "OPENAI",
        OR: [
          { monthKey: key },
          { monthKey: "", createdAt: { gte: new Date(key + "-01T00:00:00Z") } },
        ],
      },
    });
    const used = rows.reduce(
      (sum, r) =>
        sum.plus(
          r.estimatedCost?.toString() ??
            (["RESERVED", "UNCERTAIN"].includes(r.status)
              ? r.reservedCost.toString()
              : active.monthlyBudget.toString()),
        ),
      new Decimal(0),
    );
    if (
      !withinBudget(used.toString(), reserve, active.monthlyBudget.toString())
    )
      throw new Error("AI_BUDGET_LIMIT");
    return tx.salesAIUsage.create({
      data: {
        provider: "OPENAI",
        model: config.model,
        conversationId,
        operation,
        monthKey: key,
        messageId,
        status: "RESERVED",
        reservedCost: reserve,
        inputRate: config.inputRate,
        outputRate: config.outputRate,
        success: false,
      },
    });
  });
  let observed = false;
  let failureCode: string | null = null;
  let diagnostics: OpenAIOutputError["diagnostics"] | null = null;
  const provider = new OpenAISalesAI(
    config.key,
    config.model,
    transport,
    async (input, output) => {
      const estimated = cost(
        input,
        output,
        config.inputRate,
        config.outputRate,
      );
      await db.salesAIUsage.update({
        where: { id: usage.id },
        data: {
          inputTokens: input,
          outputTokens: output,
          estimatedCost: estimated,
          status: "OBSERVED",
        },
      });
      observed = true;
    },
  );
  try {
    const result = await call(provider);
    await db.salesAIUsage.update({
      where: { id: usage.id },
      data: { success: true, status: "SUCCEEDED" },
    });
    return result;
  } catch (error) {
    const errorCode = safeError(error);
    failureCode = errorCode;
    if (error instanceof OpenAIOutputError) diagnostics = error.diagnostics;
    await db.salesAIUsage.update({
      where: { id: usage.id },
      data: {
        status: observed ? "REJECTED" : "UNCERTAIN",
        errorCode,
      },
    });
    throw new Error(errorCode);
  } finally {
    const summary = await budgetSummary();
    await db.$transaction(async (tx) => {
      const current = await tx.salesAISettings.findUniqueOrThrow({
        where: { id: "company" },
      });
      const notified = await tx.salesAIBudgetMonth.updateMany({
        where: {
          id: key,
          alertSentAt: null,
          ...(new Decimal(summary.effective).gte(current.alertAt.toString())
            ? {}
            : { id: "never" }),
        },
        data: { alertSentAt: new Date() },
      });
      if (notified.count)
        await tx.activity.create({
          data: {
            type: "AI_BUDGET_ALERT",
            message: "AI monthly budget alert",
            metadata: { month: key, estimatedUSD: summary.effective },
          },
        });
      await tx.activity.create({
        data: {
          type: "AI_REQUEST_RECORDED",
          message: "AI operation recorded",
          metadata: {
            usageId: usage.id,
            operation,
            model: config.model,
            pricingVerifiedAt: config.verifiedAt,
            errorCode: failureCode,
            diagnostics,
          },
        },
      });
    });
  }
}
