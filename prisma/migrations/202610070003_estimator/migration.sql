BEGIN;
-- AlterTable
ALTER TABLE "ServiceItem" ADD COLUMN     "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "effectiveTo" TIMESTAMP(3),
ADD COLUMN     "otherDirectCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "targetMargin" DECIMAL(7,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Estimate" ADD COLUMN     "acceptanceReference" TEXT,
ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "allocatedOverhead" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "approvalReasons" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "businessSnapshot" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'General Remodeling',
ADD COLUMN     "contentVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "contributionProfit" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "creatorId" TEXT,
ADD COLUMN     "customerSnapshot" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discountRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
ADD COLUMN     "durationDays" INTEGER,
ADD COLUMN     "exclusions" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "inclusions" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "number" TEXT,
ADD COLUMN     "paymentSchedule" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "projectAddress" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "scope" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "seriesId" TEXT NOT NULL,
ADD COLUMN     "significantDiscountThreshold" DECIMAL(7,4) NOT NULL DEFAULT 0,
ADD COLUMN     "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
ADD COLUMN     "taxTreatment" TEXT NOT NULL DEFAULT 'UNREVIEWED',
ADD COLUMN     "totalInvestment" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "EstimateLineItem" ADD COLUMN     "allocatedOverhead" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "calculatedUnitPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "otherDirectCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "targetMargin" DECIMAL(7,4) NOT NULL DEFAULT 0,
ADD COLUMN     "taxable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totalCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "unitCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "unitPrice" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CatalogPriceHistory" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serviceItemId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "CatalogPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateApproval" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estimateId" TEXT NOT NULL,
    "contentVersion" INTEGER NOT NULL,
    "requesterId" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "rationale" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "EstimateApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateTemplate" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "developmentOnly" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "EstimateTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimatorSettings" (
    "id" TEXT NOT NULL DEFAULT 'company',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyName" TEXT NOT NULL DEFAULT 'Flipas Home Remodeling',
    "contactInfo" TEXT NOT NULL DEFAULT '',
    "brandingColor" TEXT NOT NULL DEFAULT '#172b30',
    "terms" TEXT NOT NULL DEFAULT '',
    "significantDiscountThreshold" DECIMAL(7,4) NOT NULL DEFAULT 0,

    CONSTRAINT "EstimatorSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateCounter" (
    "id" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EstimateCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogPriceHistory_serviceItemId_createdAt_idx" ON "CatalogPriceHistory"("serviceItemId", "createdAt");

-- CreateIndex
CREATE INDEX "EstimateApproval_estimateId_status_idx" ON "EstimateApproval"("estimateId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EstimateTemplate_name_key" ON "EstimateTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Estimate_number_key" ON "Estimate"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Estimate_seriesId_revision_key" ON "Estimate"("seriesId", "revision");

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogPriceHistory" ADD CONSTRAINT "CatalogPriceHistory_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "ServiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogPriceHistory" ADD CONSTRAINT "CatalogPriceHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateApproval" ADD CONSTRAINT "EstimateApproval_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateApproval" ADD CONSTRAINT "EstimateApproval_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve existing catalog values while deriving a margin for the new engine.
UPDATE "ServiceItem" SET "targetMargin" = GREATEST("minimumMargin", "defaultMarkup" / (1 + "defaultMarkup"));
ALTER TABLE "ServiceItem" ADD CONSTRAINT "ServiceItem_target_margin_bounds" CHECK ("targetMargin" >= "minimumMargin" AND "targetMargin" < 1 AND "otherDirectCost" >= 0 AND ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"));
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_estimator_bounds" CHECK ("discountRate" BETWEEN 0 AND 1 AND "taxRate" BETWEEN 0 AND 1 AND "revision" > 0 AND "contentVersion" >= 0 AND "taxTreatment" IN ('UNREVIEWED','EXEMPT','TAXABLE')) NOT VALID;
CREATE FUNCTION guard_estimate_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Non-draft estimates are immutable'; END IF;
  RETURN OLD;
 END IF;
 IF OLD.status <> 'DRAFT' THEN
  IF (to_jsonb(NEW) - ARRAY['status','updatedAt','acceptedAt','acceptanceReference']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','updatedAt','acceptedAt','acceptanceReference']) THEN RAISE EXCEPTION 'Non-draft content is immutable'; END IF;
  IF (NEW."acceptedAt",NEW."acceptanceReference") IS DISTINCT FROM (OLD."acceptedAt",OLD."acceptanceReference") AND NOT (OLD.status='SENT' AND NEW.status='ACCEPTED') THEN RAISE EXCEPTION 'Acceptance metadata is immutable'; END IF;
 END IF;
 IF NEW.status <> OLD.status AND NOT ((OLD.status='DRAFT' AND NEW.status='REVIEW') OR (OLD.status='REVIEW' AND NEW.status IN ('DRAFT','APPROVED')) OR (OLD.status='APPROVED' AND NEW.status='SENT') OR (OLD.status='SENT' AND NEW.status='ACCEPTED')) THEN RAISE EXCEPTION 'Invalid estimate status transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER estimate_content_guard BEFORE UPDATE OR DELETE ON "Estimate" FOR EACH ROW EXECUTE FUNCTION guard_estimate_content();
CREATE FUNCTION guard_estimate_section() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
 IF TG_OP <> 'INSERT' THEN
  SELECT status INTO parent_status FROM "Estimate" WHERE id=OLD."estimateId";
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Non-draft sections are immutable'; END IF;
 END IF;
 IF TG_OP <> 'DELETE' THEN
  SELECT status INTO parent_status FROM "Estimate" WHERE id=NEW."estimateId";
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Non-draft sections are immutable'; END IF;
  RETURN NEW;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER estimate_section_guard BEFORE INSERT OR UPDATE OR DELETE ON "EstimateSection" FOR EACH ROW EXECUTE FUNCTION guard_estimate_section();
CREATE FUNCTION guard_estimate_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
 IF TG_OP <> 'INSERT' THEN
  SELECT e.status INTO parent_status FROM "Estimate" e JOIN "EstimateSection" s ON s."estimateId"=e.id WHERE s.id=OLD."sectionId";
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Non-draft lines are immutable'; END IF;
 END IF;
 IF TG_OP <> 'DELETE' THEN
  SELECT e.status INTO parent_status FROM "Estimate" e JOIN "EstimateSection" s ON s."estimateId"=e.id WHERE s.id=NEW."sectionId";
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Non-draft lines are immutable'; END IF;
  RETURN NEW;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER estimate_line_guard BEFORE INSERT OR UPDATE OR DELETE ON "EstimateLineItem" FOR EACH ROW EXECUTE FUNCTION guard_estimate_line();

COMMIT;
