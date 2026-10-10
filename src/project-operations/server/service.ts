import { z } from "zod";
import { db } from "@/server/db";
import { Prisma, type User } from "@/generated/prisma/client";
import {
  canonicalState,
  validTransition,
  states,
  text,
  id,
  money,
  signedMoney,
  day,
  quantity,
  managers,
  financialRoles,
  assertAcyclic,
  templates,
  templateDefinition,
} from "../domain/rules";
type TX = Prisma.TransactionClient;
const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export function projectScope(u: User): Prisma.ProjectWhereInput {
  if (!u.active) return { id: "__denied__" };
  if (["OWNER", "ADMIN"].includes(u.role)) return {};
  if (u.role === "PROJECT_MANAGER")
    return {
      OR: [
        { projectManagerId: u.id },
        { operationsProjectMember: { some: { userId: u.id, active: true } } },
      ],
    };
  if (u.role === "CREW")
    return {
      operationsProjectMember: { some: { userId: u.id, active: true } },
    };
  if (u.role === "SALES") return { opportunity: { ownerId: u.id } };
  return { id: "__denied__" };
}
export async function authorized(
  tx: TX,
  u: User,
  projectId: string,
  write = false,
  finance = false,
) {
  const current = await tx.user.findUnique({ where: { id: u.id } });
  if (
    !current?.active ||
    current.passwordChangeRequired ||
    current.role !== u.role
  )
    throw new Error("ACCESS_DENIED");
  const p = await tx.project.findFirst({
    where: { AND: [{ id: projectId }, projectScope(current)] },
  });
  if (
    !p ||
    (write && !managers.includes(current.role)) ||
    (finance && !financialRoles.includes(current.role))
  )
    throw new Error("ACCESS_DENIED");
  return p;
}
async function event(
  tx: TX,
  u: User,
  projectId: string,
  type: string,
  data: unknown,
) {
  await tx.projectEvent.create({
    data: { projectId, type, actorId: u.id, metadata: json(data) },
  });
  const p = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { customerId: true, opportunityId: true },
  });
  await tx.activity.create({
    data: {
      type,
      message: type,
      actorId: u.id,
      customerId: p.customerId,
      opportunityId: p.opportunityId,
      metadata: json({ projectId }),
    },
  });
}
export async function mutate(
  u: User,
  projectId: string,
  operation: string,
  input: unknown,
) {
  id.parse(projectId);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id"=${projectId} FOR UPDATE`;
      const crewOps = ["task-progress", "checklist", "time", "daily-log"];
      const p = await authorized(
        tx,
        u,
        projectId,
        !crewOps.includes(operation),
      );
      if (
        ["COMPLETED", "CANCELLED"].includes(canonicalState(p.status)) &&
        !["cost", "cost-review"].includes(operation)
      )
        throw new Error("PROJECT_CLOSED");
      let result: unknown;
      if (operation === "details") {
        const d = z
          .object({
            address: text,
            startDate: day,
            completionDate: day,
            managerId: id,
          })
          .parse(input);
        if (d.completionDate < d.startDate) throw new Error("INVALID_DATES");
        const manager = await tx.user.findFirst({
          where: {
            id: d.managerId,
            active: true,
            role: { in: ["OWNER", "ADMIN", "PROJECT_MANAGER"] },
          },
        });
        if (!manager) throw new Error("INVALID_ASSIGNEE");
        result = await tx.project.update({
          where: { id: projectId },
          data: {
            projectAddress: d.address,
            startDate: d.startDate,
            estimatedCompletionDate: d.completionDate,
            projectManagerId: d.managerId,
          },
        });
      } else if (operation === "state") {
        const d = z
          .object({
            state: z.enum(states),
            reason: text,
            exception: z.string().trim().max(2000).default(""),
          })
          .parse(input);
        validTransition(p.status, d.state);
        if (d.state === "COMPLETED") {
          const required = await tx.projectInspection.findMany({
            where: { projectId, required: true },
          });
          const defects = await tx.projectDefect.count({
            where: { projectId, blocking: true, resolvedAt: null },
          });
          const incomplete = await tx.projectChecklist.count({
            where: { projectId, required: true, completedAt: null },
          });
          if (
            !required.length ||
            required.some((i) => i.status !== "APPROVED") ||
            defects ||
            incomplete
          ) {
            if (u.role !== "OWNER" || d.exception.length < 20)
              throw new Error("QUALITY_GATE_REQUIRED");
            await event(tx, u, projectId, "PROJECT_CLOSURE_EXCEPTION", {
              reason: d.exception,
              defects,
              incomplete,
            });
          }
        }
        result = await tx.project.update({
          where: { id: projectId },
          data: {
            status: d.state,
            operationsVersion: { increment: 1 },
            ...(d.state === "COMPLETED"
              ? { actualCompletionDate: new Date() }
              : {}),
          },
        });
        await event(tx, u, projectId, "PROJECT_STATUS_CHANGED", {
          from: p.status,
          to: d.state,
          reason: d.reason,
        });
        return result;
      } else if (operation === "member") {
        const d = z
          .object({
            userId: id,
            kind: z.enum(["EMPLOYEE", "SUBCONTRACTOR"]),
            active: z.boolean(),
          })
          .parse(input);
        const worker = await tx.user.findFirst({
          where: {
            id: d.userId,
            active: true,
            role: { in: ["CREW", "PROJECT_MANAGER", "OWNER", "ADMIN"] },
          },
        });
        if (!worker) throw new Error("INVALID_ASSIGNEE");
        result = await tx.projectMember.upsert({
          where: { projectId_userId: { projectId, userId: d.userId } },
          create: { projectId, ...d },
          update: { kind: d.kind, active: d.active },
        });
        if (!d.active)
          await tx.projectTask.updateMany({
            where: { projectId, assigneeId: d.userId },
            data: { assigneeId: null, version: { increment: 1 } },
          });
      } else if (operation === "stage") {
        const d = z
          .object({
            title: text,
            plannedStart: day,
            plannedEnd: day,
            position: z.number().int().min(0).max(1000),
          })
          .parse(input);
        if (d.plannedEnd < d.plannedStart) throw new Error("INVALID_DATES");
        result = await tx.projectStage.create({ data: { projectId, ...d } });
      } else if (operation === "task") {
        const d = z
          .object({
            title: text,
            stageId: id.optional(),
            assigneeId: id.optional(),
            dueAt: day,
            priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]),
          })
          .parse(input);
        if (
          d.stageId &&
          !(await tx.projectStage.findFirst({
            where: { id: d.stageId, projectId },
          }))
        )
          throw new Error("PROJECT_LINK_MISMATCH");
        if (
          d.assigneeId &&
          !(await tx.projectMember.findFirst({
            where: { projectId, userId: d.assigneeId, active: true },
          }))
        )
          throw new Error("INVALID_ASSIGNEE");
        result = await tx.projectTask.create({ data: { projectId, ...d } });
      } else if (operation === "task-edit") {
        const d = z
          .object({
            taskId: id,
            title: text,
            assigneeId: id.optional(),
            dueAt: day,
            version: z.number().int().nonnegative(),
          })
          .parse(input);
        const task = await tx.projectTask.findFirstOrThrow({
          where: { id: d.taskId, projectId },
        });
        if (task.version !== d.version) throw new Error("STALE_VERSION");
        if (
          d.assigneeId &&
          !(await tx.projectMember.findFirst({
            where: { projectId, userId: d.assigneeId, active: true },
          }))
        )
          throw new Error("INVALID_ASSIGNEE");
        result = await tx.projectTask.update({
          where: { id: task.id },
          data: {
            title: d.title,
            assigneeId: d.assigneeId ?? null,
            dueAt: d.dueAt,
            version: { increment: 1 },
          },
        });
      } else if (operation === "stage-edit") {
        const d = z
          .object({
            stageId: id,
            title: text,
            plannedStart: day,
            plannedEnd: day,
            actualStart: day.optional(),
            actualEnd: day.optional(),
          })
          .parse(input);
        if (
          d.plannedEnd < d.plannedStart ||
          (d.actualStart && d.actualEnd && d.actualEnd < d.actualStart)
        )
          throw new Error("INVALID_DATES");
        await tx.projectStage.findFirstOrThrow({
          where: { id: d.stageId, projectId },
        });
        result = await tx.projectStage.update({
          where: { id: d.stageId },
          data: {
            title: d.title,
            plannedStart: d.plannedStart,
            plannedEnd: d.plannedEnd,
            actualStart: d.actualStart ?? null,
            actualEnd: d.actualEnd ?? null,
          },
        });
      } else if (operation === "checklist-create") {
        const d = z
          .object({ taskId: id, title: text, required: z.boolean() })
          .parse(input);
        await tx.projectTask.findFirstOrThrow({
          where: { id: d.taskId, projectId },
        });
        result = await tx.projectChecklist.create({
          data: { projectId, ...d },
        });
      } else if (operation === "dependency") {
        const d = z.object({ taskId: id, prerequisiteId: id }).parse(input);
        if (
          (await tx.projectTask.count({
            where: { projectId, id: { in: [d.taskId, d.prerequisiteId] } },
          })) !== 2
        )
          throw new Error("PROJECT_LINK_MISMATCH");
        assertAcyclic(
          d.taskId,
          d.prerequisiteId,
          await tx.taskDependency.findMany({ where: { projectId } }),
        );
        result = await tx.taskDependency.upsert({
          where: { taskId_prerequisiteId: d },
          create: { projectId, ...d },
          update: {},
        });
      } else if (operation === "task-progress") {
        const d = z
          .object({
            taskId: id,
            version: z.number().int().nonnegative(),
            progress: z.number().int().min(0).max(100),
            note: z.string().trim().max(2000),
          })
          .parse(input);
        const task = await tx.projectTask.findFirstOrThrow({
          where: { id: d.taskId, projectId },
        });
        if (u.role === "CREW" && task.assigneeId !== u.id)
          throw new Error("ACCESS_DENIED");
        if (u.role === "SALES") throw new Error("ACCESS_DENIED");
        if (task.version !== d.version) throw new Error("STALE_VERSION");
        const dependencies = await tx.taskDependency.findMany({
          where: { projectId, taskId: task.id },
        });
        if (
          d.progress > 0 &&
          (await tx.projectTask.count({
            where: {
              id: { in: dependencies.map((x) => x.prerequisiteId) },
              completedAt: null,
            },
          }))
        )
          throw new Error("DEPENDENCY_PENDING");
        if (
          d.progress === 100 &&
          (d.note.length < 5 ||
            !(await tx.projectEvidence.count({
              where: { projectId, taskId: task.id },
            })) ||
            (await tx.projectChecklist.count({
              where: {
                projectId,
                taskId: task.id,
                required: true,
                completedAt: null,
              },
            })))
        )
          throw new Error("COMPLETION_EVIDENCE_REQUIRED");
        result = await tx.projectTask.update({
          where: { id: task.id },
          data: {
            progress: d.progress,
            status:
              d.progress === 100 ? "DONE" : d.progress ? "IN_PROGRESS" : "TODO",
            completedAt: d.progress === 100 ? new Date() : null,
            actualStart: task.actualStart ?? (d.progress ? new Date() : null),
            completionNote: d.note,
            version: { increment: 1 },
          },
        });
      } else if (operation === "checklist") {
        const d = z
          .object({ checklistId: id, completed: z.boolean() })
          .parse(input);
        const item = await tx.projectChecklist.findFirstOrThrow({
          where: { id: d.checklistId, projectId },
        });
        if (
          u.role === "CREW" &&
          (!item.taskId ||
            !(await tx.projectTask.findFirst({
              where: { id: item.taskId, projectId, assigneeId: u.id },
            })))
        )
          throw new Error("ACCESS_DENIED");
        if (u.role === "SALES") throw new Error("ACCESS_DENIED");
        result = await tx.projectChecklist.update({
          where: { id: item.id },
          data: {
            completedAt: d.completed ? new Date() : null,
            completedById: d.completed ? u.id : null,
          },
        });
      } else if (operation === "time") {
        const d = z
          .object({
            workerId: id,
            workDate: day,
            minutes: z.number().int().min(1).max(960),
            description: text,
            requestKey: id,
          })
          .parse(input);
        if ((u.role === "CREW" && d.workerId !== u.id) || u.role === "SALES")
          throw new Error("ACCESS_DENIED");
        if (
          !(await tx.projectMember.findFirst({
            where: { projectId, userId: d.workerId, active: true },
          }))
        )
          throw new Error("INVALID_ASSIGNEE");
        const existing = await tx.projectTimeEntry.findUnique({
          where: {
            projectId_requestKey: { projectId, requestKey: d.requestKey },
          },
        });
        if (existing) return existing;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"time:" + d.workerId + ":" + d.workDate.toISOString()}))`;
        const entries = await tx.projectTimeEntry.findMany({
          where: { workerId: d.workerId, workDate: d.workDate },
        });
        if (entries.reduce((sum, e) => sum + e.minutes, 0) + d.minutes > 960)
          throw new Error("DAILY_HOURS_LIMIT");
        result = await tx.projectTimeEntry.create({
          data: { projectId, ...d, createdById: u.id },
        });
      } else if (operation === "daily-log") {
        const d = z
          .object({
            workDate: day,
            summary: text,
            incidents: z.string().max(2000),
            workers: z.array(id).max(100),
            replacesId: id.optional(),
            requestKey: id,
          })
          .parse(input);
        if (u.role === "SALES") throw new Error("ACCESS_DENIED");
        if (
          (await tx.projectMember.count({
            where: {
              projectId,
              active: true,
              userId: { in: [...new Set(d.workers)] },
            },
          })) !== new Set(d.workers).size
        )
          throw new Error("INVALID_ASSIGNEE");
        const existing = await tx.projectDailyLog.findUnique({
          where: {
            projectId_requestKey: { projectId, requestKey: d.requestKey },
          },
        });
        if (existing) return existing;
        let version = 1;
        if (d.replacesId) {
          const prev = await tx.projectDailyLog.findFirstOrThrow({
            where: { projectId, id: d.replacesId },
          });
          if (u.role === "CREW" && prev.recordedById !== u.id)
            throw new Error("ACCESS_DENIED");
          if (
            await tx.projectDailyLog.count({ where: { replacesId: prev.id } })
          )
            throw new Error("STALE_VERSION");
          version = prev.version + 1;
        }
        result = await tx.projectDailyLog.create({
          data: {
            projectId,
            ...d,
            workers: json(d.workers),
            recordedById: u.id,
            version,
          },
        });
      } else if (operation === "template") {
        const d = z.object({ templateId: id }).parse(input);
        if (Object.keys(p.templateVersionSnapshot as object).length)
          throw new Error("TEMPLATE_ALREADY_APPLIED");
        const t = await tx.operationsTemplate.findFirstOrThrow({
          where: { id: d.templateId, active: true },
        });
        const definition = templateDefinition.parse(t.definition);
        for (const [position, stage] of definition.stages.entries()) {
          const created = await tx.projectStage.create({
            data: { projectId, title: stage.title, position },
          });
          for (const title of stage.tasks) {
            const task = await tx.projectTask.create({
              data: { projectId, title, stageId: created.id },
            });
            for (const criterion of stage.checklists?.[title] ?? [
              "Confirm completion and record evidence",
            ]) {
              await tx.projectChecklist.create({
                data: {
                  projectId,
                  taskId: task.id,
                  title: criterion,
                  required: true,
                },
              });
            }
          }
        }
        result = await tx.project.update({
          where: { id: projectId },
          data: {
            templateVersionSnapshot: json({
              id: t.id,
              name: t.name,
              version: t.version,
              definition,
            }),
          },
        });
      } else if (operation === "material") {
        const d = z
          .object({
            name: text,
            quantity,
            unit: z.enum(["EACH", "SQFT", "LINEAR_FT", "HOUR", "DAY", "FLAT"]),
            supplier: z.string().max(200),
          })
          .parse(input);
        result = await tx.projectMaterial.create({ data: { projectId, ...d } });
      } else if (operation === "purchase") {
        await authorized(tx, u, projectId, true, true);
        const d = z
          .object({ materialId: id, quantity, unitCost: money, requestKey: id })
          .parse(input);
        if (
          !(await tx.projectMaterial.findFirst({
            where: { id: d.materialId, projectId },
          }))
        )
          throw new Error("PROJECT_LINK_MISMATCH");
        const existing = await tx.projectPurchase.findUnique({
          where: {
            projectId_requestKey: { projectId, requestKey: d.requestKey },
          },
        });
        if (existing) return existing;
        result = await tx.projectPurchase.create({
          data: { projectId, ...d, requestedById: u.id },
        });
      } else if (operation === "purchase-state") {
        await authorized(tx, u, projectId, true, true);
        const d = z
          .object({
            purchaseId: id,
            status: z.enum(["APPROVED", "ORDERED", "DELIVERED", "CANCELLED"]),
          })
          .parse(input);
        const purchase = await tx.projectPurchase.findFirstOrThrow({
          where: { projectId, id: d.purchaseId },
        });
        const allowed: Record<string, string[]> = {
          REQUESTED: ["APPROVED", "CANCELLED"],
          APPROVED: ["ORDERED", "CANCELLED"],
          ORDERED: ["DELIVERED", "CANCELLED"],
        };
        if (!allowed[purchase.status]?.includes(d.status))
          throw new Error("INVALID_TRANSITION");
        result = await tx.projectPurchase.update({
          where: { id: purchase.id },
          data: {
            status: d.status,
            ...(d.status === "APPROVED" ? { approvedById: u.id } : {}),
          },
        });
        if (d.status === "DELIVERED") {
          const material = await tx.projectMaterial.findUniqueOrThrow({
            where: { id: purchase.materialId },
          });
          const received = material.receivedQuantity.add(purchase.quantity);
          await tx.projectMaterial.update({
            where: { id: material.id },
            data: {
              receivedQuantity: received,
              status: received.greaterThanOrEqualTo(material.quantity)
                ? "DELIVERED"
                : "PARTIAL",
            },
          });
        }
      } else if (operation === "cost") {
        await authorized(tx, u, projectId, true, true);
        const d = z
          .object({
            category: z.enum(["LABOR", "MATERIAL", "SUBCONTRACTOR", "OTHER"]),
            kind: z.enum(["COMMITTED", "ACTUAL"]),
            amount: money,
            description: text,
            sourceReference: text,
            requestKey: id,
          })
          .parse(input);
        const existing = await tx.projectCostEntry.findUnique({
          where: {
            projectId_requestKey: { projectId, requestKey: d.requestKey },
          },
        });
        if (existing) return existing;
        if (
          d.kind === "COMMITTED" &&
          (await tx.projectPurchase.count({
            where: { projectId, id: d.sourceReference },
          }))
        )
          throw new Error("PURCHASE_COMMITMENT_ALREADY_TRACKED");
        if (
          await tx.projectCostEntry.count({
            where: {
              projectId,
              sourceReference: d.sourceReference,
              kind: d.kind,
            },
          })
        )
          throw new Error("DUPLICATE_COST_REFERENCE");
        result = await tx.projectCostEntry.create({
          data: { projectId, ...d, recordedById: u.id },
        });
        await tx.project.update({
          where: { id: projectId },
          data: { costsReviewedAt: null, costsReviewedById: null },
        });
      } else if (operation === "cost-review") {
        if (u.role !== "OWNER") throw new Error("ACCESS_DENIED");
        z.object({ confirmation: z.literal(true) }).parse(input);
        if (canonicalState(p.status) !== "COMPLETED")
          throw new Error("PROJECT_NOT_COMPLETED");
        result = await tx.project.update({
          where: { id: projectId },
          data: { costsReviewedAt: new Date(), costsReviewedById: u.id },
        });
      } else if (operation === "change-request") {
        const d = z
          .object({
            title: text,
            reason: text,
            scope: text,
            scheduleDays: z.number().int().min(-365).max(365),
            requestKey: id,
          })
          .parse(input);
        const existing = await tx.projectChangeOrder.findUnique({
          where: {
            projectId_requestKey: { projectId, requestKey: d.requestKey },
          },
        });
        if (existing) return existing;
        result = await tx.projectChangeOrder.create({
          data: {
            projectId,
            ...d,
            priceDelta: "0",
            costDelta: "0",
            financialReviewed: false,
            createdById: u.id,
          },
        });
      } else if (operation === "change-revise") {
        await authorized(tx, u, projectId, true, true);
        const d = z
          .object({
            changeId: id,
            title: text,
            reason: text,
            scope: text,
            priceDelta: signedMoney,
            costDelta: signedMoney,
            scheduleDays: z.number().int().min(-365).max(365),
            requestKey: id,
          })
          .parse(input);
        const prev = await tx.projectChangeOrder.findFirstOrThrow({
          where: { id: d.changeId, projectId },
        });
        if (
          prev.status !== "DRAFT" ||
          (await tx.projectChangeOrder.count({
            where: { replacesId: prev.id },
          }))
        )
          throw new Error("CHANGE_FROZEN");
        const { changeId, ...fields } = d;
        await tx.projectChangeOrder.update({
          where: { id: changeId },
          data: { status: "REJECTED" },
        });
        result = await tx.projectChangeOrder.create({
          data: {
            projectId,
            ...fields,
            replacesId: changeId,
            version: prev.version + 1,
            financialReviewed: true,
            createdById: u.id,
          },
        });
      } else if (operation === "change-create") {
        await authorized(tx, u, projectId, true, true);
        const d = z
          .object({
            title: text,
            reason: text,
            scope: text,
            priceDelta: signedMoney,
            costDelta: signedMoney,
            scheduleDays: z.number().int().min(-365).max(365),
            requestKey: id,
          })
          .parse(input);
        const existing = await tx.projectChangeOrder.findUnique({
          where: {
            projectId_requestKey: { projectId, requestKey: d.requestKey },
          },
        });
        if (existing) return existing;
        result = await tx.projectChangeOrder.create({
          data: { projectId, ...d, financialReviewed: true, createdById: u.id },
        });
      } else if (
        operation === "change-approve" ||
        operation === "change-apply" ||
        operation === "change-reject"
      ) {
        if (u.role !== "OWNER") throw new Error("ACCESS_DENIED");
        const d = z
          .object({
            changeId: id,
            version: z.number().int().positive(),
            reason: text,
          })
          .parse(input);
        const change = await tx.projectChangeOrder.findFirstOrThrow({
          where: { id: d.changeId, projectId },
        });
        if (change.version !== d.version) throw new Error("STALE_VERSION");
        if (operation !== "change-reject" && !change.financialReviewed)
          throw new Error("CHANGE_FINANCIAL_REVIEW_REQUIRED");
        if (operation === "change-apply") {
          if (change.appliedAt) return change;
          if (
            change.status !== "APPROVED" ||
            change.approvedVersion !== change.version
          )
            throw new Error("APPROVAL_REQUIRED");
          result = await tx.projectChangeOrder.update({
            where: { id: change.id },
            data: { status: "APPLIED", appliedAt: new Date() },
          });
          await tx.project.update({
            where: { id: projectId },
            data: {
              ...(p.estimatedCompletionDate
                ? {
                    estimatedCompletionDate: new Date(
                      p.estimatedCompletionDate.getTime() +
                        change.scheduleDays * 86400000,
                    ),
                  }
                : {}),
              costsReviewedAt: null,
              costsReviewedById: null,
            },
          });
        } else {
          if (change.status !== "DRAFT") throw new Error("CHANGE_FROZEN");
          const applied = await tx.projectChangeOrder.findMany({
            where: { projectId, status: "APPLIED" },
          });
          if (
            p.contractValue
              .add(
                applied.reduce(
                  (a, c) => a.add(c.priceDelta),
                  new Prisma.Decimal(0),
                ),
              )
              .add(change.priceDelta)
              .isNegative() ||
            p.estimatedCost
              .add(
                applied.reduce(
                  (a, c) => a.add(c.costDelta),
                  new Prisma.Decimal(0),
                ),
              )
              .add(change.costDelta)
              .isNegative()
          )
            throw new Error("NEGATIVE_REVISED_BUDGET");
          result = await tx.projectChangeOrder.update({
            where: { id: change.id },
            data: {
              status: operation === "change-approve" ? "APPROVED" : "REJECTED",
              approvedById: operation === "change-approve" ? u.id : null,
              approvedVersion:
                operation === "change-approve" ? change.version : null,
              approvedAt: operation === "change-approve" ? new Date() : null,
            },
          });
        }
      } else if (operation === "inspection") {
        const d = z.object({ title: text, required: z.boolean() }).parse(input);
        result = await tx.projectInspection.create({
          data: { projectId, ...d },
        });
      } else if (operation === "inspection-review") {
        const d = z
          .object({
            inspectionId: id,
            status: z.enum(["APPROVED", "FAILED"]),
            notes: text,
          })
          .parse(input);
        const inspection = await tx.projectInspection.findFirstOrThrow({
          where: { id: d.inspectionId, projectId },
        });
        if (
          !(await tx.projectEvidence.count({
            where: { projectId, inspectionId: inspection.id },
          }))
        )
          throw new Error("COMPLETION_EVIDENCE_REQUIRED");
        result = await tx.projectInspection.update({
          where: { id: inspection.id },
          data: {
            status: d.status,
            notes: d.notes,
            reviewedById: u.id,
            reviewedAt: new Date(),
          },
        });
      } else if (operation === "defect") {
        const d = z.object({ title: text, blocking: z.boolean() }).parse(input);
        result = await tx.projectDefect.create({ data: { projectId, ...d } });
      } else if (operation === "defect-resolve") {
        const d = z.object({ defectId: id, resolution: text }).parse(input);
        const defect = await tx.projectDefect.findFirstOrThrow({
          where: { id: d.defectId, projectId },
        });
        result = await tx.projectDefect.update({
          where: { id: defect.id },
          data: {
            resolvedAt: new Date(),
            resolvedById: u.id,
            resolution: d.resolution,
          },
        });
      } else throw new Error("INVALID_OPERATION");
      await event(
        tx,
        u,
        projectId,
        "PROJECT_" + operation.toUpperCase().replaceAll("-", "_"),
        { input },
      );
      return result;
    },
    { isolationLevel: "Serializable", timeout: 15000 },
  );
}
export async function saveTemplate(
  u: User,
  name: string,
  definition: unknown,
  onlyIfMissing = false,
) {
  if (!u.active || !["OWNER", "ADMIN"].includes(u.role))
    throw new Error("ACCESS_DENIED");
  const data = templateDefinition.parse(definition);
  text.parse(name);
  return db.$transaction(async (tx) => {
    const current = await tx.user.findUniqueOrThrow({ where: { id: u.id } });
    if (!current.active || current.role !== u.role)
      throw new Error("ACCESS_DENIED");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"operations-template:" + name}))`;
    const old = await tx.operationsTemplate.findFirst({
      where: { name },
      orderBy: { version: "desc" },
    });
    if (onlyIfMissing && old) return old;
    await tx.operationsTemplate.updateMany({
      where: { name },
      data: { active: false },
    });
    const t = await tx.operationsTemplate.create({
      data: { name, version: (old?.version ?? 0) + 1, definition: json(data) },
    });
    await tx.activity.create({
      data: {
        type: "PROJECT_TEMPLATE_VERSION_CREATED",
        message: "Execution template saved",
        actorId: u.id,
        metadata: json({ templateId: t.id, version: t.version, name }),
      },
    });
    return t;
  });
}
export async function initializeTemplates(u: User) {
  for (const t of templates)
    if (!(await db.operationsTemplate.count({ where: { name: t.name } })))
      await saveTemplate(u, t.name, { stages: t.stages }, true);
}
