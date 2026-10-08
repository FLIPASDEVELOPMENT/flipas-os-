import Decimal from "decimal.js";
export function estimatedUsageCost(
  rates: { input: string | null; output: string | null },
  usage: { provider: string; inputTokens: number; outputTokens: number },
) {
  if (
    usage.provider === "MOCK" ||
    rates.input === null ||
    rates.output === null
  )
    return null;
  return new Decimal(rates.input)
    .mul(usage.inputTokens)
    .add(new Decimal(rates.output).mul(usage.outputTokens))
    .div(1000000)
    .toDecimalPlaces(6)
    .toString();
}
