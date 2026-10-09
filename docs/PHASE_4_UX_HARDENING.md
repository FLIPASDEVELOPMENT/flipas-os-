# Phase 4 UX and operational hardening

Branch: `feature/phase-4-project-operations`. No new dependencies, schema changes or migrations. Existing database records, accepted-estimate snapshots, credentials, mail controls and financial calculations remain unchanged.

## Findings and corrections

- Operations previously used a separate navigation layout and a long project form. Projects and templates now share the FLIPAS workspace shell. Project sections use compact navigation, pending submit states, sensitive-action confirmations and responsive cards.
- The accepted-estimate button checked status alone; the server used a generic relationship error. Eligibility now distinguishes missing opportunity, unavailable/mismatched identifier, different customer identifier and non-WON linked opportunity. Prices do not need to match. OWNER sees exact identifiers and may explicitly create a new DRAFT copy linked to an eligible same-customer WON opportunity without an existing project. The accepted source is untouched; the copy requires the complete approval/release/acceptance process. Existing project creation remains transactional and idempotent.
- **The exact Mac cause for F-2026-000002-R2 is not established:** that record is absent from the cloud database. Same-name records and screenshots cannot establish foreign-key identity. Inspect the new eligibility panel on the Mac before choosing a correction. Do not change records by matching names.
- Progress, completed stages, late tasks, pending materials/inspections, prerequisites and assignees come from database records. Task updates show recorder and history separately from assigned worker. Task-level supervisor approval is not recorded by the existing model; the interface says so and keeps project inspection approval separate.
- Calendar shows recorded/fallback stage start, due date, assignee, prerequisite count and lateness. Photo thumbnails use the existing authorized private evidence endpoint.
- Project financial services and DTOs are now OWNER-only, including denial to ADMIN, as requested. Original contract/cost baselines and approval calculations are unchanged. Recorded profit remains unavailable until cost reconciliation; it is not definitive company profit.
- Kitchen, Bathroom and LVP recommended procedures include preparation, checks, installation, photo evidence, inspection/punch list and handover criteria. Existing/custom templates are never overwritten. The editor explicitly loads recommendations into an unsaved form; saving creates a version. Previously generated tasks and snapshots are unchanged. Legacy template definitions remain valid.

## Validation

Automated tests use disposable PostgreSQL databases and simulated external providers; no real email or OpenAI request is needed. Unit coverage includes diagnostic states and template criteria bounds. Integration coverage includes explicit linked-copy approval guards, same-customer identity, duplicate project prevention, permission revocation, OWNER-only finance, real progress attribution and immutable template snapshots. Existing Phase 1–3 suites remain part of regression validation.

HTTP checks exercise OWNER, ADMIN, PROJECT_MANAGER and CREW pages, restricted financial content, private evidence upload/download and access rejection. Browser/mobile appearance still requires human review on the Mac; HTTP checks do not substitute for visual testing.

| Check | Result |
| --- | --- |
| Unit tests | PASS: 69 |
| Integration regressions | PASS: 53 (CRM 1, Estimator 1, OWNER 1, AI 18, Zoho read 1, commercial 7, OpenAI budget 1, delivery 11, operations 12) |
| HTTP | PASS: CRM, Estimator/PDF, OWNER, AI and operations role/evidence checks |
| Lint / TypeScript / production build | PASS |
| Whitespace / migration preservation | PASS: no migration changes |

The PostgreSQL adapter emits an existing concurrent-query deprecation warning; it did not fail the tests. No Docker image rebuild was required or claimed for this UX patch; PostgreSQL integration ran against Docker PostgreSQL 17.

## Safe Mac update

Keep PostgreSQL running. Confirm Emergency Pause remains enabled. Stop Next.js and the worker with Ctrl+C before updating.

```bash
cd ~/Projects/flipas-os-
git status --short
git switch feature/phase-4-project-operations
git pull --ff-only origin feature/phase-4-project-operations
npm run typecheck
npm run dev
```

If `git status` shows personal source changes, preserve them before switching/pulling; do not reset or discard them. This patch needs no new migration or `.env` change. If the original Phase 4 migration has not yet been applied, follow `PHASE_4_OPERATIONS.md` first. Start the existing worker in its separate terminal with `npm run worker:ai`; do not enable mail delivery.

Open `http://localhost:3000/projects`; inspect the project sections and switch to a CREW account to check assigned tasks and financial isolation. At `/projects/templates`, loading recommended procedures does not save them until explicit version submission. Open F-2026-000002-R2 and inspect its actual identifiers and eligibility message. Do not replace an accepted record; if appropriate, use the explicit new draft copy and repeat normal approval.

## Remaining limitations

No task-level supervisor signature or new approval policy was introduced. Existing workspace limits, append-only correction limitations, PostgreSQL photo quotas and backup/object-storage requirements still apply. No new package was added; the previously documented development-tool vulnerability risks remain. No automatic updates, production deployment or branch merge are part of this delivery.
