import { test } from "node:test";
import assert from "node:assert/strict";
import { price } from "../src/domain/money";
import {
  canAccess,
  canOverridePrice,
  canUseCRM,
  requiresApproval,
  Role,
} from "../src/domain/permissions";
import { hashPassword, verifyPassword } from "../src/server/password";
import { leadInput } from "../src/server/validation";
const base = {
  material: "0.10",
  labor: "0.20",
  subcontractor: "0",
  overhead: "0",
  quantity: "3",
  markup: "0.5",
  minimumMargin: "0",
};
test("decimal pricing never introduces floating point cents", () =>
  assert.deepEqual(price(base), {
    directCost: "0.90",
    sellingPrice: "1.35",
    grossProfit: "0.45",
    grossMargin: "0.3333",
  }));
test("minimum margin floor and overhead are respected", () => {
  const p = price({
    ...base,
    material: "100",
    labor: "0",
    quantity: "1",
    overhead: "10",
    markup: "0",
    minimumMargin: "0.4",
  });
  assert.equal(p.sellingPrice, "166.67");
  assert.equal(p.grossProfit, "66.67");
});
test("zero revenue has defined margin", () =>
  assert.equal(price({ ...base, quantity: "0" }).grossMargin, "0.0000"));
test("negative, nonfinite and impossible margin inputs fail", () => {
  for (const quantity of ["-1", "NaN", "Infinity"])
    assert.throws(() => price({ ...base, quantity }));
  assert.throws(() => price({ ...base, minimumMargin: "1" }));
});
test("role matrix denies operational and customer CRM access", () => {
  for (const role of ["PROJECT_MANAGER", "CREW", "CUSTOMER"] as Role[]) {
    assert.equal(canUseCRM(role), false);
    assert.equal(canAccess(role, "a", "a"), false);
    assert.equal(canOverridePrice(role), false);
  }
  for (const role of ["OWNER", "ADMIN"] as Role[]) {
    assert.equal(canAccess(role, "a", "b"), true);
    assert.equal(canOverridePrice(role), true);
  }
  assert.equal(canAccess("SALES", "a", "a"), true);
  assert.equal(canAccess("SALES", "a", "b"), false);
  assert.equal(canAccess("SALES", "a", null), false);
  assert.equal(canOverridePrice("SALES"), false);
});
test("medium/high AI actions require human approval", () => {
  assert.equal(requiresApproval("LOW"), false);
  assert.equal(requiresApproval("MEDIUM"), true);
  assert.equal(requiresApproval("HIGH"), true);
});
test("password salt, verification and rejection", async () => {
  const a = await hashPassword("Strong password 123");
  const b = await hashPassword("Strong password 123");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("Strong password 123", a), true);
  assert.equal(await verifyPassword("wrong", a), false);
  assert.equal(await verifyPassword("wrong", "invalid"), false);
});
test("lead budgets and score validated server-side", () => {
  const v = {
    customerId: "x",
    source: "WEBSITE",
    serviceType: "Kitchen",
    description: "",
    status: "NEW",
    leadScore: "80",
    budgetMin: "100",
    budgetMax: "200",
    desiredStartDate: "",
    assignedToId: "",
  };
  assert.equal(leadInput.safeParse(v).success, true);
  assert.equal(leadInput.safeParse({ ...v, budgetMax: "50" }).success, false);
  assert.equal(leadInput.safeParse({ ...v, leadScore: "101" }).success, false);
});
