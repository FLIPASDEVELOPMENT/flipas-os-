import { writeScopes } from "../domain/delivery";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { textOnly } from "../domain/security";
import type { IncomingMail, MailProvider } from "./mail";

// Fixed regional origins only: never use callback accounts-server/api_domain as a URL.
export const zohoRegions = {
  US: { accounts: "https://accounts.zoho.com", mail: "https://mail.zoho.com" },
  EU: { accounts: "https://accounts.zoho.eu", mail: "https://mail.zoho.eu" },
} as const;
export const readScopes = ["ZohoMail.accounts.READ", "ZohoMail.folders.READ", "ZohoMail.messages.READ"] as const;
export function regionEndpoints(region: string) {
  if (!Object.hasOwn(zohoRegions, region)) throw new Error("REGION_UNSUPPORTED");
  return zohoRegions[region as keyof typeof zohoRegions];
}
export function callbackUri() {
  const url = new URL(process.env.APP_ORIGIN ?? "");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))))
    throw new Error("AUTH_REQUIRED");
  return url.origin + "/api/owner/zoho/callback";
}
export function authorizeUrl(region: string, clientId: string, redirectUri: string, state: string) {
  const url = new URL("/oauth/v2/auth", regionEndpoints(region).accounts);
  url.search = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirectUri,
    scope: readScopes.join(","), access_type: "offline", prompt: "consent", state }).toString();
  return url.toString();
}
const tokenResponse = z.object({ scope:z.string().optional(), access_token: z.string().min(1), refresh_token: z.string().min(1).optional(), expires_in: z.coerce.number().positive().max(86400) });
const id = z.string().regex(/^\d{1,30}$/);
export const accountSchema = z.object({ accountId: id, primaryEmailAddress: z.email() });
export const folderSchema = z.object({ folderId: id, folderName: z.string().max(300), folderType: z.string().optional() });
export type ZohoTokens = { scopes?:string[]; accessToken: string; refreshToken: string; expiresAt: Date };
export class ZohoClient {
  constructor(readonly region: string, private readonly transport: typeof fetch = fetch) { regionEndpoints(region); }
  private async request(url: URL, init: RequestInit = {}, signal?: AbortSignal): Promise<unknown> {
    try {
      const response = await this.transport(url, { ...init, redirect: "error", cache: "no-store",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) });
      if (response.status === 429) throw new Error("RATE_LIMIT");
      if ([401,403].includes(response.status)) throw new Error("AUTH_REQUIRED");
      if (!response.ok) throw new Error("PROVIDER_REJECTED");
      // Bound streamed response before parsing; raw provider bodies never escape this adapter.
      const reader = response.body?.getReader();
      if (!reader) return null;
      let size = 0; const chunks: Uint8Array[] = [];
      try { while (true) { const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size > 2 * 1024 * 1024) throw new Error("PROVIDER_REJECTED"); chunks.push(value); }
      } finally { await reader.cancel(); }
      const body = Buffer.concat(chunks).toString("utf8");
      return body.trim() ? JSON.parse(body) : null;
    } catch (error) {
      if (error instanceof Error && ["RATE_LIMIT", "AUTH_REQUIRED", "PROVIDER_REJECTED"].includes(error.message)) throw error;
      throw new Error("PROVIDER_REJECTED");
    }
  }
  private async oauth(path: string, values: Record<string,string>) {
    return this.request(new URL(path, regionEndpoints(this.region).accounts), { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values) });
  }
  async exchange(clientId: string, secret: string, code: string, redirectUri: string, scopes: readonly string[] = readScopes): Promise<ZohoTokens> {
    const result = tokenResponse.safeParse(await this.oauth("/oauth/v2/token", { client_id: clientId, client_secret: secret,
      code, grant_type: "authorization_code", redirect_uri: redirectUri, scope: scopes.join(",") }));
    if (!result.success || !result.data.refresh_token) throw new Error("AUTH_REQUIRED");
    return { scopes:result.data.scope?.split(/[ ,]+/).filter(Boolean), accessToken: result.data.access_token, refreshToken: result.data.refresh_token, expiresAt: new Date(Date.now() + result.data.expires_in * 1000) };
  }
  async refresh(clientId: string, secret: string, tokens: ZohoTokens): Promise<ZohoTokens> {
    const result = tokenResponse.safeParse(await this.oauth("/oauth/v2/token", { client_id: clientId, client_secret: secret,
      refresh_token: tokens.refreshToken, grant_type: "refresh_token" }));
    if (!result.success) throw new Error("TOKEN_REFRESH_FAILED");
    return { scopes:result.data.scope?.split(/[ ,]+/).filter(Boolean), accessToken: result.data.access_token, refreshToken: result.data.refresh_token ?? tokens.refreshToken,
      expiresAt: new Date(Date.now() + result.data.expires_in * 1000) };
  }
  async revoke(refreshToken: string, clientId: string, secret: string) {
    // Current Accounts documentation: authenticated RFC 7009 endpoint, HTTP 200 is success.
    await this.request(new URL("/oauth/v2/revoke/token", regionEndpoints(this.region).accounts), {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(clientId + ":" + secret).toString("base64") },
      body: new URLSearchParams({token: refreshToken, token_type: "refresh_token"}) });
  }
  async get(path: string, token: string, query: Record<string,string> = {}, signal?: AbortSignal) {
    if (!/^\/api\/accounts(?:\/\d+)?(?:\/.*)?$/.test(path) || path.includes("..")) throw new Error("PROVIDER_REJECTED");
    const url = new URL(path, regionEndpoints(this.region).mail); url.search = new URLSearchParams(query).toString();
    const envelope = z.object({ status: z.object({ code: z.literal(200) }), data: z.unknown() }).safeParse(await this.request(url,
      { headers: { Authorization: `Zoho-oauthtoken ${token}`, Accept: "application/json" } }, signal));
    if (!envelope.success) throw new Error("PROVIDER_REJECTED");
    return envelope.data.data;
  }
  async accounts(token: string) { return z.array(accountSchema).max(100).parse(await this.get("/api/accounts", token)); }
  async folders(accountId: string, token: string) { return z.array(folderSchema).max(1000).parse(await this.get(`/api/accounts/${id.parse(accountId)}/folders`, token)); }
}
export type ZohoMailbox = { region: string; accountId: string; folderId: string; address: string };
const cursorSchema = z.object({ start: z.number().int().min(1).max(1000000), scan: z.string().uuid(), watermark: z.number().nonnegative(), newest: z.number().nonnegative(), boundary: z.string().nullable(), head: z.string().nullable() });
const messageSchema = z.object({ messageId: id, threadId: id.optional(), fromAddress: z.email(), sender: z.string().default(""),
  subject: z.string().default(""), receivedTime: z.string().regex(/^\d+$/), folderId: id.optional() });
/** Read-only polling. Each scan restarts at the head, overlapping its prior boundary; database dedup is authoritative.
 * Offset paging may shift under concurrent delivery; repeated scans catch shifted messages, no timestamp-only exclusion. */
export class ZohoMailProvider implements MailProvider {
  constructor(private readonly mailbox: ZohoMailbox, private readonly token: () => Promise<string>, private readonly client = new ZohoClient(mailbox.region)) {}
  async listMessages(_connectionId: string, cursor: string | null, signal?: AbortSignal) {
    const prior = cursor ? cursorSchema.parse(JSON.parse(cursor)) : null;
    const scan = prior?.start && prior.start > 1 ? prior : { start: 1, scan: randomUUID(), watermark: prior?.newest ?? 0, newest: prior?.newest ?? 0, boundary: prior?.head ?? null, head: null };
    const token = await this.token(), account = id.parse(this.mailbox.accountId), folder = id.parse(this.mailbox.folderId);
    const rows = z.array(messageSchema).max(25).parse(await this.client.get(`/api/accounts/${account}/messages/view`, token,
      { folderId: folder, start: String(scan.start), limit: "25", status: "all", sortBy: "date", sortorder: "false", includeto: "true", includesent: "false" }, signal));
    const messages: IncomingMail[] = [];
    for (const row of rows) {
      signal?.throwIfAborted();
      if (row.folderId && row.folderId !== folder) throw new Error("PROVIDER_REJECTED");
      const receivedAt = new Date(Number(row.receivedTime));
      if (!Number.isFinite(receivedAt.getTime())) throw new Error("PROVIDER_REJECTED");
      const content = z.object({ content: z.string().max(1500000) }).parse(await this.client.get(`/api/accounts/${account}/folders/${folder}/messages/${row.messageId}/content`, token, { includeBlockContent: "false" }, signal));
      messages.push({ messageId: row.messageId, threadId: row.threadId ?? row.messageId, fromEmail: row.fromAddress,
        fromName: textOnly(row.sender).slice(0,200), toEmail: this.mailbox.address, subject: textOnly(row.subject).slice(0,500),
        body: textOnly(content.content), receivedAt, attachments: [] });
    }
    const newest = Math.max(scan.newest, ...messages.map(m => m.receivedAt.getTime()));
    const head = scan.head ?? rows[0]?.messageId ?? scan.boundary;
    const reachedBoundary = rows.some(r => r.messageId === scan.boundary);
    const more = rows.length === 25 && !reachedBoundary;
    return { messages, more, nextCursor: JSON.stringify({ ...scan, newest, head, start: more ? scan.start + 25 : 1 }) };
  }
  async send(): Promise<{messageId: string}> { throw new Error("LIVE_DISABLED"); }
  async disconnect(): Promise<void> { throw new Error("AUTH_REQUIRED"); }
}

/** Separate prospective authorization; read flow never requests CREATE. */
export function writeAuthorizeUrl(
  region: string,
  clientId: string,
  redirectUri: string,
  state: string,
  ownerConsent: boolean,
) {
  if (!ownerConsent) throw new Error("WRITE_AUTH_REQUIRED");
  const url = new URL(authorizeUrl(region, clientId, redirectUri, state));
  url.searchParams.set("scope", writeScopes.join(","));
  return url.toString();
}
