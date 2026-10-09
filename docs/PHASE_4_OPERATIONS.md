# Phase 4 — Project Management & Field Operations

Implementation starts from integrated main `51c9824`. Branch: `feature/phase-4-project-operations`. No main merge, public deployment, email dispatch, credential change or financial-policy change is part of this delivery.

## Modules and access

- `/projects`: assigned project cards, legacy state compatibility, delays.
- `/projects/[id]`: approved estimate scope and original links, dates and manager, stage calendar/list, task dependencies, progress and completion evidence, crew roster/hours, materials, immutable daily log revisions, inspections/defects and immutable activity history.
- `/projects/templates`: OWNER/ADMIN editable, versioned Kitchen Remodeling, Bathroom Remodeling and LVP Flooring execution templates. Applying a template copies stages/tasks/required checklists into a project and freezes its template snapshot. Project tasks and stage dates remain customizable. Initialize missing templates explicitly; initialization adds no financial prices or external communications.
- `/owner/operations`: active/delayed projects, critical tasks, crew assignments, pending materials/change orders and recorded cost overruns.
- OWNER/ADMIN restricted project finance: original baseline, separately approved/applied change orders, commitments, actual labor/material/subcontractor/other ledger entries, purchase approval/order/delivery states. PROJECT_MANAGER can submit scope-only requests; financial review in a new version is required before OWNER approval. OWNER alone approves/applies change orders and certifies complete cost reconciliation.
- OWNER profitability now includes the operations actual-cost ledger and applied changes, while retaining the accepted estimate overhead snapshot.

Authorization is rechecked against current active users for every service mutation and evidence read/write. OWNER/ADMIN see all projects; PROJECT_MANAGER sees managed or assigned projects; CREW sees assigned projects and only their assigned tasks/time entries; SALES sees owned opportunity projects read-only. PM/CREW/SALES receive no finance DTO, cost amounts, purchase prices, change-order finances or financial audit payloads. Shared CRM activity contains only a project reference; detailed financial inputs remain in the restricted operations audit. CUSTOMER has no operational access. Removing assignment immediately revokes access and unassigns tasks.

## Migration and compatibility

New incremental migration: `202610090001_project_operations`. Adds fields/tables, three new lifecycle enum values, project foreign keys, checks, uniqueness and append-only/frozen-history triggers. Existing migrations are unchanged. Existing records are not deleted, repriced or relinked.

Legacy `PRE_CONSTRUCTION`/`MATERIAL_ORDERING` display as PLANNING; `PUNCH_LIST` displays as QUALITY_REVIEW. Persisted old states remain intact until an authorized transition. New handoffs preserve original scope/address as well as existing financial baseline. Accepted estimate/WON opportunity handoff retains its unique opportunity key and idempotent behavior.

Lifecycle: PLANNING → SCHEDULED → IN_PROGRESS → QUALITY_REVIEW → COMPLETED, with explicit hold/resume/cancellation paths. No reopening of completed/cancelled projects. Closure requires at least one required approved inspection, no blocking unresolved defects and no incomplete required checklists. OWNER can authorize an exception with at least 20 characters of justification; the exception and transition are separately audited. Normal inspection approval and task completion require linked photo evidence. Task completion also requires a completion note and finished prerequisites/checklists.

## Cost semantics

Original contract, estimated direct cost, gross profit and estimate/customer/opportunity links cannot be overwritten. Applied approved changes are summed separately; no original estimate is silently changed. Change orders use immutable content revisions, exact version approval and separate application. Draft revision supersedes the old draft, clears approval and increments version. Finalized versions are immutable. Negative resulting contract/direct-cost budgets are rejected.

Commitments = approved/ordered/delivered purchase totals + manually recorded commitments. Actual costs = preserved legacy `Project.actualCost` + new ACTUAL entries. A purchase is not automatically an actual invoice. An actual invoice needs its own unique source reference. Do not record an existing PO twice as a manual commitment; the service rejects a PO ID used as another manual commitment. The same invoice/reference and kind cannot be recorded twice. Commitments and actuals are separate measures, not amounts to add together. Delivered quantities can be partial; receiving a purchase twice is blocked.

Cost reconciliation is an explicit OWNER attestation after operational completion. New actual costs invalidate it. Until attested, actual profitability is unavailable. The reconciled result is **recorded project contribution**, not company net profit; taxes, company overhead and unrecorded costs must not be inferred. Accepted-estimate overhead remains separately visible, not recalculated using current policies. Hours do not imply a labor rate; only authorized financial users record actual labor cost.

Ledger/time/evidence entries are append-only. This release does not support voiding incorrect invoices/hours or reopening closed jobs; those need a separately reviewed correction workflow rather than silently editing history. Daily logs support appended corrected versions. Purchase and manual commitments require OWNER reconciliation to avoid duplicate business references under different IDs.

## Evidence persistence and backup

Images only: JPEG, PNG, WebP. Each original and normalized image ≤5 MiB, decoded image ≤20 million pixels, no animated images. Actual bytes/signatures are checked, images decoded/re-encoded with Sharp, metadata including EXIF/GPS removed, filenames sanitized. SVG, HTML, PDF and malformed image payloads rejected. Upload request limit 6 MiB; project quota 100 MiB; total company quota 500 MiB. Quota checks are transactional and serialized. Duplicate normalized image/target/uploader returns existing evidence.

PostgreSQL bytea stores normalized content durably. Access-controlled attachment download sets private/no-store, nosniff and restrictive CSP. Upload verifies authenticated session, same-origin request and project/target authorization. An evidence record references exactly one task, log or inspection in the same project. `EvidenceStore` is the persistence boundary for a future object-store adapter; no ephemeral filesystem is used. An object-storage migration must copy/verify hashes, retain authorization, secure bucket policy and migrate references before removing DB bytes.

Back up the **whole PostgreSQL database**, including bytea evidence. Keep encrypted/off-device backups and test restores to a separate database. Retain the private `.env`/mail-encryption key securely and separately; losing that key makes existing OAuth ciphertext unreadable. Never commit backups or `.env` files. Suggested policy: daily backup, 30-day retention and a monthly restore drill; no backup scheduler was activated automatically. Quotas are intentionally conservative until an object-store migration is reviewed. No automatic evidence deletion/retention job is installed.

## Local Mac update (preserve private config/data)

Stop Next.js and the AI worker with Ctrl+C, keep Docker/PostgreSQL running. Check Emergency Pause remains active in OWNER Console before stopping. Do not enable `ZOHO_SEND_ENABLED`.

```bash
cd ~/Projects/flipas-os-
git status --short
```

If this shows user changes, stop and save them safely before switching branches. Back up the current DB before applying the new migration:

```bash
mkdir -p ~/FLIPAS-backups
chmod 700 ~/FLIPAS-backups
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > ~/FLIPAS-backups/before-phase-4.sql
chmod 600 ~/FLIPAS-backups/before-phase-4.sql
```

Check the backup exists and has nonzero size; do not paste its contents into chat. This uses the existing Docker database configuration and does not change passwords. Keep your existing private `.env` unchanged and backed up securely.

```bash
git fetch origin
git switch --track origin/feature/phase-4-project-operations
npm ci
npm run db:generate
npm run db:migrate
npm run dev
```

If the branch already exists locally: `git switch feature/phase-4-project-operations` then `git pull --ff-only`. Never run reset, database reset or `docker compose down -v` for this update. No new `.env` variable is required for Phase 4. Existing worker configuration and email/AI controls are unchanged. In another terminal restart the existing worker with `npm run worker:ai` if desired; no operations notifications are sent.

Open `http://localhost:3000/projects`. As OWNER initialize the execution templates at `/projects/templates`, open/create a project through the accepted-estimate/WON handoff, set manager/crew, apply a template, customize dates/tasks, upload evidence, record hours, enter actual costs, approve a change order and inspect quality gates. Sign in with separate PROJECT_MANAGER/CREW accounts to verify assignment and financial isolation. OWNER dashboard: `http://localhost:3000/owner/operations`.

## Repeatable tests

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run test:operations:local
```

`test:operations:local` creates, migrates and removes a separate `*_test` DB using the existing local Docker PostgreSQL service; it never resets the application DB. Direct integration commands reject a DB whose name does not end `_test`. Production HTTP checks use `test:operations:http` with a disposable DB containing fixtures and a separately running production server (`SMOKE_BASE_URL`). Do not point those tests at your application database.

Security coverage includes role/assignment revocation, financial DTO filtering, append-only records/baselines, task/checklist/dependency gates, evidence validation/access, duplicate requests, concurrent costs, immutable template snapshots, change-order revision/exact approval/application and closure exception/normal gates. Prior phase suites cover authentication, CRM, estimates/PDF, OWNER policies, OpenAI budgets, OAuth, emergency pause, delivery idempotence and loop protection with provider mocks. No real OpenAI/Zoho operation is required.

## Remaining operational considerations

- Human visual acceptance on real Mac/mobile devices is still required; automated HTTP checks do not certify usability on every device.
- Configure and test backup retention externally; this delivery defines the strategy but does not start cloud backup services.
- Object storage, invoice/hour correction, paging beyond current caps and full resource-capacity scheduling remain future work. Current caps: 200 project cards, 300 tasks, 100 recent logs/time/events, 200 evidence metadata rows per workspace; old immutable records stay in DB.
- Node PostgreSQL adapter emits an existing concurrent-query deprecation warning; current tests pass, but evaluate before adopting pg 9.
- npm audit: 6 high development-tool findings share a `braces` stack-exhaustion advisory; the registry's latest `braces` is still 3.0.3 and has no patched version. Runtime audit: 0 findings. No forced Next/Prisma downgrade/update was applied. Avoid untrusted glob patterns in tooling; monitor the upstream patch.
