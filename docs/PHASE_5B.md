# Phase 5B — purchase classification and human approval

## Audit and architecture

Baseline: `78fc3bb`, branch `feature/phase-5-financial-intelligence`. Phase 5A already had immutable original CSV evidence, the native Home Depot adapter, versioned OWNER reviews, exact approval, reconciliation and the Phase 4 cost ledger. Permanent short codes had been requested but were not implemented in that baseline. This delivery adds their codebook; it does not replace any project identifier or financial model.

- `ProjectIdentity`: one permanent global code per project. PostgreSQL sequence starts at F001, grows to F1000 and beyond; cancellation, year changes and label edits never reset it. Gaps are intentional. Database triggers enforce immutability and assign codes to every existing project creation path. Existing projects receive codes in creation-date/ID order.
- `ProjectAlias`: confirmed exact historical labels. Renaming preserves the previous name as an immutable alias. Shared historical names are retained as ambiguous; manual attempts to claim another project's alias/code are rejected. Codes are recognized only at the start of a job label, with a whitespace/end boundary: F042, F-042, f042, F042 Angela. Substrings, F42, zero-padded alternative widths and trailing non-whitespace text do not match. Code conflicts take precedence over aliases and fail closed. Name-only matches are candidates for review, never deterministic assignments.
- Rules resolve code/alias before AI. Native Pro Xtra transaction summaries use rules only, without provider calls: they cannot prove a material, expense type or original estimate line. Itemized imports can use the existing OpenAI SDK, strict Responses parser and shared budget/usage ledger. Missing facts stay null. IDs must exist in the candidate snapshot; literal evidence and conservative category checks are enforced. Estimate-line links belong to the project's original estimate, require related item evidence, and never edit that snapshot.
- `PurchaseSuggestion`: immutable original input/output, actor, model/classifier version, request key, review version, timestamps and sanitized failure code. One running job per purchase. No network call inside a database transaction. Same-key retries return the durable job, not another API call. Concurrent review/finalization makes a result STALE. Interrupted jobs are not retried automatically; OWNER can close one after five minutes with a reason, preserving request counts and uncertain cost reservations.
- `PurchaseReview.suggestionId`: links a human correction/confirmation to the original suggestion. The proposal only pre-fills the form after an explicit click. Saving the review is separate from approving it. Rejection of a suggestion is an immutable `PurchaseSuggestionDecision`; the purchase remains pending. Each review preserves the edited allocations and reason. Finalization continues to use the existing exact-version approval and cost ledger.
- Supervised examples: at most five OWNER-approved, exact SKU/description matches from the same deterministically identified project. Pending records, other projects and summary receipts are excluded. Examples are untrusted hints, not policy; output still needs current evidence. No fine-tuning, catalog writes or external accounting.

## Limits and security

OWNER-only pages/actions/services include fresh active-role and password-setup checks. Project codes/names are safe metadata returned only through already authorized project views; aliases and financial suggestions remain OWNER-only. HTML/RSC role tests cover the new codebook and batch pages.

- Four explicit requests per purchase, including failed/interrupted jobs; counters are never reset by this feature.
- Batch: OWNER selects at most five purchases; sequential requests preserve independent outcomes and existing budget reservations. Errors are visible in job history/Inbox notice.
- Classification: at most 20 receipt lines, 100 candidate projects, 40 original estimate lines per project, five approved examples. Oversized context is rejected, not silently selected or truncated into an assignment. Remaining estimate lines can be assigned manually.
- Existing OpenAI adapter limit: 45 KB request, 1,500 output tokens, 45 seconds, no tools, no SDK retries, `store: false`. Existing conservative token reservation and monthly thresholds apply to `PURCHASE_CLASSIFY`, alongside commercial operations.
- AI pause and processing-enabled settings apply. Mail Emergency Pause is a distinct delivery control and is never changed. No cron/batch classification runs automatically. No email or accounting connector is enabled.
- No amounts, dates, addresses, payment details, purchasers, document bytes or financial policies are sent to the purchase classifier. It receives bounded descriptions/SKUs, job/PO labels, candidate identifiers/names, original estimate-line names and eligible examples. Credential-looking text is redacted from receipt fields. Labels are untrusted; instructions inside them cannot authorize actions. Category/line confidence is a recommendation, not verification of expense or receipt authenticity.
- Pending receipts with the same evidence identity block approval until OWNER reviews and rejects the duplicate with a reason. Already approved matches remain blocked. Existing costs require explicit verified ledger linking (same project/type/exact amount), never automatic reposting. Native identity includes transaction/store/date/order/invoice; a shared online order alone is not a duplicate key.
- Internal estimated cost controls do not guarantee exact provider billing. Uncertain reservations remain charged against internal availability; inspect OWNER AI Administration.

## Migration and private configuration

New additive migration: `202610110002_purchase_classification`. Creates codebook/aliases/suggestions/rejections and adds nullable `PurchaseReview.suggestionId`. Backfills only the new codebook, not existing project fields, costs or snapshots. No prior migration changed. Never delete/reset the sequence or codebook. PostgreSQL backups must include these new tables and sequence.

No new environment variables, dependencies, secrets or AI model/rate assumptions. Existing private `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_INPUT_USD_PER_MILLION`, `OPENAI_OUTPUT_USD_PER_MILLION`, `OPENAI_PRICING_VERIFIED_AT` are reused. Verify chosen model/pricing with https://platform.openai.com/docs/models and https://openai.com/api/pricing/ before configuring them privately. Do not paste keys into chat. Existing MOCK remains available. No real provider requests were used in development validation.

## Update safely on macOS

1. Stop Next.js and the AI worker with Control-C in their respective Terminal windows; keep Docker/PostgreSQL running.
2. In a new Terminal, check local changes. If `git status --short` shows edits, preserve/review them before pulling; do not reset or discard them.

```sh
cd ~/Projects/flipas-os-
git status --short
```

3. Back up PostgreSQL **before the migration**, to a private directory outside the repository. This dump contains customer data and may contain encrypted integration secrets; do not upload it. It requires your existing private mail encryption key for a full future recovery, so preserve that separately using your established secure backup procedure.

```sh
umask 077
mkdir -p ~/FLIPAS-backups
chmod 700 ~/FLIPAS-backups
backup_file="$HOME/FLIPAS-backups/before-phase-5b-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_file"
test -s "$backup_file"
docker compose exec -T db pg_restore --list < "$backup_file" > /dev/null
```

Stop on any backup failure. Do not restore over a live database as part of updating.

4. Update the branch, generate the client, and apply incremental migrations. Leave `.env` untouched; do **not** run `env:local`, `db:seed`, `prisma migrate reset`, or remove Docker volumes.

```sh
git switch feature/phase-5-financial-intelligence
git pull --ff-only origin feature/phase-5-financial-intelligence
npm ci
npm run db:generate
npm run db:migrate
npm run dev
```

5. In the worker Terminal, restart using the same existing private configuration:

```sh
cd ~/Projects/flipas-os-
npm run worker:ai
```

6. Log in as OWNER at http://localhost:3000. Leave mail Emergency Pause activated and `ZOHO_SEND_ENABLED` unchanged/disabled.

## Test a real Home Depot purchase without approval

1. Open `/owner/purchases/projects`. Find the intended project, note its code, edit the display name if needed, and explicitly confirm the original Pro Desk Job Name as a historical alias with a reason. Do not associate by customer name alone. Use **only the short code** for future cashier entries.
2. Open an eligible pending native purchase in Purchase Inbox. Check original transaction ID, date basis, Job Name, warnings and duplicate identity. Returns/credits or ambiguous totals remain blocked.
3. Click **Suggest classification with AI**. Processing must already be enabled and AI not paused in the existing settings; this feature does not activate them. For native summaries the result says RULES and makes no OpenAI request. Project matches can come from a code/confirmed alias; item category/estimate line remain unknown without item evidence.
4. Inspect evidence/confidence and warnings. You may reject the suggestion only, or click **Use this suggestion in the review form** and edit the proposal. Neither action posts costs. Saving a review also leaves the purchase pending.
5. **Do not click Approve saved version and record costs during this test.** Confirm there are no postings and the project cost ledger is unchanged. Any future expense recognition requires that separate OWNER approval.
6. For itemized normalized receipts, OpenAI/MOCK is controlled by existing AI Administration. Real OpenAI classification consumes the shared estimated budget; no email is sent.

## Validation

Unit tests cover safe codes/aliases/ambiguity, summary limitations, literal item evidence, IDs/snapshots and strict SDK output failures using simulated Responses API envelopes. Purchase integration tests cover legacy backfill, immutable identities/history, human corrections/rejections, duplicate reconciliation, roles/revocation, pause/budget limits, request idempotency/concurrency, stale results, approved example separation and interrupted jobs. Full Phase 1–4 integration suites are run against disposable `_test` databases. HTTP tests check OWNER/non-OWNER HTML and RSC and forged actions; Chromium checks mobile/desktop layouts and explicit suggestion proposal without posting. No application database migration, live OpenAI request, real email, merge or deployment occurs during these checks.

Limits: live provider quality is not claimed from mock testing. Unrecognized categories/estimate-line wording can require manual classification. Accounting of returns and non-USD movements remains unsupported and blocked from Phase 5A. Phase 5C is not implemented.

Validation results (2026-10-11): lint, TypeScript, production build and 87 unit tests PASS. The ten earlier-phase integration suites passed 57 tests, and the expanded purchase suite passed 15, for 72 integration tests in total. Existing HTTP suites for authentication/CRM, Estimator, OWNER, AI, operations, team and purchases passed; purchase HTTP includes the new codebook and batch pages for all six roles in HTML and RSC. Headless Chromium validated 375/390/430/1280 px, including an actual MOCK suggestion → explicit review-form proposal flow with unchanged ledger counts. This is browser automation, not a physical iPhone inspection. Runtime `npm audit --omit=dev`: zero findings; full audit retains six high development-tool findings documented in `VALIDATION.md`. No dependency update or real provider call was used to obtain these results.
