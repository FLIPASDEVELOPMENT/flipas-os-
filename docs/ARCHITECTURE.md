# FLIPAS OS architecture

FLIPAS OS is a modular monolith: Next.js 16 App Router, TypeScript, PostgreSQL, Prisma 7.10 with PostgreSQL driver adapter, Tailwind and Zod. Server components read through the service layer; server actions validate inputs, authenticate and authorize every mutation. UI → services → Prisma → PostgreSQL. Integrations and AI have independent provider interfaces.

Directory structure: src/app (routes), src/components (shared UI), src/domain (permissions and money), src/server (authentication, database, transactional services), src/ai (provider contracts), prisma (schema, migrations, seed), tests (business/security tests).

Opaque random sessions are hashed in the database, expire after seven days and use HttpOnly, SameSite=Lax cookies; production uses Secure cookies. Passwords use scrypt with individual salts. Login attempts are limited in the database. No public registration: owner provisioning is an explicit CLI operation. Disabled users lose access immediately. Next.js server-action origin protection is retained. Set APP_ORIGIN to the actual public HTTPS origin. Do not trust proxy identity headers.

Owner/Admin manage CRM; Sales accesses only assigned leads and opportunities and their customers. Project Manager, Crew and Customer have no CRM access in Phase 1. This restrictive default requires business-owner review before broader access. Sales may propose justified price overrides in drafts; only Owner/Admin can approve exceptions and release proposals. Medium/high AI actions require approval; execution is not implemented.

Every CRM mutation and audit event commits in one transaction. Customer deletion is intentionally unavailable. Opportunity WON never automatically creates a project. Phase 2 provides an explicit, idempotent handoff only with a matching accepted estimate. No fake dashboard metrics. All dates are UTC; all money uses PostgreSQL Decimal and decimal.js, rounded to cents at explicit boundaries. Pricing rules are foundations only and require owner approval before estimates launch.

Deploy as a standalone Linux container with PostgreSQL, persistent volume, HTTPS reverse proxy, backups and restricted database access. Cloudflare is an edge proxy, not an authentication boundary. No Vercel services. Initial scope is one company, one currency (USD). Multi-tenancy is deferred.

Leads connected to opportunities must remain assigned. Creating an opportunity for an unassigned lead assigns it to the creating owner/admin. Reassigning a lead reassigns its linked opportunity in the same transaction. The migration runner uses version-pinned official npm-packaged WASM components and Prisma migration history; no native binary checksum verification is disabled.

## Estimator module

`src/estimator/domain` owns validated string-based decimal inputs, pure target-margin calculations, scope templates and a strictly allowlisted customer DTO. `server` owns scoped reads and audited serializable transactions for catalog, snapshots, revisions, exact-content-version approvals and controlled handoff. Client components provide a live draft builder; server calculation is authoritative. PostgreSQL triggers independently freeze non-draft headers/sections/lines and restrict status transitions.

Proposal HTML and PDF receive the same customer-only projection. Authenticated routes prevent public database access; internal fields never enter the projection. PDF generation uses pdf-lib and standard embedded fonts without browser/network dependencies. Configurable branding/contact/terms are captured in each saved snapshot. No licensing or contractual claims are fabricated.

`estimatorAnalysisContext` provides scoped, read-only structured requirements, template checklists, profitability flags, follow-up questions and limited same-customer historical project comparisons. Initial actual costs are explicitly non-final. It exposes no AI provider or mutation/delivery capability.

## OWNER financial administration

`src/owner` contains OWNER guards, pure policy/allocation calculations and serializable audited version writes. OWNER routes and APIs deny every other role independently of navigation visibility. Estimator drafts retain captured policy versions; new estimates inherit the active version and compute automatic project-level allocation. Sales builder props exclude confidential monthly plan amounts. Financial reports distinguish contract bookings, estimates, recorded non-final cost and revenue plans.

## Phase 3 internal AI Sales

Mail and AI provider interfaces isolate the inbox from external transports. PostgreSQL stores leased jobs, immutable reply versions and unique send attempts. Separate guarded `/ai` routes reuse existing authentication. Zoho implementation remains blocked; the OpenAI adapter is implemented with simulated-response tests; see AI_SALES.md.
