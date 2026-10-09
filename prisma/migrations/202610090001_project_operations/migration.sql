-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProjectStatus" ADD VALUE 'QUALITY_REVIEW';
ALTER TYPE "ProjectStatus" ADD VALUE 'ON_HOLD';
ALTER TYPE "ProjectStatus" ADD VALUE 'PLANNING';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "costsReviewedAt" TIMESTAMP(3),
ADD COLUMN     "costsReviewedById" TEXT,
ADD COLUMN     "operationsVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "originalScopeSnapshot" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "projectAddress" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "templateVersionSnapshot" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "ProjectTask" ADD COLUMN     "actualStart" TIMESTAMP(3),
ADD COLUMN     "assigneeId" TEXT,
ADD COLUMN     "completionNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "plannedStart" TIMESTAMP(3),
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stageId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'TODO',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectStage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "plannedStart" TIMESTAMP(3),
    "plannedEnd" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),

    CONSTRAINT "ProjectStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationsTemplate" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "definition" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "OperationsTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectChecklist" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "title" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,

    CONSTRAINT "ProjectChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "prerequisiteId" TEXT NOT NULL,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTimeEntry" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,

    CONSTRAINT "ProjectTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMaterial" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "supplier" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'NEEDED',
    "receivedQuantity" DECIMAL(14,4) NOT NULL DEFAULT 0,

    CONSTRAINT "ProjectMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPurchase" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "quantity" DECIMAL(14,4) NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL,
    "approvedById" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,

    CONSTRAINT "ProjectPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectCostEntry" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,

    CONSTRAINT "ProjectCostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDailyLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "summary" TEXT NOT NULL,
    "incidents" TEXT NOT NULL DEFAULT '',
    "workers" JSONB NOT NULL,
    "recordedById" TEXT NOT NULL,
    "replacesId" TEXT,
    "requestKey" TEXT NOT NULL,

    CONSTRAINT "ProjectDailyLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectEvidence" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "taskId" TEXT,
    "logId" TEXT,
    "inspectionId" TEXT,

    CONSTRAINT "ProjectEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectChangeOrder" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scope" TEXT NOT NULL,
    "priceDelta" DECIMAL(14,2) NOT NULL,
    "costDelta" DECIMAL(14,2) NOT NULL,
    "scheduleDays" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedVersion" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "requestKey" TEXT NOT NULL,

    CONSTRAINT "ProjectChangeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectInspection" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ProjectInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDefect" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ProjectDefect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "ProjectEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectMember_projectId_createdAt_idx" ON "ProjectMember"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE INDEX "ProjectStage_projectId_createdAt_idx" ON "ProjectStage"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OperationsTemplate_name_version_key" ON "OperationsTemplate"("name", "version");

-- CreateIndex
CREATE INDEX "ProjectChecklist_projectId_createdAt_idx" ON "ProjectChecklist"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskDependency_projectId_createdAt_idx" ON "TaskDependency"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDependency_taskId_prerequisiteId_key" ON "TaskDependency"("taskId", "prerequisiteId");

-- CreateIndex
CREATE INDEX "ProjectTimeEntry_projectId_createdAt_idx" ON "ProjectTimeEntry"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTimeEntry_projectId_requestKey_key" ON "ProjectTimeEntry"("projectId", "requestKey");

-- CreateIndex
CREATE INDEX "ProjectMaterial_projectId_createdAt_idx" ON "ProjectMaterial"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectPurchase_projectId_createdAt_idx" ON "ProjectPurchase"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPurchase_projectId_requestKey_key" ON "ProjectPurchase"("projectId", "requestKey");

-- CreateIndex
CREATE INDEX "ProjectCostEntry_projectId_createdAt_idx" ON "ProjectCostEntry"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCostEntry_projectId_requestKey_key" ON "ProjectCostEntry"("projectId", "requestKey");

-- CreateIndex
CREATE INDEX "ProjectDailyLog_projectId_createdAt_idx" ON "ProjectDailyLog"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDailyLog_projectId_requestKey_key" ON "ProjectDailyLog"("projectId", "requestKey");

-- CreateIndex
CREATE INDEX "ProjectEvidence_projectId_createdAt_idx" ON "ProjectEvidence"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectChangeOrder_projectId_createdAt_idx" ON "ProjectChangeOrder"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectChangeOrder_projectId_requestKey_key" ON "ProjectChangeOrder"("projectId", "requestKey");

-- CreateIndex
CREATE INDEX "ProjectInspection_projectId_createdAt_idx" ON "ProjectInspection"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectDefect_projectId_createdAt_idx" ON "ProjectDefect"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectEvent_projectId_createdAt_idx" ON "ProjectEvent"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectStage" ADD CONSTRAINT "ProjectStage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectChecklist" ADD CONSTRAINT "ProjectChecklist_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTimeEntry" ADD CONSTRAINT "ProjectTimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMaterial" ADD CONSTRAINT "ProjectMaterial_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPurchase" ADD CONSTRAINT "ProjectPurchase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCostEntry" ADD CONSTRAINT "ProjectCostEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDailyLog" ADD CONSTRAINT "ProjectDailyLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEvidence" ADD CONSTRAINT "ProjectEvidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectChangeOrder" ADD CONSTRAINT "ProjectChangeOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInspection" ADD CONSTRAINT "ProjectInspection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDefect" ADD CONSTRAINT "ProjectDefect_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEvent" ADD CONSTRAINT "ProjectEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectChangeOrder" ADD COLUMN "replacesId" TEXT UNIQUE REFERENCES "ProjectChangeOrder"("id");
CREATE UNIQUE INDEX "ProjectDailyLog_replacesId_unique" ON "ProjectDailyLog"("replacesId");
CREATE UNIQUE INDEX "ProjectCostEntry_source_unique" ON "ProjectCostEntry"("projectId","sourceReference","kind");
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_progress_check" CHECK ("progress" BETWEEN 0 AND 100);
ALTER TABLE "ProjectTimeEntry" ADD CONSTRAINT "ProjectTimeEntry_minutes_check" CHECK ("minutes" BETWEEN 1 AND 960);
ALTER TABLE "ProjectMaterial" ADD CONSTRAINT "ProjectMaterial_quantity_check" CHECK ("quantity">0 AND "receivedQuantity">=0);
ALTER TABLE "ProjectPurchase" ADD CONSTRAINT "ProjectPurchase_amount_check" CHECK ("quantity">0 AND "unitCost">=0);
ALTER TABLE "ProjectCostEntry" ADD CONSTRAINT "ProjectCostEntry_amount_check" CHECK ("amount">=0);
ALTER TABLE "ProjectEvidence" ADD CONSTRAINT "ProjectEvidence_size_check" CHECK ("byteSize">0 AND "byteSize"<=5242880 AND octet_length("data")="byteSize");
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_user_fk" FOREIGN KEY ("userId") REFERENCES "User"("id");
ALTER TABLE "ProjectTimeEntry" ADD CONSTRAINT "ProjectTimeEntry_worker_fk" FOREIGN KEY ("workerId") REFERENCES "User"("id");
CREATE UNIQUE INDEX "ProjectTask_id_project_unique" ON "ProjectTask"("id","projectId");
CREATE UNIQUE INDEX "ProjectStage_id_project_unique" ON "ProjectStage"("id","projectId");
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_stage_project_fk" FOREIGN KEY ("stageId","projectId") REFERENCES "ProjectStage"("id","projectId");
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_task_project_fk" FOREIGN KEY ("taskId","projectId") REFERENCES "ProjectTask"("id","projectId");
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_prerequisite_project_fk" FOREIGN KEY ("prerequisiteId","projectId") REFERENCES "ProjectTask"("id","projectId");
ALTER TABLE "ProjectChecklist" ADD CONSTRAINT "ProjectChecklist_task_project_fk" FOREIGN KEY ("taskId","projectId") REFERENCES "ProjectTask"("id","projectId");
CREATE FUNCTION operations_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Append-only operations record'; END $$;
CREATE TRIGGER operations_events_immutable BEFORE UPDATE OR DELETE ON "ProjectEvent" FOR EACH ROW EXECUTE FUNCTION operations_immutable();
CREATE TRIGGER operations_cost_immutable BEFORE UPDATE OR DELETE ON "ProjectCostEntry" FOR EACH ROW EXECUTE FUNCTION operations_immutable();
CREATE TRIGGER operations_logs_immutable BEFORE UPDATE OR DELETE ON "ProjectDailyLog" FOR EACH ROW EXECUTE FUNCTION operations_immutable();
CREATE TRIGGER operations_time_immutable BEFORE UPDATE OR DELETE ON "ProjectTimeEntry" FOR EACH ROW EXECUTE FUNCTION operations_immutable();
CREATE TRIGGER operations_evidence_immutable BEFORE UPDATE OR DELETE ON "ProjectEvidence" FOR EACH ROW EXECUTE FUNCTION operations_immutable();
CREATE FUNCTION operations_project_baseline() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."contractValue"<>OLD."contractValue" OR NEW."estimatedCost"<>OLD."estimatedCost" OR NEW."estimatedGrossProfit"<>OLD."estimatedGrossProfit" OR NEW."estimateId"<>OLD."estimateId" OR NEW."opportunityId"<>OLD."opportunityId" OR NEW."customerId"<>OLD."customerId" THEN RAISE EXCEPTION 'Original project baseline is immutable'; END IF;
 IF OLD."originalScopeSnapshot"<>'{}'::jsonb AND NEW."originalScopeSnapshot"<>OLD."originalScopeSnapshot" THEN RAISE EXCEPTION 'Original project snapshot is immutable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER operations_project_baseline BEFORE UPDATE ON "Project" FOR EACH ROW EXECUTE FUNCTION operations_project_baseline();
CREATE FUNCTION operations_change_frozen() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Change history cannot be deleted'; END IF;
 IF NEW."financialReviewed" IS DISTINCT FROM OLD."financialReviewed" OR NEW."title"<>OLD."title" OR NEW."reason"<>OLD."reason" OR NEW."createdById"<>OLD."createdById" OR NEW."projectId"<>OLD."projectId" OR NEW."replacesId" IS DISTINCT FROM OLD."replacesId" OR NEW."scope"<>OLD."scope" OR NEW."priceDelta"<>OLD."priceDelta" OR NEW."costDelta"<>OLD."costDelta" OR NEW."version"<>OLD."version" OR NEW."scheduleDays"<>OLD."scheduleDays" THEN RAISE EXCEPTION 'Create a change order revision'; END IF;
 IF OLD."status" IN ('APPLIED','REJECTED') THEN RAISE EXCEPTION 'Finalized change order is immutable'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER operations_change_frozen BEFORE UPDATE OR DELETE ON "ProjectChangeOrder" FOR EACH ROW EXECUTE FUNCTION operations_change_frozen();

CREATE UNIQUE INDEX "ProjectDailyLog_id_project_unique" ON "ProjectDailyLog"("id","projectId");
CREATE UNIQUE INDEX "ProjectInspection_id_project_unique" ON "ProjectInspection"("id","projectId");
CREATE UNIQUE INDEX "ProjectMaterial_id_project_unique" ON "ProjectMaterial"("id","projectId");
ALTER TABLE "ProjectPurchase" ADD CONSTRAINT "ProjectPurchase_material_project_fk" FOREIGN KEY ("materialId","projectId") REFERENCES "ProjectMaterial"("id","projectId");
ALTER TABLE "ProjectEvidence" ADD CONSTRAINT "ProjectEvidence_task_project_fk" FOREIGN KEY ("taskId","projectId") REFERENCES "ProjectTask"("id","projectId");
ALTER TABLE "ProjectEvidence" ADD CONSTRAINT "ProjectEvidence_log_project_fk" FOREIGN KEY ("logId","projectId") REFERENCES "ProjectDailyLog"("id","projectId");
ALTER TABLE "ProjectEvidence" ADD CONSTRAINT "ProjectEvidence_inspection_project_fk" FOREIGN KEY ("inspectionId","projectId") REFERENCES "ProjectInspection"("id","projectId");
ALTER TABLE "ProjectEvidence" ADD CONSTRAINT "ProjectEvidence_one_target" CHECK (num_nonnulls("taskId","logId","inspectionId")=1);
CREATE FUNCTION operations_template_frozen() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Template history cannot be deleted'; END IF;
 IF NEW."name"<>OLD."name" OR NEW."version"<>OLD."version" OR NEW."definition"<>OLD."definition" THEN RAISE EXCEPTION 'Create a template revision'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER operations_template_frozen BEFORE UPDATE OR DELETE ON "OperationsTemplate" FOR EACH ROW EXECUTE FUNCTION operations_template_frozen();

ALTER TABLE "ProjectChangeOrder" ADD COLUMN "financialReviewed" BOOLEAN NOT NULL DEFAULT false;
