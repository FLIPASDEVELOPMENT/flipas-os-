import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db } from "../src/server/db";
import {
  mutate,
  initializeTemplates,
  saveTemplate,
} from "../src/project-operations/server/service";
import { workspace, projectList } from "../src/project-operations/server/view";
import {
  uploadEvidence,
  readEvidence,
} from "../src/project-operations/server/evidence";
import type { Role } from "../src/generated/prisma/client";
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error("Disposable *_test database required");
after(() => db.$disconnect());
const key = () => randomUUID();
async function fixture() {
  const make = (role: Role) =>
    db.user.create({
      data: {
        role,
        name: role,
        email: key() + "@example.invalid",
        passwordHash: "test-not-login",
      },
    });
  const owner = await make("OWNER"),
    pm = await make("PROJECT_MANAGER"),
    crew = await make("CREW"),
    stranger = await make("CREW"),
    sales = await make("SALES");
  const customer = await db.customer.create({
      data: { firstName: "Operations", lastName: "Test" },
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
        ownerId: sales.id,
        stage: "WON",
      },
    }),
    estimate = await db.estimate.create({
      data: {
        customerId: customer.id,
        opportunityId: opportunity.id,
        directCost: "6500",
        sellingPrice: "10000",
        grossProfit: "3500",
        grossMargin: "0.35",
        scope: "Original kitchen scope",
      },
    }),
    project = await db.project.create({
      data: {
        customerId: customer.id,
        opportunityId: opportunity.id,
        estimateId: estimate.id,
        contractValue: "10000",
        estimatedCost: "6500",
        actualCost: "0",
        estimatedGrossProfit: "3500",
        actualGrossProfit: "0",
        projectManagerId: pm.id,
      },
    });
  await mutate(owner, project.id, "member", {
    userId: crew.id,
    kind: "EMPLOYEE",
    active: true,
  });
  return { owner, pm, crew, stranger, sales, project };
}
test("project permissions, financial redaction, revoked access and append-only audit", async () => {
  const x = await fixture();
  assert.equal((await workspace(x.crew, x.project.id)).financial, null);
  assert.equal((await workspace(x.pm, x.project.id)).financial, null);
  assert.equal((await projectList(x.stranger)).length, 0);
  await assert.rejects(workspace(x.stranger, x.project.id), /ACCESS_DENIED/);
  await assert.rejects(
    mutate(x.crew, x.project.id, "cost", { amount: "1" }),
    /ACCESS_DENIED/,
  );
  await assert.rejects(
    mutate(x.pm, x.project.id, "cost", { amount: "1" }),
    /ACCESS_DENIED/,
  );
  await assert.rejects(
    db.project.update({
      where: { id: x.project.id },
      data: { contractValue: "1" },
    }),
  );
  const e = await db.projectEvent.findFirstOrThrow({
    where: { projectId: x.project.id },
  });
  await assert.rejects(
    db.projectEvent.update({ where: { id: e.id }, data: { type: "changed" } }),
  );
  await mutate(x.owner, x.project.id, "member", {
    userId: x.crew.id,
    kind: "EMPLOYEE",
    active: false,
  });
  await assert.rejects(workspace(x.crew, x.project.id), /ACCESS_DENIED/);
});
test("tasks, evidence, dependencies, version checks and own crew hours", async () => {
  const x = await fixture();
  await mutate(x.pm, x.project.id, "task", {
    title: "Install cabinets",
    assigneeId: x.crew.id,
    dueAt: "2026-10-15",
    priority: "HIGH",
  });
  const t = await db.projectTask.findFirstOrThrow({
    where: { projectId: x.project.id },
  });
  await assert.rejects(
    mutate(x.crew, x.project.id, "task-progress", {
      taskId: t.id,
      version: 0,
      progress: 100,
      note: "Finished work",
    }),
    /COMPLETION_EVIDENCE/,
  );
  const bytes = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const evidence = await uploadEvidence(
    x.crew,
    x.project.id,
    { bytes, name: "test.png" },
    { taskId: t.id },
  );
  assert.equal(
    evidence,
    await uploadEvidence(
      x.crew,
      x.project.id,
      { bytes, name: "test.png" },
      { taskId: t.id },
    ),
  );
  assert.ok((await readEvidence(x.crew, evidence)).data.length);
  await assert.rejects(readEvidence(x.stranger, evidence));
  await assert.rejects(
    uploadEvidence(
      x.crew,
      x.project.id,
      { bytes: Buffer.from([255, 216, 255, 0, 255, 217]), name: "fake.jpg" },
      { taskId: t.id },
    ),
    /INVALID_IMAGE/,
  );
  await mutate(x.crew, x.project.id, "task-progress", {
    taskId: t.id,
    version: 0,
    progress: 100,
    note: "Finished work",
  });
  await assert.rejects(
    mutate(x.crew, x.project.id, "task-progress", {
      taskId: t.id,
      version: 0,
      progress: 50,
      note: "stale",
    }),
    /STALE_VERSION/,
  );
  const input = {
    workerId: x.crew.id,
    workDate: "2026-10-09",
    minutes: 480,
    description: "Installation",
    requestKey: key(),
  };
  await mutate(x.crew, x.project.id, "time", input);
  await mutate(x.crew, x.project.id, "time", input);
  assert.equal(
    await db.projectTimeEntry.count({ where: { projectId: x.project.id } }),
    1,
  );
  await assert.rejects(
    mutate(x.crew, x.project.id, "time", {
      ...input,
      workerId: x.pm.id,
      requestKey: key(),
    }),
    /ACCESS_DENIED/,
  );
  await assert.rejects(
    mutate(x.crew, x.project.id, "time", {
      ...input,
      minutes: 481,
      requestKey: key(),
    }),
    /DAILY_HOURS_LIMIT/,
  );
  const log = {
    workDate: "2026-10-09",
    summary: "Installed cabinets",
    incidents: "",
    workers: [x.crew.id],
    requestKey: key(),
  };
  await mutate(x.crew, x.project.id, "daily-log", log);
  const old = await db.projectDailyLog.findFirstOrThrow({
    where: { projectId: x.project.id },
  });
  await mutate(x.crew, x.project.id, "daily-log", {
    ...log,
    summary: "Corrected record",
    replacesId: old.id,
    requestKey: key(),
  });
  await assert.rejects(
    db.projectDailyLog.update({
      where: { id: old.id },
      data: { summary: "overwrite" },
    }),
  );
});
test("versioned templates preserve snapshots and allow project customization", async () => {
  const x = await fixture();
  await initializeTemplates(x.owner);
  const template = await db.operationsTemplate.findFirstOrThrow({
    where: { name: "Kitchen Remodeling", active: true },
  });
  await mutate(x.pm, x.project.id, "template", { templateId: template.id });
  await saveTemplate(x.owner, template.name, {
    stages: [{ title: "Custom stage", tasks: ["Custom task"] }],
  });
  assert.equal(
    (await db.project.findUniqueOrThrow({ where: { id: x.project.id } }))
      .templateVersionSnapshot instanceof Object,
    true,
  );
  await assert.rejects(
    mutate(x.pm, x.project.id, "template", { templateId: template.id }),
    /TEMPLATE_ALREADY/,
  );
  const t = await db.projectTask.findFirstOrThrow({
    where: { projectId: x.project.id },
  });
  await mutate(x.pm, x.project.id, "task-edit", {
    taskId: t.id,
    version: t.version,
    title: "Customized cabinet work",
    assigneeId: x.crew.id,
    dueAt: "2026-10-20",
  });
  assert.equal(
    (await db.projectTask.findUniqueOrThrow({ where: { id: t.id } })).title,
    "Customized cabinet work",
  );
});
test("cost ledger, change order exact approval, revision, idempotent application and quality closure", async () => {
  const x = await fixture();
  const input = {
    title: "Additional backsplash",
    reason: "Owner requested scope",
    scope: "Additional backsplash",
    priceDelta: "500",
    costDelta: "200",
    scheduleDays: 2,
    requestKey: key(),
  };
  await mutate(x.owner, x.project.id, "change-create", input);
  let c = await db.projectChangeOrder.findFirstOrThrow({
    where: { projectId: x.project.id },
  });
  await assert.rejects(
    mutate(x.owner, x.project.id, "change-apply", {
      changeId: c.id,
      version: 1,
      reason: "Apply",
    }),
    /APPROVAL_REQUIRED/,
  );
  await mutate(x.owner, x.project.id, "change-revise", {
    ...input,
    changeId: c.id,
    priceDelta: "600",
    requestKey: key(),
  });
  c = await db.projectChangeOrder.findFirstOrThrow({
    where: { projectId: x.project.id, status: "DRAFT" },
  });
  assert.equal(c.version, 2);
  await assert.rejects(
    mutate(x.owner, x.project.id, "change-approve", {
      changeId: c.id,
      version: 1,
      reason: "Approval",
    }),
    /STALE_VERSION/,
  );
  await mutate(x.owner, x.project.id, "change-approve", {
    changeId: c.id,
    version: 2,
    reason: "Confirmed scope and price",
  });
  await mutate(x.owner, x.project.id, "change-apply", {
    changeId: c.id,
    version: 2,
    reason: "Apply approved scope",
  });
  await mutate(x.owner, x.project.id, "change-apply", {
    changeId: c.id,
    version: 2,
    reason: "Retry",
  });
  assert.equal(
    (await workspace(x.owner, x.project.id)).financial?.approvedRevenue,
    "600.00",
  );
  const cost = {
    category: "LABOR",
    kind: "ACTUAL",
    amount: "1000",
    description: "Labor invoice",
    sourceReference: "invoice-1",
    requestKey: key(),
  };
  await mutate(x.owner, x.project.id, "cost", cost);
  await mutate(x.owner, x.project.id, "cost", cost);
  assert.equal(
    (await workspace(x.owner, x.project.id)).financial?.actual,
    "1000.00",
  );
  assert.equal(
    (await workspace(x.owner, x.project.id)).financial?.profit,
    null,
  );
  await assert.rejects(
    mutate(x.owner, x.project.id, "cost", { ...cost, requestKey: key() }),
    /DUPLICATE_COST/,
  );
  for (const state of ["SCHEDULED", "IN_PROGRESS", "QUALITY_REVIEW"])
    await mutate(x.pm, x.project.id, "state", {
      state,
      reason: "Verified transition",
    });
  await assert.rejects(
    mutate(x.pm, x.project.id, "state", {
      state: "COMPLETED",
      reason: "Close",
    }),
    /QUALITY_GATE/,
  );
  await mutate(x.owner, x.project.id, "state", {
    state: "COMPLETED",
    reason: "Test close",
    exception:
      "Owner authorizes a documented exceptional closure for this fixture",
  });
  await mutate(x.owner, x.project.id, "cost-review", { confirmation: true });
  assert.equal(
    (await workspace(x.owner, x.project.id)).financial?.profit,
    "9600.00",
  );
  assert.equal(
    (
      await db.project.findUniqueOrThrow({ where: { id: x.project.id } })
    ).contractValue.toFixed(2),
    "10000.00",
  );
  assert.equal(
    await db.projectEvent.count({
      where: { projectId: x.project.id, type: "PROJECT_CLOSURE_EXCEPTION" },
    }),
    1,
  );
});
test("mandatory inspection, blocking defects and evidence gate normal closure", async () => {
  const x = await fixture();
  await mutate(x.pm, x.project.id, "inspection", {
    title: "Final mandatory inspection",
    required: true,
  });
  const i = await db.projectInspection.findFirstOrThrow({
    where: { projectId: x.project.id },
  });
  await assert.rejects(
    mutate(x.pm, x.project.id, "inspection-review", {
      inspectionId: i.id,
      status: "APPROVED",
      notes: "Passed",
    }),
    /COMPLETION_EVIDENCE/,
  );
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await uploadEvidence(
    x.pm,
    x.project.id,
    { bytes, name: "inspection.png" },
    { inspectionId: i.id },
  );
  await mutate(x.pm, x.project.id, "inspection-review", {
    inspectionId: i.id,
    status: "APPROVED",
    notes: "Handover inspection passed",
  });
  await mutate(x.pm, x.project.id, "defect", {
    title: "Loose trim",
    blocking: true,
  });
  const d = await db.projectDefect.findFirstOrThrow({
    where: { projectId: x.project.id },
  });
  for (const state of ["SCHEDULED", "IN_PROGRESS", "QUALITY_REVIEW"])
    await mutate(x.pm, x.project.id, "state", { state, reason: "Real event" });
  await assert.rejects(
    mutate(x.pm, x.project.id, "state", {
      state: "COMPLETED",
      reason: "Close",
      exception: "PM cannot grant exceptions even with a detailed reason",
    }),
    /QUALITY_GATE/,
  );
  await mutate(x.pm, x.project.id, "defect-resolve", {
    defectId: d.id,
    resolution: "Trim repaired and re-inspected",
  });
  await mutate(x.pm, x.project.id, "state", {
    state: "COMPLETED",
    reason: "Inspected and handed over",
  });
  assert.equal(
    (await db.project.findUniqueOrThrow({ where: { id: x.project.id } }))
      .status,
    "COMPLETED",
  );
});
test("purchase approvals, partial deliveries and commitment totals", async () => {
  const x = await fixture();
  await mutate(x.pm, x.project.id, "material", {
    name: "Cabinets",
    quantity: "10",
    unit: "EACH",
    supplier: "Test supplier",
  });
  const material = await db.projectMaterial.findFirstOrThrow({
    where: { projectId: x.project.id },
  });
  await assert.rejects(
    mutate(x.pm, x.project.id, "purchase", {
      materialId: material.id,
      quantity: "4",
      unitCost: "100",
      requestKey: key(),
    }),
    /ACCESS_DENIED/,
  );
  await mutate(x.owner, x.project.id, "purchase", {
    materialId: material.id,
    quantity: "4",
    unitCost: "100",
    requestKey: key(),
  });
  const p = await db.projectPurchase.findFirstOrThrow({
    where: { projectId: x.project.id },
  });
  await assert.rejects(
    mutate(x.owner, x.project.id, "purchase-state", {
      purchaseId: p.id,
      status: "DELIVERED",
    }),
    /INVALID_TRANSITION/,
  );
  for (const status of ["APPROVED", "ORDERED", "DELIVERED"])
    await mutate(x.owner, x.project.id, "purchase-state", {
      purchaseId: p.id,
      status,
    });
  assert.equal(
    (await db.projectMaterial.findUniqueOrThrow({ where: { id: material.id } }))
      .status,
    "PARTIAL",
  );
  assert.equal(
    (await workspace(x.owner, x.project.id)).financial?.committed,
    "400.00",
  );
  await assert.rejects(
    mutate(x.owner, x.project.id, "cost", {
      category: "MATERIAL",
      kind: "COMMITTED",
      amount: "400",
      description: "Duplicate PO",
      sourceReference: p.id,
      requestKey: key(),
    }),
    /ALREADY_TRACKED/,
  );
  await assert.rejects(
    mutate(x.owner, x.project.id, "purchase-state", {
      purchaseId: p.id,
      status: "DELIVERED",
    }),
    /INVALID_TRANSITION/,
  );
});
test("dependencies reject cycles and enforce completion before starting dependent tasks", async () => {
  const x = await fixture();
  for (const title of ["Prepare site", "Install floor"])
    await mutate(x.pm, x.project.id, "task", {
      title,
      assigneeId: x.crew.id,
      dueAt: "2026-10-20",
      priority: "NORMAL",
    });
  const tasks = await db.projectTask.findMany({
      where: { projectId: x.project.id },
      orderBy: { createdAt: "asc" },
    }),
    a = tasks[0],
    b = tasks[1];
  await mutate(x.pm, x.project.id, "dependency", {
    taskId: b.id,
    prerequisiteId: a.id,
  });
  await assert.rejects(
    mutate(x.pm, x.project.id, "dependency", {
      taskId: a.id,
      prerequisiteId: b.id,
    }),
    /DEPENDENCY_CYCLE/,
  );
  await assert.rejects(
    mutate(x.crew, x.project.id, "task-progress", {
      taskId: b.id,
      version: 0,
      progress: 10,
      note: "Starting",
    }),
    /DEPENDENCY_PENDING/,
  );
  await mutate(x.pm, x.project.id, "checklist-create", {
    taskId: a.id,
    title: "Inspect preparation",
    required: true,
  });
  const c = await db.projectChecklist.findFirstOrThrow({
    where: { projectId: x.project.id, taskId: a.id },
  });
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await uploadEvidence(
    x.crew,
    x.project.id,
    { bytes, name: "task.png" },
    { taskId: a.id },
  );
  await assert.rejects(
    mutate(x.crew, x.project.id, "task-progress", {
      taskId: a.id,
      version: 0,
      progress: 100,
      note: "Prepared site",
    }),
    /COMPLETION_EVIDENCE/,
  );
  await mutate(x.crew, x.project.id, "checklist", {
    checklistId: c.id,
    completed: true,
  });
  await mutate(x.crew, x.project.id, "task-progress", {
    taskId: a.id,
    version: 0,
    progress: 100,
    note: "Prepared site",
  });
  await mutate(x.crew, x.project.id, "task-progress", {
    taskId: b.id,
    version: 0,
    progress: 10,
    note: "Starting after preparation",
  });
});
test("concurrent duplicate cost requests record at most one entry", async () => {
  const x = await fixture(),
    input = {
      category: "OTHER",
      kind: "ACTUAL",
      amount: "50",
      description: "Same invoice",
      sourceReference: "concurrent-invoice",
      requestKey: key(),
    };
  const results = await Promise.allSettled([
    mutate(x.owner, x.project.id, "cost", input),
    mutate(x.owner, x.project.id, "cost", input),
  ]);
  assert.ok(results.some((x) => x.status === "fulfilled"));
  assert.equal(
    await db.projectCostEntry.count({ where: { projectId: x.project.id } }),
    1,
  );
});
test("PM scope requests cannot bypass financial review or OWNER approval", async () => {
  const x = await fixture();
  await mutate(x.pm, x.project.id, "change-request", {
    title: "Additional lighting",
    reason: "Site discovery",
    scope: "Add two fixtures",
    scheduleDays: 1,
    requestKey: key(),
  });
  const c = await db.projectChangeOrder.findFirstOrThrow({
    where: { projectId: x.project.id },
  });
  assert.equal(c.financialReviewed, false);
  assert.equal((await workspace(x.pm, x.project.id)).financial, null);
  assert.equal(
    (await workspace(x.pm, x.project.id)).requestedChanges[0].title,
    "Additional lighting",
  );
  await assert.rejects(
    mutate(x.owner, x.project.id, "change-approve", {
      changeId: c.id,
      version: 1,
      reason: "Approve",
    }),
    /FINANCIAL_REVIEW/,
  );
  await mutate(x.owner, x.project.id, "change-revise", {
    changeId: c.id,
    title: c.title,
    reason: "Pricing reviewed",
    scope: c.scope,
    priceDelta: "150",
    costDelta: "50",
    scheduleDays: 1,
    requestKey: key(),
  });
  const revised = await db.projectChangeOrder.findFirstOrThrow({
    where: { projectId: x.project.id, status: "DRAFT" },
  });
  assert.equal(revised.financialReviewed, true);
  await mutate(x.owner, x.project.id, "change-approve", {
    changeId: revised.id,
    version: 2,
    reason: "Exact scope and financial version approved",
  });
});

test("shared CRM activity never contains restricted cost payloads", async () => {
  const x = await fixture();
  await mutate(x.owner, x.project.id, "cost", {
    category: "OTHER",
    kind: "ACTUAL",
    amount: "123.45",
    description: "Private invoice",
    sourceReference: "private-source",
    requestKey: key(),
  });
  const entry = await db.activity.findFirstOrThrow({
    where: { type: "PROJECT_COST", opportunityId: x.project.opportunityId },
  });
  assert.deepEqual(entry.metadata, { projectId: x.project.id });
  const event = await db.projectEvent.findFirstOrThrow({
    where: { projectId: x.project.id, type: "PROJECT_COST" },
  });
  assert.ok(JSON.stringify(event.metadata).includes("123.45"));
});
