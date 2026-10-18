import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('Set DATABASE_URL before creating a PostgreSQL backup.');

const backupDirectory = process.env.LUMIERE_BACKUP_DIR?.trim()
  || path.join(process.cwd(), 'backups');
fs.mkdirSync(backupDirectory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDirectory, `lumiere-postgres-${stamp}.dump`);
const pgDump = process.env.PG_DUMP_PATH?.trim() || (os.platform() === 'win32' ? 'pg_dump.exe' : 'pg_dump');

const backup = spawn(pgDump, ['--format=custom', '--no-owner', '--file', backupPath], {
  env: { ...process.env, PGDATABASE: databaseUrl },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let errorOutput = '';
backup.stderr.setEncoding('utf8');
backup.stderr.on('data', chunk => { errorOutput += chunk; });
backup.on('error', error => {
  console.error(`Could not run pg_dump (${pgDump}). Install PostgreSQL client tools or set PG_DUMP_PATH.`, error);
  process.exitCode = 1;
});
backup.on('close', code => {
  if (code !== 0) {
    console.error(`PostgreSQL backup failed with exit code ${code}: ${errorOutput.trim()}`);
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    process.exitCode = 1;
    return;
  }
  console.log(`PostgreSQL backup created: ${backupPath}`);
});
