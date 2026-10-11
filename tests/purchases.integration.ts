import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import {
  importCSV,
  reviewPurchase,
  approvePurchase,
  rejectPurchase,
  purchaseData,
  readDocument,
  approveBatch,
} from "../src/purchases/service";
import { sample } from "./purchases.fixture";
import { mutate } from "../src/project-operations/server/service";
import { workspace } from "../src/project-operations/server/view";
import type { Role } from "../src/generated/prisma/client";
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error("Disposable *_test database required");
after(() => db.$disconnect());
const make = (role: Role) =>
  db.user.create({
    data: {
      role,
      name: role,
      email: randomUUID() + "@example.invalid",
      passwordHash: "test-not-login",
    },
  });
async function fixture() {
  const owner = await make("OWNER"),
    pm = await make("PROJECT_MANAGER"),
    crew = await make("CREW"),
    customer = await db.customer.create({
      data: { firstName: "Purchase", lastName: "Test" },
    }),
    lead = await db.lead.create({
      data: {
        customerId: customer.id,
        source: "WEBSITE",
        serviceType: "Kitchen",
      },
    }),
    opportunity = await db.opportunity.create({
      data: {
        customerId: customer.id,
        leadId: lead.id,
        ownerId: owner.id,
        stage: "WON",
      },
    }),
    estimate = await db.estimate.create({
      data: {
        customerId: customer.id,
        opportunityId: opportunity.id,
        directCost: "100",
        sellingPrice: "200",
        grossProfit: "100",
        grossMargin: "0.5",
      },
    }),
    section = await db.estimateSection.create({
      data: { estimateId: estimate.id, name: "Scope", position: 0 },
    }),
    line = await db.estimateLineItem.create({
      data: {
        sectionId: section.id,
        name: "Backsplash",
        unit: "EACH",
        quantity: "1",
        materialCost: "100",
        laborCost: "0",
        subcontractorCost: "0",
        overheadAllocation: "0",
        markup: "0",
        minimumMargin: "0",
        calculatedPrice: "200",
        sellingPrice: "200",
      },
    }),
    project = await db.project.create({
      data: {
        customerId: customer.id,
        opportunityId: opportunity.id,
        estimateId: estimate.id,
        contractValue: "200",
        estimatedCost: "100",
        estimatedGrossProfit: "100",
        actualCost: "0",
        actualGrossProfit: "0",
        projectManagerId: pm.id,
      },
    });
  await db.projectMember.create({
    data: { projectId: project.id, userId: crew.id },
  });
  return { owner, pm, crew, line, project };
}
async function imported(
  owner: Awaited<ReturnType<typeof make>>,
  overrides: Record<string, string> = {},
) {
  const r = await importCSV(
    owner,
    "fixture.csv",
    sample({
      external_id: randomUUID(),
      receipt_id: randomUUID(),
      ...overrides,
    }),
  );
  return db.importedPurchase.findFirstOrThrow({
    where: { documentId: r.documentId },
  });
}
const allocation = (projectId: string, estimateLineId?: string) => [
  {
    lineId: "1",
    amount: "40.80",
    category: "Tile",
    costType: "MATERIAL",
    projectId,
    estimateLineId,
  },
];
test("pending import, revisions, exact approval, concurrency, immutable evidence and existing finance reports", async () => {
  const x = await fixture(),
    p = await imported(x.owner);
  assert.equal(
    await db.projectCostEntry.count({ where: { projectId: x.project.id } }),
    0,
  );
  const r = await reviewPurchase(
    x.owner,
    p.id,
    0,
    allocation(x.project.id, x.line.id),
    "Verified receipt and project",
  );
  await assert.rejects(approvePurchase(x.owner, p.id, r.version, false));
  const r2 = await reviewPurchase(
    x.owner,
    p.id,
    1,
    allocation(x.project.id, x.line.id),
    "Corrected and rechecked",
  );
  await assert.rejects(
    approvePurchase(x.owner, p.id, 1, true),
    /STALE_VERSION/,
  );
  const results = await Promise.allSettled([
    approvePurchase(x.owner, p.id, r2.version, true),
    approvePurchase(x.owner, p.id, r2.version, true),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
  const costs = await db.projectCostEntry.findMany({
    where: { projectId: x.project.id },
  });
  assert.equal(costs.length, 1);
  assert.equal(costs[0].amount.toFixed(2), "40.80");
  await assert.rejects(
    mutate(x.owner, x.project.id, "cost", {
      category: "MATERIAL",
      kind: "ACTUAL",
      amount: "40.80",
      description: "Repeat raw receipt",
      sourceReference: (p.original as { header: { receipt_id: string } }).header
        .receipt_id,
      requestKey: randomUUID(),
    }),
    /DUPLICATE_COST_REFERENCE/,
  );
  await assert.rejects(
    mutate(x.owner, x.project.id, "cost", {
      category: "MATERIAL",
      kind: "ACTUAL",
      amount: "40.80",
      description: "Duplicate manual cost",
      sourceReference: costs[0].sourceReference,
      requestKey: randomUUID(),
    }),
    /DUPLICATE_COST_REFERENCE/,
  );
  assert.equal(
    await db.purchasePosting.count({ where: { purchaseId: p.id } }),
    1,
  );
  assert.equal((await workspace(x.pm, x.project.id)).financial, null);
  assert.equal(
    JSON.stringify(await workspace(x.crew, x.project.id)).includes(
      "Purchase private financial sentinel",
    ),
    false,
  );
  await assert.rejects(
    reviewPurchase(
      x.owner,
      p.id,
      2,
      allocation(x.project.id),
      "Cannot overwrite approval",
    ),
    /PURCHASE_FINAL/,
  );
  await assert.rejects(
    db.purchaseReview.deleteMany({ where: { purchaseId: p.id } }),
  );
  await assert.rejects(
    db.importedPurchase.update({
      where: { id: p.id },
      data: { original: { tampered: true } },
    }),
  );
  assert.equal(
    (
      await db.estimateLineItem.findUniqueOrThrow({ where: { id: x.line.id } })
    ).materialCost.toFixed(2),
    "100.00",
  );
  assert.equal(
    (await db.importedPurchase.findUniqueOrThrow({ where: { id: p.id } }))
      .approvedById,
    x.owner.id,
  );
});
test("all roles and revoked actors denied, imports idempotent, conflicts roll back, duplicate receipt and cross-project line denied", async () => {
  const x = await fixture();
  const bytes = sample({ external_id: randomUUID(), receipt_id: randomUUID() });
  const first = await importCSV(x.owner, "one.csv", bytes),
    second = await importCSV(x.owner, "again.csv", bytes);
  assert.equal(second.imported, 0);
  assert.equal(first.documentId, second.documentId);
  const normalizedReplay = await importCSV(
    x.owner,
    "CRLF.csv",
    Buffer.from(bytes.toString().replaceAll("\n", "\r\n")),
  );
  assert.equal(normalizedReplay.imported, 0);
  assert.equal(normalizedReplay.repeated, 1);
  const p = await db.importedPurchase.findFirstOrThrow({
    where: { documentId: first.documentId },
  });
  for (const role of [
    "ADMIN",
    "SALES",
    "PROJECT_MANAGER",
    "CREW",
    "CUSTOMER",
  ] as const) {
    const actor = await make(role);
    await assert.rejects(importCSV(actor, "one.csv", bytes), /ACCESS_DENIED/);
    await assert.rejects(
      reviewPurchase(actor, p.id, 0, allocation(x.project.id), "Unauthorized"),
      /ACCESS_DENIED/,
    );
    await assert.rejects(
      approvePurchase(actor, p.id, 1, true),
      /ACCESS_DENIED/,
    );
    await assert.rejects(purchaseData(actor), /ACCESS_DENIED/);
    await assert.rejects(
      readDocument(actor, first.documentId),
      /ACCESS_DENIED/,
    );
  }
  const other = await fixture();
  await assert.rejects(
    reviewPurchase(
      x.owner,
      p.id,
      0,
      allocation(x.project.id, other.line.id),
      "Foreign estimate line",
    ),
    /ESTIMATE_LINK/,
  );
  const original = p.original as {
    header: { external_id: string; receipt_id: string };
  };
  await assert.rejects(
    importCSV(
      x.owner,
      "conflict.csv",
      sample({
        external_id: original.header.external_id,
        receipt_id: original.header.receipt_id,
        unit_price: "21",
        line_total: "42.80",
        transaction_total: "42.80",
      }),
    ),
    /SOURCE_CONFLICT/,
  );
  await reviewPurchase(
    x.owner,
    p.id,
    0,
    allocation(x.project.id),
    "Verified first source",
  );
  await approvePurchase(x.owner, p.id, 1, true);
  const duplicate = await imported(x.owner, {
    source: "HOME_DEPOT_CSV",
    receipt_id: original.header.receipt_id,
  });
  await reviewPurchase(
    x.owner,
    duplicate.id,
    0,
    allocation(x.project.id),
    "Duplicate source review",
  );
  await assert.rejects(
    approvePurchase(x.owner, duplicate.id, 1, true),
    /DUPLICATE_EVIDENCE/,
  );
  await rejectPurchase(
    x.owner,
    duplicate.id,
    1,
    "Already approved from another source",
  );
  const current = await db.user.update({
    where: { id: x.owner.id },
    data: { active: false },
  });
  await assert.rejects(purchaseData(current), /ACCESS_DENIED/);
});
test("company overhead never posts project cost and verified existing cost reconciliation does not double book", async () => {
  const x = await fixture(),
    p = await imported(x.owner);
  await reviewPurchase(
    x.owner,
    p.id,
    0,
    [
      {
        lineId: "1",
        amount: "40.80",
        category: "General Overhead",
        costType: "OTHER",
      },
    ],
    "Confirmed company expense",
  );
  await approvePurchase(x.owner, p.id, 1, true);
  assert.equal(
    await db.projectCostEntry.count({ where: { projectId: x.project.id } }),
    0,
  );
  const next = await imported(x.owner),
    d = next.original as { header: { receipt_id: string } };
  const cost = await db.projectCostEntry.create({
    data: {
      projectId: x.project.id,
      category: "MATERIAL",
      kind: "ACTUAL",
      amount: "40.80",
      description: "Already entered manually",
      sourceReference: d.header.receipt_id,
      requestKey: randomUUID(),
      recordedById: x.owner.id,
    },
  });
  await reviewPurchase(
    x.owner,
    next.id,
    0,
    allocation(x.project.id),
    "Check existing receipt",
  );
  await assert.rejects(
    approvePurchase(x.owner, next.id, 1, true),
    /EXISTING_RECEIPT_COST/,
  );
  await reviewPurchase(
    x.owner,
    next.id,
    1,
    [{ ...allocation(x.project.id)[0], existingLedgerId: cost.id }],
    "Verified same existing ledger cost",
  );
  await approvePurchase(x.owner, next.id, 2, true);
  assert.equal(
    await db.projectCostEntry.count({ where: { projectId: x.project.id } }),
    1,
  );
  assert.equal(
    (
      await db.purchasePosting.findFirstOrThrow({
        where: { purchaseId: next.id },
      })
    ).ledgerId,
    cost.id,
  );
});

test("split purchases and explicit multi-review preserve independent exact approvals", async () => {
  const x = await fixture(),
    other = await fixture(),
    p = await imported(x.owner),
    q = await imported(x.owner);
  const split = [
    { ...allocation(x.project.id, x.line.id)[0], amount: "20.40" },
    { ...allocation(other.project.id, other.line.id)[0], amount: "20.40" },
  ];
  await reviewPurchase(
    x.owner,
    p.id,
    0,
    split,
    "Verified split between projects",
  );
  await reviewPurchase(
    x.owner,
    q.id,
    0,
    allocation(x.project.id),
    "Verified second purchase",
  );
  const results = await approveBatch(x.owner, [
    { id: p.id, version: 1 },
    { id: q.id, version: 99 },
  ]);
  assert.equal(results[0].approved, true);
  assert.equal(results[1].approved, false);
  assert.equal(
    await db.purchasePosting.count({ where: { purchaseId: p.id } }),
    2,
  );
  assert.equal(
    (await db.importedPurchase.findUniqueOrThrow({ where: { id: q.id } }))
      .status,
    "NEEDS_REVIEW",
  );
  await assert.rejects(
    approveBatch(x.crew, [{ id: q.id, version: 1 }]),
    /ACCESS_DENIED/,
  );
  assert.equal(
    (
      await db.projectCostEntry.aggregate({
        where: { projectId: x.project.id },
        _sum: { amount: true },
      })
    )._sum.amount?.toFixed(2),
    "20.40",
  );
});

test("multiple allocations to one project share receipt evidence without duplicate retry", async () => {
  const x = await fixture(),
    p = await imported(x.owner);
  await reviewPurchase(
    x.owner,
    p.id,
    0,
    [
      { ...allocation(x.project.id)[0], amount: "20.40" },
      {
        ...allocation(x.project.id)[0],
        amount: "20.40",
        category: "Electrical",
      },
    ],
    "Verified categories in same project",
  );
  await approvePurchase(x.owner, p.id, 1, true);
  await approvePurchase(x.owner, p.id, 1, true);
  assert.equal(
    await db.projectCostEntry.count({ where: { projectId: x.project.id } }),
    2,
  );
  assert.equal(
    (
      await db.projectCostEntry.aggregate({
        where: { projectId: x.project.id },
        _sum: { amount: true },
      })
    )._sum.amount?.toFixed(2),
    "40.80",
  );
});
