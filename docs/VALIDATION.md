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
