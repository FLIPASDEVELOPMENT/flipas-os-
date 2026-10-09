import { db } from "@/server/db";
import { Prisma, type User } from "@/generated/prisma/client";
import { authorized, projectScope } from "./service";
import { canonicalState, financialRoles, overdue } from "../domain/rules";
export async function projectList(u: User) {
  if (
    !u.active ||
    !["OWNER", "ADMIN", "PROJECT_MANAGER", "CREW", "SALES"].includes(u.role)
  )
    throw new Error("ACCESS_DENIED");
  const rows = await db.project.findMany({
    where: projectScope(u),
    select: {
      id: true,
      status: true,
      startDate: true,
      estimatedCompletionDate: true,
      actualCompletionDate: true,
      projectAddress: true,
      customer: { select: { firstName: true, lastName: true } },
      projectManager: { select: { name: true } },
      _count: { select: { tasks: true } },
      tasks: {
        select: {
          id: true,
          progress: true,
          completedAt: true,
          dueAt: true,
          title: true,
          assigneeId: true,
        },
        ...(u.role === "CREW" ? { where: { assigneeId: u.id } } : {}),
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const assignees = await db.user.findMany({
    where: { id: { in: [...new Set(rows.flatMap((p) => p.tasks.map((t) => t.assigneeId).filter((id): id is string => !!id)))] } },
    select: { id: true, name: true },
  });
  return rows.map((p) => ({
    ...p,
    progress: p.tasks.length
      ? Math.round(p.tasks.reduce((n, t) => n + t.progress, 0) / p.tasks.length)
      : 0,
    nextTasks: p.tasks
      .filter((t) => !t.completedAt)
      .sort(
        (a, b) =>
          (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity),
      )
      .slice(0, 3)
      .map((t) => ({ ...t, assigneeName: assignees.find((a) => a.id === t.assigneeId)?.name })),
    state: canonicalState(p.status),
    delayed:
      overdue(p.estimatedCompletionDate, p.actualCompletionDate) &&
      !["COMPLETED", "CANCELLED"].includes(canonicalState(p.status)),
  }));
}
export async function workspace(u: User, projectId: string) {
  return db.$transaction(async (tx) => {
    const p = await authorized(tx, u, projectId);
    const finance = financialRoles.includes(u.role);
    const project = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        id: true,
        originalScopeSnapshot: true,
        status: true,
        operationsVersion: true,
        projectAddress: true,
        startDate: true,
        estimatedCompletionDate: true,
        actualCompletionDate: true,
        projectManagerId: true,
        customer: { select: { firstName: true, lastName: true } },
        opportunity: { select: { id: true, stage: true } },
        estimate: {
          select: {
            id: true,
            number: true,
            scope: true,
            projectAddress: true,
            category: true,
            inclusions: true,
            exclusions: true,
          },
        },
        templateVersionSnapshot: true,
      },
    });
    const [
      stages,
      tasks,
      members,
      checklists,
      time,
      logs,
      materials,
      inspections,
      defects,
      evidence,
      events,
    ] = await Promise.all([
      tx.projectStage.findMany({
        where: { projectId },
        orderBy: { position: "asc" },
      }),
      tx.projectTask.findMany({
        where: {
          projectId,
          ...(u.role === "CREW" ? { assigneeId: u.id } : {}),
        },
        orderBy: { dueAt: "asc" },
        take: 300,
      }),
      tx.projectMember.findMany({ where: { projectId } }),
      tx.projectChecklist.findMany({ where: { projectId } }),
      tx.projectTimeEntry.findMany({
        where: { projectId, ...(u.role === "CREW" ? { workerId: u.id } : {}) },
        orderBy: { workDate: "desc" },
        take: 100,
      }),
      tx.projectDailyLog.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      tx.projectMaterial.findMany({ where: { projectId } }),
      tx.projectInspection.findMany({ where: { projectId } }),
      tx.projectDefect.findMany({ where: { projectId } }),
      tx.projectEvidence.findMany({
        where: { projectId },
        select: {
          id: true,
          fileName: true,
          byteSize: true,
          taskId: true,
          logId: true,
          inspectionId: true,
          createdAt: true,
        },
        take: 200,
      }),
      tx.projectEvent.findMany({
        where: { projectId },
        select: { id: true, type: true, actorId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    const dependencies = await tx.taskDependency.findMany({
      where: { projectId },
      select: { taskId: true, prerequisiteId: true },
    });
    const allTasks = await tx.projectTask.findMany({
      where: { projectId },
      select: {
        id: true,
        stageId: true,
        assigneeId: true,
        progress: true,
        completedAt: true,
        dueAt: true,
      },
    });
    const visible =
      u.role === "CREW"
        ? allTasks.filter((t) => t.assigneeId === u.id)
        : allTasks;
    const visibleStages =
      u.role === "CREW"
        ? stages.filter((s) => visible.some((t) => t.stageId === s.id))
        : stages;
    const summary = {
      taskCount: visible.length,
      completedTasks: visible.filter((t) => t.completedAt).length,
      progress: visible.length
        ? Math.round(
            visible.reduce((sum, t) => sum + t.progress, 0) / visible.length,
          )
        : 0,
      stageCount: visibleStages.length,
      completedStages: visibleStages.filter((s) => {
        const items = allTasks.filter((t) => t.stageId === s.id);
        return !!items.length && items.every((t) => t.completedAt);
      }).length,
      overdueTasks: visible.filter((t) => overdue(t.dueAt, t.completedAt))
        .length,
      pendingMaterials: materials.filter((m) =>
        m.receivedQuantity.lessThan(m.quantity),
      ).length,
      pendingInspections: inspections.filter(
        (i) => i.required && i.status !== "APPROVED",
      ).length,
      blockingDefects: defects.filter((d) => d.blocking && !d.resolvedAt)
        .length,
    };
    const progressEvents = await tx.projectEvent.findMany({
      where: { projectId, type: "PROJECT_TASK_PROGRESS" },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { actorId: true, createdAt: true, metadata: true },
    });
    const recorders = await tx.user.findMany({
      where: { id: { in: progressEvents.map((e) => e.actorId) } },
      select: { id: true, name: true },
    });
    const taskHistory: Record<
      string,
      {
        actorName: string;
        at: Date;
        entries: {
          actorName: string;
          at: Date;
          note: string;
          progress: number;
        }[];
      }
    > = {};
    for (const e of progressEvents) {
      const input = (
        e.metadata as {
          input?: { taskId?: string; note?: string; progress?: number };
        }
      )?.input;
      if (!input?.taskId || !visible.some((t) => t.id === input.taskId))
        continue;
      const actorName =
        recorders.find((u) => u.id === e.actorId)?.name ?? "Former user";
      taskHistory[input.taskId] ??= { actorName, at: e.createdAt, entries: [] };
      taskHistory[input.taskId].entries.push({
        actorName,
        at: e.createdAt,
        note: typeof input.note === "string" ? input.note.slice(0, 2000) : "",
        progress: typeof input.progress === "number" ? input.progress : 0,
      });
    }
    const requestedChanges = await tx.projectChangeOrder.findMany({
      where: { projectId },
      select: {
        id: true,
        title: true,
        scope: true,
        scheduleDays: true,
        status: true,
        version: true,
      },
      take: 100,
    });
    const users = await tx.user.findMany({
      where: {
        active: true,
        ...(members.length
          ? {
              id: {
                in: [...members.map((m) => m.userId), p.projectManagerId ?? ""],
              },
            }
          : { id: p.projectManagerId ?? "" }),
      },
      select: { id: true, name: true, role: true },
    });
    let financial = null;
    if (finance) {
      const [costs, changes, purchases] = await Promise.all([
        tx.projectCostEntry.findMany({
          where: { projectId },
          orderBy: { createdAt: "desc" },
        }),
        tx.projectChangeOrder.findMany({
          where: { projectId },
          orderBy: { createdAt: "desc" },
        }),
        tx.projectPurchase.findMany({ where: { projectId } }),
      ]);
      const applied = changes.filter((c) => c.status === "APPLIED");
      const sum = (values: Prisma.Decimal[]) =>
        values.reduce((a, b) => a.add(b), new Prisma.Decimal(0));
      const approvedRevenue = sum(applied.map((c) => c.priceDelta)),
        approvedCost = sum(applied.map((c) => c.costDelta));
      const actual = p.actualCost.add(
        sum(costs.filter((c) => c.kind === "ACTUAL").map((c) => c.amount)),
      );
      const committed = sum(
        costs.filter((c) => c.kind === "COMMITTED").map((c) => c.amount),
      ).add(
        sum(
          purchases
            .filter((x) =>
              ["APPROVED", "ORDERED", "DELIVERED"].includes(x.status),
            )
            .map((x) => x.quantity.mul(x.unitCost)),
        ),
      );
      financial = {
        originalRevenue: p.contractValue.toFixed(2),
        originalEstimatedCost: p.estimatedCost.toFixed(2),
        approvedRevenue: approvedRevenue.toFixed(2),
        approvedCost: approvedCost.toFixed(2),
        actual: actual.toFixed(2),
        committed: committed.toFixed(2),
        profit:
          p.costsReviewedAt && p.actualCompletionDate
            ? p.contractValue.add(approvedRevenue).sub(actual).toFixed(2)
            : null,
        costsReviewedAt: p.costsReviewedAt,
        costs: costs.map((c) => ({ ...c, amount: c.amount.toFixed(2) })),
        changes: changes.map((c) => ({
          ...c,
          priceDelta: c.priceDelta.toFixed(2),
          costDelta: c.costDelta.toFixed(2),
        })),
        purchases: purchases.map((x) => ({
          ...x,
          quantity: x.quantity.toString(),
          unitCost: x.unitCost.toFixed(2),
        })),
      };
    }
    return {
      project: {
        ...project,
        originalScopeSnapshot: {
          scope:
            typeof (project.originalScopeSnapshot as { scope?: unknown })
              ?.scope === "string"
              ? (project.originalScopeSnapshot as { scope: string }).scope
              : "",
        },
        state: canonicalState(project.status),
      },
      stages,
      tasks,
      members,
      users,
      checklists,
      time,
      logs,
      materials: materials.map((m) => ({
        ...m,
        quantity: m.quantity.toString(),
        receivedQuantity: m.receivedQuantity.toString(),
      })),
      inspections,
      defects,
      evidence,
      events,
      summary,
      dependencies,
      taskHistory,
      requestedChanges,
      financial,
    };
  });
}
