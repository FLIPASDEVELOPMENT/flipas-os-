import { z } from "zod";
import type { User } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { assertOwner } from "@/owner/service";
import { decryptSecret, encryptSecret } from "../domain/security";
import { ZohoClient, ZohoMailProvider, accountSchema, regionEndpoints } from "../providers/zoho";
import { accessToken, tokenSet } from "./token-lifecycle";
import { audit, enqueue } from "./service";
const grantSchema = z.object({ region: z.string(), clientId: z.string(), secret: z.string(), tokens: tokenSet, accounts: z.array(accountSchema) });
export async function finishZohoOAuth(u: User, state: { region: string; clientId: string; secretCipher: string; redirectUri: string }, code: string) {
  assertOwner(u);
  const secret = decryptSecret(state.secretCipher), client = new ZohoClient(state.region);
  const tokens = await client.exchange(state.clientId, secret, code, state.redirectUri);
  const grant=await db.mailOAuthGrant.create({data:{ownerId:u.id,expiresAt:new Date(Date.now()+10*60000),
    grantCipher:encryptSecret(JSON.stringify({region:state.region,clientId:state.clientId,secret,tokens,accounts:[]}))}});
  try {
    const accounts=await client.accounts(tokens.accessToken);
    await db.$transaction(async tx=>{
      await tx.mailOAuthGrant.update({where:{id:grant.id},data:{grantCipher:encryptSecret(JSON.stringify({region:state.region,clientId:state.clientId,secret,tokens,accounts}))}});
      await audit(tx,u.id,"MAIL_OAUTH_AUTHORIZED",{region:state.region});
    });
    return grant.id;
  } catch {
    await db.$transaction(async tx=>{
      await tx.mailOAuthGrant.update({where:{id:grant.id},data:{expiresAt:new Date(Date.now()-1)}});
      await enqueue("REVOKE_GRANT",`revoke-grant:${grant.id}`,{grantId:grant.id},new Date(),tx);
    });
    throw new Error("PROVIDER_REJECTED");
  }
}
export async function pendingZohoGrant(u: User, grantId: string) {
  assertOwner(u);
  const row = await db.mailOAuthGrant.findUnique({where:{id:grantId}});
  if (!row || row.ownerId!==u.id || row.expiresAt <= new Date()) throw new Error("AUTH_REQUIRED");
  const grant = grantSchema.parse(JSON.parse(decryptSecret(row.grantCipher)));
  return { row, grant };
}
export async function grantFolders(u: User, grantId: string, accountId: string) {
  const {grant} = await pendingZohoGrant(u,grantId);
  if (!grant.accounts.some(a=>a.accountId===accountId)) throw new Error("ACCESS_DENIED");
  return new ZohoClient(grant.region).folders(accountId,grant.tokens.accessToken);
}
export async function selectZohoMailbox(u: User, grantId: string, accountId: string, folderId: string, consent: boolean) {
  assertOwner(u);
  if (!consent) throw new Error("AUTH_REQUIRED");
  const {grant} = await pendingZohoGrant(u,grantId);
  const account=grant.accounts.find(a=>a.accountId===accountId);
  if (!account) throw new Error("ACCESS_DENIED");
  const folders=await grantFolders(u,grantId,accountId);
  const folder=folders.find(f=>f.folderId===folderId);
  if (!folder || ["Drafts","Sent","Spam","Trash","Templates"].includes(folder.folderType??"")) throw new Error("ACCESS_DENIED");
  return db.$transaction(async tx=>{
    const claimed=await tx.mailOAuthGrant.deleteMany({where:{id:grantId,ownerId:u.id,expiresAt:{gt:new Date()}}});
    if(claimed.count!==1) throw new Error("AUTH_REQUIRED");
    const old=await tx.mailConnection.findUnique({where:{provider_accountId:{provider:"ZOHO",accountId}}});
    // Never overwrite another owner's grant or silently cross data centers.
    if(old && (old.ownerId!==u.id || old.region!==grant.region || old.tokenCipher)) throw new Error("ACCESS_DENIED");
    const data={ownerId:u.id,region:grant.region,address:account.primaryEmailAddress,folderId,consented:true,connected:true,
      tokenCipher:encryptSecret(JSON.stringify(grant.tokens)),tokenExpiresAt:grant.tokens.expiresAt,
      oauthClientId:grant.clientId,oauthSecretCipher:encryptSecret(grant.secret),syncCursor:null,lastError:null};
    await tx.mailConnection.upsert({where:{provider_accountId:{provider:"ZOHO",accountId}},create:{provider:"ZOHO",accountId,...data},update:data});
    await audit(tx,u.id,"MAIL_FOLDER_CONSENTED",{accountId,folderId,region:grant.region});
  },{isolationLevel:"Serializable"});
}
export async function zohoProvider(connectionId: string) {
  const c=await db.mailConnection.findUniqueOrThrow({where:{id:connectionId}});
  if(c.provider!=="ZOHO" || !c.folderId || !c.oauthSecretCipher) throw new Error("AUTH_REQUIRED");
  regionEndpoints(c.region);
  const client=new ZohoClient(c.region), secret=decryptSecret(c.oauthSecretCipher);
  // Credentials captured before token row lock; refresh cannot reread/lock that row.
  return new ZohoMailProvider({region:c.region,accountId:c.accountId,folderId:c.folderId,address:c.address},
    ()=>accessToken(c.id,{refresh:(_id,tokens)=>client.refresh(c.oauthClientId,secret,tokens)}),client);
}
export async function revokeZohoConnection(connectionId: string) {
  const c=await db.mailConnection.findUniqueOrThrow({where:{id:connectionId}});
  if(c.provider!=="ZOHO" || c.connected) throw new Error("ACCESS_DENIED");
  if(!c.tokenCipher) return;
  const tokens=tokenSet.parse(JSON.parse(decryptSecret(c.tokenCipher)));
  if(!c.oauthSecretCipher) throw new Error("AUTH_REQUIRED");
  await new ZohoClient(c.region).revoke(tokens.refreshToken,c.oauthClientId,decryptSecret(c.oauthSecretCipher));
  await db.$transaction(async tx=>{
    await tx.mailConnection.update({where:{id:c.id},data:{tokenCipher:null,oauthSecretCipher:null,tokenExpiresAt:null,lastError:null}});
    await audit(tx,c.ownerId,"MAIL_OAUTH_REVOKED",{connectionId:c.id});
  });
}

export async function revokePendingGrant(id: string) {
  const row=await db.mailOAuthGrant.findUnique({where:{id}});
  if(!row) return;
  if(row.expiresAt>new Date()) throw new Error("ACCESS_DENIED");
  const grant=grantSchema.parse(JSON.parse(decryptSecret(row.grantCipher)));
  await new ZohoClient(grant.region).revoke(grant.tokens.refreshToken,grant.clientId,grant.secret);
  await db.mailOAuthGrant.deleteMany({where:{id,expiresAt:{lt:new Date()}}});
}
