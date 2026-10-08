# Data model

User owns sessions and assigned leads/opportunities. Customer is the central contact record. Lead belongs to Customer and optionally an assigned User. Opportunity has a unique Lead, the same Customer, an owner and an explicit pipeline stage. Activity is append-only through application services and connects Customer, Lead and Opportunity with actor and JSON metadata. Sessions store only token hashes. LoginAttempt supports shared persistent throttling.

Phase 2 schema foundations: ServiceCategory/ServiceItem store database pricing; Estimate/Section/LineItem preserve cost and price snapshots, calculated price and override reason/actor. Project connects a won opportunity and accepted estimate, with tasks and financial totals. AI agents, actions, recommendations and approvals preserve context, risk and results. These tables have no execution workflows in Phase 1.

Money is Decimal(14,2), quantity Decimal(12,3), ratio Decimal(7,4). Nullable values represent unknown data, not fabricated zero metrics. Referential actions restrict removal of business records; ephemeral sessions cascade with users. Services enforce cross-record customer consistency. Future accepted-estimate and project workflows must enforce it transactionally.

Database CHECK constraints independently enforce lead score/budget ranges, opportunity probability/value bounds and service pricing bounds. They live in the integrity SQL migration because Prisma schema declarations do not represent these checks. Preserve them when generating future migrations.

## Phase 2 estimator migration

`202610070003_estimator` extends existing tables without removing data. ServiceItem adds other direct costs, target margin and effective dates; CatalogPriceHistory stores actor, reason and before/after prices. Estimate adds unique display number, series/revision, optimistic content version, creator, commercial terms, customer/business snapshots, discount/tax/overhead/contribution totals, review flags and acceptance evidence. Section and line positions control ordering; lines retain costs, ratios, units, quantities, calculated and manually overridden selling prices.

EstimateApproval ties review to the exact content version, with requester/reviewer, flags, rationale and timestamps. EstimateCounter allocates numbers transactionally. EstimateTemplate stores configurable structured sections; EstimatorSettings stores reviewed business information and significant-discount threshold. Existing lead/opportunity/customer relationships are preserved; estimate opportunity references reach the lead. Project keeps unique opportunity and estimate links, tax-exclusive contract revenue and snapshotted estimated cost.

Lifecycle: DRAFT → REVIEW → APPROVED → SENT → ACCEPTED; rejection is REVIEW → DRAFT. SENT means explicitly released, not automatically delivered. No frozen-content edits or deletions are allowed; revisions insert a new estimate. Application transactions enforce accepted/WON/customer consistency and idempotency before Project creation. Database triggers use dollar-quoted PostgreSQL functions; the migration runner passes complete SQL scripts through the adapter rather than splitting semicolons.

## OWNER Console

Migration 202610070004_owner_console adds immutable FinancialPolicy versions, FinancialPolicyHead active pointer and Estimate.financialPolicySnapshot. Policy versions capture monthly revenue/overhead plans, target/minimum gross margins, discount threshold, creator and reason. Initial owner-requested values are audited. No existing CRM, catalog or estimate data is removed. See OWNER_CONSOLE.md.

## AI Sales models

The additive 202610080001_ai_sales migration adds mail connections/threads/messages, settings, immutable draft versions, send attempts, follow-ups, jobs, OAuth state and usage. Scalar CRM/user foreign keys and lifecycle checks are enforced by SQL. No existing estimate snapshot or financial policy is changed.
