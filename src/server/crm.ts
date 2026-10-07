import { Prisma, User } from "@/generated/prisma/client";
import { db } from "./db";
import { canAccess, canManage, canUseCRM } from "@/domain/permissions";
import {
  customerInput,
  leadInput,
  opportunityInput,
  stageInput,
  noteInput,
} from "./validation";
function assertCRM(u: User) {
  if (!canUseCRM(u.role)) throw new Error("Access denied");
}
export const leadScope = (u: User): Prisma.LeadWhereInput =>
  canManage(u.role) ? {} : { assignedToId: u.id };
export const opportunityScope = (u: User): Prisma.OpportunityWhereInput =>
  canManage(u.role) ? {} : { ownerId: u.id };
export const customerScope = (u: User): Prisma.CustomerWhereInput =>
  canManage(u.role)
    ? {}
    : {
        OR: [
          { leads: { some: { assignedToId: u.id } } },
          { opportunities: { some: { ownerId: u.id } } },
        ],
      };
export async function createCustomer(u: User, input: unknown) {
  assertCRM(u);
  const data = customerInput.parse(input);
  return db.$transaction(
    async (tx) => {
      const customer = await tx.customer.create({ data });
      // A Sales-created customer gets an assigned intake lead, preventing orphaned invisible records.
      const lead =
        u.role === "SALES"
          ? await tx.lead.create({
              data: {
                customerId: customer.id,
                source: "OTHER",
                serviceType: "Remodeling inquiry",
                assignedToId: u.id,
              },
            })
          : null;
      await tx.activity.create({
        data: {
          type: "CUSTOMER_CREATED",
          message: "Customer created",
          actorId: u.id,
          customerId: customer.id,
          leadId: lead?.id,
        },
      });
      return customer;
    },
    { isolationLevel: "Serializable" },
  );
}
export async function saveLead(u: User, input: unknown, id?: string) {
  assertCRM(u);
  const parsed = leadInput.parse(input);
  return db.$transaction(
    async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: parsed.customerId, ...customerScope(u) },
      });
      if (!customer) throw new Error("Customer unavailable");
      const existing = id ? await tx.lead.findUnique({ where: { id } }) : null;
      if (id && (!existing || !canAccess(u.role, u.id, existing.assignedToId)))
        throw new Error("Access denied");
      const assignedToId = canManage(u.role) ? parsed.assignedToId : u.id;
      if (
        assignedToId &&
        !(await tx.user.findFirst({
          where: {
            id: assignedToId,
            active: true,
            role: { in: ["OWNER", "ADMIN", "SALES"] },
          },
        }))
      )
        throw new Error("Invalid salesperson");
      if (existing && existing.customerId !== parsed.customerId)
        throw new Error("Lead customer cannot change");
      if (existing && assignedToId && assignedToId !== existing.assignedToId)
        await tx.opportunity.updateMany({
          where: { leadId: existing.id },
          data: { ownerId: assignedToId },
        });
      if(existing && !assignedToId && await tx.opportunity.findUnique({where:{leadId:existing.id}}))throw new Error("A lead linked to an opportunity must remain assigned");
      const data = { ...parsed, assignedToId };
      const lead = id
        ? await tx.lead.update({ where: { id }, data })
        : await tx.lead.create({ data });
      await tx.activity.create({
        data: {
          type: id ? "LEAD_UPDATED" : "LEAD_CREATED",
          message: id ? "Lead updated" : "Lead created",
          actorId: u.id,
          customerId: lead.customerId,
          leadId: lead.id,
          metadata: {
            before: existing
              ? {
                  status: existing.status,
                  leadScore: existing.leadScore,
                  assignedToId: existing.assignedToId,
                }
              : null,
            after: {
              status: lead.status,
              leadScore: lead.leadScore,
              assignedToId,
            },
          },
        },
      });
      return lead;
    },
    { isolationLevel: "Serializable" },
  );
}
export async function createOpportunity(u: User, input: unknown) {
  assertCRM(u);
  const data = opportunityInput.parse(input);
  return db.$transaction(
    async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { id: data.leadId, ...leadScope(u) },
      });
      if (!lead) throw new Error("Lead unavailable");
      if(!lead.assignedToId){
        await tx.lead.update({where:{id:lead.id},data:{assignedToId:u.id}});
        await tx.activity.create({data:{type:"LEAD_ASSIGNED",message:"Lead assigned to opportunity owner",actorId:u.id,customerId:lead.customerId,leadId:lead.id,metadata:{assignedToId:u.id}}});
      }
      const opportunity = await tx.opportunity.create({
        data: {
          ...data,
          customerId: lead.customerId,
          ownerId: lead.assignedToId ?? u.id,
        },
      });
      await tx.activity.create({
        data: {
          type: "OPPORTUNITY_CREATED",
          message: "Opportunity created",
          actorId: u.id,
          customerId: lead.customerId,
          leadId: lead.id,
          opportunityId: opportunity.id,
        },
      });
      return opportunity;
    },
    { isolationLevel: "Serializable" },
  );
}
export async function moveStage(u: User, input: unknown) {
  assertCRM(u);
  const { id, stage } = stageInput.parse(input);
  return db.$transaction(
    async (tx) => {
      const old = await tx.opportunity.findFirst({
        where: { id, ...opportunityScope(u) },
      });
      if (!old) throw new Error("Opportunity unavailable");
      await tx.opportunity.update({ where: { id }, data: { stage } });
      await tx.activity.create({
        data: {
          type: "STAGE_CHANGED",
          message: `${old.stage} → ${stage}`,
          actorId: u.id,
          customerId: old.customerId,
          leadId: old.leadId,
          opportunityId: id,
          metadata: { before: old.stage, after: stage },
        },
      });
    },
    { isolationLevel: "Serializable" },
  );
}
export async function addNote(u: User, input: unknown) {
  assertCRM(u);
  const data = noteInput.parse(input);
  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findFirst({
      where: { id: data.leadId, ...leadScope(u) },
    });
    if (!lead) throw new Error("Lead unavailable");
    return tx.activity.create({
      data: {
        type: "NOTE",
        message: data.message,
        actorId: u.id,
        customerId: lead.customerId,
        leadId: lead.id,
      },
    });
  });
}

export async function updateOpportunity(u: User, input: unknown, id: string) {
  assertCRM(u);
  const data = opportunityInput.parse(input);
  return db.$transaction(
    async (tx) => {
      const old = await tx.opportunity.findFirst({
        where: { id, ...opportunityScope(u) },
      });
      if (!old || old.leadId !== data.leadId)
        throw new Error("Opportunity unavailable");
      const updated = await tx.opportunity.update({
        where: { id },
        data: {
          estimatedValue: data.estimatedValue,
          probability: data.probability,
          nextAction: data.nextAction,
          nextActionDate: data.nextActionDate,
        },
      });
      await tx.activity.create({
        data: {
          type: "OPPORTUNITY_UPDATED",
          actorId: u.id,
          customerId: old.customerId,
          leadId: old.leadId,
          opportunityId: id,
          message: "Opportunity value and next action updated",
          metadata: {
            before: {
              estimatedValue: old.estimatedValue?.toString() ?? null,
              probability: old.probability,
              nextAction: old.nextAction,
              nextActionDate: old.nextActionDate?.toISOString() ?? null,
            },
            after: {
              estimatedValue: updated.estimatedValue?.toString() ?? null,
              probability: updated.probability,
              nextAction: updated.nextAction,
              nextActionDate: updated.nextActionDate?.toISOString() ?? null,
            },
          },
        },
      });
      return updated;
    },
    { isolationLevel: "Serializable" },
  );
}
