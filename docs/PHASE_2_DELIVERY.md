# Phase 2 delivery: FLIPAS ESTIMATOR

Feature branch: `feature/phase-2-estimator`; Phase 1 main remains unchanged. No production deployment or automatic customer delivery.

Implemented catalog categories, units, all direct cost components, separate overhead, target/minimum margins, effective dates and audited price history. Added scoped draft builder, editable scope templates, live decimal totals, discount/tax review, snapshotted pricing/business details, duplication/revisions, exact-version human review, immutability, customer-only HTML/PDF and controlled accepted-estimate/WON project creation. Read-only future agent context includes scope checklists, missing-information questions, flags and limited historical project comparisons.

Migration `202610070003_estimator` is additive, transactional and retains existing CRM data. It extends estimate/service snapshots and adds settings, templates, counter, approval and price-history tables plus SQL content/status guards. No new environment secrets are required. The SQL adapter now lets PostgreSQL parse complete migration scripts, including dollar-quoted functions.

Screens: `/estimates`, `/estimates/new`, `/estimates/[id]`, `/estimates/catalog`, `/estimates/templates`, `/estimates/settings`, `/proposals/[id]`, `/api/estimates/[id]/pdf`, `/projects`.

Validation performed:

- ESLint and TypeScript pass.
- 12 unit tests pass, including existing Phase 1 tests and new money/privacy/PDF coverage.
- Existing CRM database integration scenario passes.
- Estimator database scenario passes: idempotent initialization, scope/RBAC, historical snapshots, stale edit rejection, tax permissions, exception review, database immutability, revision and duplicate isolation, controlled idempotent project handoff, audit and read-only analysis context.
- All three migrations apply to a fresh disposable database; rerun applies zero. Docker tools runs the same migration runner successfully.
- Production Next.js build and Docker runtime/tools image builds pass.
- HTTP smoke passes on standalone Node and Docker: real login, secure cookies, twelve authenticated screens, estimate detail, private customer proposal/PDF, unauthenticated PDF denial and disabled-user revocation.
- Chromium desktop/mobile test passes: login, live target-margin calculation, server-action draft save, no JavaScript errors and no horizontal overflow at 390px. Screenshots are temporary validation artifacts outside the repository.
- Production dependency audit reports zero vulnerabilities. Full dependency audit retains six high development-tool findings inherited from Phase 1; see VALIDATION.md. No forced major dependency changes were made.

Local startup and secure account provisioning are in README.md. To inspect: configure reviewed business contact/terms/discount policy, initialize categories/templates, enter real catalog costs, create an estimate, review tax and payment/expiry details, save, submit, approve, explicitly release and inspect the customer proposal/PDF. Record actual external acceptance and mark the opportunity WON before project handoff. Use the existing OWNER account; there are no new default credentials.

Owner decisions before business use: actual prices/costs, target/minimum margins, discount threshold, rounding, overhead allocation, applicable tax treatment/rates, terms, payment/expiration/acceptance policies and Sales access scope. Arithmetic fixtures are development-only examples, not company quotes.

Limitations: no real AI, automated delivery, e-signature, customer portal or full project management. Template administration currently uses JSON; estimate editing uses the visual builder. Duplicates retain customer/opportunity binding. Standard PDF fonts substitute unsupported non-Latin characters. Deployment security, external TLS/backup recovery and owner visual acceptance are not claimed as validated here.
