import { safeError } from "@/sales-ai/domain/security";
import { cookies } from "next/headers";
import { currentUser } from "@/server/auth";
import { consumeOAuthState } from "@/sales-ai/server/oauth-state";
import { finishWriteOAuth } from "@/sales-ai/server/write-oauth";
import { finishZohoOAuth } from "@/sales-ai/server/zoho";
import { callbackUri, regionEndpoints } from "@/sales-ai/providers/zoho";
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || user.role !== "OWNER")
    return new Response(null, { status: 403 });
  const jar = await cookies(),
    binding = jar.get("flipas_zoho_binding")?.value ?? "";
  jar.delete("flipas_zoho_binding");
  let target = "/owner/ai?error=AUTH_REQUIRED";
  try {
    const query = new URL(request.url).searchParams;
    const state = await consumeOAuthState(
      user,
      query.get("state") ?? "",
      binding,
    );
    const expected = regionEndpoints(state.region);
    if (
      state.redirectUri !== callbackUri() ||
      query.get("error") ||
      !query.get("code") ||
      (query.has("location") &&
        query.get("location")?.toUpperCase() !== state.region) ||
      (query.has("accounts-server") &&
        query.get("accounts-server") !== expected.accounts)
    )
      throw new Error("AUTH_REQUIRED");
    const code = query.get("code")!;
    if (code.length > 2000) throw new Error("AUTH_REQUIRED");
    if (state.purpose === "SEND") {
      await finishWriteOAuth(user, state, code);
      target = "/owner/ai?saved=1";
    } else if (state.purpose === "READ") {
      const grant = await finishZohoOAuth(user, state, code);
      target = "/owner/ai/zoho?grant=" + encodeURIComponent(grant);
    } else throw new Error("ACCESS_DENIED");
  } catch (e) {
    // Only allowlisted internal codes; never raw provider errors or OAuth code.
    target = "/owner/ai?error=" + encodeURIComponent(safeError(e));
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: target,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
