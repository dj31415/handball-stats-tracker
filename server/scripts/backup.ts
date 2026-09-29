// Consistent online backup of the SQLite database using VACUUM INTO.
// Usage: node dist/backup.js   (or: npm run backup)
// Env: DATA_DIR / DB_PATH (same as the server), BACKUP_DIR (default DATA_DIR/backups), BACKUP_KEEP (default 14).
import { createClient } from '@libsql/client';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR || path.resolve(process.cwd(), 'data'));
const dbPath = path.resolve(process.env.DB_PATH || path.join(dataDir, 'handball.db'));
const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(dataDir, 'backups'));
const keep = Math.max(1, parseInt(process.env.BACKUP_KEEP || '14') || 14);

if (!existsSync(dbPath)) {
	console.error(`Database not found: ${dbPath}`);
	process.exit(1);
}

mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = path.join(backupDir, `handball-${stamp}.db`);

const db = createClient({ url: `file:${dbPath}` });
await db.execute({ sql: 'VACUUM INTO ?', args: [target] });
db.close();
console.log(`Backup written: ${target}`);

const old = readdirSync(backupDir)
	.filter((f) => /^handball-.*\.db$/.test(f))
	.sort()
	.slice(0, -keep);
for (const f of old) unlinkSync(path.join(backupDir, f));
if (old.length) console.log(`Removed ${old.length} old backup(s)`);
