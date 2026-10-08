# Zoho Mail connector — read only

Implemented on `feature/phase-3-ai-sales`. Verified against public official documentation on 2026-10-08. OAuth, account/folder discovery, encrypted refresh, polling and revocation are implemented and tested with simulated HTTP responses and disposable PostgreSQL databases. No real mailbox authorization, authenticated Zoho call, email delivery or paid model call was performed. **Real email sending is permanently disabled in this phase**, including after human draft approval or disabling the emergency pause.

## Official contracts

- [Mail OAuth guide](https://www.zoho.com/mail/help/api/using-oauth-2.html)
- [Accounts server-based OAuth](https://www.zoho.com/accounts/protocol/oauth/web-server-applications.html)
- [Authorization-code exchange](https://www.zoho.com/accounts/protocol/oauth/web-apps/access-token.html)
- [Regional Accounts servers](https://www.zoho.com/accounts/protocol/oauth/multi-dc.html)
- [Current token revocation](https://www.zoho.com/accounts/protocol/oauth/revoke-refresh-token.html)
- [User accounts](https://www.zoho.com/mail/help/api/get-all-users-accounts.html)
- [Folders](https://www.zoho.com/mail/help/api/get-all-folder-details.html)
- [Message list](https://www.zoho.com/mail/help/api/get-emails-list.html)
- [Message content](https://www.zoho.com/mail/help/api/get-email-content.html)

| Supported region | Accounts origin | Mail REST origin |
| --- | --- | --- |
| US | https://accounts.zoho.com | https://mail.zoho.com |
| EU | https://accounts.zoho.eu | https://mail.zoho.eu |

Both Mail `/api/accounts` origins also returned Zoho's `INVALID_TICKET` JSON on unauthenticated connectivity checks; this verifies reachable API handlers, **not authentication or account eligibility**. Public OAuth documentation was accessible after the environment network change. `www.zoho.eu` mirrors the Mail guide, but its examples still use `.com`; the official Accounts multi-DC guide supplies the EU authorization server.

Accounts documentation additionally lists IN (`accounts.zoho.in`), AU (`accounts.zoho.com.au`), JP (`accounts.zoho.jp`), CA (`accounts.zohocloud.ca`), SA (`accounts.zoho.sa`) and UK (`accounts.zoho.uk`). Those regions remain unsupported in this connector until their Mail service endpoints are independently verified. Canada is **not** `accounts.zoho.ca`. No region is silently redirected to US. China is not listed in the inspected current multi-DC guide and remains unsupported.

OAuth uses GET `/oauth/v2/auth`, `response_type=code`, `access_type=offline`, `prompt=consent` and a single-use state bound to the OWNER/session browser. Token exchange and refresh use POST `/oauth/v2/token` with form-encoded parameters in the **body**, keeping codes, refresh tokens and client secrets out of request URLs. API headers use `Authorization: Zoho-oauthtoken <access-token>`; do not substitute `Bearer` or the token response's `api_domain` for the Mail origin.

Only these scopes are requested:

- `ZohoMail.accounts.READ`
- `ZohoMail.folders.READ`
- `ZohoMail.messages.READ`

No `ALL`, `CREATE`, `UPDATE`, `DELETE` or organization-admin scopes. Mail polling never marks messages read, moves/deletes messages, downloads attachments or sends mail. `ZohoMail.messages.CREATE` is intentionally absent.

**Documentation discrepancy:** Mail's OAuth guide shows the legacy `/oauth/v2/token/revoke` URL. The current dedicated Accounts revocation guide specifies POST `/oauth/v2/revoke/token`, Basic client authentication, form `token` and `token_type=refresh_token`, with HTTP 200 indicating success. This connector follows that dedicated current guide. Local disconnect is immediate; remote revocation stays pending until confirmed, with four worker attempts and OWNER retry controls. OWNER can independently revoke access in Zoho Accounts → Sessions → Connected Apps.

## OWNER configuration requirements

No credentials should be supplied in chat, command history, Git, screenshots or shared logs.

1. Update the existing feature branch locally. Install locked dependencies, regenerate Prisma and apply migrations, including `202610080002_zoho_readonly`. Keep PostgreSQL, the application and `npm run worker:ai` running.
2. Run `npm run env:mail` locally to create a random server encryption key in the ignored `.env`, then restart **both** app and worker. Preserve and privately back up the existing key; regeneration would prevent decrypting existing integrations. Mock-only development needs no key.
3. Set `APP_ORIGIN` to the actual browser address. For native Mac development use `http://localhost:3000`. Public origins require HTTPS. The callback registered in Zoho must exactly match `http://localhost:3000/api/owner/zoho/callback` for that setup (or `<APP_ORIGIN>/api/owner/zoho/callback` elsewhere). Never register a Codex-cloud localhost URL for a Mac-running app.
4. In the matching region's Zoho API Console, register a **Server-based Application**. Ensure the designated business account's Zoho Mail plan/admin policies permit API access. If using a client registered in another DC, configure the required multi-DC client support and region-specific client credentials in Zoho; do not guess a different token server.
5. Sign in with the existing FLIPAS OWNER account and open `/owner/ai`. Privately enter the OAuth client ID/secret, select US or EU, and save. Blank secret input preserves the stored value; the stored secret is never displayed. No Zoho account password is collected by FLIPAS.
6. Click **Authorize read-only Zoho access**. Sign in/consent on Zoho's own screen. Back in FLIPAS, select the commercial mailbox, load folders, select the business-inquiry folder and explicitly confirm authority/consent. Sent, drafts, spam and trash folders are excluded. Authorization setup expires after ten minutes; unfinished grants are encrypted and queued for revocation after expiry.
7. To authorize actual reading, select **Zoho Mail (read only)** and enable processing in `/owner/ai`. Keep AI provider **MOCK** unless separately authorizing transmission of inquiry text to the configured model. An existing mock mailbox does not authorize access to a real mailbox. Queue sync, then check mailbox health/jobs and the inbox. Worker polling follows the OWNER's configured interval.
8. Keep emergency outbound pause enabled. **Unchecking it cannot enable Zoho sending**: request, worker and provider each reject real delivery. A future outbound phase requires separate implementation, permissions, validation and explicit authorization.

OAuth setup grants one selected mailbox per authorization. Disconnect/revoke an existing connection before reconnecting that same account; do not overwrite an outstanding grant. Retry failed revocation jobs in AI Administration or revoke directly in Zoho. Tokens and secrets clear only after confirmed server revocation. Mail configuration does not require changing OWNER passwords, creating a second authentication system, modifying estimates or moving pipeline records.

## Import behavior and limits

The connector reads at most 25 messages per page, plus bounded text content, using the selected account/folder IDs. IDs stay strings to preserve Zoho's long integers. Responses are bounded to 2 MiB; requests time out after ten seconds and reject redirects. HTML is reduced to bounded plain text and rendered escaped. Attachment files/metadata are not imported by the Zoho adapter in this phase. Message recipients in the internal inbound record are normalized to the selected mailbox address; full To/CC headers are not imported.

Cursors persist scan/page progress and a prior head boundary. Every new scan restarts at the newest message and overlaps its prior boundary; message IDs deduplicate in PostgreSQL. Zoho's offset listing is not a transactional snapshot: concurrent delivery/moves may shift pages, and repeated polling catches typical shifts. This is an incremental inquiry inbox, not a guaranteed complete historical archive or sent-message synchronization. A historic message inserted behind the prior boundary may require a fresh full rescan; no manual cursor reset UI is provided yet. Do not rely on this importer for legal archival.

Rate limits return redacted `RATE_LIMIT` and durable exponential retry; no quota numbers are invented. Worker rechecks consent/provider/processing before committing imported mail, so disconnect or concurrent cursor changes cannot commit a stale page. Financial snapshots and CRM records remain untouched by mail import. Model classification and CRM linking retain human confirmation.

Authenticated connectivity, account plan eligibility, a region-specific live OAuth flow and actual mailbox sync remain **OWNER-side validation**, since no credentials were requested or used. Tests are simulations of the verified contracts, not evidence that an external account has been connected.
