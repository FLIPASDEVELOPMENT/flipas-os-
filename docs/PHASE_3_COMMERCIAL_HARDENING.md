# Phase 3 — commercial assistant hardening

## What changed

The existing Phase 3 application, authentication, scoped CRM and exact-version reply approval are reused. There is no second application or authentication system. Phase 1/2 financial policies and AI budget/rates/counters are unchanged.

OpenAI receives up to six reduced conversation messages (including inbound/outbound direction for drafting) plus an allowlist of same-identity, role-accessible CRM fields: verified name, city/address, lead scope, confirmed customer budget/start date and opportunity stage. It never receives CRM notes, financial policies, internal costs, database handles or tools. Email/history/CRM strings are data, never executable instructions. Existing credential redaction, byte limits, 1500 output-token cap, four-request per-email cap and monthly reservations remain enforced. Recent-message limits are intentional; very long/ambiguous histories need human review.

Extraction now includes explicitly quoted materials, property address and consultation availability. Scalar facts require literal evidence; absent facts remain null. Materials require evidence for every entry. Stored older analyses receive backwards-compatible defaults; the API contract requires all fields explicitly. New questions are selected locally from missing scope, approximate address and consultation availability, with a maximum of three. Email, budget and timeline are never re-requested by this qualification plan. Verified CRM takes precedence for drafting without overwriting CRM records with AI suggestions.

OpenAI must reproduce those locally selected questions exactly. Extra questions, requests for budget/email, invented greeting identities, prices, discounts, guarantees, free consultations and availability claims are rejected. No commercial policy currently authorizes a free consultation, so none is offered. Mock replies use the same plan. Analysis remains a recommendation: exact quote validation cannot prove that the sender's underlying claims are true. Staff must confirm identity and project details.

## CRM and follow-ups

- Manual CRM confirmation requires an accessible contact whose email matches the conversation sender, with same-customer/lead opportunity checks. Email matching alone is not proof of mailbox ownership; verify the identity before confirming. Forwarded names are not automatically promoted to contact identity. Forwarded mail requires review and new-contact creation is blocked in that flow; verify the contact separately in CRM.
- New contacts/leads require a human action, are protected by serializable duplicate checks and never create opportunities automatically. The existing LeadSource enum remains compatible (`OTHER`); description and audit explicitly record MOCK/ZOHO email origin, summary and message references. Confirmed customer fields and lead budgets are not overwritten.
- Different senders inside the same provider thread are separated instead of inheriting the first sender's CRM links. New inbound mail invalidates existing approvals and requires a fresh exact-version approval.
- "Do not contact" is persisted and checked for the sender and linked customer across conversations. Explicit opt-out phrases suppress contact on import. Drafting, approval, send requests and follow-up tasks are blocked. Only OWNER can clear suppression; another suppressed conversation for that identity still blocks contact. Existing tasks are closed on opt-out. No opt-out detection can cover every possible wording: staff can also set the flag manually.
- Follow-up draft suggestions require a real linked opportunity next action and date. WON/LOST opportunities are blocked. One open task and one active follow-up draft per conversation prevent repeated reminders. An existing sent follow-up remains a duplicate; this release does not invent a new campaign or automatically start another sequence. Overdue reminders are internal only; closed/suppressed contacts are excluded.

## Zoho sending preparation — not activation

Official documents inspected on 2026-10-08:

- [Send an email](https://www.zoho.com/mail/help/api/post-send-an-email.html)
- [Mail OAuth](https://www.zoho.com/mail/help/api/using-oauth-2.html)
- [Accounts data centers](https://www.zoho.com/accounts/protocol/oauth/multi-dc.html)

The official send contract is POST `/api/accounts/{accountId}/messages`, with `fromAddress`, `toAddress`, `subject`, `content`; the prepared body explicitly uses plaintext, UTF-8 and no receipt, CC/BCC or scheduling. US uses `accounts.zoho.com`/`mail.zoho.com`; EU uses `accounts.zoho.eu`/`mail.zoho.eu`. The connector preserves the selected existing region; unsupported regions never fall back to US. No DNS, MX, SPF, DKIM or mailbox settings are changed.

Existing OAuth reads only `ZohoMail.accounts.READ`, `ZohoMail.folders.READ`, `ZohoMail.messages.READ`. A prospective **separate** sending authorization uses `ZohoMail.accounts.READ` (verify selected account) and `ZohoMail.messages.CREATE`. No `ALL`, `UPDATE`, `DELETE` or folder-write scopes. The prospective URL builder and pure request preparation are tested but **not wired to a live OAuth exchange or HTTP send**. OWNER Console can record/revoke preparation consent, bound to OWNER, account, region and address, without touching credentials. Consent is never represented as an OAuth grant. Revoking it activates emergency outbound pause.

**Real sending remains locked in request, worker and Zoho provider.** `MailWriteConsent` holds no tokens. There is no env toggle that unlocks real delivery. Actual write-token provisioning and activation remain a separate, explicitly approved step; before that step the future OAuth flow must use separate single-use browser-bound state, immutable region/account snapshots, encrypted write tokens, least-privilege account validation and independent revocation. Do not reuse or silently replace a read token.

The existing mock delivery engine rechecks active requester/approver roles, assignment, pause, connected/consented mailbox, recipient, subject, body hash, current approved version and new inbound state. Delivery uses a unique draft/version attempt and queued job key. APPROVED means content approved, not permission to send. PAUSED is displayed alongside approved content when delivery is blocked. SENT requires confirmation. Ambiguous delivery is FAILED/UNCERTAIN and must be checked externally; send jobs are never automatically retried. The inspected send documentation does not establish provider idempotency, so no unsupported idempotency header or safe-retry claim is made. Local uniqueness cannot solve an unknown external outcome. STARTED/UNCERTAIN attempts block further delivery for the same conversation, including replacement drafts. Identical recipient/subject/body delivery is also blocked across different drafts for 24 hours after a confirmed send. This is a conservative local duplicate check, not provider idempotency.

## Update your Mac

1. Stop the application and worker terminals with Control-C; leave Docker Desktop/PostgreSQL running.
2. In Terminal:

```sh
cd ~/Projects/flipas-os-
git switch feature/phase-3-ai-sales
git pull --ff-only origin feature/phase-3-ai-sales
npm ci
npm run db:generate
npm run db:migrate
npm run test
npm run dev
```

The additive migration is `202610080004_commercial_safety`. It adds contact suppression, CRM confirmation timestamp and prepared write-consent records. It does not reset data, usage, financial settings or credentials. Keep your existing ignored `.env`; no new secret or environment variable is needed.

3. In a second Terminal:

```sh
cd ~/Projects/flipas-os-
npm run worker:ai
```

4. Open the application on your Mac at `http://localhost:3000`. OWNER → AI Administration shows approval attention, separate write-consent preparation and safe request diagnostics. An approved Zoho draft still explains why it cannot be sent.
5. `npm run test` includes Pedro's English/Spanish regression entirely offline using simulated HTTP. To inspect a real classification later, use only an existing authorized test conversation when your budget/per-email limits allow it; each actual analysis/draft can incur provider charges. Never clear counters to bypass a limit.
6. For Pedro's kitchen inquiry in Tampa, $18,000–$25,000, 4–6 weeks, cabinets/countertops/backsplash/LED: the qualification asks only approximate property address and consultation availability if absent. A verified CRM address removes the address question. An explicit available consultation time removes that question too. It does not ask for email, budget or timeline, quote a selling price, promise a date or offer a free visit.
7. Do not authorize or activate live sending in this review. Approval does not send the reply. Keep emergency pause active. No production deployment or merge is part of this change.

## Developer validation

Unit tests: `npm run test`. Database suites `test:integration`, `test:estimator`, `test:owner`, `test:ai`, `test:zoho`, `test:openai`, `test:commercial` require separately migrated disposable PostgreSQL databases with names ending `_test`; do not point them at your development/customer database. HTTP suites run against an isolated test server whose database is the same disposable database. All OpenAI/Zoho operations in these tests are simulated; no real API calls or real emails are used. Run `npm run lint`, `npm run typecheck`, `npm run build` as well.
