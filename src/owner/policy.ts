import Decimal from "decimal.js";
const D = Decimal.clone({ precision: 40 });
import { z } from "zod";
import { moneyInput, ratioInput, LineInput } from "@/estimator/domain/input";
export const financialPolicyInput = z
  .object({
    expectedVersion: z.coerce.number().int().positive(),
    monthlyProjectedRevenue: moneyInput.refine((v) => new D(v).gt(0)),
    monthlyFixedOverhead: moneyInput,
    targetMargin: ratioInput.refine((v) => new D(v).lt(1)),
    minimumMargin: ratioInput,
    significantDiscountThreshold: ratioInput,
    reason: z.string().trim().min(1).max(2000),
  })
  .refine((v) => new D(v.targetMargin).gte(v.minimumMargin), {
    message: "Target margin must be at least minimum margin",
  });
export type PolicySnapshot = {
  id: string;
  version: number;
  monthlyProjectedRevenue: string;
  monthlyFixedOverhead: string;
  targetMargin: string;
  minimumMargin: string;
  significantDiscountThreshold: string;
};
export function policySnapshot(p: {
  id: string;
  version: number;
  monthlyProjectedRevenue: { toString(): string };
  monthlyFixedOverhead: { toString(): string };
  targetMargin: { toString(): string };
  minimumMargin: { toString(): string };
  significantDiscountThreshold: { toString(): string };
}): PolicySnapshot {
  return {
    id: p.id,
    version: p.version,
    monthlyProjectedRevenue: p.monthlyProjectedRevenue.toString(),
    monthlyFixedOverhead: p.monthlyFixedOverhead.toString(),
    targetMargin: p.targetMargin.toString(),
    minimumMargin: p.minimumMargin.toString(),
    significantDiscountThreshold: p.significantDiscountThreshold.toString(),
  };
}
export function parsePolicy(v: unknown): PolicySnapshot | null {
  const result = z
    .object({
      id: z.string(),
      version: z.number().int().positive(),
      monthlyProjectedRevenue: moneyInput,
      monthlyFixedOverhead: moneyInput,
      targetMargin: ratioInput,
      minimumMargin: ratioInput,
      significantDiscountThreshold: ratioInput,
    })
    .safeParse(v);
  return result.success ? result.data : null;
}
export function projectOverhead(netRevenue: string, policy: PolicySnapshot) {
  return new D(netRevenue)
    .mul(policy.monthlyFixedOverhead)
    .div(policy.monthlyProjectedRevenue)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2);
}
export function policyLine(
  line: LineInput,
  policy: Pick<PolicySnapshot, "targetMargin" | "minimumMargin">,
): LineInput {
  return {
    ...line,
    targetMargin: D.max(policy.targetMargin, line.minimumMargin).toString(),
    minimumMargin: D.max(policy.minimumMargin, line.minimumMargin).toString(),
  };
}
export function isOwner(user: { role: string; active: boolean }) {
  return user.active && user.role === "OWNER";
}

export type BuilderPolicy = Pick<
  PolicySnapshot,
  | "id"
  | "version"
  | "targetMargin"
  | "minimumMargin"
  | "significantDiscountThreshold"
> & { overheadRate: string };
export function builderPolicy(p: PolicySnapshot | null): BuilderPolicy | null {
  return p
    ? {
        id: p.id,
        version: p.version,
        targetMargin: p.targetMargin,
        minimumMargin: p.minimumMargin,
        significantDiscountThreshold: p.significantDiscountThreshold,
        overheadRate: new D(p.monthlyFixedOverhead)
          .div(p.monthlyProjectedRevenue)
          .toString(),
      }
    : null;
}
export function allocatedOverheadFromRate(netRevenue: string, rate: string) {
  return new D(netRevenue)
    .mul(rate)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2);
}
