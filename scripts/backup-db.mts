/**
 * On-demand, consistent SQLite backup using `VACUUM INTO`.
 *
 * Usage:  npm run db:backup
 * Honors LUMIERE_DATA_DIR (same resolution logic as server.ts).
 * The snapshot is written into <DATA_DIR>/backups/perfumes-manual-<timestamp>.db
 * and never touches the live database.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = process.env.LUMIERE_DATA_DIR
  || (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'LumiereMenu')
    : path.join(os.homedir(), '.lumiere-menu'));
const DB_PATH = path.join(DATA_DIR, 'perfumes.db');

// Optional off-volume backup location (LUMIERE_BACKUP_DIR); defaults to
// <DATA_DIR>/backups when unset.
const BACKUP_DIR = (process.env.LUMIERE_BACKUP_DIR && process.env.LUMIERE_BACKUP_DIR.trim().length > 0)
  ? process.env.LUMIERE_BACKUP_DIR.trim()
  : path.join(DATA_DIR, 'backups');

if (!fs.existsSync(DB_PATH)) {
  console.error(`No database found at ${DB_PATH}`);
  console.error('Start the server once to create it, or set LUMIERE_DATA_DIR to the right folder.');
  process.exit(1);
}

const backupDir = BACKUP_DIR;
fs.mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(backupDir, `perfumes-manual-${stamp}.db`);

const db = new DatabaseSync(DB_PATH);
try {
  // VACUUM INTO writes a compact, transactionally consistent snapshot of the
  // whole database without interrupting readers/writers.
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
} finally {
  db.close();
}

const sizeKb = Math.round(fs.statSync(target).size / 1024);
console.log(`Backup created: ${target} (${sizeKb} KB)`);