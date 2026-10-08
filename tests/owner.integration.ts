import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import {
  activePolicy,
  saveFinancialPolicy,
  ownerSummary,
} from "../src/owner/service";
import {
  saveDraft,
  readEstimate,
  toDraft,
} from "../src/estimator/server/service";
import { DraftInput } from "../src/estimator/domain/input";
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error("Disposable *_test database required");
after(() => db.$disconnect());
test("owner-only policy writes, immutable history, audit and estimate snapshots", async () => {
  const make = (role: "OWNER" | "SALES" | "ADMIN") =>
    db.user.create({
      data: {
        name: role,
        email: `${randomUUID()}@example.invalid`,
        role,
        passwordHash: "not-a-login-hash",
      },
    });
  const owner = await make("OWNER"),
    sales = await make("SALES"),
    admin = await make("ADMIN");
  const original = await activePolicy();
  assert.equal(original.monthlyProjectedRevenue, "30000");
  const policy = {
    expectedVersion: original.version,
    monthlyProjectedRevenue: "30000",
    monthlyFixedOverhead: "2000",
    targetMargin: "0.35",
    minimumMargin: "0.20",
    significantDiscountThreshold: "0.05",
    reason: "Owner test policy",
  };
  await assert.rejects(saveFinancialPolicy(sales, policy), /OWNER/);
  await assert.rejects(saveFinancialPolicy(admin, policy), /OWNER/);
  await assert.rejects(ownerSummary(sales), /OWNER/);
  await saveFinancialPolicy(owner, policy);
  await assert.rejects(saveFinancialPolicy(owner, policy), /changed/);
  await assert.rejects(
    db.financialPolicy.update({
      where: { id: original.id },
      data: { monthlyFixedOverhead: "1" },
    }),
  );
  const customer = await db.customer.create({
    data: { firstName: "Test", lastName: "Owner" },
  });
  const input: DraftInput = {
    contentVersion: 0,
    customerId: customer.id,
    opportunityId: "",
    category: "General Remodeling",
    projectAddress: "Test",
    scope: "Test",
    notes: "",
    inclusions: "",
    exclusions: "",
    durationDays: null,
    expiresAt: "",
    paymentSchedule: [],
    discountRate: "0",
    taxTreatment: "UNREVIEWED",
    taxRate: "0",
    sections: [
      {
        name: "Test",
        lines: [
          {
            name: "Test service",
            description: "",
            unit: "EACH",
            quantity: "1",
            materialCost: "100",
            laborCost: "0",
            subcontractorCost: "0",
            otherDirectCost: "0",
            overheadAllocation: "99",
            targetMargin: "0",
            minimumMargin: "0",
            overrideUnitPrice: "",
            overrideReason: "",
            taxable: false,
          },
        ],
      },
    ],
  };
  const id = await saveDraft(owner, input);
  let estimate = await readEstimate(owner, id);
  assert.equal(estimate.sellingPrice.toString(), "153.85");
  assert.equal(estimate.allocatedOverhead.toString(), "10.26");
  assert.equal(estimate.contributionProfit.toString(), "43.59");
  const snapshot = estimate.financialPolicySnapshot;
  const current = await activePolicy();
  await saveFinancialPolicy(owner, {
    ...policy,
    expectedVersion: current.version,
    targetMargin: "0.40",
    monthlyFixedOverhead: "3000",
  });
  await saveDraft(owner, toDraft(estimate));
  estimate = await readEstimate(owner, id);
  assert.deepEqual(estimate.financialPolicySnapshot, snapshot);
  assert.equal(estimate.sellingPrice.toString(), "153.85");
  assert.equal(estimate.allocatedOverhead.toString(), "10.26");
  const newId = await saveDraft(owner, input);
  const newer = await readEstimate(owner, newId);
  assert.equal(newer.sellingPrice.toString(), "166.67");
  assert.equal(newer.allocatedOverhead.toString(), "16.67");
  assert.ok(
    (await db.activity.count({
      where: { actorId: owner.id, type: "FINANCIAL_POLICY_CHANGED" },
    })) >= 2,
  );
  const report = await ownerSummary(owner);
  assert.equal(report.customers, 1);
  assert.equal(report.monthlyAcceptedContractValue, "0");
  assert.equal(report.projects.length, 0);
});
