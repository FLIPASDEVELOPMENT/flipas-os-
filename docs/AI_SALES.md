# Phase 3 — AI Sales internal checkpoint

Status: AI Sales and the read-only Zoho Mail connector are implemented on `feature/phase-3-ai-sales`. Official Zoho Mail/OAuth documentation is now accessible and was verified on 2026-10-08. OAuth, refresh, selected-folder import and revocation are tested with simulated HTTP and PostgreSQL; no real account was authenticated. **Real email sending remains disabled in all backend layers.** MOCK remains the default provider, and actual reading requires explicit OWNER configuration/consent. No main merge or production deployment. See [Zoho Mail setup and official contracts](ZOHO_MAIL.md).

## What you can inspect

- `/ai`: database counts of potential leads, pending reviews/replies, overdue tasks, conversations requiring attention, open opportunities without updates for 14 days, mailbox health. No fabricated performance metrics.
- `/ai/inbox`: assigned inbox for SALES, searchable subjects/senders, category and unread/unprocessed filters. Latest 100 results.
- `/ai/inbox/[id]`: plain-text message history, sender, structured extraction with confidence and exact evidence references, missing project details, recommended qualifying questions/template, human classification, CRM links, representative assignment by OWNER, follow-ups and English/Spanish reply drafts.
- `/ai/follow-ups`: actual assigned due/overdue tasks and completed history. Open a conversation to draft a follow-up; no reminder sends mail.
- `/owner/ai`: OWNER-only processing toggle, emergency outbound pause, role configuration, mock initialization, mailbox health, recorded usage, jobs, send attempts and audited changes. Zoho is available for explicitly authorized read-only access in US/EU. OpenAI requires an OWNER-entered encrypted key and model.
- Customer records show linked conversations, filtered by the user's mail assignments.

Mock mail imports two synthetic `example.invalid` messages clearly labeled DEVELOPMENT ONLY: a kitchen inquiry and a newsletter. The mock AI uses deterministic heuristics and neutral canned replies, not a language model. Its confidence is explicitly a development indicator. Unknown names, phone, location and timeline stay null. Only explicit budget text is extracted. No attachments are downloaded, rendered or executed.

## Safe local startup on the existing Mac checkout

Do not overwrite `.env`, recreate the OWNER, or reset the PostgreSQL volume. Stop your existing Next development process with Control-C before updating. In a terminal already inside `~/Projects/flipas-os-`:

```sh
git fetch origin
git switch feature/phase-3-ai-sales
git pull --ff-only origin feature/phase-3-ai-sales
npm ci
npm run db:generate
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait db
npm run db:migrate
npm run dev
```

In a **second terminal**:

```sh
cd ~/Projects/flipas-os-
npm run worker:ai
```

Keep both terminals and Docker Desktop running. Open `http://localhost:3000` on your Mac, sign in with your existing OWNER account, and open Owner Console → AI Administration. Click **Initialize mock mailbox**. The worker imports/analyzes the synthetic mail. Open AI Center → Inbox. This localhost address only works on the computer running the application, not from the Codex cloud machine to your Mac.

Try the kitchen conversation: review classification, provide verified names when confirming a new lead, create a follow-up, generate a reply, edit and submit its exact version, approve it, then request a **simulated** send. Outbound is paused by default; to test a simulated send the OWNER must explicitly uncheck the pause and save. Mock provider sends have `mock-` identifiers and never reach an external mailbox. Editing an approved version always clears approval. The newsletter cannot create a lead or draft until a human deliberately changes its classification. Existing email matches must be linked explicitly; ambiguous/hidden matches are never imported automatically.

Follow-up times use a date/time picker in your browser’s local time zone; the browser submits a validated UTC instant. Display times use America/New_York.

## Data model and delivery integrity

Migration `202610080001_ai_sales` adds `SalesAISettings`, `MailConnection`, `MailConversation`, `MailMessage`, `SalesEmailDraft`, `SalesEmailVersion`, `MailSendAttempt`, `SalesFollowUp`, `SalesJob`, `MailOAuthState`, and `SalesAIUsage`. Existing CRM, financial-policy snapshots, estimates and project handoff are untouched.

Draft states: GENERATED → PENDING_REVIEW → APPROVED → SENDING → SENT. A human edit creates a new immutable version with a content digest, changes status to EDITED and clears approval/request metadata; rejected drafts may be resubmitted. Exact versions are immutable at PostgreSQL level. Each send creates one unique durable attempt for the draft/version. Worker rechecks active requester/approver, current role grants, assignment, approved version, connection consent and emergency pause immediately before claiming delivery.

The pause linearizes at the database send claim: it prevents new claims, but cannot recall an email whose claim already committed or which is already in transit. A transport failure or a crash after send claim is **UNCERTAIN**. The system never automatically retries that send, including after editing to a new version. Verify the provider mailbox externally before human reconciliation; this checkpoint has no automated reconciliation action.

SYNC, ANALYZE, SEND, REMIND and RETENTION jobs live in PostgreSQL. Polling inserts unique time-bucket jobs, workers atomically claim with `FOR UPDATE SKIP LOCKED`, non-send failures back off exponentially (maximum four attempts), and jobs have a 90-second abort deadline and expired 120-second leases are recovered. Sends are never retried automatically. Worker restart resumes database state; its runner timer is not the source of truth. Pagination continuation is persisted, message IDs deduplicate, and no inbound mail automatically changes pipeline stages or creates opportunities, estimates or projects.

## Security and current limits

- Existing Phase 1 sessions/RBAC and Next server-action origin checks protect mutations. OWNER-only settings; OWNER/ADMIN CRM roles can inspect mail, SALES only assigned conversations; other roles denied. OWNER can grant approval/sending to ADMIN/SALES without expanding SALES record scope.
- Integration secrets and token sets use randomized AES-256-GCM with a server-only 32-byte hex `MAIL_ENCRYPTION_KEY`. There is no default key and no secret values returned to browsers, audit records or logs. `npm run env:mail` securely appends a random key to your existing ignored `.env`; it preserves an existing key. Securely back it up and never commit or paste it. Losing/changing it requires reconnecting integrations. Mock-only mode needs no key.
- Provider-independent OAuth state helpers bind owner/browser, hash state, expire after ten minutes and consume once. The connector uses them for its actual OWNER-only OAuth start/callback and account/folder selection flow. Provider-independent token lifecycle tests cover authenticated storage, serialized refresh, rotation and redacted failures; real exchange remains unrun; the adapter contract is exercised with simulated responses.
- Model abstraction receives only the inquiry and can never call CRM/financial/send tools. Mock output ignores prompt injection. Structured facts require exact message evidence; outgoing approval blocks price/discount/contractual/sensitive terms. **This is not a claim that live-model prompt injection defenses have been validated.** Live-model use is disabled by default; OWNER must explicitly configure a key/model and select OpenAI before calls can occur.
- Email HTML is displayed as escaped plain text; bodies limited to 30 KB; bounded metadata accepts PDF/images/TXT <=5 MiB. Attachments are never fetched.
- Retention setting removes old inbox bodies/attachment metadata and stale extracted intelligence. Exact draft versions and audited communications remain retained for human review. This is **not** complete erasure of all customer PII. An audited/legal retention policy for drafts, addresses and history remains a live-rollout requirement.
- Provider error text is replaced by allowlisted codes. Only explicitly authorized US/EU Zoho mailboxes/folders can be connected and synchronized. Real sending remains blocked. UI usage counts describe actual mock operations; model costs are estimated only when OWNER supplies both token rates; unknown costs are unavailable, not invented.
- No paid provider calls or customer communications occurred during development. No Zoho password is needed or requested.

## Docker

The existing compose stack now includes `sales-worker` using the tools image. `app` and worker use the same database and optional server encryption key. Keep credentials only in ignored local environment configuration. Full container deployment requires DATABASE_URL using hostname `db`, as in the existing README; native Mac development uses the loopback PostgreSQL port.

```sh
docker compose build app migrate sales-worker
docker compose up -d --wait db
docker compose run --rm migrate
docker compose up -d app sales-worker
```

## OWNER setup for read-only Zoho

Follow [ZOHO_MAIL.md](ZOHO_MAIL.md) for official endpoint/scope evidence, exact callback registration and private configuration requirements. Migration `202610080002_zoho_readonly` adds encrypted, short-lived `MailOAuthGrant` staging and stores the callback URI in OAuth state. REVOKE/REVOKE_GRANT jobs handle disconnected/unfinished authorization; failed revocations have OWNER retry controls. Real sending cannot be enabled with settings or approval. No external credentials are requested in chat.

## OpenAI adapter configuration (optional, owner-authorized only)

The adapter uses `POST https://api.openai.com/v1/responses`. This contract was verified on 2026-10-08 against official OpenAI SDK documentation and generated OpenAPI types:

- https://github.com/openai/openai-python/blob/main/README.md
- https://github.com/openai/openai-python/blob/main/src/openai/_client.py
- https://github.com/openai/openai-python/blob/main/src/openai/resources/responses/responses.py
- https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response_format_text_json_schema_config_param.py
- https://github.com/openai/openai-python/blob/main/src/openai/types/responses/response_usage.py

No model is hard-coded. Use a model supported by your provider account and Responses JSON Schema output. Configure `npm run env:mail` locally first, restart app/worker so both inherit the key, and enter the provider key and model in `/owner/ai` only when the OWNER authorizes transmitting inquiry text to OpenAI. Keep MOCK selected otherwise. OpenAI receives no CRM database, financial settings, credentials or tool permissions. Actual input/output token counts are recorded after validated successful responses; optional OWNER-supplied USD/million token rates estimate cost with decimal arithmetic. Missing rates produce no cost estimate. Provider-side billing after an uncertain/rejected response is not captured as confirmed usage.

`store:false`, no tools, 45-second request timeout, 150 KB response limit, bounded recent inbound context, basic credential redaction, schema/evidence checks and outgoing restrictions apply. Structured format uses `strict:false` plus strict local Zod/evidence validation rather than claiming full support for every schema constraint in all models. Models can still fail/refuse; those outputs are rejected and never automatically sent. Request error bodies are never logged. Live `api.openai.com` network access is required only after OWNER authorizes this optional adapter. No paid call was made in validation.
