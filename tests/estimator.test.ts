import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import {
  calculateEstimate,
  targetPrice,
  marginRatio,
  markupRatio,
} from "../src/estimator/domain/calculations";
import { LineInput } from "../src/estimator/domain/input";
import { proposalDTO } from "../src/estimator/domain/proposal";
import { proposalPDF } from "../src/estimator/server/pdf";
const item = (patch: Partial<LineInput> = {}): LineInput => ({
  name: "Service",
  description: "",
  unit: "EACH",
  quantity: "1",
  materialCost: "100",
  laborCost: "0",
  subcontractorCost: "0",
  otherDirectCost: "0",
  overheadAllocation: "10",
  targetMargin: "0.30",
  minimumMargin: "0.20",
  overrideUnitPrice: "",
  overrideReason: "",
  taxable: true,
  serviceItemId: "catalog",
  ...patch,
});
test("margin pricing differs from markup, rounds upward, safely handles zero and losses", () => {
  assert.equal(targetPrice("100", "0.30"), "142.86");
  assert.equal(marginRatio("100", "125"), "0.2000");
  assert.equal(markupRatio("100", "125"), "0.2500");
  assert.equal(marginRatio("100", "50"), "-1.0000");
  assert.equal(marginRatio("0", "0"), null);
  assert.equal(markupRatio("0", "100"), null);
  assert.equal(targetPrice("0", "0.99"), "0.00");
  for (const m of ["1", "-0.1", "NaN"])
    assert.throws(() => targetPrice("100", m));
});
test("extended costs, discount, reviewed tax, overhead and minimum-margin flags are decimal safe", () => {
  const t = calculateEstimate(
    [
      item({
        quantity: "2",
        targetMargin: "0.20",
        otherDirectCost: "10",
        laborCost: "10",
      }),
    ],
    "0.10",
    "0.07",
    "TAXABLE",
    "0.05",
  );
  assert.equal(t.directCost, "240.00");
  assert.equal(t.subtotal, "300.00");
  assert.equal(t.discountAmount, "30.00");
  assert.equal(t.sellingPrice, "270.00");
  assert.equal(t.taxAmount, "18.90");
  assert.equal(t.totalInvestment, "288.90");
  assert.equal(t.grossProfit, "30.00");
  assert.equal(t.allocatedOverhead, "20.00");
  assert.equal(t.contributionProfit, "10.00");
  assert.ok(t.reasons.includes("BELOW_MINIMUM_MARGIN"));
  assert.ok(t.reasons.includes("SIGNIFICANT_DISCOUNT"));
  assert.equal(
    calculateEstimate([item()], "0", "0.07", "UNREVIEWED").taxAmount,
    "0.00",
  );
  assert.equal(
    calculateEstimate([item()], "0", "0.07", "EXEMPT").taxAmount,
    "0.00",
  );
});
test("largest-remainder discounts preserve cent totals and taxable allocation", () => {
  const lines = Array.from({ length: 3 }, (_, i) =>
    item({
      materialCost: "0.01",
      overheadAllocation: "0",
      targetMargin: "0",
      minimumMargin: "0",
      taxable: i === 0,
    }),
  );
  const t = calculateEstimate(lines, "0.50", "1", "TAXABLE");
  assert.equal(t.discountAmount, "0.02");
  assert.equal(t.sellingPrice, "0.01");
  assert.equal(t.taxAmount, "0.00");
  assert.equal(
    calculateEstimate(
      [item({ quantity: "0.333", targetMargin: "0" })],
      "0",
      "0",
      "EXEMPT",
    ).directCost,
    "33.30",
  );
  assert.throws(() =>
    calculateEstimate([item({ quantity: "0" })], "0", "0", "EXEMPT"),
  );
  assert.throws(() =>
    calculateEstimate([item({ materialCost: "-1" })], "0", "0", "EXEMPT"),
  );
  assert.throws(() =>
    calculateEstimate([item({ overrideUnitPrice: "50" })], "0", "0", "EXEMPT"),
  );
  const negative = calculateEstimate(
    [item({ overrideUnitPrice: "50", overrideReason: "Approved exception" })],
    "0",
    "0",
    "EXEMPT",
  );
  assert.equal(negative.grossProfit, "-50.00");
  assert.ok(negative.reasons.includes("MANUAL_PRICE_OVERRIDE"));
});
test("customer projection excludes financial secrets and creates multi-page PDF", async () => {
  const source = {
    id: "e",
    number: "F-1-R1",
    revision: 1,
    status: "DRAFT",
    category: "Kitchen",
    projectAddress: "Test address",
    scope: "Scope ".repeat(1000),
    inclusions: "Fixtures",
    exclusions: "Appliances",
    durationDays: 10,
    expiresAt: new Date("2030-01-01"),
    paymentSchedule: [
      { label: "Deposit", percentage: "1", internal: "SECRET" },
    ],
    customerSnapshot: { name: "Customer" },
    businessSnapshot: { companyName: "Flipas", terms: "Reviewed terms" },
    sellingPrice: "100",
    discountAmount: "0",
    taxAmount: "0",
    totalInvestment: "100",
    notes: "SECRET",
    directCost: "SECRET",
    grossMargin: "SECRET",
    sections: [
      {
        name: "Section",
        lines: [
          {
            name: "Service",
            description: "Visible",
            unit: "EACH",
            quantity: "1",
            unitPrice: "100",
            sellingPrice: "100",
            materialCost: "SECRET",
            overrideReason: "SECRET",
          },
        ],
      },
    ],
  };
  const dto = proposalDTO(source);
  assert.ok(!JSON.stringify(dto).includes("SECRET"));
  assert.ok(!JSON.stringify(dto).includes("grossMargin"));
  assert.equal(dto.draft, true);
  assert.equal(proposalDTO({ ...source, status: "SENT" }).draft, false);
  const bytes = await proposalPDF(dto);
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() > 1);
  assert.equal(Buffer.from(bytes).subarray(0, 4).toString(), "%PDF");
});
