# FLIPAS OS

AI-Powered Remodeling Operations for Flipas Home Remodeling, Florida.

Phase 1 implements secure login, six roles, scoped customer/lead/opportunity access, customer records, lead create/edit/assignment/scoring/notes, opportunity value/next-action editing, an audited Kanban pipeline and a database-backed dashboard. Phase 2 adds FLIPAS ESTIMATOR: configurable pricing, cost snapshots, draft builder, revisions, approval, customer proposals/PDFs and controlled project handoff. AI remains read-only preparation; no real AI or automatic communication executes.

## Architecture

Next.js 16.4 App Router + TypeScript + Tailwind 4, PostgreSQL 17 and Prisma 7.10 with the PostgreSQL driver adapter. Server actions validate with Zod and call transactional services. Sessions are opaque, database-backed, hashed, expiring and revocable. Passwords use salted scrypt. Login throttling is persistent across application instances. Financial foundations use decimal.js and Decimal database columns.

Read [architecture](docs/ARCHITECTURE.md), [data model](docs/DATA_MODEL.md) and [roadmap](docs/ROADMAP.md). Source lives in `src/app`, `src/components`, `src/domain`, `src/server`, `src/ai`; schema/migrations/provisioning live in `prisma`; repeatable tooling lives in `scripts`.

## Local development

Requires Node.js 24, npm, Docker and Docker Compose. Use the existing isolated checkout; no worktree is needed.

```sh
cd ~/Projects/flipas-os- # on macOS; cloud checkout: /workspace/flipas-os-
npm run env:local # creates a random local database password; preserves existing .env
npm ci
npm run db:generate
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait db
# Wait until the database reports healthy:
docker compose exec db pg_isready -U flipas -d flipas
npm run db:migrate
```

`.env` is ignored. For development its database URL uses `localhost`; its password must match `POSTGRES_PASSWORD`. `APP_ORIGIN=http://localhost:3000` authorizes browser mutations from that exact origin. The committed .env.example has blank credential fields. Never commit your generated .env.

Provision the initial owner without storing a password in source or command history:

```sh
set -a
. ./.env
set +a
export USER_EMAIL='owner@your-company.com'
export USER_NAME='Business Owner'
export USER_ROLE='OWNER'
# macOS default shell (zsh):
read -s 'USER_PASSWORD?New password (12+ characters): '
printf '\n'
export USER_PASSWORD
npm run user:create
unset USER_PASSWORD
npm run dev
```

Open the app on port 3000 in your own local environment. The cloud onboarding UI does not provide a localhost preview. Provision additional users using the same CLI with their role. Duplicate email provisioning fails and never overwrites an existing account. Keep CLI/database access restricted to administrators. Password reset and MFA/SSO are not implemented in Phase 1.

Optional development fixtures:

```sh
ALLOW_DEMO_SEED=true npm run db:seed
```

Seed is idempotent, refuses `NODE_ENV=production`, requires an existing owner and labels the customer/service/activity as development/demo. It creates no default credentials. The production UI has no random metrics.

## Validation

```sh
npm run lint
npm run typecheck
npm test
# The following commands need DATABASE_URL in the process environment:
set -a
. ./.env
set +a
npm run test:integration
npm run build
npm start
# In another terminal with the same DATABASE_URL:
npm run test:smoke
```

Integration tests use unique fixtures and remove only their own records. HTTP smoke creates a temporary owner, tests real login, cookie security, authenticated pages and disabled-user revocation, then removes its fixtures. Run it against a production-mode app (`npm start`), with `APP_ORIGIN` matching `SMOKE_BASE_URL` (default `http://localhost:3000`). Do not target a customer production database for tests.

`npm start` serves the standalone build; build copies static assets into it. Production-mode cookies are Secure: a deployed application needs HTTPS. The HTTP test supplies cookies explicitly for internal loopback verification.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string; protect credentials, URL-encode password characters. |
| `POSTGRES_PASSWORD` | Compose database password; must match the URL. |
| `APP_ORIGIN` | Exact public origin, including scheme and optional port; required in production. |
| `USER_EMAIL`, `USER_NAME`, `USER_ROLE`, `USER_PASSWORD` | Only used by administrator account provisioning. |
| `ALLOW_DEMO_SEED` | Explicit development seed opt-in. |
| `SMOKE_BASE_URL` | Optional test target; defaults to loopback port 3000. |

No AI credentials or additional secrets are required for Phase 2.

## Migrations and restricted networks

`202610070001_initial` creates the relational schema. `202610070002_integrity` adds database checks for score, budgets, probability and pricing bounds. `202610070003_estimator` adds catalog history, estimator settings/templates/approvals/counter, snapshot fields and PostgreSQL immutability triggers. It is additive and atomic, backfills target margins without changing existing catalog costs, and preserves Phase 1 data. The runner now passes complete scripts to PostgreSQL to support dollar-quoted functions.

`db:generate` and `db:migrate` use official Prisma npm-packaged generator and WASM schema engine, with package versions pinned together. This avoids the CLI's native binary download requirement in restricted cloud environments. npm integrity and TLS verification remain enabled. Migration execution uses Prisma's migration history and locking, rather than a custom SQL ledger. These internal interfaces are version-sensitive: upgrade them together and rerun database and repeatability tests.

For future migrations, standard Prisma CLI `npx prisma migrate dev --name your_change` can be used locally; it needs `binaries.prisma.sh`. Commit migration SQL and apply it with `npm run db:migrate`. Do not use `db push` against production. Do not regenerate the initial migration after it is applied; `scripts/migrate.ts --initial` is only a one-time project bootstrap helper. Review custom database checks when generating subsequent migrations.

## Docker deployment on Linux

1. Copy `.env.example` to `.env` if absent, then securely configure:
   - a strong unique `POSTGRES_PASSWORD`;
   - `DATABASE_URL=postgresql://flipas:<URL-encoded-password>@db:5432/flipas`;
   - `APP_ORIGIN=https://os.your-company.com`.
2. Build and start:

```sh
docker compose build
docker compose up -d
docker compose ps
```

The one-shot `migrate` service waits for PostgreSQL health and applies pending migrations before the app starts. Data persists in `postgres_data`. The production database has no published port; the app is bound only to host loopback port 3000. Configure your host reverse proxy for TLS, preserve the public Host/Origin, forward to loopback port 3000, and place Cloudflare in front with Full (strict) TLS. If the reverse proxy runs in a separate container, connect it to the app network and adapt ports accordingly.

Provision the owner using the tools image, without putting the password in the invocation:

```sh
export USER_EMAIL='owner@your-company.com'
export USER_NAME='Business Owner'
export USER_ROLE='OWNER'
read -r -s -p 'New password (12+ characters): ' USER_PASSWORD
printf '\n'
export USER_PASSWORD
docker compose run --rm -e USER_EMAIL -e USER_NAME -e USER_ROLE -e USER_PASSWORD migrate npm run user:create
unset USER_PASSWORD
```

For upgrades, back up first, build new images and rerun `docker compose up -d --force-recreate migrate app`. Do not remove database volumes. Before customer production use, configure off-host PostgreSQL backups, test restore, monitoring, retention and MFA/SSO policy. Publication of the Codex environment is separate from application deployment.

## OWNER Console

The existing OWNER account can open **Owner console** (`/owner`) for executive metrics, versioned financial policies, pending estimate approvals, team permissions and project profitability. Initial owner-requested plan: $30,000 projected monthly revenue, $2,000 fixed overhead, 35% target gross margin and 20% minimum. New estimates inherit active policies; historical snapshots remain unchanged. Automatic overhead is proportional to contract revenue excluding tax. See [OWNER Console](docs/OWNER_CONSOLE.md) for calculations, permissions, migration and limitations. This adds no authentication system or required secrets.

## FLIPAS ESTIMATOR (Phase 2)

See [estimator workflow and financial policy](docs/ESTIMATOR.md). Open **Estimates → Catalog** as OWNER/ADMIN and initialize the nine categories and three scope-only templates. Configure business contact, branding, reviewed terms and discount approval threshold in **Business settings**, then add your actual service costs and margins. No final company pricing or legal claims are seeded.

Create an estimate from scratch or a template, attach a customer and optional opportunity (which links to its lead), price every line, configure tax treatment, future expiration and payment milestones totaling 100%. Save and submit for approval. OWNER/ADMIN reviews the frozen internal snapshot and listed exceptions; Sales cannot approve or release. Reject to draft for corrections. Approve, then explicitly release; **release does not send anything**. Download PDF or inspect customer preview. Record externally obtained acceptance with its reference. After the linked opportunity is WON, use **Create initial project**. Revisions preserve the original snapshots; duplicate creates a separate estimate series.

For an existing local checkout, stop Next with Ctrl+C, switch to the feature branch when available, then run `npm ci`, `npm run db:generate`, start the existing PostgreSQL container, `npm run db:migrate`, and `npm run dev`. Preserve `.env` and the database volume. Your existing OWNER login remains valid.

Estimator database tests must use a separate disposable database with a name ending `_test`:

```sh
docker compose exec db createdb -U flipas flipas_estimator_test
set -a
. ./.env
set +a
# This subshell does not change your normal application DATABASE_URL:
( export DATABASE_URL="${DATABASE_URL%/*}/flipas_estimator_test"; npm run db:migrate && npm run db:migrate && npm run test:estimator )
docker compose exec db dropdb -U flipas flipas_estimator_test
```

Do not target a customer production database for tests. Owner review is required for real pricing/target and minimum margins, discount threshold, rounding policy, overhead allocation, tax applicability/rates, reviewed terms, expiry/payment/acceptance policy and Sales visibility. Full project management, e-signatures, customer portal/delivery, real AI and production deployment remain outside this phase.

### Cloud proxy build

When the cloud machine supplies `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS`, use the optional helper to pass the CA as a transient BuildKit secret and resolve the proxy hostname using the host resolver:

```sh
DOCKER_CONFIG=/tmp/flipas-docker python3 scripts/cloud-build.py
DOCKER_CONFIG=/tmp/flipas-docker python3 scripts/cloud-build.py --target tools --tag flipas-os-tools
```

TLS and npm package integrity remain enabled. The proxy CA is not copied into the production image. Standard Linux hosts without this proxy can use `docker compose build` directly.

## AI Sales development checkpoint

See [docs/AI_SALES.md](docs/AI_SALES.md) for `/ai`, the inbox, approval flow, PostgreSQL worker and mock startup. Run `npm run worker:ai` beside `npm run dev`. The Zoho Mail connector is implemented for OWNER-authorized read-only US/EU access; real email sending stays disabled. See [Zoho configuration](docs/ZOHO_MAIL.md); the OpenAI adapter is simulated-response-tested and remains off by default; no customer emails are sent.

OpenAI Phase 3: [private server setup, monthly budget and first real classification](docs/OPENAI_SETUP.md). Configure securely with `npm run env:openai`; MOCK remains available and real email sending stays disabled.

Phase 3 commercial context, safe sending preparation and Mac verification: [Commercial hardening](docs/PHASE_3_COMMERCIAL_HARDENING.md).

Zoho sending OAuth, safety controls and the paused OWNER self-test procedure: [ZOHO_DELIVERY.md](docs/ZOHO_DELIVERY.md).

Phase 4 project/field operations are documented in [PHASE_4_OPERATIONS.md](docs/PHASE_4_OPERATIONS.md), including safe Mac updates, project permissions, evidence quotas/backups and disposable integration tests.

Project UX, exact handoff diagnostics and explicit versioned-template updates: [PHASE_4_UX_HARDENING.md](docs/PHASE_4_UX_HARDENING.md).

PostgreSQL transaction concurrency correction and local regression procedure: [POSTGRES_TRANSACTION_SERIALIZATION.md](docs/POSTGRES_TRANSACTION_SERIALIZATION.md).
