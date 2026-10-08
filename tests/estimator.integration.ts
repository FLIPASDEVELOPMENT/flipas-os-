import { activePolicy, saveFinancialPolicy } from "../src/owner/service";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import {
  initializeCatalog,
  saveCatalog,
  saveSettings,
  saveDraft,
  readEstimate,
  toDraft,
  submitEstimate,
  decideEstimate,
  transitionEstimate,
  copyEstimate,
  handoffProject,
} from "../src/estimator/server/service";
import { estimatorAnalysisContext } from "../src/estimator/server/analysis";
import { DraftInput, LineInput } from "../src/estimator/domain/input";
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error(
    "Run estimator integration ONLY in a disposable *_test database",
  );
after(async () => {
  await db.$disconnect();
});
test("migration, catalog snapshot, stale edits, RBAC, approval, immutability, revision and idempotent handoff", async () => {
  const prefix = randomUUID();
  const make = (role: "OWNER" | "SALES" | "CREW", n: string) =>
    db.user.create({
      data: {
        email: `${prefix}-${n}@example.invalid`,
        name: n,
        role,
        passwordHash: "not-a-login-hash",
      },
    });
  const owner = await make("OWNER", "owner"),
    sales = await make("SALES", "sales"),
    other = await make("SALES", "other"),
    crew = await make("CREW", "crew");
  const initialPolicy = await activePolicy();
  await saveFinancialPolicy(owner, {
    ...initialPolicy,
    expectedVersion: initialPolicy.version,
    targetMargin: "0.20",
    minimumMargin: "0.10",
    significantDiscountThreshold: "0.05",
    reason: "Development-only estimator regression policy",
  });
  await initializeCatalog(owner);
  await initializeCatalog(owner);
  assert.equal(await db.serviceCategory.count(), 9);
  assert.equal(await db.estimateTemplate.count(), 3);
  await assert.rejects(initializeCatalog(sales), /Owner/);
  await saveSettings(owner, {
    companyName: "Test company",
    contactInfo: "Test contact",
    brandingColor: "#172b30",
    terms: "Development-only reviewed test terms",
    significantDiscountThreshold: "0.05",
  });
  const category = await db.serviceCategory.findFirstOrThrow();
  const pricing = {
    categoryId: category.id,
    name: "Development-only test service",
    description: "Test only",
    unit: "EACH",
    materialCost: "100",
    laborCost: "0",
    subcontractorCost: "0",
    otherDirectCost: "0",
    overheadAllocation: "10",
    targetMargin: "0.20",
    minimumMargin: "0.10",
    active: true,
    effectiveFrom: "2020-01-01",
    effectiveTo: "",
    reason: "Test fixture",
  };
  const catalog = await saveCatalog(owner, pricing);
  await assert.rejects(saveCatalog(sales, pricing), /Owner/);
  const customer = await db.customer.create({
    data: {
      firstName: "Test",
      lastName: "Customer",
      email: `${prefix}@example.invalid`,
    },
  });
  const lead = await db.lead.create({
    data: {
      customerId: customer.id,
      source: "REFERRAL",
      serviceType: "Kitchen",
      assignedToId: sales.id,
    },
  });
  const opportunity = await db.opportunity.create({
    data: {
      customerId: customer.id,
      leadId: lead.id,
      ownerId: sales.id,
      estimatedValue: "100",
      probability: 50,
    },
  });
  const line: LineInput = {
    ...pricing,
    unit: "EACH",
    quantity: "2",
    overrideUnitPrice: "",
    overrideReason: "",
    taxable: true,
    serviceItemId: catalog.id,
  };
  const input: DraftInput = {
    customerId: customer.id,
    opportunityId: opportunity.id,
    category: "Kitchen",
    projectAddress: "Test address",
    scope: "Test scope",
    notes: "INTERNAL ONLY",
    inclusions: "Test inclusion",
    exclusions: "Test exclusion",
    durationDays: 5,
    expiresAt: "2030-01-01",
    paymentSchedule: [{ label: "Completion", percentage: "1" }],
    discountRate: "0",
    taxRate: "0",
    taxTreatment: "UNREVIEWED",
    contentVersion: 0,
    sections: [{ name: "Work", lines: [line] }],
  };
  const id = await saveDraft(sales, input);
  let e = await readEstimate(owner, id);
  assert.equal(e.directCost.toString(), "200");
  assert.equal(e.sellingPrice.toString(), "250");
  await assert.rejects(readEstimate(other, id), /unavailable/);
  await assert.rejects(readEstimate(crew, id), /denied/);
  await saveCatalog(owner, {
    ...pricing,
    id: catalog.id,
    materialCost: "500",
    reason: "Changed catalog",
  });
  let draft = toDraft(e);
  draft.sections[0].lines[0].materialCost = "999";
  await saveDraft(sales, draft);
  e = await readEstimate(owner, id);
  assert.equal(e.directCost.toString(), "200");
  assert.equal(e.sections[0].lines[0].materialCost.toString(), "100");
  await assert.rejects(saveDraft(sales, draft), /changed/);
  draft = toDraft(e);
  await assert.rejects(
    saveDraft(sales, { ...draft, taxRate: "0.07" }),
    /Owner/,
  );
  await submitEstimate(sales, id, e.contentVersion);
  await assert.rejects(
    decideEstimate(sales, id, true, "Self approval"),
    /Owner/,
  );
  await assert.rejects(
    decideEstimate(owner, id, true, "Review"),
    /tax treatment/,
  );
  await assert.rejects(
    db.estimate.update({ where: { id }, data: { sellingPrice: "1" } }),
  );
  await assert.rejects(
    db.estimateLineItem.update({
      where: { id: e.sections[0].lines[0].id },
      data: { materialCost: "1" },
    }),
  );
  await decideEstimate(owner, id, false, "Tax configuration missing");
  e = await readEstimate(owner, id);
  draft = toDraft(e);
  draft.taxTreatment = "TAXABLE";
  draft.taxRate = "0.07";
  draft.sections[0].lines[0].overrideUnitPrice = "90";
  draft.sections[0].lines[0].overrideReason =
    "Owner-reviewed development exception";
  draft.discountRate = "0.10";
  await saveDraft(owner, draft);
  e = await readEstimate(owner, id);
  assert.ok((e.approvalReasons as string[]).includes("BELOW_MINIMUM_MARGIN"));
  assert.ok((e.approvalReasons as string[]).includes("MANUAL_PRICE_OVERRIDE"));
  await assert.rejects(
    transitionEstimate(owner, id, "release", ""),
    /approval/,
  );
  await submitEstimate(sales, id, e.contentVersion);
  await decideEstimate(
    owner,
    id,
    true,
    "Approve test exceptions and final release",
  );
  await transitionEstimate(owner, id, "release", "");
  e = await readEstimate(owner, id);
  await assert.rejects(saveDraft(owner, toDraft(e)), /immutable|draft/i);
  await assert.rejects(db.estimate.delete({ where: { id } }));
  await assert.rejects(
    db.estimateSection.delete({ where: { id: e.sections[0].id } }),
  );
  const revision = await copyEstimate(owner, id, true);
  const rev = await readEstimate(owner, revision);
  assert.equal(rev.revision, 2);
  assert.equal(rev.status, "DRAFT");
  assert.equal(rev.sections[0].lines[0].materialCost.toString(), "100");
  assert.equal(rev.approvals.length, 0);
  await assert.rejects(copyEstimate(owner, id, true), /already exists/);
  const duplicate = await copyEstimate(owner, id, false);
  assert.notEqual((await readEstimate(owner, duplicate)).seriesId, e.seriesId);
  await transitionEstimate(
    owner,
    id,
    "accept",
    "Test signed document reference",
  );
  await assert.rejects(handoffProject(owner, id), /WON/);
  await db.opportunity.update({
    where: { id: opportunity.id },
    data: { stage: "WON" },
  });
  const projectId = await handoffProject(owner, id);
  assert.equal(await handoffProject(owner, id), projectId);
  await assert.rejects(handoffProject(sales, id), /Owner/);
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
  });
  assert.equal(project.contractValue.toString(), "162");
  assert.equal(project.estimatedCost.toString(), "200");
  assert.equal(project.estimateId, id);
  assert.equal(
    await db.project.count({ where: { opportunityId: opportunity.id } }),
    1,
  );
  const context = await estimatorAnalysisContext(owner, id);
  assert.equal(context.historicalJobs.length, 1);
  assert.ok(context.authority.startsWith("READ_ONLY"));
  assert.ok(
    (await db.activity.count({ where: { opportunityId: opportunity.id } })) > 8,
  );
  assert.equal(
    await db.catalogPriceHistory.count({
      where: { serviceItemId: catalog.id },
    }),
    2,
  );
});
