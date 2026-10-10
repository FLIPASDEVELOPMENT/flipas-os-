# Project manager and task assignment hardening — 2026-10-10

Branch: `feature/phase-4-project-operations`, based on `50c530f`. No migration is needed: the existing User, ProjectMember, ProjectTask and ProjectEvent models support the correction.

## Findings

The Project details manager selector incorrectly reused the general active-worker list (OWNER, ADMIN, PROJECT_MANAGER, CREW). The server rejected CREW but incorrectly allowed ADMIN. The selector and server now share the exact manager allowlist: active OWNER or PROJECT_MANAGER. The label is **Project Manager**, the current selection is retained when eligible, and a selection placeholder prevents silently choosing the first user for an invalid legacy value. Stored legacy records are not rewritten automatically.

Task assignees come from active users with active membership in this specific project. The workspace user list is based on ProjectMember rows and the project manager, not the global account directory. A newly created CREW account therefore does not appear in an older project's assignee selector until explicitly assigned through Project Crew. A project's age or legacy state is not a selection predicate. This behavior was reproduced with PRE_CONSTRUCTION and PLANNING projects, before and after crew membership.

There was also a server defect: task creation/edit checked active membership but did not recheck the user's active state and eligible role. Both paths now require an existing active account, an eligible operational role and active membership. Existing eligible task roles OWNER/ADMIN/PROJECT_MANAGER/CREW are retained; SALES/CUSTOMER are denied. No automatic membership is inferred from old tasks, names or account creation.

Removing project membership now also clears the same user's project-manager pointer, closing a path by which a removed PM could retain access. Existing task-unassignment/versioning behavior remains. Manager and task-assignee changes record before/after identifiers in project audit events; prior events, progress, photos, logs and financial snapshots are preserved.

The developer environment has no access to the user's Mac database. Miguel's exact IDs/membership have not been inspected; the reproduced missing-membership explanation must be confirmed in the local Project Crew view. Two records sharing a name do not prove identity.

## Safe Mac update and local check

Stop Next.js and the AI worker with Control+C, keeping PostgreSQL running. Preserve any local changes shown by `git status --short`; do not discard them. Then, with a clean tree:

```sh
cd ~/Projects/flipas-os-
git switch feature/phase-4-project-operations
git pull --ff-only origin feature/phase-4-project-operations
npm ci
npm run db:generate
npm run dev
```

This commit adds no migration. If the previous Team update has not yet been applied, back up privately and apply its existing incremental migration with `npm run db:migrate` before starting Next.js; see [TEAM_PERMISSIONS.md](TEAM_PERMISSIONS.md). Do not reset Prisma, delete Docker volumes or replace `.env`. Restart the worker separately with `npm run worker:ai`.

1. As OWNER, open the older project's Scope section. **Project Manager** must list only active OWNER/PROJECT_MANAGER accounts; select the intended account and save.
2. In Project Crew, verify Miguel's precise account/project identifiers, active CREW account and **Assigned** membership. If absent or Removed, explicitly add that account to this project. No global or new-project assignment grants access to the older one.
3. Return to Tasks and expand the existing Install backsplash edit form. Select that assigned worker and save. The page now explains the membership requirement and links directly to Project Crew.
4. As the assigned CREW user, verify the project and task are visible. An unassigned CREW or unrelated PROJECT_MANAGER must not have access. Inspect project Activity for manager/task-assignee events.
5. If the user already has active membership but remains absent, record the project/user IDs and active-role/membership state for investigation; do not create a duplicate account or infer identity from names.

Automated regression covers legacy/new states, existing task progress retention, membership before/after grant, active/role revalidation, unauthorized assignment attempts, financial filtering and assignment audits. HTTP tests inspect the actual manager selector and the Project Crew guidance. External integrations, Emergency Pause, credentials and financial policies are unchanged; no emails are sent.

## Validation results

| Check | Result |
| --- | --- |
| Unit tests | PASS — 75 |
| Integration | PASS — 57 total: CRM 1, estimator 1, OWNER 1, AI 18, Zoho read 1, commercial 7, OpenAI budget 1, Zoho delivery 11, operations 14, team 2 |
| HTTP | PASS — login/CRM, estimates/PDF, OWNER, AI, team and operations; actual manager options exclude CREW/ADMIN/SALES/CUSTOMER |
| Navigation regression | PASS — Chromium OWNER/PM/CREW at 375, 390, 430 and 1280 px |
| Lint / TypeScript / build | PASS |
| Data/migration safety | No new migration or application database changes; test fixtures only in disposable PostgreSQL databases |

The actual Mac records and real-device usability remain user verification steps. No provider calls were made by these tests. No merge or deployment occurred.
