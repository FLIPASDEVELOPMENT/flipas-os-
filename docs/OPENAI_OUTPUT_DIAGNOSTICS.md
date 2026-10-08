# OpenAI: invalid structured output investigation — 2026-10-08

## Confirmed defects and limits of the diagnosis

The previous API request used `strict: false` with the storage schema, including defaulted classification fields. Local validation expected complete fields and literal evidence, but an unconstrained response could omit fields or normalize an extracted fact differently from its quote. In addition, the budget wrapper replaced every post-usage error with `INVALID_AI_OUTPUT`; response status, JSON parsing, Zod failures and evidence failures were indistinguishable. Provider failures were also collapsed into generic errors. The inbox therefore showed no actionable cause.

The actual response from the user's Mac is not available in this Codex workspace. Its private API key is not configured here. Read-only inspection found no OpenAI execution records or output errors in this workspace's application database/logs. The old code did not retain enough detail to establish which validation stage failed for that exact message. These implementation defects were reproduced with synthetic Responses envelopes; this is not a claim to have inspected or successfully re-run the user's authenticated request.

## Changes

- Separate API schema from backwards-compatible stored intelligence. All API fields are explicitly required, nullable facts remain nullable, no legacy defaults are sent, and the request sets `strict: true`. Draft JSON rejects extra fields too.
- Prompt specifies exact JSON field names, null for absent values, concise output and literal extracted values rather than translated/reformatted facts.
- Local validation still checks JSON, schema, forbidden tool calls/refusals, exact evidence, sender binding and draft safety. No heuristic repair, fabricated facts or unsafe fallback is accepted. Partial responses are never saved as recommendations.
- Specific safe error codes survive the usage wrapper and appear in OWNER recent operations. Audit history shows allowlisted diagnostic stages/field names or HTTP status, never raw provider error messages, email content, keys or field values.
- SDK timeouts/network failures, HTTP permissions/model/request errors, incomplete output, invalid JSON, invalid schema, unsupported evidence and refusals are distinct. Terminal output/configuration errors do not trigger automatic worker retries.
- Observed tokens/cost remain recorded even for invalid/incomplete output. Unknown outcomes retain their reservations. Monthly limits, rates, output cap, per-email cap and financial policies are unchanged.
- Human approval of each exact response version and backend blocks on real email delivery remain intact.

## Codes shown to the OWNER

| Code | Meaning |
| --- | --- |
| `AI_CONFIG_REQUIRED` | Missing/invalid private server configuration. |
| `AUTH_REQUIRED` | Authentication rejected; verify private project key. |
| `AI_API_PERMISSION_DENIED` | HTTP 403; project/API permissions. |
| `AI_MODEL_UNAVAILABLE` | HTTP 404; model/project access or model ID. |
| `AI_API_REQUEST_REJECTED` | HTTP 400; request/schema/model incompatibility. |
| `RATE_LIMIT` | HTTP 429; quota or rate limit. |
| `JOB_TIMEOUT` / `PROVIDER_FAILURE` | Timeout/network failure; provider charge may be uncertain. |
| `AI_OUTPUT_INCOMPLETE` | Response did not complete; no partial recommendations saved. |
| `AI_OUTPUT_REFUSED` | Model refusal; manual review. |
| `INVALID_AI_OUTPUT_FORMAT` | Invalid JSON. |
| `INVALID_AI_OUTPUT_SCHEMA` | Missing/invalid/unexpected fields; audit lists safe field names. |
| `INVALID_AI_OUTPUT_ENVELOPE` | Invalid response envelope or absent/invalid usage. |
| `INVALID_AI_OUTPUT_EVIDENCE` | Extracted fact or quote does not match the reduced inquiry. |
| `INVALID_AI_OUTPUT_UNSAFE` | Reply violates existing safety rules. |

Old records retain the old generic error code; the fix cannot recover discarded provider output. Do not paste keys, `.env`, raw API errors or private mail into chat. If another test fails, report only the new safe code and the diagnostic stage/field names shown in OWNER Console.

## Local update on macOS

First stop both application and worker terminals with Control-C. Keep Docker Desktop running. Then:

```sh
cd ~/Projects/flipas-os-
git switch feature/phase-3-ai-sales
git pull --ff-only origin feature/phase-3-ai-sales
npm ci
npm run dev
```

In a second terminal:

```sh
cd ~/Projects/flipas-os-
npm run worker:ai
```

No schema migration or new API-key configuration is required for this fix. Preserve `.env`, existing credentials and PostgreSQL data. Do not run `npm audit fix --force`, migration resets or volume removal.

Open `http://localhost:3000/ai/inbox`, select the kitchen test and analyze it once. Review `/owner/ai` → Recent OpenAI operations and Audit history. A synthetic request with subject **Kitchen Remodeling Estimate – Tampa, FL** and a kitchen estimate request is tested as `POTENTIAL_CUSTOMER` / `Kitchen Remodeling`; Tampa is supported by the literal subject. Absent name, phone, budget and timeline remain null and urgency UNKNOWN. This fixture is not the unavailable real email body.

The four-request per-email cap still applies, including prior failures. If `AI_EMAIL_LIMIT` appears, do not clear usage or bypass controls; review manually. No request is automatically retried for schema/format/incomplete/evidence failures, and no real mail is sent.

## Validation

42 unit tests passed, including valid kitchen requests, strict schema requirements, incomplete output with observed tokens, invalid JSON, missing fields, fabricated evidence, refusal, malformed usage and safe HTTP error mapping. PostgreSQL integration verifies persisted error codes, safe audit diagnostics, token costs and uncertain reservations. Existing CRM/Estimator/OWNER/AI/Zoho regression suites, permission/CSRF HTTP checks, ESLint, TypeScript and production build are included in validation. Only synthetic keys and simulated OpenAI HTTP were used; no paid calls or real sends.

## Follow-up after b907627: intermittent rejection

A second defect was reproduced without OpenAI access: the adapter validated evidence against `minimalInquiry` (HTML converted to text, reduced and redacted), whereas `analyzeConversation` revalidated against the original body. For example, a quote spanning `<b>Tampa, FL</b>` is valid in the actual input but absent from the original HTML. The service then threw generic `INVALID_AI_OUTPUT` after the usage wrapper had already recorded success. Both boundaries now use the same reduced evidence view, with sender addresses resolved locally. Exact quote matching, missing-fact checks and sender binding remain enforced; invented evidence is still rejected.

The Responses lifecycle is now checked before requiring completed-response usage/output. An incomplete or failed envelope with null usage is therefore correctly categorized, with uncertain reservations retained. Message-level incomplete status is rejected. Only the single assistant message supplies the JSON; reasoning content is excluded and tool calls still fail. Missing fields, invalid enums, invalid nonnullable nulls and additional properties remain failures under the strict schema.

OWNER recent operations now display safe diagnostics next to the matching usage row, independently of the latest 50 audit events. Old generic rows are identified explicitly. Existing totals and old error codes do not disappear on restart or update. The six Mac operations alone cannot identify which responses failed at which stage; their unavailable raw responses are not reconstructed or requested.

Before a paid test, run `npm run test` locally: all OpenAI unit fixtures use simulated HTTP. No migration or `.env` change is required. After restarting both processes, inspect the timestamp of a **new** operation rather than expecting the five old errors to change. If a new request is permitted by existing budget/per-email limits, test only one synthetic kitchen inquiry. Do not clear counters or bypass `AI_EMAIL_LIMIT`. Report only its safe code and validation stage if it fails.

Follow-up validation covers the complete service persistence path for HTML evidence with a simulated SDK response, recursive required/additional-property schema checks, lifecycle failures without usage, incomplete assistant messages, reasoning exclusion, and rendered OWNER diagnostics for format/schema/incomplete/refusal. No real API calls, mail delivery or production data resets are used.
