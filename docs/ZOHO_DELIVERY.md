# Zoho sending: connection ready, activation remains disabled

Implemented on `feature/phase-3-ai-sales`. Migration `202610080005_zoho_delivery` adds sending fields and explicitly enables Emergency Pause so an earlier unpaused MOCK test cannot activate real delivery. No financial limits, counters, DNS/MX/SPF/DKIM, passwords or existing Zoho read grants are changed. All provider tests use simulated HTTP and disposable databases.

## Verified official contracts (2026-10-08)

- [Send reply](https://www.zoho.com/mail/help/api/post-reply-to-an-email.html): POST `https://mail.zoho.com/api/accounts/{accountId}/messages/{messageId}`, scope `ZohoMail.messages.CREATE`, JSON `fromAddress`, `toAddress`, `subject`, `content`, `action: "reply"` (official sample), `mailFormat: "plaintext"`, `askReceipt: "no"`, `encoding: "UTF-8"`. No CC, BCC or schedule.
- [Send email](https://www.zoho.com/mail/help/api/post-send-an-email.html): POST same account `/messages` when no reply message exists. Normal Inbox replies select the latest inbound provider message ID, not the last outbound message.
- [Mail OAuth](https://www.zoho.com/mail/help/api/using-oauth-2.html), [server applications](https://www.zoho.com/accounts/protocol/oauth/web-server-applications.html): authorization code with offline access, explicit consent, POST token exchange and refresh. Sending requests only `ZohoMail.accounts.READ,ZohoMail.messages.CREATE`; accounts.READ validates the exact account/address. Existing reading scopes remain unchanged.
- [Multi DC](https://www.zoho.com/accounts/protocol/oauth/multi-dc.html): US `https://accounts.zoho.com`; EU `https://accounts.zoho.eu`. Mail hosts are fixed to `https://mail.zoho.com` / `https://mail.zoho.eu`. Callback-provided URLs and token `api_domain` never become network destinations.
- [Current Accounts revocation](https://www.zoho.com/accounts/protocol/oauth/revoke-refresh-token.html?source=oauth): POST `/oauth/v2/revoke/token`, Basic client authentication, form `token`, `token_type=refresh_token`; HTTP 200 confirms revocation. The older Mail guide's legacy endpoint is not used. The canonical page initially returned 404; the official index still links it and this official query URL returned the current contract.
- [Response codes](https://www.zoho.com/mail/help/api/response-codes.html): 200 successful / 201 created. Adapter requires a bounded JSON status acknowledgement with either code. Unexpected, empty or unreadable success envelopes remain uncertain.

The account screenshots show `accounts.zoho.com` (US). Cloud tests cannot authenticate or independently inspect the Mac mailbox. The actual connection's stored region/account/address and the returned OAuth location/server are verified before installing a grant; an account mismatch is rejected and encrypted cleanup is queued. Unsupported regions are blocked, not guessed. US/EU support is inherited; no multi-DC configuration changes are performed.

The send/reply pages do not guarantee a `messageId` response field or a provider idempotency header. We do not invent either contract. If a numeric string messageId is present it is recorded; otherwise a confirmed acknowledgement is recorded with a clearly labelled **local** `zoho-ack:<attempt-key>` reference. SENT means provider API acceptance, not proof of delivery to the recipient. Unexpected envelopes remain UNCERTAIN for manual verification.

## Controls and lifecycle

`MailWriteConsent` now holds an independent encrypted sending grant, client-secret snapshot, expiry, authorization timestamp, account/region/address and separate delivery controls. It never replaces `MailConnection` reading credentials. If Zoho returns the same refresh token as the reading grant, installation is rejected without revoking that shared token; a separate sending OAuth client is then required to preserve independent revocation. Secrets use the existing AES-GCM server encryption key. OWNER/browser-bound one-use OAuth state captures purpose, exact mailbox and consent timestamp. READ state cannot install a SEND grant. Returned scope information, when present, must match the minimal requested grant; rejected post-exchange grants are durably encrypted for cleanup. Refresh is serialized on the write grant and preserves an omitted refresh token. Failures disable mailbox sending and expose safe codes only.

Revoking sending immediately disables it and enables Emergency Pause. A durable REVOKE_WRITE worker job revokes the independent refresh token; encrypted credentials clear only after confirmation. Failed jobs can be retried by OWNER. Reading stays connected. Disconnecting the entire mailbox queues both revocations and pauses delivery. An OAuth authorization can show extra already-connected apps in Zoho Accounts; do not broadly revoke the whole client if reading must remain active.

Three gates are required: private server `ZOHO_SEND_ENABLED=true`, active sending grant with `sendEnabled=true`, and Emergency Pause explicitly cleared. Defaults are env gate absent/false, mailbox disabled, Emergency Pause true. Connecting OAuth and testing account access do not unlock any gate. Existing legacy `liveAuthorized` remains false and is not an activation switch.

Approval identifies **draft ID + version**, not merely "Version 1". OWNER UI shows draft IDs. Editing invalidates approval. New inbound messages invalidate approvals. Send is a separate human server action, with current assignment, active sender/approver, roles, recipient, subject, body hash, exact approved version, opt-out and pipeline-closure checks. Dispatch repeats these checks and locks settings/grant/draft/users/conversation across its bounded POST so committed pause/revocation cannot be bypassed. Tokens, raw provider responses and secrets never appear in audit or UI.

One durable attempt per draft/version plus conversation locks prevent competing workers. Any STARTED/UNCERTAIN attempt blocks replacement drafts in that conversation; identical confirmed content is blocked for 24 hours. No SEND job automatically retries, including 401/403/429. Explicit rejection and known pre-dispatch blocks become DEFINITELY_FAILED attempts / FAILED drafts; network, timeout, 5xx or ambiguous acknowledgement becomes UNCERTAIN / FAILED. A crashed worker's lease is recovered as uncertain. Do not create another draft to evade an uncertain result. Verify Zoho Sent/the recipient manually first; there is no automatic uncertain-result reset.

OWNER Console defaults to **one self-addressed test**, and the durable test-attempt marker is never reset on reconnect. Authorizing a mode retains Emergency Pause. A separate Approved replies mode requires explicit OWNER consent, deployment enablement and manual unpause; it is not selected or activated by this implementation. The self-test must target the exact connected address; aliases or another OWNER address do not qualify.

## Update the Mac safely

Stop Next.js and the worker with Control+C. Keep Docker/PostgreSQL running. In Terminal:

```bash
cd ~/Projects/flipas-os-
git switch feature/phase-3-ai-sales
git pull --ff-only origin feature/phase-3-ai-sales
npm ci
npm run db:generate
npm run db:migrate
npm run test
npm run dev
```

In a second Terminal:

```bash
cd ~/Projects/flipas-os-
npm run worker:ai
```

No new secret is required. Reuse the existing client configuration and ignored `.env` encryption key. The only new private switch is `ZOHO_SEND_ENABLED`; **leave it absent or `false` now**. Never prefix it or any secret with NEXT_PUBLIC_. Never paste keys, client secrets or refresh tokens in chat. Do not regenerate the encryption key; keep its existing secure backup. Server-side failures are logged only with safe codes; Next.js development request logging excludes the OAuth callback. Configure infrastructure access logs to redact OAuth callback query strings (authorization codes), never full request URLs.

## OWNER: connect and prepare (safe stopping point)

1. Open the Mac's `http://localhost:3000`, sign in as OWNER, go to Owner Console → AI Administration.
2. Keep Emergency Pause checked. Keep `ZOHO_SEND_ENABLED` absent/false. Existing reading/synchronization continues.
3. In Separate Zoho sending authorization, confirm the exact address, account and region of the existing connection. Prepare sending consent if required.
4. Click Authorize sending in Zoho, explicitly consent to this mailbox, and approve Zoho's own OAuth screen. The same registered callback is reused: `http://localhost:3000/api/owner/zoho/callback`; no redirect/DNS changes are needed if reading OAuth already works. Use the correct Zoho account. The new token requests account READ and message CREATE only.
5. Back in FLIPAS, check OAuth sending authorized, mailbox PAUSED and Emergency Pause PAUSED. Click Test access — no email sent. This calls account discovery only and proves the correct account token can be renewed/read; it does not prove SMTP delivery or exercise CREATE.
6. In Zoho's own UI, manually send a clearly labelled internal test inquiry from the connected mailbox to **that same address**. This is an OWNER action outside automated testing, not an application send. Sync it into FLIPAS. If the provider omits self-addressed inbox items, do not use another recipient or weaken recipient validation; verify folder placement in Zoho first.
7. Review/classify it, generate or edit one concise test reply, submit and approve the exact draft ID/version. Do not click Send or change activation settings yet.

**Stop here. No application email has been sent.**

## Later, only after explicit approval: exactly one real self-test

These are future steps, not performed by this implementation:

1. Set private `.env` `ZOHO_SEND_ENABLED=true` locally and restart **both** Next.js and worker. Do not print `.env` contents or commit it.
2. OWNER keeps Delivery authorization = One self-addressed test only, checks the explicit authorization checkbox and clicks Authorize mailbox delivery. This enables only that mailbox/test mode and keeps Emergency Pause enabled.
3. Confirm the approved draft ID/version, recipient equal to the connected address, subject and body. If anything changed, submit/approve the new exact version first.
4. OWNER explicitly clears Emergency Pause through existing AI settings. Processing must be enabled and sending role authorized.
5. Click Send approved reply **once**. The worker dispatches one POST. Additional clicks/workers are blocked; the self-test allowance is consumed at claim, even if delivery subsequently fails. No automatic retry.
6. Verify SENT / acknowledgement and audit, then verify the actual message in Zoho Sent and the self inbox. UNCERTAIN requires external review and must not be retried. FAILED explains rejection or a local block.
7. Restore Emergency Pause, disable mailbox sending, set `ZOHO_SEND_ENABLED=false`, and restart server/worker. Optionally Disconnect sending & revoke token; reading remains enabled.

## Automated validation

`npm run test` includes offline transport tests. `npm run test:zoho:delivery` requires an explicitly disposable PostgreSQL database ending `_test`, migrated first; never point it at the Mac development/customer database. Existing CRM, Estimator, OWNER, AI, Zoho read, OpenAI budget and commercial integration suites remain regression checks. No test obtains a real OAuth grant or sends real email. The synthetic transport gate is enabled only inside the isolated test process and removed afterward; deployment configuration remains unchanged.

### Access test feedback

`Test access — no email sent` calls `writeConnectionAction` → `testWriteConnection` → Zoho `GET /api/accounts`, using the independent sending grant. An expired OAuth token may be refreshed through the token endpoint; no Mail send/reply endpoint is called. Emergency Pause and mailbox delivery authorization are unchanged.

The mailbox panel shows the latest **Access test successful/failed**, its recorded date/time in ET, and a readable result. Both outcomes are audited as `MAIL_WRITE_CONNECTION_TESTED` with actor, mailbox ID, success and an allowlisted error code. Raw provider responses, cookies and tokens are never included. This is an account-access check, not proof of delivery permission or email delivery. Historical audit entries without an explicit outcome are not presented as verified results; test again.

A Next.js Server Action HTTP 200 is a transport response, not the Zoho result. Read the explicit result beside the button. Permission failures before authorized mailbox access are rejected, without creating a test record for another owner's mailbox. No database migration or environment change is required for this feedback fix.
