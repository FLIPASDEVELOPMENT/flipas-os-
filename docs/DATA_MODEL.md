# Data model

User owns sessions and assigned leads/opportunities. Customer is the central contact record. Lead belongs to Customer and optionally an assigned User. Opportunity has a unique Lead, the same Customer, an owner and an explicit pipeline stage. Activity is append-only through application services and connects Customer, Lead and Opportunity with actor and JSON metadata. Sessions store only token hashes. LoginAttempt supports shared persistent throttling.

Phase 2 schema foundations: ServiceCategory/ServiceItem store database pricing; Estimate/Section/LineItem preserve cost and price snapshots, calculated price and override reason/actor. Project connects a won opportunity and accepted estimate, with tasks and financial totals. AI agents, actions, recommendations and approvals preserve context, risk and results. These tables have no execution workflows in Phase 1.

Money is Decimal(14,2), quantity Decimal(12,3), ratio Decimal(7,4). Nullable values represent unknown data, not fabricated zero metrics. Referential actions restrict removal of business records; ephemeral sessions cascade with users. Services enforce cross-record customer consistency. Future accepted-estimate and project workflows must enforce it transactionally.

Database CHECK constraints independently enforce lead score/budget ranges, opportunity probability/value bounds and service pricing bounds. They live in the integrity SQL migration because Prisma schema declarations do not represent these checks. Preserve them when generating future migrations.
