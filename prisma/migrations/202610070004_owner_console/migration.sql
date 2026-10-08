BEGIN;
CREATE TABLE "FinancialPolicy" (
 "id" TEXT PRIMARY KEY, "version" INTEGER NOT NULL UNIQUE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdById" TEXT REFERENCES "User"("id"), "reason" TEXT NOT NULL,
 "monthlyProjectedRevenue" DECIMAL(14,2) NOT NULL,
 "monthlyFixedOverhead" DECIMAL(14,2) NOT NULL,
 "targetMargin" DECIMAL(7,4) NOT NULL,
 "minimumMargin" DECIMAL(7,4) NOT NULL,
 "significantDiscountThreshold" DECIMAL(7,4) NOT NULL,
 CHECK("version">0 AND "monthlyProjectedRevenue">0 AND "monthlyFixedOverhead">=0 AND "targetMargin">="minimumMargin" AND "minimumMargin">=0 AND "targetMargin"<1 AND "significantDiscountThreshold" BETWEEN 0 AND 1)
);
CREATE TABLE "FinancialPolicyHead"("id" TEXT PRIMARY KEY, "policyId" TEXT NOT NULL UNIQUE REFERENCES "FinancialPolicy"("id"));
ALTER TABLE "Estimate" ADD COLUMN "financialPolicySnapshot" JSONB NOT NULL DEFAULT '{}';
INSERT INTO "FinancialPolicy" VALUES ('owner-policy-initial',1,CURRENT_TIMESTAMP,NULL,'Initial values explicitly requested by business owner',30000,2000,0.35,0.20,0);
INSERT INTO "FinancialPolicyHead" VALUES ('company','owner-policy-initial');
INSERT INTO "Activity"("id","type","message","metadata") VALUES ('owner-policy-initial-audit','FINANCIAL_POLICY_INITIALIZED','Owner-requested financial policy initialized', '{"policyId":"owner-policy-initial","version":1,"monthlyProjectedRevenue":"30000","monthlyFixedOverhead":"2000","targetMargin":"0.35","minimumMargin":"0.20"}');
CREATE FUNCTION immutable_financial_policy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Financial policy versions are immutable'; END $$;
CREATE TRIGGER financial_policy_immutable BEFORE UPDATE OR DELETE ON "FinancialPolicy" FOR EACH ROW EXECUTE FUNCTION immutable_financial_policy();
COMMIT;
