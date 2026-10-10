# Phase 4 mobile-first operations

Based on `96b6433`, branch `feature/phase-4-project-operations`. No schema, migration, dependency, business-data, credential or mail-control changes. The added npm script is test-only.

## Changes

- Shared workspace mobile menu is initially collapsed, has an accessible expanded state and controls, and exposes only existing role-authorized links. Desktop retains the sidebar. Compact grid rows prevent empty header space on short CREW pages.
- Mobile project navigation uses a labeled native selector listing every authorized section, including OWNER finances for OWNER alone. Desktop tabs wrap instead of clipping horizontally.
- CREW starts with assigned tasks and gets sticky shortcuts to tasks, own hours and incident/job logs. The project summary/alerts are expandable instead of pushing primary actions below multiple cards.
- Task progress action appears immediately below its title. Dependencies, completion attribution, history, photos, photo upload, checklist and administrative forms are expandable. Touch targets remain at least 44px and text inputs use 16px mobile sizing. Existing server validations, versioning, evidence requirements and audit events are unchanged.
- OWNER retains all sections and financial forms. No financial data is merely hidden with CSS: the existing server authorization/DTO filtering still excludes it for ADMIN, PROJECT_MANAGER and CREW.

## Automated validation

| Check | Result |
| --- | --- |
| Unit tests | PASS: 72 |
| Integration regressions | PASS: 54 across Phase 1–4 suites |
| HTTP | PASS: CRM, Estimator/PDF, OWNER, AI and operations |
| Financial HTTP isolation | PASS: restricted ledger reference present for OWNER, absent for other roles in both HTML and React Server Component responses |
| Browser navigation | PASS: OWNER, PROJECT_MANAGER and CREW at 375, 390, 430 and 1280px (12 combinations) |
| Lint / TypeScript / production build | PASS |

Browser checks cover menu open/close, every available section, no document-level horizontal overflow, finance section availability, CREW assigned-task isolation, hours/incidents shortcuts, expandable progress fields/photo form, a compact collapsed header and an early first-task progress action. They also reject client/hydration errors. Full-size screenshots were generated and inspected for sample mobile layouts.

**Limits:** this is Chromium viewport emulation and screenshot review, not a physical iPhone or Safari/WebKit review. Native iOS selectors, photo picking/camera behavior, safe-area insets and the on-screen keyboard still need device testing. Desktop was tested at 1280px. Calendars retain their contained horizontal scrolling/list alternative. No offline synchronization was introduced.

## Relevant files

- `src/components/workspace-navigation.tsx` and `workspace-shell.tsx`: compact role-filtered menu, preserving the server/client boundary.
- `src/project-operations/components/sections.tsx`: mobile selector and field shortcuts.
- `src/app/projects/[id]/page.tsx`, `components/form.tsx`, `src/app/globals.css`: summary/task/photo disclosure and responsive layout.
- `tests/operations.http.ts`: navigation and HTML/RSC financial isolation.
- `tests/operations.mobile.mjs`: actual browser navigation/viewport regression. `package.json` exposes `test:operations:mobile`.

The browser test is optional tooling, not an application dependency. It requires Playwright and a Chromium installation in the test environment, a built app server at `SMOKE_BASE_URL`, and `DATABASE_URL` pointing to an isolated `*_test` database seeded by `test:estimator`. It refuses ordinary database names. Optional `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` select externally installed tools; `MOBILE_SCREENSHOTS_DIR` defaults to `/tmp/flipas-mobile-review`. Run `npm run test:operations:mobile` in that prepared environment. Never run fixture tests against the Mac application database. Test-generated credentials are ephemeral and never logged.

## Safe Mac update and review

Keep Docker/PostgreSQL running and Emergency Pause active. Stop Next.js with Ctrl+C, preserve any personal source changes reported by `git status`, then:

```bash
cd ~/Projects/flipas-os-
git status --short
git switch feature/phase-4-project-operations
git pull --ff-only origin feature/phase-4-project-operations
npm run dev
```

No `.env` edit, dependency installation or migration is needed for the application update. Open `/projects` as CREW, choose an assigned project and test Menu, My tasks, Record progress, Add photo evidence, Checklist, My hours and Report incident. With OWNER check the finance section; with PROJECT_MANAGER verify it is absent. Repeat on the actual iPhone and desktop before accepting the UX review. No mail delivery should be enabled for these checks.
