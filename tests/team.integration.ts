import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import { hashPassword, verifyPassword } from "../src/server/password";
import {
  createAccount,
  administerAccount,
  assignProject,
  changeOwnPassword,
} from "../src/team/service";
import { workspace } from "../src/project-operations/server/view";
import type { Role } from "../src/generated/prisma/client";
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error("Disposable *_test database required");
after(() => db.$disconnect());
const initial = "test-initial-password-4839";
const own = "test-personal-password-7284";
async function make(role: Role) {
  return db.user.create({
    data: {
      name: role,
      email: randomUUID() + "@example.invalid",
      role,
      passwordHash: await hashPassword(initial),
    },
  });
}
test("OWNER administration, passwords, last-owner guard and all role denials", async () => {
  const owner = await make("OWNER");
  await assert.rejects(
    administerAccount(owner, owner.id, "active", false),
    /LAST_OWNER/,
  );
  await assert.rejects(
    administerAccount(owner, owner.id, "role", "ADMIN"),
    /LAST_OWNER/,
  );
  await assert.rejects(
    createAccount(owner, {
      name: "Escalation",
      email: randomUUID() + "@example.invalid",
      role: "OWNER",
      password: initial,
      confirmation: initial,
    }),
  );
  const id = await createAccount(owner, {
    name: "Field employee",
    email: "FIELD@test.invalid",
    role: "CREW",
    password: initial,
    confirmation: initial,
  });
  let user = await db.user.findUniqueOrThrow({ where: { id } });
  assert.equal(user.passwordChangeRequired, true);
  assert.notEqual(user.passwordHash, initial);
  assert.ok(await verifyPassword(initial, user.passwordHash));
  await assert.rejects(
    createAccount(owner, {
      name: "duplicate",
      email: "field@test.invalid",
      role: "CREW",
      password: initial,
      confirmation: initial,
    }),
    /EMAIL_EXISTS/,
  );
  for (const role of [
    "ADMIN",
    "SALES",
    "PROJECT_MANAGER",
    "CREW",
    "CUSTOMER",
  ] as const) {
    const actor = await make(role);
    await assert.rejects(
      createAccount(actor, {
        name: "blocked",
        email: randomUUID() + "@example.invalid",
        role: "CREW",
        password: initial,
        confirmation: initial,
      }),
      /ACCESS_DENIED/,
    );
    await assert.rejects(
      administerAccount(actor, id, "active", false),
      /ACCESS_DENIED/,
    );
    await assert.rejects(
      administerAccount(actor, id, "role", "ADMIN"),
      /ACCESS_DENIED/,
    );
    await assert.rejects(
      administerAccount(actor, id, "sessions", null),
      /ACCESS_DENIED/,
    );
    await assert.rejects(
      assignProject(actor, id, "unknown", true),
      /ACCESS_DENIED/,
    );
  }
  await db.session.create({
    data: {
      userId: id,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await assert.rejects(
    changeOwnPassword(user, "wrong", own),
    /CURRENT_PASSWORD_INVALID/,
  );
  await changeOwnPassword(user, initial, own);
  user = await db.user.findUniqueOrThrow({ where: { id } });
  assert.equal(user.passwordChangeRequired, false);
  assert.ok(await verifyPassword(own, user.passwordHash));
  assert.equal(await db.session.count({ where: { userId: id } }), 0);
  await administerAccount(owner, id, "reset", initial);
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id } })).passwordChangeRequired,
    true,
  );
  await administerAccount(owner, id, "active", false);
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id } })).active,
    false,
  );
  await administerAccount(owner, id, "active", true);
  await administerAccount(owner, id, "role", "PROJECT_MANAGER");
  await assert.rejects(administerAccount(owner, id, "role", "OWNER"));
  const audits = JSON.stringify(
    await db.activity.findMany({ where: { type: { startsWith: "TEAM_" } } }),
  );
  assert.ok(audits.includes("TEAM_PASSWORD_RESET"));
  assert.equal(audits.includes(initial), false);
  assert.equal(audits.includes(own), false);
  assert.equal(audits.includes(user.passwordHash), false);
  const otherOwner = await make("OWNER");
  const results = await Promise.allSettled([
    administerAccount(owner, otherOwner.id, "active", false),
    administerAccount(otherOwner, owner.id, "active", false),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    await db.user.count({ where: { role: "OWNER", active: true } }),
    1,
  );
});
test("project authorization, financial filtering, removal and role-change revocation", async () => {
  const owner = await make("OWNER"),
    crew = await make("CREW"),
    pm = await make("PROJECT_MANAGER"),
    sales = await make("SALES");
  const customer = await db.customer.create({
    data: { firstName: "Team", lastName: "Test" },
  });
  const lead = await db.lead.create({
    data: {
      customerId: customer.id,
      source: "WEBSITE",
      serviceType: "Kitchen",
    },
  });
  const opportunity = await db.opportunity.create({
    data: {
      customerId: customer.id,
      leadId: lead.id,
      ownerId: sales.id,
      stage: "WON",
    },
  });
  const estimate = await db.estimate.create({
    data: {
      customerId: customer.id,
      opportunityId: opportunity.id,
      directCost: "6500",
      sellingPrice: "10000",
      grossProfit: "3500",
      grossMargin: "0.35",
      scope: "Original kitchen scope",
    },
  });
  const project = await db.project.create({
    data: {
      customerId: customer.id,
      opportunityId: opportunity.id,
      estimateId: estimate.id,
      contractValue: "10000",
      estimatedCost: "6500",
      actualCost: "0",
      estimatedGrossProfit: "3500",
      actualGrossProfit: "0",
    },
  });
  for (const user of [crew, pm]) {
    await assert.rejects(workspace(user, project.id), /ACCESS_DENIED/);
    await assignProject(owner, user.id, project.id, true);
    assert.equal((await workspace(user, project.id)).financial, null);
    await assignProject(owner, user.id, project.id, false);
    await assert.rejects(workspace(user, project.id), /ACCESS_DENIED/);
  }
  await assert.rejects(
    assignProject(owner, sales.id, project.id, true),
    /INVALID_ASSIGNEE/,
  );
  await assignProject(owner, crew.id, project.id, true);
  const task = await db.projectTask.create({
    data: { projectId: project.id, assigneeId: crew.id, title: "Assigned" },
  });
  await db.session.create({
    data: {
      userId: crew.id,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await administerAccount(owner, crew.id, "role", "SALES");
  assert.equal(await db.session.count({ where: { userId: crew.id } }), 0);
  assert.equal(
    (await db.projectTask.findUniqueOrThrow({ where: { id: task.id } }))
      .assigneeId,
    null,
  );
  await assert.rejects(workspace(crew, project.id), /ACCESS_DENIED/);
  assert.equal(
    await db.projectEvent.count({
      where: { projectId: project.id, type: "TEAM_PROJECT_ACCESS_REVOKED" },
    }),
    1,
  );
  assert.equal(
    await db.projectMember.count({ where: { userId: crew.id, active: true } }),
    0,
  );
  const changed = await db.user.findUniqueOrThrow({ where: { id: crew.id } });
  await administerAccount(owner, changed.id, "active", false);
  await administerAccount(owner, changed.id, "active", true);
  assert.equal(
    await db.projectMember.count({ where: { userId: crew.id, active: true } }),
    0,
  );
  await assignProject(owner, pm.id, project.id, true);
  await db.project.update({
    where: { id: project.id },
    data: { status: "CANCELLED" },
  });
  await assignProject(owner, pm.id, project.id, false);
  await assert.rejects(workspace(pm, project.id), /ACCESS_DENIED/);
  await assert.rejects(
    assignProject(owner, pm.id, project.id, true),
    /PROJECT_CLOSED/,
  );
});
