# Phase 1 validation

Verified in the cloud workspace on 2026-10-07:

- ESLint: passed, zero errors/warnings.
- TypeScript: passed.
- Unit tests: 8 passed; decimal pricing/margins, invalid financial input, role matrix, approval policy, salted password verification and lead validation.
- PostgreSQL integration: 1 scenario passed with multiple assertions covering connected customer/lead/opportunity creation, activity persistence, unauthorized mutations and visibility, ownership reassignment, opportunity editing, invalid input rollback and database score checks. Fixtures cleaned after each run.
- Initial and integrity migrations: applied to two fresh databases; rerunning applied zero migrations. Docker tools image also ran the migration runner successfully.
- Owner provisioning: succeeded in a disposable validation database. Development seed ran twice and retained exactly one demo customer, lead and opportunity; validation database removed afterward.
- Production Next.js build: passed.
- Docker runtime and tools images: built. Restricted cloud BuildKit required host-resolved proxy DNS and the supplied CA via a transient secret. No TLS/checksum checks disabled.
- Production HTTP smoke on standalone Node and Docker: passed real credential login, Secure/HttpOnly/SameSite cookie checks, six authenticated pages, unauthenticated redirect and immediate disabled-user revocation; temporary account/session/activity cleaned.
- Development login page: HTTP 200 and expected brand content.
- `npm audit --omit=dev`: zero reported vulnerabilities. Full audit reports six high findings through development-only `braces` glob tooling (GHSA-vfj7-8cjw-p6xm), including Next ESLint and Prisma code generation dependencies. Latest published braces remains affected; no unsafe automatic major downgrade was applied. Track upstream updates. The production runtime image does not use these generator/linter modules.

No customer production database, live business data, external AI provider, email/SMS delivery, browser interaction/accessibility suite, production TLS domain, backup recovery or external deployment was tested. Phase 2 behavior is disabled. User accounts must be provisioned securely; no default login is shipped.

The environment configuration draft stores installation and startup instructions. Saving this draft is not publication. Application source is local workspace work; nothing has been pushed to GitHub.

## Phase 2

See [Phase 2 delivery](PHASE_2_DELIVERY.md) for the new estimator, migration, production/Docker HTTP and Chromium checks. This supersedes the earlier Phase 1-only statement that estimator behavior is disabled.

## OWNER Console extension

17 unit tests, existing CRM/estimator integration and dedicated owner policy integration pass. Fresh additive migrations and rerun apply correctly. Production build, lint/types, Docker build and Chromium desktop/mobile policy save pass. Owner route/API HTTP tests verify role denial and anonymous requests. See OWNER_CONSOLE.md.

## Phase 3 internal/mock checkpoint validation (2026-10-08 UTC)

Lint, TypeScript, 27 unit tests and production build passed. Separate disposable PostgreSQL databases ran CRM (1), estimator (1), OWNER Console (1) and AI Sales integration (18 including its parent test), all passed. AI HTTP passed against native production and Docker runtime: seven role identities, owner-only administration, SALES assignment scope, anonymous denial, blocked cross-origin mutation and authorized draft creation. Docker runtime/tools images built; containerized worker --once successfully connected to PostgreSQL. Encryption-key setup was verified for randomness, file mode 0600 and repeatability. Generated client chunks contained no encryption/token storage code.

Docker validation initially exhausted cloud disk space and stopped PostgreSQL. Removing unused build cache freed space, then PostgreSQL restarted healthy with its persistent volume intact. Development application and mock-safe worker were restarted and login/anonymous route checks passed. No application data was deleted or reset.

Official Zoho web documentation requests returned HTTP 403 from the environment proxy. The Zoho OAuth/API connector remains unimplemented/disabled. The OpenAI adapter was verified against official SDK source and tested using simulated HTTP responses; no authenticated live-provider call was run. Token/OAuth tests cover provider-independent mocked foundations only. No real customer email or paid model call occurred. The existing npm audit reports 6 high findings; dependencies were preserved and no forced upgrade was made. See AI_SALES.md for known limits and the network draft needed to resume live integration work.


## Zoho read-only connector — 2026-10-08

Official Zoho Mail/OAuth documentation became accessible. Verified account/folder/message READ scopes, authorization/refresh contracts and regional Accounts servers; US/EU Mail API hosts returned documented authentication-required JSON without credentials. Current dedicated Accounts revocation documentation differs from the older Mail guide; the adapter implements authenticated POST `/oauth/v2/revoke/token`.

Lint, TypeScript, 33 unit tests and production build pass. Separate fresh PostgreSQL databases passed CRM (1), estimator (1), OWNER Console (1), AI Sales (18 including parent) and the new Zoho integration scenario (1): 22 integration tests total. Native production HTTP checks passed real login, estimator/proposal/PDF regressions, OWNER report permissions and seven-role AI/OAuth checks. Zoho HTTP checks verify OWNER-only setup/callback, denied anonymous/Sales requests, cross-origin start rejection, HttpOnly browser binding, state consumption on region mismatch, and secret omission. No credential-bearing provider call was performed.

The first clean Docker build encountered proxy HTTP 403 downloading a locked npm tarball. Cached-dependency runtime/tools images passed the seven-role AI/OAuth HTTP suite and containerized worker `--once` against a disposable PostgreSQL database. After the network configuration update, a fresh `npm ci` and the original Docker runtime/tools builds also succeeded with unchanged lockfile/dependencies and verified TLS. The freshly installed container runtime also passed the seven-role AI/OAuth HTTP suite, and its tools worker completed `--once`. The network draft adds the missing `accounts.zoho.com`, `registry.npmjs.org` and repository host `github.com`, preserving existing entries; draft saving does not apply or publish it.

Real outbound mail is rejected by request, worker and Zoho provider, even with an approved draft and emergency pause disabled; tests confirm no HTTP send or durable send attempt occurs. No real credentials, email deliveries or live model calls were requested/used. Authenticated Zoho account eligibility and real readonly import remain OWNER-side checks. PostgreSQL, the native development server and worker are running; no real Zoho mailbox is connected. Other regions, attachment import and complete historical archive synchronization remain outside the implemented connector scope, documented in ZOHO_MAIL.md. Phase 1/2 integration and historical snapshot checks remain passing.

## OpenAI SDK and budget checkpoint — 2026-10-08

Official model documentation verified gpt-4.1-mini, Responses, Structured Outputs and published $0.40 input/$1.60 output per million tokens. Official npm package openai 7.30.1 is pinned; no model or token price is hard-coded in runtime configuration. All OpenAI calls during testing used simulated responses and synthetic keys.

Passed: 38 unit tests; existing CRM, Estimator, OWNER, AI and Zoho PostgreSQL integrations (22 tests total); new OpenAI reservation integration; HTTP smoke, Estimator, OWNER and AI permission/CSRF suites; ESLint, TypeScript and production build. Database suites ran only against fresh disposable *_test databases. Interactive PTY validation confirmed hidden key input, preservation of prior environment values and ignored .env mode 0600. No real credentials or mail sends were used.

Reservation tests cover concurrent attempts, full-budget rejection, four-call per-message limits, OWNER pause, billable malformed output, uncertain reservations and blocking advertising/uncertain CRM creation. Existing OWNER and AI HTTP suites verify SALES/anonymous denial and assigned inbox scope. The existing npm audit still reports six high vulnerabilities; no forced dependency upgrade was made. First authenticated OpenAI classification and account-specific model availability remain OWNER configuration steps in OPENAI_SETUP.md. The internal budget is conservative and cannot guarantee exact provider billing.

## Structured-output correction — 2026-10-08

42 unit tests cover strict API schema, literal evidence/unknown data for a synthetic Tampa kitchen inquiry, incomplete/invalid/refused responses, usage retention and distinct safe API/permission errors. OpenAI PostgreSQL integration checks persisted incomplete-response codes and redacted audit diagnostics. No real Mac execution logs or authenticated provider response were available; the prior generic error cannot identify that historical failure stage. See OPENAI_OUTPUT_DIAGNOSTICS.md. Financial limits and human approval/delivery restrictions are unchanged.


### OpenAI intermittent-output follow-up (2026-10-08)

45 unit tests passed. All 23 PostgreSQL regression/integration tests passed (CRM, Estimator, OWNER, AI, Zoho and OpenAI), including actual analysis persistence with HTML evidence and simulated SDK HTTP. HTTP smoke, Estimator, OWNER permissions, AI permissions/CSRF and rendered OWNER format/schema/incomplete/refusal diagnostics passed. ESLint, TypeScript and production build passed. Tests use disposable databases and simulated OpenAI responses; no paid API calls, real email sends, financial-limit changes or existing counter resets. Historical generic errors are preserved and cannot be retrospectively diagnosed.
