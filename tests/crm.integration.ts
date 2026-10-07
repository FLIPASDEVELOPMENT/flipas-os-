import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import { User } from "../src/generated/prisma/client";
import {
  createCustomer,
  saveLead,
  createOpportunity,
  moveStage,
  addNote,
  customerScope,
  updateOpportunity,
} from "../src/server/crm";
if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL required for integration tests");
const prefix = `test-${randomUUID()}`;
let owner: User, sales: User, other: User, crew: User;
let customerId: string, leadId: string, opportunityId: string;
before(async () => {
  const make = (role: User["role"], n: string) =>
    db.user.create({
      data: {
        name: n,
        email: `${prefix}-${n}@example.invalid`,
        passwordHash: "not-a-login-hash",
        role,
      },
    });
  [owner, sales, other, crew] = await Promise.all([
    make("OWNER", "owner"),
    make("SALES", "sales"),
    make("SALES", "other"),
    make("CREW", "crew"),
  ]);
});
after(async () => {
  const ids = [owner, sales, other, crew].filter(Boolean).map((u) => u.id);
  await db.activity.deleteMany({ where: { actorId: { in: ids } } });
  await db.opportunity.deleteMany({ where: { ownerId: { in: ids } } });
  await db.lead.deleteMany({
    where: { customer: { email: { startsWith: prefix } } },
  });
  await db.customer.deleteMany({ where: { email: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});
test("CRM operations preserve ownership, links and atomic audit", async () => {
  const c = await createCustomer(owner, {
    firstName: "Test",
    lastName: "Customer",
    email: `${prefix}@example.invalid`,
    phone: "",
    address: "",
    city: "Orlando",
    state: "FL",
    zip: "",
    notes: "",
  });
  customerId = c.id;
  const l = await saveLead(owner, {
    customerId,
    source: "REFERRAL",
    serviceType: "Kitchen",
    description: "",
    status: "NEW",
    leadScore: "75",
    budgetMin: "10000",
    budgetMax: "20000",
    desiredStartDate: "",
    assignedToId: sales.id,
  });
  leadId = l.id;
  const o = await createOpportunity(sales, {
    leadId,
    estimatedValue: "15000.10",
    probability: "30",
    nextAction: "Call",
    nextActionDate: "",
  });
  opportunityId = o.id;
  assert.equal(o.customerId, customerId);
  assert.equal(o.ownerId, sales.id);
  assert.equal(o.estimatedValue?.toFixed(2), "15000.10");
  await moveStage(sales, { id: opportunityId, stage: "CONTACTED" });
  await addNote(sales, { leadId, message: "Qualification call completed" });
  const logs = await db.activity.findMany({ where: { leadId } });
  assert.equal(logs.length, 4);
  assert.ok(
    logs.some(
      (a) => a.type === "STAGE_CHANGED" && a.message === "NEW → CONTACTED",
    ),
  );
  await assert.rejects(moveStage(other, { id: opportunityId, stage: "WON" }));
  await assert.rejects(addNote(other, { leadId, message: "Unauthorized" }));
  assert.equal(await db.activity.count({ where: { leadId } }), 4);
  assert.equal(
    await db.customer.count({
      where: { id: customerId, ...customerScope(other) },
    }),
    0,
  );
  await assert.rejects(
    createCustomer(crew, { firstName: "Bad", lastName: "Access" }),
  );
  await assert.rejects(
    saveLead(sales, {
      customerId,
      source: "WEBSITE",
      serviceType: "Kitchen",
      description: "",
      status: "NEW",
      leadScore: 101,
      budgetMin: "",
      budgetMax: "",
      desiredStartDate: "",
      assignedToId: sales.id,
    }),
  );
  assert.equal(await db.lead.count({ where: { customerId } }), 1);
  await saveLead(
    owner,
    {
      customerId,
      source: "REFERRAL",
      serviceType: "Kitchen",
      description: "",
      status: "QUALIFIED",
      leadScore: 80,
      budgetMin: "10000",
      budgetMax: "20000",
      desiredStartDate: "",
      assignedToId: other.id,
    },
    leadId,
  );
  assert.equal(
    (await db.opportunity.findUniqueOrThrow({ where: { id: opportunityId } }))
      .ownerId,
    other.id,
  );
  await assert.rejects(moveStage(sales, { id: opportunityId, stage: "WON" }));
  await updateOpportunity(other,{leadId,estimatedValue:"18000.25",probability:40,nextAction:"Schedule visit",nextActionDate:"2026-11-01"},opportunityId);
  assert.equal((await db.opportunity.findUniqueOrThrow({where:{id:opportunityId}})).estimatedValue?.toFixed(2),"18000.25");
  await assert.rejects(db.lead.update({where:{id:leadId},data:{leadScore:-1}}));
  assert.equal((await db.lead.findUniqueOrThrow({where:{id:leadId}})).leadScore,80);
});
