export function Notice({ error, saved }: { error?: string; saved?: string }) {
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {(
            {
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
              OUTBOUND_PAUSED: "Outbound mail is paused by the owner.",
              PROCESSING_DISABLED: "AI processing is disabled.",
              LIVE_DISABLED:
                "Live providers remain locked pending documentation verification and owner authorization.",
              INVALID_INPUT: "Check the required fields and date format.",
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
