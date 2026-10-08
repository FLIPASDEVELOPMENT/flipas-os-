import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID,randomBytes } from "node:crypto";
import { db } from "../src/server/db";
import { finishZohoOAuth,pendingZohoGrant,grantFolders,selectZohoMailbox,revokeZohoConnection } from "../src/sales-ai/server/zoho";
import { initializeMock,syncMailbox,analyzeConversation,generateDraft,reviewDraft,requestSend,sendApproved,disconnectMailbox } from "../src/sales-ai/server/service";
import { encryptSecret,decryptSecret } from "../src/sales-ai/domain/security";
if(!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")) throw new Error("Disposable *_test database required");
process.env.MAIL_ENCRYPTION_KEY=randomBytes(32).toString("hex");
after(()=>db.$disconnect());
test("OWNER OAuth discovery/consent, encrypted refresh, readonly sync/dedup, hard outbound lock and durable revocation",async()=>{
  const make=(role:"OWNER"|"SALES"|"ADMIN")=>db.user.create({data:{role,name:role,email:randomUUID()+"@example.invalid",passwordHash:"not-a-login-hash"}});
  const owner=await make("OWNER"),other=await make("OWNER"),sales=await make("SALES"),admin=await make("ADMIN");
  await initializeMock(owner);
  await db.salesAISettings.update({where:{id:"company"},data:{mailProvider:"ZOHO",processingEnabled:true,outboundPaused:false}});
  const original=globalThis.fetch;let sends=0,refreshes=0,revocations=0,failRevoke=false;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.pathname==="/oauth/v2/token") {
      if((init?.body as URLSearchParams).get("grant_type")==="refresh_token")refreshes++;
      return Response.json({access_token:"private-access",refresh_token:"private-refresh",expires_in:3600});
    }
    if(url.pathname==="/oauth/v2/revoke/token") {revocations++;if(failRevoke)return new Response(null,{status:429});return new Response(null,{status:200});}
    if(init?.method==="POST"){sends++;throw new Error("No send allowed");}
    const data=url.pathname==="/api/accounts"?[{accountId:"456",primaryEmailAddress:"sales@example.invalid"}]:
      url.pathname.endsWith("/folders")?[{folderId:"123",folderName:"Inbox",folderType:"Inbox"},{folderId:"789",folderName:"Drafts",folderType:"Drafts"}]:
      url.pathname.endsWith("/messages/view")?[{messageId:"1709887058769100001",threadId:"1709883095364100001",fromAddress:"customer@example.invalid",sender:"Customer",subject:"Kitchen remodeling inquiry",receivedTime:"1709887053409",folderId:"123"}]:
      {content:"Please assess my kitchen remodeling project."};
    return Response.json({status:{code:200},data});
  };
  try {
    const state={region:"EU",clientId:"test-client",secretCipher:encryptSecret("private-client-secret"),redirectUri:"http://localhost:3000/api/owner/zoho/callback"};
    await assert.rejects(finishZohoOAuth(sales,state,"test-code"));await assert.rejects(finishZohoOAuth(admin,state,"test-code"));
    const grant=await finishZohoOAuth(owner,state,"test-code");
    const raw=await db.mailOAuthGrant.findUniqueOrThrow({where:{id:grant}});assert.ok(!raw.grantCipher.includes("private"));
    await assert.rejects(pendingZohoGrant(other,grant));await assert.rejects(grantFolders(owner,grant,"999"));
    await assert.rejects(selectZohoMailbox(owner,grant,"456","123",false));
    await assert.rejects(selectZohoMailbox(owner,grant,"456","789",true));
    await selectZohoMailbox(owner,grant,"456","123",true);await assert.rejects(selectZohoMailbox(owner,grant,"456","123",true));
    const c=await db.mailConnection.findUniqueOrThrow({where:{provider_accountId:{provider:"ZOHO",accountId:"456"}}});
    assert.equal(c.consented,true);assert.equal(c.folderId,"123");assert.ok(!c.tokenCipher!.includes("private"));
    await db.mailConnection.update({where:{id:c.id},data:{tokenCipher:encryptSecret(JSON.stringify({accessToken:"expired",refreshToken:"private-refresh",expiresAt:new Date(0)}))}});
    await syncMailbox(c.id);await syncMailbox(c.id);assert.equal(refreshes,1);
    assert.equal(await db.mailMessage.count(),1);
    const thread=await db.mailConversation.findFirstOrThrow({where:{connectionId:c.id}});
    await analyzeConversation(thread.id);
    const draftId=await generateDraft(owner,thread.id,"EN","QUALIFY");
    await reviewDraft(owner,draftId,"submit",1);await reviewDraft(owner,draftId,"approve",1);
    await assert.rejects(requestSend(owner,draftId,1),/WRITE_AUTH_REQUIRED/);
    await db.salesEmailDraft.update({where:{id:draftId},data:{requestedById:owner.id}});
    await assert.rejects(sendApproved(draftId,1,owner.id),/WRITE_AUTH_REQUIRED/);assert.equal(sends,0);assert.equal(await db.mailSendAttempt.count(),0);
    await assert.rejects(disconnectMailbox(sales,c.id));await disconnectMailbox(owner,c.id);
    await assert.rejects(syncMailbox(c.id),/AUTH_REQUIRED/);
    assert.equal(await db.salesJob.count({where:{type:"REVOKE",status:"PENDING"}}),1);
    failRevoke=true;await assert.rejects(revokeZohoConnection(c.id),/RATE_LIMIT/);
    const pending=await db.mailConnection.findUniqueOrThrow({where:{id:c.id}});assert.equal(pending.connected,false);assert.ok(pending.tokenCipher);
    failRevoke=false;await revokeZohoConnection(c.id);assert.equal(revocations,2);
    const revoked=await db.mailConnection.findUniqueOrThrow({where:{id:c.id}});assert.equal(revoked.tokenCipher,null);assert.equal(revoked.oauthSecretCipher,null);
    const audit=JSON.stringify(await db.activity.findMany());assert.ok(!audit.includes("private-client-secret"));assert.ok(!audit.includes("private-access"));assert.ok(!audit.includes("private-refresh"));
    assert.equal(JSON.parse(decryptSecret(c.tokenCipher!)).refreshToken,"private-refresh");
  } finally {globalThis.fetch=original;}
});
