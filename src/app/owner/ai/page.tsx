import { realDeliveryEnabled } from "@/sales-ai/domain/delivery";
import { z } from "zod";
import { budgetSummary } from "@/sales-ai/server/budget";
import { openaiStatus } from "@/sales-ai/server/openai-config";
import { callbackUri, readScopes } from "@/sales-ai/providers/zoho";
import { requireOwner } from "@/owner/auth";
import { db } from "@/server/db";
import {
  initialize,
  configuration,
  mailboxAction,
  connectZoho,
  retryRevocation,
  writeConsentAction,
  connectZohoSending,
  writeConnectionAction,
} from "@/sales-ai/actions";
import { DateTime, Mode, Notice } from "@/sales-ai/components";
const diagnosticView = z.object({
  stage: z.enum([
    "API",
    "ENVELOPE",
    "COMPLETION",
    "FORMAT",
    "SCHEMA",
    "EVIDENCE",
    "SAFETY",
  ]),
  invalidFields: z
    .array(
      z.enum([
        "response",
        "status",
        "output",
        "usage",
        "body",
        "mailKind",
        "language",
        "needsHumanReview",
        "category",
        "source",
        "customerName",
        "email",
        "phone",
        "projectLocation",
        "propertyAddress",
        "consultationAvailability",
        "requestedServices",
        "materials",
        "budget",
        "timeline",
        "urgency",
        "missingInformation",
        "summary",
        "confidence",
        "evidence",
        "questions",
        "recommendedTemplate",
      ]),
    )
    .optional(),
  httpStatus: z.number().int().min(400).max(599).optional(),
});
function Diagnostic({ metadata }: { metadata: unknown }) {
  const wrapper = z.object({ diagnostics: diagnosticView }).safeParse(metadata);
  if (!wrapper.success) return null;
  const d = wrapper.data.diagnostics;
  return (
    <span className="muted">
      · Validation stage: {d.stage}
      {d.invalidFields?.length
        ? ` · Fields: ${d.invalidFields.join(", ")}`
        : ""}
      {d.httpStatus ? ` · HTTP ${d.httpStatus}` : ""}
    </span>
  );
}
export default async function AIAdmin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireOwner();
  const p = await searchParams;
  const budget = await budgetSummary();
  const provider = openaiStatus();
  const requests = await db.salesAIUsage.findMany({
    where: { provider: "OPENAI" },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      createdAt: true,
      operation: true,
      model: true,
      inputTokens: true,
      outputTokens: true,
      estimatedCost: true,
      status: true,
      errorCode: true,
    },
  });
  const [writeConsents, pendingReplies] = await Promise.all([
    db.mailWriteConsent.findMany({
      select: {
        connectionId: true,
        revokedAt: true,
        consentedAt: true,
        authorizedAt: true,
        sendEnabled: true,
        testOnly: true,
        testAttemptAt: true,
        lastError: true,
        scopes: true,
      },
    }),
    db.salesEmailDraft.findMany({
      where: { status: { in: ["PENDING_REVIEW", "APPROVED", "FAILED"] } },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: {
        id: true,
        version: true,
        status: true,
        lastError: true,
        conversationId: true,
        conversation: { select: { subject: true } },
      },
    }),
  ]);
  const requestDiagnostics = await db.activity.findMany({
    where: {
      type: "AI_REQUEST_RECORDED",
      OR: requests.map((r) => ({
        metadata: { path: ["usageId"], equals: r.id },
      })),
    },
    select: { metadata: true },
  });
  const [s, connections, jobs, logs, usage, sends] = await Promise.all([
    db.salesAISettings.findUnique({
      where: { id: "company" },
      select: {
        processingEnabled: true,
        aiPaused: true,
        monthlyBudget: true,
        alertAt: true,
        outboundPaused: true,
        liveAuthorized: true,
        mailProvider: true,
        aiProvider: true,
        model: true,
        retentionDays: true,
        pollMinutes: true,
        approveRoles: true,
        sendRoles: true,
        oauthRegion: true,
        oauthClientId: true,
        inputCostPerMillion: true,
        outputCostPerMillion: true,
      },
    }),
    db.mailConnection.findMany({
      select: {
        id: true,
        provider: true,
        region: true,
        accountId: true,
        address: true,
        connected: true,
        consented: true,
        folderId: true,
        lastSyncAt: true,
        lastError: true,
      },
    }),
    db.salesJob.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        type: true,
        status: true,
        attempts: true,
        errorCode: true,
        updatedAt: true,
      },
    }),
    db.activity.findMany({
      where: {
        OR: [
          { type: { startsWith: "AI_" } },
          { type: { startsWith: "MAIL_" } },
          { type: { startsWith: "EMAIL_" } },
          { type: { startsWith: "SALES_FOLLOW_" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.salesAIUsage.aggregate({
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, estimatedCost: true },
    }),
    db.mailSendAttempt.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return (
    <>
      <h1>AI Administration</h1>
      <p className="muted">
        OWNER controls mail authorization, processing and sending permissions.
        Real email delivery starts paused and requires separate sending OAuth,
        deployment and mailbox authorization. The original Zoho connection
        remains read-only.
      </p>
      <Notice {...p} />
      <section className="panel">
        <h2>Replies requiring attention</h2>
        <p>
          GENERATED → PENDING_REVIEW → APPROVED. Approval never enables
          delivery. PAUSED is a delivery block; SENT is confirmed; FAILED may
          require manual verification.
        </p>
        {pendingReplies.map((d) => (
          <a className="row" key={d.id} href={"/ai/inbox/" + d.conversationId}>
            <span>
              {d.conversation.subject} · Draft {d.id} · Version {d.version}
            </span>
            <span className="badge">
              {d.status}
              {d.lastError ? " · " + d.lastError : ""}
            </span>
          </a>
        ))}
        {!pendingReplies.length && <p>No replies awaiting action.</p>}
      </section>
      <section className="panel">
        <h2>Separate Zoho sending authorization</h2>
        <p>
          Read access stays unchanged. Sending uses a separate OAuth grant with
          ZohoMail.accounts.READ and ZohoMail.messages.CREATE. No ALL, UPDATE,
          DELETE or folder write scopes.
        </p>
        <p>
          Deployment gate:{" "}
          <strong>{realDeliveryEnabled() ? "enabled" : "disabled"}</strong> ·
          Emergency Pause:{" "}
          <strong>{s?.outboundPaused !== false ? "PAUSED" : "not paused"}</strong>.
          Connecting and testing access never sends email. Approval and Send are
          separate actions.
        </p>
        {connections
          .filter((c) => c.provider === "ZOHO")
          .map((c) => {
            const w = writeConsents.find((w) => w.connectionId === c.id);
            const authorized = !!w?.authorizedAt && !w.revokedAt;
            return (
              <div key={c.id} className="panel">
                <h3>
                  {c.address} · {c.region} · Account {c.accountId}
                </h3>
                <p>
                  {authorized
                    ? "OAuth sending authorized"
                    : w?.revokedAt
                      ? "REVOKED"
                      : "READ ONLY / sending not authorized"}
                  {w?.lastError ? " · " + w.lastError : ""}
                </p>
                <p>
                  Mailbox delivery: {w?.sendEnabled ? "enabled" : "PAUSED"} ·
                  {w?.testOnly
                    ? "One self-addressed test only"
                    : "Approved replies"}
                  {w?.testAttemptAt
                    ? " · Test attempt consumed; no automatic retry"
                    : ""}
                </p>
                {!w || w.revokedAt ? (
                  <form action={writeConsentAction} className="form">
                    <input type="hidden" name="id" value={c.id} />
                    <label>
                      <input type="checkbox" name="consent" required /> I am the
                      OWNER and consent to separate sending authorization. This
                      does not enable delivery.
                    </label>
                    <button name="operation" value="prepare">
                      Prepare sending consent
                    </button>
                  </form>
                ) : null}
                {w && !w.revokedAt && !authorized ? (
                  <form action={connectZohoSending}>
                    <input type="hidden" name="id" value={c.id} />
                    <label>
                      <input type="checkbox" name="consent" required />{" "}
                      Authorize this exact mailbox for sending through Zoho
                      OAuth.
                    </label>
                    <button disabled={!c.connected}>
                      Authorize sending in Zoho
                    </button>
                  </form>
                ) : null}
                {authorized ? (
                  <>
                    <form action={writeConnectionAction} className="form">
                      <input type="hidden" name="id" value={c.id} />
                      <button name="operation" value="test">
                        Test access — no email sent
                      </button>
                      <button name="operation" value="disable">
                        Disable mailbox sending & pause
                      </button>
                    </form>
                    <form action={writeConnectionAction} className="form">
                      <input type="hidden" name="id" value={c.id} />
                      <label>
                        Delivery authorization
                        <select name="mode" defaultValue="SELF_TEST">
                          <option value="SELF_TEST">
                            One self-addressed test only
                          </option>
                          <option value="APPROVED_REPLIES">
                            Approved replies (explicit OWNER authorization)
                          </option>
                        </select>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          name="deliveryConsent"
                          required
                        />{" "}
                        I explicitly authorize this mailbox and selected
                        delivery mode. Emergency Pause stays active.
                      </label>
                      <button
                        name="operation"
                        value="enable"
                        disabled={!realDeliveryEnabled()}
                      >
                        Authorize mailbox delivery (keeps Emergency Pause)
                      </button>
                    </form>
                  </>
                ) : null}
                {w && !w.revokedAt ? (
                  <form action={writeConsentAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <button name="operation" value="revoke">
                      Disconnect sending & revoke token (keep reading)
                    </button>
                  </form>
                ) : null}
              </div>
            );
          })}
      </section>
      <section className="panel">
        <h2>OpenAI monthly budget · {budget.month} UTC</h2>
        <div className="form">
          <div>
            <p>Estimated consumption</p>
            <h2>${Number(budget.spent).toFixed(4)}</h2>
          </div>
          <div>
            <p>Pending / uncertain reservations</p>
            <h2>${Number(budget.reserved).toFixed(4)}</h2>
          </div>
          <div>
            <p>Monthly limit / alert</p>
            <h2>
              ${s?.monthlyBudget.toString() ?? "10"} / $
              {s?.alertAt.toString() ?? "5"}
            </h2>
          </div>
          <div>
            <p>Input / output tokens</p>
            <h2>
              {budget.inputTokens} / {budget.outputTokens}
            </h2>
          </div>
        </div>
        {Number(budget.effective) >= Number(s?.alertAt ?? 5) && (
          <p role="alert">
            Budget alert: review estimated consumption and reservations before
            continuing.
          </p>
        )}
        <p>
          Internal estimates do not guarantee an exact provider billing limit.
          Pending requests reserve their maximum estimated cost. Uncertain
          reservations remain counted for this month.
        </p>
        <p>
          Private server configuration:{" "}
          {provider.configured
            ? `${provider.model} · input $${provider.inputRate} / output $${provider.outputRate} per million tokens · rates verified ${provider.verifiedAt}`
            : "Incomplete. Configure private server environment before selecting OpenAI."}
        </p>
      </section>
      <section className="panel">
        <h2>Recent OpenAI operations</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Operation / model</th>
              <th>Tokens in / out</th>
              <th>Estimated USD</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td>
                  <DateTime date={r.createdAt} />
                </td>
                <td>
                  {r.operation} · {r.model}
                </td>
                <td>
                  {r.inputTokens} / {r.outputTokens}
                </td>
                <td>{r.estimatedCost?.toString() ?? "Reserved / uncertain"}</td>
                <td>
                  {r.status}
                  {r.errorCode ? ` · ${r.errorCode}` : ""}
                  {r.errorCode === "INVALID_AI_OUTPUT" && (
                    <small>
                      {" "}
                      · Generic record: the original validation stage was not
                      recorded.
                    </small>
                  )}
                  <Diagnostic
                    metadata={
                      requestDiagnostics.find((a) => {
                        const record = z
                          .object({ usageId: z.string() })
                          .safeParse(a.metadata);
                        return record.success && record.data.usageId === r.id;
                      })?.metadata
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h2>Development mailbox</h2>
        <p>
          Initialize two clearly labeled mock messages. The durable worker
          processes the queue. Simulated sends never leave this application.
        </p>
        <form action={initialize}>
          <button>Initialize mock mailbox</button>
        </form>
      </section>
      <section className="panel">
        <h2>Processing & permissions</h2>
        <form action={configuration} className="form">
          <label className="checkbox-label">
            <input
              name="processingEnabled"
              type="checkbox"
              defaultChecked={s?.processingEnabled ?? false}
            />
            Enable AI processing
          </label>
          <label className="checkbox-label">
            <input
              name="outboundPaused"
              type="checkbox"
              defaultChecked={s?.outboundPaused ?? true}
            />
            Emergency pause: prevent new outbound sends
          </label>
          <label>
            Mail provider
            <select
              name="mailProvider"
              defaultValue={s?.mailProvider ?? "MOCK"}
            >
              <option value="MOCK">Mock (development only)</option>
              <option value="ZOHO">Zoho Mail (read only)</option>
            </select>
          </label>
          <label>
            AI provider
            <select name="aiProvider" defaultValue={s?.aiProvider ?? "MOCK"}>
              <option value="MOCK">Mock heuristic (no model calls)</option>
              <option value="OPENAI">
                OpenAI Responses (requires owner-configured key/model)
              </option>
            </select>
          </label>
          <p className="muted wide">
            Selecting OpenAI and enabling processing authorizes inquiry text to
            be sent to that provider. Keep Mock selected for development; do not
            configure a real server key until you authorize provider use.
          </p>
          <label className="checkbox-label">
            <input
              name="aiPaused"
              type="checkbox"
              defaultChecked={s?.aiPaused ?? false}
            />
            Pause AI requests (mail import remains independent)
          </label>
          <label>
            Monthly internal budget (USD)
            <input
              name="monthlyBudget"
              type="number"
              min="0.01"
              max="1000"
              step="0.01"
              defaultValue={s?.monthlyBudget.toString() ?? "10"}
            />
          </label>
          <label>
            Alert threshold (USD)
            <input
              name="alertAt"
              type="number"
              min="0.01"
              max="1000"
              step="0.01"
              defaultValue={s?.alertAt.toString() ?? "5"}
            />
          </label>
          <label>
            Polling interval (minutes)
            <input
              type="number"
              min={1}
              max={1440}
              name="pollMinutes"
              defaultValue={s?.pollMinutes ?? 5}
            />
          </label>
          <fieldset>
            <legend>May approve replies</legend>
            {["OWNER", "ADMIN", "SALES"].map((role) => (
              <label className="checkbox-label" key={role}>
                <input
                  type="checkbox"
                  name="approveRoles"
                  value={role}
                  defaultChecked={
                    Array.isArray(s?.approveRoles)
                      ? s.approveRoles.includes(role)
                      : role === "OWNER"
                  }
                />
                {role}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>May request sending</legend>
            {["OWNER", "ADMIN", "SALES"].map((role) => (
              <label className="checkbox-label" key={role}>
                <input
                  type="checkbox"
                  name="sendRoles"
                  value={role}
                  defaultChecked={
                    Array.isArray(s?.sendRoles)
                      ? s.sendRoles.includes(role)
                      : role === "OWNER"
                  }
                />
                {role}
              </label>
            ))}
          </fieldset>
          <p className="muted wide">
            OWNER retains approval and sending authority. SALES remains limited
            to assigned conversations even when granted a role permission.
          </p>
          <label>
            Inbox body retention (days)
            <input
              type="number"
              min={7}
              max={3650}
              name="retentionDays"
              defaultValue={s?.retentionDays ?? 30}
            />
          </label>
          <p className="muted">
            Old inbox bodies and extracted intelligence are removed. Exact draft
            versions and communication audits are retained for review.
          </p>
          <div className="wide">
            <details>
              <summary>Zoho OAuth configuration (read only)</summary>
              <p className="muted">
                Use a server-based application registered in your matching Zoho
                region. Never enter a Zoho account password. US and EU are
                supported; other regions remain locked pending Mail endpoint
                verification.
              </p>
              <div className="form">
                <label>
                  Region
                  <select
                    name="oauthRegion"
                    defaultValue={s?.oauthRegion ?? "US"}
                  >
                    {["US", "EU"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label>
                  OAuth client ID
                  <input
                    name="oauthClientId"
                    defaultValue={s?.oauthClientId ?? ""}
                    maxLength={300}
                  />
                </label>
                <label>
                  OAuth client secret
                  <input
                    name="oauthSecret"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Blank preserves stored secret"
                  />
                </label>
              </div>
            </details>
          </div>
          <button>Save owner configuration</button>
        </form>
      </section>
      <section className="panel">
        <h2>Connect Zoho Mail</h2>
        <p>
          Save your private OAuth configuration above first. Register this exact
          redirect URI: <code>{callbackUri()}</code>
        </p>
        <p>
          Permissions: {readScopes.join(", ")}. Sending, deleting and marking
          messages are not authorized.
        </p>
        <form action={connectZoho}>
          <button>Authorize read-only Zoho access</button>
        </form>
      </section>
      <section className="panel">
        <h2>Integration health</h2>
        {connections.map((c) => (
          <div className="row" key={c.id}>
            <div>
              {c.address} <Mode provider={c.provider} />
              <p className="muted">
                {c.connected ? "Connected" : "Disconnected"} · consent{" "}
                {c.consented ? "confirmed" : "required"} · folder{" "}
                {c.folderId ?? "not selected"}
                <br />
                {c.lastSyncAt ? (
                  <DateTime date={c.lastSyncAt} />
                ) : (
                  "No successful sync"
                )}{" "}
                · {c.lastError ?? "No reported error"}
              </p>
            </div>
            <form action={mailboxAction} className="button-row">
              <input type="hidden" name="id" value={c.id} />
              {!c.connected && c.lastError === "REVOCATION_PENDING" && (
                <button name="operation" value="disconnect">
                  Retry Zoho revocation
                </button>
              )}
              {c.connected && (
                <>
                  <button name="operation" value="sync">
                    Queue sync
                  </button>
                  <button
                    className="secondary"
                    name="operation"
                    value="disconnect"
                  >
                    Disconnect
                  </button>
                </>
              )}
            </form>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Recorded AI usage</h2>
        <p>
          {usage._count} AI operations · {usage._sum.inputTokens ?? 0} input
          tokens · {usage._sum.outputTokens ?? 0} output tokens
        </p>
        <p>
          Estimated cost:{" "}
          {usage._sum.estimatedCost === null
            ? "Not available (mock mode is not billable)"
            : "$" + usage._sum.estimatedCost.toString()}
        </p>
      </section>
      <p className="muted">
        Costs are estimates only for recorded calls with both OWNER-configured
        token rates. Unknown usage and provider billing may differ.
      </p>
      <section className="panel">
        <h2>Persistent jobs</h2>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Error code</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>{j.type}</td>
                <td>{j.status}</td>
                <td>{j.attempts}</td>
                <td>
                  {j.errorCode ?? "—"}
                  {j.status === "FAILED" &&
                    ["REVOKE", "REVOKE_GRANT", "REVOKE_WRITE"].includes(
                      j.type,
                    ) && (
                      <form action={retryRevocation}>
                        <input type="hidden" name="id" value={j.id} />
                        <button>Retry revocation</button>
                      </form>
                    )}
                </td>
                <td>
                  <DateTime date={j.updatedAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h2>Sending activity</h2>
        {sends.map((a) => (
          <div className="row" key={a.id}>
            <span>
              Version {a.version} · {a.status}
              <br />
              <small>
                {a.providerMessageId ?? a.errorCode ?? "Awaiting confirmation"}
              </small>
            </span>
            <DateTime date={a.createdAt} />
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>Audit history</h2>
        {logs.map((a) => (
          <div className="row" key={a.id}>
            <span>
              {a.message}
              {a.type === "AI_REQUEST_RECORDED" && (
                <Diagnostic metadata={a.metadata} />
              )}
            </span>
            <DateTime date={a.createdAt} />
          </div>
        ))}
      </section>
    </>
  );
}
