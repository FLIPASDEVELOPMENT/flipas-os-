# FLIPAS OS architecture

Phase 1 is a modular monolith: Next.js 16 App Router, TypeScript, PostgreSQL, Prisma 7.10 with PostgreSQL driver adapter, Tailwind and Zod. Server components read through the service layer; server actions validate inputs, authenticate and authorize every mutation. UI → services → Prisma → PostgreSQL. Integrations and AI have independent provider interfaces.

Directory structure: src/app (routes), src/components (shared UI), src/domain (permissions and money), src/server (authentication, database, transactional services), src/ai (provider contracts), prisma (schema, migrations, seed), tests (business/security tests).

Opaque random sessions are hashed in the database, expire after seven days and use HttpOnly, SameSite=Lax cookies; production uses Secure cookies. Passwords use scrypt with individual salts. Login attempts are limited in the database. No public registration: owner provisioning is an explicit CLI operation. Disabled users lose access immediately. Next.js server-action origin protection is retained. Set APP_ORIGIN to the actual public HTTPS origin. Do not trust proxy identity headers.

Owner/Admin manage CRM; Sales accesses only assigned leads and opportunities and their customers. Project Manager, Crew and Customer have no CRM access in Phase 1. This restrictive default requires business-owner review before broader access. Price override is Owner/Admin only. Medium/high AI actions require approval; execution is not implemented.

Every CRM mutation and audit event commits in one transaction. Customer deletion is intentionally unavailable. Opportunity WON does not create projects until Phase 2. No fake dashboard metrics. All dates are UTC; all money uses PostgreSQL Decimal and decimal.js, rounded to cents at explicit boundaries. Pricing rules are foundations only and require owner approval before estimates launch.

Deploy as a standalone Linux container with PostgreSQL, persistent volume, HTTPS reverse proxy, backups and restricted database access. Cloudflare is an edge proxy, not an authentication boundary. No Vercel services. Initial scope is one company, one currency (USD). Multi-tenancy is deferred.

Leads connected to opportunities must remain assigned. Creating an opportunity for an unassigned lead assigns it to the creating owner/admin. Reassigning a lead reassigns its linked opportunity in the same transaction. The migration runner uses version-pinned official npm-packaged WASM components and Prisma migration history; no native binary checksum verification is disabled.
