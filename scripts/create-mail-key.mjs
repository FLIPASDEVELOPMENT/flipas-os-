import { readFile,appendFile,chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const text=await readFile('.env','utf8');
if(/^MAIL_ENCRYPTION_KEY=.+$/m.test(text))console.log('Existing mail encryption key preserved.');
else {await appendFile('.env','\nMAIL_ENCRYPTION_KEY='+randomBytes(32).toString('hex')+'\n',{mode:0o600});await chmod('.env',0o600);console.log('Mail encryption key added to ignored .env. Back up securely; never share it.');}
