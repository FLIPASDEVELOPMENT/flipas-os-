import { test } from "node:test";
import assert from "node:assert/strict";
import { ZohoClient, ZohoMailProvider, authorizeUrl, callbackUri, regionEndpoints, readScopes } from "../src/sales-ai/providers/zoho";
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
const api=(data:unknown)=>json({status:{code:200},data});
const tokens={accessToken:"test-access",refreshToken:"test-refresh",expiresAt:new Date(0)};
test("fixed regional OAuth origins, least-privilege scopes and trusted callback",()=>{
  process.env.APP_ORIGIN="http://localhost:3000";
  assert.equal(callbackUri(),"http://localhost:3000/api/owner/zoho/callback");
  const url=new URL(authorizeUrl("EU","test-client",callbackUri(),"opaque-state"));
  assert.equal(url.origin,"https://accounts.zoho.eu");assert.equal(url.searchParams.get("scope"),readScopes.join(","));
  assert.equal(url.searchParams.get("access_type"),"offline");assert.equal(url.searchParams.get("state"),"opaque-state");
  assert.ok(!url.toString().includes("CREATE"));assert.throws(()=>regionEndpoints("https://attacker.invalid"));assert.throws(()=>regionEndpoints("CN"));
  process.env.APP_ORIGIN="http://public.invalid";assert.throws(callbackUri);
  process.env.APP_ORIGIN="https://user:secret@example.invalid";assert.throws(callbackUri);
  process.env.APP_ORIGIN="http://localhost:3000";
});
test("OAuth exchange/refresh use POST bodies, preserve refresh token and enforce expiry",async()=>{
  let calls=0;
  const transport:typeof fetch=async(input,init)=>{
    assert.equal(new URL(String(input)).origin,"https://accounts.zoho.eu");assert.equal(init?.method,"POST");
    assert.equal(new URL(String(input)).search,"");assert.equal(init?.redirect,"error");
    const form=init?.body as URLSearchParams;assert.equal(form.get("client_secret"),"private-test-secret");
    if(calls++===0) {assert.equal(form.get("scope"),readScopes.join(","));return json({access_token:"test-access",refresh_token:"test-refresh",expires_in:3600,api_domain:"https://attacker.invalid"});}
    assert.equal(form.get("grant_type"),"refresh_token");return json({access_token:"rotated-access",expires_in:3600});
  };
  const client=new ZohoClient("EU",transport);
  const first=await client.exchange("client","private-test-secret","code","http://localhost:3000/callback");
  assert.equal(first.refreshToken,tokens.refreshToken);assert.ok(first.expiresAt>new Date());
  const next=await client.refresh("client","private-test-secret",first);assert.equal(next.refreshToken,first.refreshToken);assert.equal(next.accessToken,"rotated-access");
});
test("OAuth refresh failure, rate limits and response bounds never expose provider secrets",async()=>{
  for(const response of [json({error:"private-provider-secret"}),json({error:"private-provider-secret"},429),json({},401),new Response("x".repeat(2*1024*1024+1)),new Response("private-secret",{status:500})]) {
    const client=new ZohoClient("US",async()=>response);
    await assert.rejects(client.refresh("id","secret",tokens),e=>e instanceof Error && !e.message.includes("private") && ["TOKEN_REFRESH_FAILED","RATE_LIMIT","AUTH_REQUIRED","PROVIDER_REJECTED"].includes(e.message));
  }
});
test("account/folder discovery uses Mail origin and Zoho-oauthtoken, not returned api_domain",async()=>{
  const client=new ZohoClient("EU",async(input,init)=>{
    const url=new URL(String(input));assert.equal(url.origin,"https://mail.zoho.eu");
    assert.equal((init?.headers as Record<string,string>).Authorization,"Zoho-oauthtoken test-access");
    return url.pathname.endsWith("/folders")?api([{folderId:"123",folderName:"Inbox",folderType:"Inbox"}]):api([{accountId:"456",primaryEmailAddress:"sales@example.invalid"}]);
  });
  assert.equal((await client.accounts("test-access"))[0].accountId,"456");assert.equal((await client.folders("456","test-access"))[0].folderId,"123");
  await assert.rejects(client.folders("../../attacker","test-access"));
});
test("bounded folder polling preserves long IDs, sanitizes HTML and overlaps boundaries",async()=>{
  let page=0, lastStart="";
  const rows=Array.from({length:25},(_,i)=>({messageId:String(1709887058769100001n+BigInt(i)),threadId:"1709883095364100001",fromAddress:"customer@example.invalid",subject:"Kitchen",receivedTime:"1709887053409",folderId:"123",sender:"Customer"}));
  const client=new ZohoClient("US",async(input)=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith("/messages/view")) {lastStart=url.searchParams.get("start")!;assert.equal(url.searchParams.get("folderId"),"123");assert.equal(url.searchParams.get("includesent"),"false");return api(page++===0?rows:[rows[0]]);}
    return api({content:"<script>danger()</script><b>Hello</b>"});
  });
  const provider=new ZohoMailProvider({region:"US",accountId:"456",folderId:"123",address:"sales@example.invalid"},async()=>"test-access",client);
  const first=await provider.listMessages("id",null);assert.equal(first.messages.length,25);assert.equal(first.messages[0].messageId,rows[0].messageId);assert.ok(first.more);assert.equal(lastStart,"1");assert.ok(!first.messages[0].body.includes("danger"));
  const second=await provider.listMessages("id",first.nextCursor);assert.equal(lastStart,"26");assert.equal(second.more,false);
  const third=await provider.listMessages("id",second.nextCursor);assert.equal(lastStart,"1");assert.equal(third.more,false);assert.notEqual(JSON.parse(third.nextCursor).scan,JSON.parse(second.nextCursor).scan);
});
test("real send is blocked before any HTTP call, and revocation uses authenticated current endpoint",async()=>{
  let calls=0;
  const client=new ZohoClient("EU",async(input,init)=>{
    calls++;assert.equal(String(input),"https://accounts.zoho.eu/oauth/v2/revoke/token");assert.equal(init?.method,"POST");
    assert.equal((init?.headers as Record<string,string>).Authorization,"Basic "+Buffer.from("client:secret").toString("base64"));
    assert.equal((init?.body as URLSearchParams).get("token_type"),"refresh_token");return new Response(null,{status:200});
  });
  const provider=new ZohoMailProvider({region:"EU",accountId:"456",folderId:"123",address:"sales@example.invalid"},async()=>{throw new Error("token must not be read");},client);
  await assert.rejects(provider.send(),/LIVE_DISABLED/);assert.equal(calls,0);
  await client.revoke("test-refresh","client","secret");assert.equal(calls,1);
});
