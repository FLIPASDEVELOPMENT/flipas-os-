# PostgreSQL concurrent-client warning: cause and correction

Investigated from Phase 4 commit `00cf650`, on `feature/phase-4-project-operations`.

## Evidence

Installed versions: Prisma/client/adapter-pg **7.10.0**, node-postgres (`pg`) **8.23.1**. There is no direct application `pg.Client` or `pg.Pool` construction. `src/server/db.ts` builds the Prisma adapter. The migration runner uses its own adapter and awaited statements; parallel filesystem reads there are unrelated.

Before the correction, `NODE_OPTIONS=--trace-deprecation npm run test:operations:local` reproduced this stack:

```text
Client.query                         pg/lib/client.js:780
PgTransaction.performIO             @prisma/adapter-pg/dist/index.js:681
PgTransaction.queryRaw              @prisma/adapter-pg/dist/index.js:631
query-interpreter callback          @prisma/client-engine-runtime
interpretNode / withChunkTransaction
```

Two sources submit concurrent queries to one transaction connection:

1. `workspace()` in `src/project-operations/server/view.ts` used `Promise.all` for eleven operational reads, and again for three financial reads, inside `db.$transaction`. All use the same `tx` client.
2. Prisma's relation-load query plans also dispatch child reads concurrently. Sequencing the application reads alone still reproduced the same warning. The adapter's `startTransaction()` reserves one pool client; `performIO()` forwards requests directly to `client.query()` without a transaction-local queue. Thus nested relation reads can trigger the warning even from a single awaited Prisma call.

The existing `pg` implementation warns when its internal pending query queue grows; a parallel pool operation using separate clients is not the problem. Application-level `Promise.all` outside transactions and intentional concurrent race tests remain valid.

## Correction

- Operational transaction reads now explicitly await each query.
- `SerializedPrismaPg` extends the installed adapter using its public `connect` / `startTransaction` interfaces. Each returned transaction receives its own FIFO queue for `queryRaw` and `executeRaw`, covering both application and Prisma-generated queries.
- Commit/rollback wait in the same queue before the dedicated connection is released. Query errors still reach callers; a rejected query does not prevent queued rollback. Savepoints route through the same transaction's `executeRaw`.
- Queries outside transactions still use the ordinary pool; separate transactions have separate queues. Isolation levels, SQL, query arguments, Prisma timeouts, authorization and business calculations are unchanged.
- No dependency upgrade, node_modules patch, warning suppression, migration, credential change or mail configuration change was needed. Reassess the wrapper when a future compatible Prisma release guarantees serialization; do not remove it without running the regression tests. It adds no logs of SQL, parameters, credentials or tokens.

## Validation

| Check | Result |
| --- | --- |
| Unit tests | PASS: 72, including ordering/release, error propagation/rollback and savepoints/separate transactions |
| Integration tests | PASS: 54 across all nine Phase 1–4 suites, using disposable Docker PostgreSQL databases and mocked external providers |
| PostgreSQL regression | PASS: actual client invocations/settlement monitored in tests; zero overlap during OWNER/PM/CREW workspace reads, relation loading, intentionally concurrent transactional requests and error rollback |
| HTTP regressions | PASS: CRM, Estimator/PDF, OWNER, AI and project roles/private evidence |
| Lint, TypeScript and production build | PASS |
| Warning trace | No concurrent-client deprecation warning in corrected integration or HTTP runs, including production server logs, with `--trace-deprecation` enabled |

The regression observer handles both pg's Promise and callback query APIs, never records SQL/arguments, and restores the original method after its test. Only generated fixture rows in disposable `*_test` databases were modified. Existing application data was not changed. No real OpenAI request or email was sent.

## Mac verification

Keep PostgreSQL running and Emergency Pause enabled. Stop Next.js and the worker with Ctrl+C; restarting is necessary because the development singleton may retain the previous adapter.

```bash
cd ~/Projects/flipas-os-
git status --short
git switch feature/phase-4-project-operations
git pull --ff-only origin feature/phase-4-project-operations
npm run typecheck
NODE_OPTIONS=--trace-deprecation npm run test:operations:local
NODE_OPTIONS=--trace-deprecation npm run dev
```

Preserve any personal source changes before pulling; do not reset or discard them. No installation, migration or `.env` edit is required for this patch. The local test command creates and drops only its uniquely named test database. Open project details as OWNER and switch sections; inspect the terminal for warnings. Restart the worker separately with `npm run worker:ai` if needed, retaining existing mail controls.
