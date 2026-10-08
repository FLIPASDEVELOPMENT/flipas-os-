import { businessMonthStart } from "../src/owner/calendar";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isOwner,
  projectOverhead,
  financialPolicyInput,
  builderPolicy,
  policyLine,
  PolicySnapshot,
} from "../src/owner/policy";
import { calculateEstimate } from "../src/estimator/domain/calculations";
const policy: PolicySnapshot = {
  id: "v1",
  version: 1,
  monthlyProjectedRevenue: "30000",
  monthlyFixedOverhead: "2000",
  targetMargin: "0.35",
  minimumMargin: "0.20",
  significantDiscountThreshold: "0",
};
test("only an active OWNER can access owner functions", () => {
  for (const role of ["ADMIN", "SALES", "CREW", "CUSTOMER", "PROJECT_MANAGER"])
    assert.equal(isOwner({ role, active: true }), false);
  assert.equal(isOwner({ role: "OWNER", active: false }), false);
  assert.equal(isOwner({ role: "OWNER", active: true }), true);
});
test("automatic project overhead uses net revenue and cents without intermediate ratio rounding", () => {
  assert.equal(projectOverhead("30000", policy), "2000.00");
  assert.equal(projectOverhead("1000", policy), "66.67");
  assert.equal(projectOverhead("0", policy), "0.00");
  assert.equal(projectOverhead("0.07", policy), "0.00");
});
test("owner policy validation and builder projection protect confidential monthly plans", () => {
  assert.ok(
    financialPolicyInput.safeParse({
      ...policy,
      expectedVersion: 1,
      reason: "Reviewed",
    }).success,
  );
  assert.equal(
    financialPolicyInput.safeParse({
      ...policy,
      expectedVersion: 1,
      reason: "Reviewed",
      monthlyProjectedRevenue: "0",
    }).success,
    false,
  );
  assert.equal(
    financialPolicyInput.safeParse({
      ...policy,
      expectedVersion: 1,
      reason: "Reviewed",
      targetMargin: "0.10",
    }).success,
    false,
  );
  assert.ok(
    !JSON.stringify(builderPolicy(policy)).includes("monthlyProjectedRevenue"),
  );
  assert.ok(
    !JSON.stringify(builderPolicy(policy)).includes("monthlyFixedOverhead"),
  );
});
test("estimator inherits target/minimum floors with margin pricing", () => {
  const line = policyLine(
    {
      name: "Test",
      description: "",
      unit: "EACH",
      quantity: "1",
      materialCost: "100",
      laborCost: "0",
      subcontractorCost: "0",
      otherDirectCost: "0",
      overheadAllocation: "10",
      targetMargin: "0",
      minimumMargin: "0",
      overrideUnitPrice: "",
      overrideReason: "",
      taxable: false,
    },
    policy,
  );
  const totals = calculateEstimate([line], "0", "0", "EXEMPT");
  assert.equal(totals.sellingPrice, "153.85");
  assert.equal(line.minimumMargin, "0.2");
  assert.equal(
    policyLine({ ...line, minimumMargin: "0.4" }, policy).targetMargin,
    "0.4",
  );
});

test("monthly reports follow New York boundaries including daylight saving", () => {
  assert.equal(
    businessMonthStart(new Date("2026-10-01T02:00:00Z")).toISOString(),
    "2026-09-01T04:00:00.000Z",
  );
  assert.equal(
    businessMonthStart(new Date("2026-01-15T12:00:00Z")).toISOString(),
    "2026-01-01T05:00:00.000Z",
  );
  assert.equal(
    businessMonthStart(new Date("2026-03-20T12:00:00Z")).toISOString(),
    "2026-03-01T05:00:00.000Z",
  );
});
