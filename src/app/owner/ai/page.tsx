import { callbackUri, readScopes } from "@/sales-ai/providers/zoho";
import { requireOwner } from "@/owner/auth";
import { db } from "@/server/db";
import { initialize, configuration, mailboxAction, connectZoho, retryRevocation } from "@/sales-ai/actions";
import { DateTime, Mode, Notice } from "@/sales-ai/components";
export default async function AIAdmin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireOwner();
  const p = await searchParams;
  const [s, connections, jobs, logs, usage, sends] = await Promise.all([
    db.salesAISettings.findUnique({
      where: { id: "company" },
      select: {
        processingEnabled: true,
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
        Real email sending is disabled. Zoho connection grants read-only access.
      </p>
      <Notice {...p} />
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
              <option value="ZOHO">
                Zoho Mail (read only)
              </option>
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
            enter a real key until you authorize provider use.
          </p>
          <label>
            Model
            <input name="model" defaultValue={s?.model ?? ""} maxLength={100} />
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
          <label>
            Estimated input cost / million tokens (USD)
            <input
              name="inputCostPerMillion"
              defaultValue={s?.inputCostPerMillion?.toString() ?? ""}
              placeholder="Leave blank if unknown"
            />
          </label>
          <label>
            Estimated output cost / million tokens (USD)
            <input
              name="outputCostPerMillion"
              defaultValue={s?.outputCostPerMillion?.toString() ?? ""}
              placeholder="Leave blank if unknown"
            />
          </label>
          <label>
            AI key (server encrypted)
            <input
              name="aiKey"
              type="password"
              autoComplete="new-password"
              placeholder="Blank preserves stored key"
            />
          </label>
          <div className="wide">
            <details>
              <summary>Zoho OAuth configuration (read only)</summary>
              <p className="muted">
                Use a server-based application registered in your matching Zoho region. Never enter a Zoho account password. US and EU are supported; other regions remain locked pending Mail endpoint verification.
              </p>
              <div className="form">
                <label>
                  Region
                  <select
                    name="oauthRegion"
                    defaultValue={s?.oauthRegion ?? "US"}
                  >
                    {["US", "EU"].map(
                      (v) => (
                        <option key={v}>{v}</option>
                      ),
                    )}
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
        <p>Save your private OAuth configuration above first. Register this exact redirect URI: <code>{callbackUri()}</code></p>
        <p>Permissions: {readScopes.join(", ")}. Sending, deleting and marking messages are not authorized.</p>
        <form action={connectZoho}><button>Authorize read-only Zoho access</button></form>
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
              {!c.connected && c.lastError === "REVOCATION_PENDING" && <button name="operation" value="disconnect">Retry Zoho revocation</button>}
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
                <td>{j.errorCode ?? "—"}{j.status === "FAILED" && ["REVOKE", "REVOKE_GRANT"].includes(j.type) && <form action={retryRevocation}><input type="hidden" name="id" value={j.id}/><button>Retry revocation</button></form>}</td>
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
            <span>{a.message}</span>
            <DateTime date={a.createdAt} />
          </div>
        ))}
      </section>
    </>
  );
}
