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
  stageImport,
  importPreview,
  confirmImport,
} from "../src/purchases/service";
import { readFileSync } from "node:fs";
import { sample } from "./purchases.fixture";
import { mutate } from "../src/project-operations/server/service";
import { workspace } from "../src/project-operations/server/view";
import type { Role } from "../src/generated/prisma/client";
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error("Disposable *_test database required");
after(() => db.$disconnect());
test("Pro Xtra preview, explicit import, blocked returns, permissions and idempotent costs", async () => {
  const { owner, project } = await fixture();
  const csv = readFileSync(
    new URL(
      "../docs/examples/home-depot-pro-xtra-synthetic.csv",
      import.meta.url,
    ),
  );
  const id = await stageImport(owner, "native.csv", csv);
  assert.equal(
    await db.importedPurchase.count({ where: { documentId: id } }),
    0,
  );
  const preview = await importPreview(owner, id);
  assert.equal(preview.validRows, 3);
  assert.equal(preview.pendingRows, 2);
  await assert.rejects(confirmImport(owner, id, false));
  for (const role of [
    "ADMIN",
    "SALES",
    "PROJECT_MANAGER",
    "CREW",
    "CUSTOMER",
  ] as const) {
    const user = await make(role);
    await assert.rejects(stageImport(user, "native.csv", csv), /ACCESS_DENIED/);
    await assert.rejects(importPreview(user, id), /ACCESS_DENIED/);
    await assert.rejects(confirmImport(user, id, true), /ACCESS_DENIED/);
  }
  const confirmed = await confirmImport(owner, id, true);
  assert.equal(confirmed.imported, 5);
  assert.equal((await confirmImport(owner, id, true)).imported, 0);
  const rows = await db.importedPurchase.findMany({
    where: { documentId: id },
  });
  for (const p of rows.filter((p) => p.status === "NEEDS_REVIEW")) {
    await assert.rejects(
      reviewPurchase(owner, p.id, 0, [], "Cannot bypass return guard"),
      /UNSUPPORTED_MOVEMENT/,
    );
    await assert.rejects(
      approvePurchase(owner, p.id, 1, true),
      /UNSUPPORTED_MOVEMENT/,
    );
    assert.equal(
      await db.purchasePosting.count({ where: { purchaseId: p.id } }),
      0,
    );
  }
  const purchase = rows.find((p) => p.status === "IMPORTED")!;
  const original =
    purchase.original as unknown as import("../src/purchases/validation").PurchaseData;
  await reviewPurchase(
    owner,
    purchase.id,
    0,
    [
      {
        lineId: "summary",
        amount: original.header.transaction_total,
        category: "Tile",
        costType: "MATERIAL",
        projectId: project.id,
      },
    ],
    "Verified synthetic receipt and transaction date",
  );
  await Promise.all([
    approvePurchase(owner, purchase.id, 1, true),
    approvePurchase(owner, purchase.id, 1, true),
  ]);
  assert.equal(
    await db.purchasePosting.count({ where: { purchaseId: purchase.id } }),
    1,
  );
  assert.equal(
    await db.projectCostEntry.count({
      where: { projectId: project.id, kind: "ACTUAL" },
    }),
    1,
  );
  assert.equal((await importPreview(owner, id)).matches.length, 5);
});
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

// Phase 5B: all API calls are mocked; fixtures live exclusively in a disposable database.
import {
  suggestPurchase,
  suggestBatch,
  editProjectIdentity,
  projectIdentityData,
  suggestionHistory,
  rejectSuggestion,
  abandonSuggestion,
} from "../src/purchases/classification-service";
import {
  rulesSuggestion,
  type Candidate,
} from "../src/purchases/classification";
import type { PurchaseData } from "../src/purchases/validation";
async function aiSettings(provider = "MOCK") {
  await db.salesAISettings.upsert({
    where: { id: "company" },
    create: { id: "company", processingEnabled: true, aiProvider: provider },
    update: {
      processingEnabled: true,
      aiPaused: false,
      aiProvider: provider,
      monthlyBudget: 10,
    },
  });
}
test("permanent codes on old/new projects, immutable aliases, OWNER corrections and exact review approval", async () => {
  const { owner, project, line } = await fixture();
  const code = await db.projectIdentity.findUniqueOrThrow({
    where: { projectId: project.id },
  });
  assert.match(code.code, /^F\d{3,}$/);
  await assert.rejects(
    db.projectIdentity.update({
      where: { projectId: project.id },
      data: { code: "F999999" },
    }),
    /Permanent project code/,
  );
  await assert.rejects(
    db.projectIdentity.delete({ where: { projectId: project.id } }),
    /Permanent project code/,
  );
  await editProjectIdentity(
    owner,
    project.id,
    "Angela Kitchen Remodel",
    "Historical Pro Desk label",
    "Owner confirms historical identity",
  );
  const aliases = (await projectIdentityData(owner)).find(
    (p) => p.projectId === project.id,
  )!.aliases;
  assert.ok(aliases.some((a) => a.alias === code.name));
  assert.ok(aliases.some((a) => a.alias === "Historical Pro Desk label"));
  await aiSettings();
  const p = await imported(owner, {
    job_name: code.code + " Angela",
    description: "Backsplash tile",
  });
  const key = randomUUID(),
    job = await suggestPurchase(owner, p.id, 0, key);
  assert.equal(job.state, "GENERATED");
  assert.equal(
    (job.result as unknown as ReturnType<typeof rulesSuggestion>).lines[0]
      .projectId,
    project.id,
  );
  assert.equal((await suggestPurchase(owner, p.id, 0, key)).id, job.id);
  assert.equal(
    await db.projectCostEntry.count({ where: { projectId: project.id } }),
    0,
  );
  await reviewPurchase(
    owner,
    p.id,
    0,
    [
      {
        lineId: "1",
        amount: "40.80",
        category: "Tile",
        costType: "MATERIAL",
        projectId: project.id,
        estimateLineId: line.id,
      },
    ],
    "OWNER corrected classification from receipt evidence",
    job.id,
  );
  await assert.rejects(
    reviewPurchase(
      owner,
      p.id,
      1,
      [],
      "Old suggestion cannot replace new review",
      job.id,
    ),
    /STALE_VERSION/,
  );
  await assert.rejects(approvePurchase(owner, p.id, 1, false));
  await Promise.all([
    approvePurchase(owner, p.id, 1, true),
    approvePurchase(owner, p.id, 1, true),
  ]);
  assert.equal(
    await db.projectCostEntry.count({ where: { projectId: project.id } }),
    1,
  );
  const history = await suggestionHistory(owner, p.id);
  assert.equal(history[0].reviews[0].version, 1);
  await assert.rejects(
    db.purchaseSuggestion.update({
      where: { id: job.id },
      data: { model: "replace" },
    }),
    /Immutable suggestion/,
  );
  assert.equal(
    (await db.salesAISettings.findUniqueOrThrow({ where: { id: "company" } }))
      .outboundPaused,
    true,
  );
  const next = await fixture();
  const nextCode = await db.projectIdentity.findUniqueOrThrow({
    where: { projectId: next.project.id },
  });
  assert.ok(nextCode.number > code.number);
});
test("native summary uses no network; rejected suggestion preserves pending costs and batch is bounded", async () => {
  const { owner } = await fixture();
  await aiSettings("OPENAI");
  const doc = await importCSV(
    owner,
    "native.csv",
    readFileSync(
      new URL(
        "../docs/examples/home-depot-pro-xtra-synthetic.csv",
        import.meta.url,
      ),
    ),
  );
  const p = await db.importedPurchase.findFirstOrThrow({
    where: { documentId: doc.documentId, status: "IMPORTED" },
  });
  let calls = 0;
  const job = await suggestPurchase(owner, p.id, 0, randomUUID(), async () => {
    calls++;
    throw new Error("Network forbidden");
  });
  assert.equal(calls, 0);
  assert.equal(job.provider, "RULES");
  assert.equal(job.state, "GENERATED");
  const result = job.result as unknown as ReturnType<typeof rulesSuggestion>;
  assert.equal(result.lines[0].estimateLineId, null);
  assert.equal(result.lines[0].category, null);
  await rejectSuggestion(
    owner,
    p.id,
    0,
    job.id,
    "Not enough item evidence; review manually",
  );
  await assert.rejects(
    reviewPurchase(owner, p.id, 0, [], "Cannot use rejected proposal", job.id),
    /STALE_VERSION/,
  );
  assert.equal(
    (await db.importedPurchase.findUniqueOrThrow({ where: { id: p.id } }))
      .status,
    "IMPORTED",
  );
  assert.equal(
    await db.purchasePosting.count({ where: { purchaseId: p.id } }),
    0,
  );
  await assert.rejects(
    suggestBatch(
      owner,
      Array.from({ length: 6 }, () => ({
        id: p.id,
        version: 0,
        requestKey: randomUUID(),
      })),
    ),
  );
});
test("roles, deactivation, AI pause and request limits are effective in services", async () => {
  const { owner } = await fixture();
  await aiSettings();
  const p = await imported(owner);
  for (const role of [
    "ADMIN",
    "SALES",
    "PROJECT_MANAGER",
    "CREW",
    "CUSTOMER",
  ] as const) {
    const user = await make(role);
    await assert.rejects(
      suggestPurchase(user, p.id, 0, randomUUID()),
      /ACCESS_DENIED/,
    );
    await assert.rejects(suggestionHistory(user, p.id), /ACCESS_DENIED/);
    await assert.rejects(projectIdentityData(user), /ACCESS_DENIED/);
    await assert.rejects(
      suggestBatch(user, [{ id: p.id, version: 0, requestKey: randomUUID() }]),
      /ACCESS_DENIED/,
    );
  }
  await db.salesAISettings.update({
    where: { id: "company" },
    data: { aiPaused: true },
  });
  await assert.rejects(
    suggestPurchase(owner, p.id, 0, randomUUID()),
    /AI_PAUSED/,
  );
  assert.equal(
    await db.purchaseSuggestion.count({ where: { purchaseId: p.id } }),
    0,
  );
  await aiSettings();
  for (let i = 0; i < 4; i++)
    await suggestPurchase(owner, p.id, 0, randomUUID());
  await assert.rejects(
    suggestPurchase(owner, p.id, 0, randomUUID()),
    /AI_EMAIL_LIMIT/,
  );
  await db.user.update({ where: { id: owner.id }, data: { active: false } });
  await assert.rejects(suggestionHistory(owner, p.id), /ACCESS_DENIED/);
});
test("OpenAI mock concurrency, idempotency, shared budget, failures and concurrent review preserve immutable suggestion", async () => {
  const { owner, project, line } = await fixture();
  await aiSettings("OPENAI");
  process.env.OPENAI_API_KEY = "simulated-not-real";
  process.env.OPENAI_MODEL = "simulation-only";
  process.env.OPENAI_INPUT_USD_PER_MILLION = "0.4";
  process.env.OPENAI_OUTPUT_USD_PER_MILLION = "1.6";
  process.env.OPENAI_PRICING_VERIFIED_AT = "2026-10-11";
  const code = await db.projectIdentity.findUniqueOrThrow({
      where: { projectId: project.id },
    }),
    p = await imported(owner, {
      job_name: code.code,
      description: "Backsplash tile",
    });
  const d = p.original as unknown as PurchaseData,
    candidates: Candidate[] = [
      {
        projectId: project.id,
        code: code.code,
        name: code.name,
        aliases: [],
        lines: [{ id: line.id, name: line.name }],
      },
    ];
  const result = rulesSuggestion(d, candidates);
  result.lines[0].category = "Tile";
  result.lines[0].costType = "MATERIAL";
  result.lines[0].evidence.push({
    field: "description",
    quote: "Backsplash tile",
  });
  let calls = 0,
    release!: () => void,
    started!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    ready = new Promise<void>((r) => (started = r));
  const transport = async () => {
    calls++;
    started();
    await gate;
    return Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(result) }],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 40 },
    });
  };
  const key = randomUUID();
  const pending = suggestPurchase(owner, p.id, 0, key, transport);
  await ready;
  assert.equal(
    (await suggestPurchase(owner, p.id, 0, key, transport)).state,
    "RUNNING",
  );
  await assert.rejects(
    suggestPurchase(owner, p.id, 0, randomUUID(), transport),
    /CLASSIFICATION_RUNNING/,
  );
  release();
  const job = await pending;
  assert.equal(job.state, "GENERATED");
  assert.equal(calls, 1);
  assert.equal(
    await db.salesAIUsage.count({
      where: {
        conversationId: "purchase:" + p.id,
        operation: "PURCHASE_CLASSIFY",
        success: true,
      },
    }),
    1,
  );
  const failed = await suggestPurchase(owner, p.id, 0, randomUUID(), async () =>
    Response.json({
      status: "incomplete",
      output: [],
      usage: { input_tokens: 50, output_tokens: 10 },
    }),
  );
  assert.equal(failed.state, "FAILED");
  assert.equal(failed.errorCode, "AI_OUTPUT_INCOMPLETE");
  const usage = await db.salesAIUsage.findFirstOrThrow({
    where: {
      conversationId: "purchase:" + p.id,
      errorCode: "AI_OUTPUT_INCOMPLETE",
    },
  });
  assert.equal(usage.inputTokens, 50);
  assert.equal(usage.status, "REJECTED");
  let release2!: () => void, started2!: () => void;
  const g2 = new Promise<void>((r) => (release2 = r)),
    r2 = new Promise<void>((r) => (started2 = r));
  const inflight = suggestPurchase(owner, p.id, 0, randomUUID(), async () => {
    started2();
    await g2;
    return Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(result) }],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 40 },
    });
  });
  await r2;
  await reviewPurchase(
    owner,
    p.id,
    0,
    [
      {
        lineId: "1",
        amount: "40.80",
        category: "Tile",
        costType: "MATERIAL",
        projectId: project.id,
      },
    ],
    "Concurrent manual OWNER review",
  );
  release2();
  assert.equal((await inflight).state, "STALE");
  assert.equal(
    await db.projectCostEntry.count({ where: { projectId: project.id } }),
    0,
  );
  const limited = await imported(owner);
  await db.salesAISettings.update({
    where: { id: "company" },
    data: { monthlyBudget: "0.000001" },
  });
  const blocked = await suggestPurchase(
    owner,
    limited.id,
    0,
    randomUUID(),
    async () => {
      throw new Error("Budget must block before network");
    },
  );
  assert.equal(blocked.errorCode, "AI_BUDGET_LIMIT");
  await aiSettings();
});
test("duplicate pending identity blocks approval until explicit OWNER rejection", async () => {
  const { owner, project } = await fixture();
  const receipt = randomUUID();
  const p = await imported(owner, { receipt_id: receipt });
  const dup = await imported(owner, { receipt_id: receipt });
  await reviewPurchase(
    owner,
    p.id,
    0,
    [
      {
        lineId: "1",
        amount: "40.80",
        category: "Tile",
        costType: "MATERIAL",
        projectId: project.id,
      },
    ],
    "Verified receipt requires duplicate reconciliation",
  );
  await assert.rejects(
    approvePurchase(owner, p.id, 1, true),
    /DUPLICATE_PENDING/,
  );
  assert.equal(
    await db.projectCostEntry.count({ where: { projectId: project.id } }),
    0,
  );
  await rejectPurchase(
    owner,
    dup.id,
    0,
    "Verified duplicate of first imported receipt",
  );
  await approvePurchase(owner, p.id, 1, true);
  assert.equal(
    await db.projectCostEntry.count({ where: { projectId: project.id } }),
    1,
  );
});
test("additive backfill preserves legacy project IDs and finances, duplicate historical names remain ambiguous", async () => {
  const f = await fixture(),
    migration = readFileSync(
      new URL(
        "../prisma/migrations/202610110002_purchase_classification/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
  const backfill = migration.match(
    /DO \$\$ DECLARE legacy[\s\S]*?END \$\$;/,
  )![0];
  const snapshot = await db.project.findUniqueOrThrow({
    where: { id: f.project.id },
  });
  // Simulate one pre-codebook project only in this disposable test database.
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      'ALTER TABLE "ProjectIdentity" DISABLE TRIGGER project_code_immutable',
    );
    await tx.projectIdentity.delete({ where: { projectId: f.project.id } });
    await tx.$executeRawUnsafe(
      'ALTER TABLE "ProjectIdentity" ENABLE TRIGGER project_code_immutable',
    );
    // Migration normally sees an empty new identity table. Scope simulated legacy backfill to the missing row.
    await tx.$executeRawUnsafe(
      backfill.replace(
        'ORDER BY p."createdAt",p.id',
        'WHERE NOT EXISTS (SELECT 1 FROM "ProjectIdentity" i WHERE i."projectId"=p.id) ORDER BY p."createdAt",p.id',
      ),
    );
  });
  const after = await db.project.findUniqueOrThrow({
    where: { id: f.project.id },
  });
  assert.deepEqual(after, snapshot);
  assert.ok(
    await db.projectIdentity.findUnique({ where: { projectId: f.project.id } }),
  );
  const second = await fixture();
  await editProjectIdentity(
    f.owner,
    f.project.id,
    "Legacy one",
    "",
    "Rename preserves same legacy name as alias",
  );
  await editProjectIdentity(
    f.owner,
    second.project.id,
    "Legacy two",
    "",
    "Rename preserves ambiguous historical name",
  );
  const identities = await projectIdentityData(f.owner),
    a = identities.find((x) => x.projectId === f.project.id)!,
    b = identities.find((x) => x.projectId === second.project.id)!;
  const { matchProject } = await import("../src/purchases/classification");
  assert.equal(
    matchProject(
      [snapshot ? "Purchase Test · General Remodeling" : ""],
      [a, b].map((x) => ({
        projectId: x.projectId,
        code: x.code,
        name: x.name,
        aliases: x.aliases.map((y) => y.alias),
        lines: [],
      })),
    ).projectId,
    null,
  );
  await assert.rejects(
    editProjectIdentity(
      f.owner,
      f.project.id,
      "Legacy one",
      b.code + " hijack",
      "Cannot alias a different project code",
    ),
    /ALIAS_CODE_CONFLICT/,
  );
});
test("supervised examples are approved exact items in the same verified project, never pending or cross-project data", async () => {
  const { owner, project } = await fixture(),
    other = await fixture();
  await aiSettings();
  const code = await db.projectIdentity.findUniqueOrThrow({
      where: { projectId: project.id },
    }),
    otherCode = await db.projectIdentity.findUniqueOrThrow({
      where: { projectId: other.project.id },
    });
  const p = await imported(owner, {
    job_name: code.code,
    sku: "SUPERVISED-SKU",
    description: "Backsplash tile",
  });
  const pending = await imported(owner, {
    job_name: code.code,
    sku: "SUPERVISED-SKU",
    description: "Backsplash tile",
  });
  for (const row of [p, pending])
    await reviewPurchase(
      owner,
      row.id,
      0,
      [
        {
          lineId: "1",
          amount: "40.80",
          category: "Tile",
          costType: "MATERIAL",
          projectId: project.id,
        },
      ],
      "Verified item classification for supervised example",
    );
  await approvePurchase(owner, p.id, 1, true);
  const next = await imported(owner, {
      job_name: code.code,
      sku: "SUPERVISED-SKU",
      description: "Backsplash tile",
    }),
    job = await suggestPurchase(owner, next.id, 0, randomUUID());
  const input = job.input as {
    examples: { projectId: string; reviewId: string }[];
  };
  assert.equal(input.examples.length, 1);
  assert.equal(input.examples[0].projectId, project.id);
  assert.equal(
    input.examples[0].reviewId,
    (await db.purchaseReview.findFirstOrThrow({ where: { purchaseId: p.id } }))
      .id,
  );
  const cross = await imported(owner, {
      job_name: otherCode.code,
      sku: "SUPERVISED-SKU",
      description: "Backsplash tile",
    }),
    different = await suggestPurchase(owner, cross.id, 0, randomUUID());
  assert.equal((different.input as { examples: unknown[] }).examples.length, 0);
});

test("interrupted requests require OWNER justification, never release reservations or retry automatically", async () => {
  const { owner } = await fixture();
  await aiSettings();
  const p = await imported(owner),
    key = randomUUID();
  const job = await db.purchaseSuggestion.create({
    data: {
      purchaseId: p.id,
      requestKey: key,
      baseVersion: 0,
      createdById: owner.id,
      input: {},
      createdAt: new Date(Date.now() - 310000),
    },
  });
  const reserved = await db.salesAIUsage.create({
    data: {
      provider: "OPENAI",
      model: "simulated",
      conversationId: "purchase:" + p.id,
      messageId: "purchase:" + p.id,
      operation: "PURCHASE_CLASSIFY",
      status: "UNCERTAIN",
      reservedCost: "0.05",
      success: false,
    },
  });
  const before = await db.salesAIUsage.findUniqueOrThrow({
    where: { id: reserved.id },
  });
  await abandonSuggestion(
    owner,
    p.id,
    job.id,
    "OWNER verified worker interrupted; manual review instead",
  );
  assert.equal(
    (
      await suggestPurchase(owner, p.id, 0, key, async () => {
        throw new Error("No retry allowed");
      })
    ).state,
    "FAILED",
  );
  assert.deepEqual(
    await db.salesAIUsage.findUniqueOrThrow({ where: { id: reserved.id } }),
    before,
  );
  assert.equal(
    await db.purchaseSuggestion.count({ where: { purchaseId: p.id } }),
    1,
  );
});
test("global sequence grows past F999 without year reset or code reuse", async () => {
  // Disposable DB only; advance, never reset or modify an existing assigned number.
  const current = await db.projectIdentity.aggregate({
    _max: { number: true },
  });
  const next =
    current._max.number && current._max.number > 999n
      ? current._max.number
      : 999n;
  await db.$queryRaw`SELECT setval('project_code_number',${next},true)`;
  const { project } = await fixture(),
    identity = await db.projectIdentity.findUniqueOrThrow({
      where: { projectId: project.id },
    });
  assert.equal(identity.code, "F" + identity.number.toString());
  assert.ok(identity.number >= 1000n);
});
