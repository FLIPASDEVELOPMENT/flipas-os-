-- Additive codebook: never alter original project IDs, snapshots or applied migrations.
CREATE SEQUENCE "project_code_number" AS bigint START 1 NO CYCLE;
CREATE TABLE "ProjectIdentity" (
 "projectId" text PRIMARY KEY REFERENCES "Project"(id) ON DELETE RESTRICT,
 "number" bigint NOT NULL UNIQUE DEFAULT nextval('"project_code_number"'),
 code text NOT NULL UNIQUE CHECK(code='F'||CASE WHEN "number"<1000 THEN lpad("number"::text,3,'0') ELSE "number"::text END), name text NOT NULL,
 CHECK("number">0),
 "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION project_code_create() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n bigint; label text;
BEGIN
 n := nextval('"project_code_number"');
 SELECT c."firstName" || ' ' || c."lastName" || ' · ' || e.category INTO label
 FROM "Customer" c JOIN "Estimate" e ON e.id=NEW."estimateId" WHERE c.id=NEW."customerId";
 INSERT INTO "ProjectIdentity"("projectId","number",code,name)
 VALUES(NEW.id,n,'F'||CASE WHEN n<1000 THEN lpad(n::text,3,'0') ELSE n::text END,coalesce(label,'Project'));
 RETURN NEW;
END $$;
CREATE TRIGGER project_code_insert AFTER INSERT ON "Project" FOR EACH ROW EXECUTE FUNCTION project_code_create();
-- Stable order for existing projects; sequence is global and does not reset by year.
DO $$ DECLARE legacy record; n bigint; BEGIN
 FOR legacy IN SELECT p.id,c."firstName"||' '||c."lastName"||' · '||e.category AS label
 FROM "Project" p JOIN "Customer" c ON c.id=p."customerId" JOIN "Estimate" e ON e.id=p."estimateId"
 ORDER BY p."createdAt",p.id LOOP
 n:=nextval('"project_code_number"');
 INSERT INTO "ProjectIdentity"("projectId","number",code,name) VALUES(legacy.id,n,'F'||CASE WHEN n<1000 THEN lpad(n::text,3,'0') ELSE n::text END,legacy.label);
 END LOOP;
END $$;
CREATE FUNCTION project_code_protect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Permanent project code'; END IF;
 IF NEW."projectId"<>OLD."projectId" OR NEW."number"<>OLD."number" OR NEW.code<>OLD.code OR NEW."createdAt"<>OLD."createdAt" THEN RAISE EXCEPTION 'Permanent project code'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_code_immutable BEFORE UPDATE OR DELETE ON "ProjectIdentity" FOR EACH ROW EXECUTE FUNCTION project_code_protect();
CREATE TABLE "ProjectAlias" (
 id text PRIMARY KEY,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "projectId" text NOT NULL REFERENCES "ProjectIdentity"("projectId") ON DELETE RESTRICT,
 alias text NOT NULL, normalized text NOT NULL,
 UNIQUE("projectId",normalized),
 "confirmedById" text NOT NULL REFERENCES "User"(id),reason text NOT NULL
);
CREATE TRIGGER project_alias_immutable BEFORE UPDATE OR DELETE ON "ProjectAlias" FOR EACH ROW EXECUTE FUNCTION operations_immutable();
CREATE TABLE "PurchaseSuggestion" (
 id text PRIMARY KEY,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"completedAt" timestamp(3),
 "purchaseId" text NOT NULL REFERENCES "ImportedPurchase"(id),"requestKey" text NOT NULL,
 "baseVersion" integer NOT NULL CHECK("baseVersion">=0),"createdById" text NOT NULL REFERENCES "User"(id),
 state text NOT NULL DEFAULT 'RUNNING' CHECK(state IN ('RUNNING','GENERATED','FAILED','STALE')),
 provider text NOT NULL DEFAULT 'RULES', model text NOT NULL DEFAULT 'purchase-classifier-v1',input jsonb NOT NULL,result jsonb,"errorCode" text,
 UNIQUE("purchaseId","requestKey")
);
CREATE INDEX "PurchaseSuggestion_purchaseId_createdAt_idx" ON "PurchaseSuggestion"("purchaseId","createdAt");
CREATE UNIQUE INDEX purchase_one_running ON "PurchaseSuggestion"("purchaseId") WHERE state='RUNNING';
CREATE FUNCTION purchase_suggestion_protect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Immutable suggestion'; END IF;
 IF OLD.state<>'RUNNING' OR NEW.state='RUNNING' OR NEW.id<>OLD.id OR NEW."purchaseId"<>OLD."purchaseId" OR NEW."requestKey"<>OLD."requestKey" OR NEW.input<>OLD.input OR NEW."baseVersion"<>OLD."baseVersion" OR NEW."createdById"<>OLD."createdById" OR NEW."createdAt"<>OLD."createdAt" THEN RAISE EXCEPTION 'Immutable suggestion'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER purchase_suggestion_immutable BEFORE UPDATE OR DELETE ON "PurchaseSuggestion" FOR EACH ROW EXECUTE FUNCTION purchase_suggestion_protect();
ALTER TABLE "PurchaseReview" ADD COLUMN "suggestionId" text REFERENCES "PurchaseSuggestion"(id);

CREATE TABLE "PurchaseSuggestionDecision" (
 id text PRIMARY KEY,"createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "suggestionId" text NOT NULL UNIQUE REFERENCES "PurchaseSuggestion"(id),
 "actorId" text NOT NULL REFERENCES "User"(id), reason text NOT NULL
);
CREATE TRIGGER purchase_decision_immutable BEFORE UPDATE OR DELETE ON "PurchaseSuggestionDecision" FOR EACH ROW EXECUTE FUNCTION operations_immutable();
