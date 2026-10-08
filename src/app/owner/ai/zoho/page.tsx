import { requireOwner } from "@/owner/auth";
import { pendingZohoGrant, grantFolders } from "@/sales-ai/server/zoho";
import { selectMailbox } from "@/sales-ai/actions";
export default async function ZohoSelection({searchParams}:{searchParams:Promise<{grant?:string;account?:string}>}) {
  const u=await requireOwner(), p=await searchParams;
  let accounts: {accountId:string;primaryEmailAddress:string}[]=[], folders:{folderId:string;folderName:string;folderType?:string}[]=[];
  try {
    const {grant}=await pendingZohoGrant(u,p.grant??""); accounts=grant.accounts;
    if(p.account) folders=await grantFolders(u,p.grant??"",p.account);
  } catch {return <section className="panel"><h1>Mailbox setup unavailable</h1><p>Authorization expired or Zoho could not be reached. Return to AI Administration and reconnect. Do not paste tokens or passwords.</p></section>;}
  return <section className="panel"><h1>Select a commercial mailbox</h1><p>Only the selected folder will be imported. Real email sending remains disabled.</p>
    <form method="GET" className="form"><input type="hidden" name="grant" value={p.grant}/><label>Mailbox<select name="account" defaultValue={p.account}>{accounts.map(a=><option key={a.accountId} value={a.accountId}>{a.primaryEmailAddress}</option>)}</select></label><button>Load folders</button></form>
    {p.account && <form action={selectMailbox} className="form"><input type="hidden" name="grant" value={p.grant}/><input type="hidden" name="accountId" value={p.account}/>
      <label>Folder<select name="folderId" required>{folders.filter(f=>!["Drafts","Sent","Spam","Trash","Templates"].includes(f.folderType??"")).map(f=><option key={f.folderId} value={f.folderId}>{f.folderName}</option>)}</select></label>
      <label className="checkbox-label"><input type="checkbox" name="consent" required/>I authorize FLIPAS OS to read and store business inquiries from this mailbox and folder. I have authority to grant access.</label>
      <button>Save mailbox and folder consent</button></form>}
    <p>Authorization expires after ten minutes. Unfinished grants are retained encrypted only until cleanup. You can revoke access in your Zoho account at any time.</p>
  </section>;
}
