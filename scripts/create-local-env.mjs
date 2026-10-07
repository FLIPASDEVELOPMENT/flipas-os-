import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const password = randomBytes(32).toString('hex');
try {
 await writeFile('.env', `DATABASE_URL=postgresql://flipas:${password}@localhost:5432/flipas\nAPP_ORIGIN=http://localhost:3000\nPOSTGRES_PASSWORD=${password}\n`, {mode:0o600, flag:'wx'});
 console.log('Local .env created with a random database password; do not commit it.');
} catch (error) {
 if (error.code === 'EEXIST') console.log('Existing .env preserved.');
 else throw error;
}
