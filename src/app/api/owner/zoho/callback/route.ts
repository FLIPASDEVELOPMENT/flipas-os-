import { cookies } from "next/headers";
import { currentUser } from "@/server/auth";
import { consumeOAuthState } from "@/sales-ai/server/oauth-state";
import { finishZohoOAuth } from "@/sales-ai/server/zoho";
import { callbackUri, regionEndpoints } from "@/sales-ai/providers/zoho";
export async function GET(request: Request) {
  const user=await currentUser();
  if(!user || user.role!=="OWNER") return new Response(null,{status:403});
  const jar=await cookies(), binding=jar.get("flipas_zoho_binding")?.value??"";
  jar.delete("flipas_zoho_binding");
  let target="/owner/ai?error=AUTH_REQUIRED";
  try {
    const query=new URL(request.url).searchParams;
    const state=await consumeOAuthState(user,query.get("state")??"",binding);
    const expected=regionEndpoints(state.region);
    if(state.redirectUri!==callbackUri() || query.get("error") || !query.get("code") ||
      (query.has("location") && query.get("location")?.toUpperCase()!==state.region) ||
      (query.has("accounts-server") && query.get("accounts-server")!==expected.accounts)) throw new Error("AUTH_REQUIRED");
    const code=query.get("code")!;
    if(code.length>2000) throw new Error("AUTH_REQUIRED");
    const grant=await finishZohoOAuth(user,state,code);
    target="/owner/ai/zoho?grant="+encodeURIComponent(grant);
  } catch { /* Grant codes, credentials and provider error descriptions never appear in responses. */ }
  return new Response(null,{status:303,headers:{Location:target,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
}
