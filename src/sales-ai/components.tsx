export function Notice({ error, saved }: { error?: string; saved?: string }) {
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {(
            {
              INVALID_AI_OUTPUT:
                "OpenAI output could not be validated. Review the operation error code in OWNER Console.",
              INVALID_AI_OUTPUT_FORMAT:
                "OpenAI returned invalid JSON. No recommendations were saved; review the operation in OWNER Console.",
              INVALID_AI_OUTPUT_SCHEMA:
                "OpenAI returned missing, invalid or unexpected fields. No recommendations were saved.",
              INVALID_AI_OUTPUT_ENVELOPE:
                "OpenAI returned an invalid response envelope or missing token usage. Review the operation in OWNER Console.",
              INVALID_AI_OUTPUT_EVIDENCE:
                "Extracted facts do not match literal email evidence. Review the email manually; no unsupported facts were saved.",
              INVALID_AI_OUTPUT_UNSAFE:
                "The generated draft failed content safety checks, not a self-mail restriction. No reply was saved or sent. OWNER: review the latest DRAFT operation and Draft safety reason in AI Administration; older operations may have no detailed reason.",
              AI_OUTPUT_INCOMPLETE:
                "OpenAI did not finish the response, possibly because of the output limit. No partial recommendations were saved. Review manually; do not repeatedly retry.",
              AI_OUTPUT_REFUSED:
                "OpenAI declined this analysis. Review the message manually.",
              AI_RESPONSE_FAILED:
                "OpenAI could not complete the response. Review the operation status; no recommendations were saved.",
              AI_API_PERMISSION_DENIED:
                "OpenAI denied permission for this project or API operation. Check the private key’s project permissions.",
              AI_MODEL_UNAVAILABLE:
                "The configured model is unavailable to this OpenAI project. Verify OPENAI_MODEL and project access.",
              AI_API_REQUEST_REJECTED:
                "OpenAI rejected the API request. Verify model compatibility with Responses and structured JSON output.",
              RATE_LIMIT:
                "OpenAI rejected the request because of rate or quota limits. Review project usage and billing.",
              JOB_TIMEOUT:
                "The OpenAI request timed out. Its outcome and provider charge may be uncertain; review the reserved amount.",
              PROVIDER_REJECTED:
                "The provider returned an API error. Review the operation code in OWNER Console.",
              AI_CONFIG_REQUIRED:
                "Configure the private OpenAI server environment, model and verified prices first.",
              AI_PAUSED:
                "AI requests are paused by the OWNER. Mail sending remains disabled.",
              AI_BUDGET_LIMIT:
                "Monthly AI budget cannot cover this request. Review consumption and pending reservations in OWNER Console.",
              AI_EMAIL_LIMIT:
                "This email reached its four-request limit, including analysis and drafts. Continue manually.",
              AI_REQUEST_LIMIT:
                "This inquiry exceeds the request size limit. Review it manually.",
              HUMAN_REVIEW_REQUIRED:
                "Review and confirm this message’s commercial classification before creating a lead or reply.",
              NOT_COMMERCIAL:
                "Review and confirm the commercial classification before creating a lead or reply.",
              MATCH_REQUIRES_CONFIRMATION:
                "This email already matches a contact. Confirm an existing CRM link; ask the OWNER if the contact is outside your assigned records.",
              CRM_LINK_MISMATCH:
                "Choose a customer, lead and opportunity that belong together.",
              ASSIGNEE_REQUIRED:
                "Choose an active OWNER, ADMIN or SALES representative.",
              DRAFT_CHANGED:
                "This draft changed or is already sending. Reload before editing or approving.",
              RECIPIENT_MISMATCH:
                "The recipient must match this conversation’s sender.",
              DRAFT_NOT_REVIEWABLE:
                "Save changes and submit the draft for review before approval.",
              UNSAFE_REPLY:
                "Remove prices, discounts, guarantees and sensitive terms. Use the Estimator for pricing and contractual review.",
              APPROVAL_REQUIRED:
                "Approve this exact message version before requesting delivery.",
              DELIVERY_ALREADY_ATTEMPTED:
                "This delivery was already attempted. Verify the provider mailbox; do not retry an uncertain delivery.",
              AUTH_REQUIRED:
                "Check the private server configuration or reconnect the authorized mailbox.",
              ACCESS_DENIED:
                "Your role or assignment does not permit this action.",
              WRITE_AUTH_REQUIRED:
                "This mailbox has read-only authorization. Separate OWNER write consent and Zoho write authorization are required; real delivery remains disabled.",
              CONTACT_SUPPRESSED:
                "This contact requested no further contact. Drafting, approval, sending and follow-ups are blocked.",
              IDENTITY_REVIEW_REQUIRED:
                "Forwarded mail requires manual identity verification. Do not create a contact from the quoted sender.",
              FOLLOW_UP_CLOSED:
                "This opportunity is closed. No follow-up or outbound action is allowed.",
              FOLLOW_UP_DUPLICATE:
                "An open follow-up task or draft already exists. Review it instead of creating a duplicate.",
              FOLLOW_UP_EVENT_REQUIRED:
                "Set a verified pipeline next action and date before drafting a follow-up.",
              OUTBOUND_PAUSED: "Outbound mail is paused by the owner.",
              PROCESSING_DISABLED: "AI processing is disabled.",
              LIVE_DISABLED:
                "Deployment or mailbox delivery is disabled. OAuth authorization and draft approval do not activate sending.",
              INVALID_INPUT: "Check the required fields and date format.",
              SEND_REJECTED:
                "Zoho explicitly rejected the request. No automatic retry; review authorization and create a newly approved draft only after verification.",
              SHARED_GRANT_REJECTED:
                "Zoho reused the reading refresh token. Sending was not connected or revoked; use a separate sending OAuth client to preserve reading access.",
              ACCOUNT_MISMATCH:
                "The authorized Zoho account does not match the selected mailbox. No sending grant was installed.",
              TEST_RECIPIENT_REQUIRED:
                "Self-addressed test mode can only send to the connected mailbox's own address.",
              TEST_ALREADY_ATTEMPTED:
                "The one-mail test attempt has already been consumed. Do not retry automatically.",
              SEND_UNCERTAIN:
                "Delivery is uncertain. Verify the provider mailbox; do not retry.",
              PROVIDER_FAILURE:
                "The action could not complete. Check the draft state, required fields and administration job status.",
            } as Record<string, string>
          )[error] ??
            "Unable to complete the action. Reload and check your permissions."}
        </p>
      )}
      {saved && (
        <p className="ai-success" role="status">
          Saved.
        </p>
      )}
    </>
  );
}
export function Mode({ provider }: { provider: string }) {
  return (
    <span className="badge">
      {provider === "MOCK" ? "MOCK · development only" : provider}
    </span>
  );
}
export function DateTime({ date }: { date: Date }) {
  return (
    <time dateTime={date.toISOString()}>
      {date.toLocaleString("en-US", {
        timeZone: "America/New_York",
        dateStyle: "medium",
        timeStyle: "short",
      })}{" "}
      ET
    </time>
  );
}
