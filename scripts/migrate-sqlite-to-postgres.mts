import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';

const railwayTarget = process.env.DB_MIGRATION_TARGET === 'railway';
const databaseUrl = railwayTarget
  ? process.env.RAILWAY_DATABASE_URL?.trim()
  : process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    railwayTarget
      ? 'Set RAILWAY_DATABASE_URL to the Railway PostgreSQL connection string.'
      : 'Set DATABASE_URL to the destination PostgreSQL connection string.'
  );
}

const defaultDataDir = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'LumiereMenu')
  : path.join(os.homedir(), '.lumiere-menu');
const sqlitePath = process.env.SQLITE_DB_PATH?.trim() || path.join(defaultDataDir, 'perfumes.db');
if (!fs.existsSync(sqlitePath)) throw new Error(`SQLite database not found at ${sqlitePath}. Set SQLITE_DB_PATH if it is stored elsewhere.`);

const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
const postgres = new Pool({ connectionString: databaseUrl });
if (railwayTarget) console.log('Destination: Railway PostgreSQL (RAILWAY_DATABASE_URL).');
const tables = [
  { name: 'perfumes', keys: ['id'] },
  { name: 'accord_colors', keys: ['name'] },
  { name: 'category_settings', keys: ['category'] },
  { name: 'catalog_images', keys: ['id'] },
  { name: 'catalog_size_images', keys: ['gender', 'category', 'size'] },
] as const;

try {
  const existingTables = await postgres.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()"
  );
  const availableTables = new Set(existingTables.rows.map(row => row.table_name as string));
  const client = await postgres.connect();
  try {
    await client.query('BEGIN');
    for (const table of tables) {
      if (!availableTables.has(table.name)) {
        throw new Error(`PostgreSQL table "${table.name}" is missing. Start the app once to create the schema before migrating.`);
      }
      const sqliteColumns = sqlite.prepare(`PRAGMA table_info(${table.name})`).all() as { name: string }[];
      if (sqliteColumns.length === 0) {
        if (table.name === 'perfumes') {
          throw new Error('The source SQLite database does not contain the required perfumes table.');
        }
        console.log(`Skipped ${table.name}: the source SQLite database does not contain this table.`);
        continue;
      }
      const postgresColumns = await client.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
        [table.name]
      );
      const allowedColumns = new Set(postgresColumns.rows.map(row => row.column_name as string));
      const columns = sqliteColumns
        .map(column => column.name.toLowerCase())
        .filter(column => allowedColumns.has(column));
      if (columns.length === 0) continue;

      const rows = sqlite.prepare(`SELECT * FROM ${table.name}`).all() as Record<string, unknown>[];
      const conflictKeys = table.keys.filter(key => columns.includes(key));
      if (conflictKeys.length !== table.keys.length) {
        throw new Error(`Could not find all conflict-key columns for "${table.name}".`);
      }
      const conflictKeySet = new Set<string>(conflictKeys);
      const updateColumns = columns.filter(column => !conflictKeySet.has(column));
      const conflictAction = updateColumns.length > 0
        ? `DO UPDATE SET ${updateColumns.map(column => `${column} = EXCLUDED.${column}`).join(', ')}`
        : 'DO NOTHING';

      for (const row of rows) {
        const values = columns.map(column => {
          const sourceName = sqliteColumns.find(item => item.name.toLowerCase() === column)?.name;
          return sourceName ? row[sourceName] : null;
        });
        const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
        await client.query(
          `INSERT INTO ${table.name} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${conflictKeys.join(', ')}) ${conflictAction}`,
          values
        );
      }
      console.log(`Migrated ${rows.length} ${table.name} row(s).`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} finally {
  sqlite.close();
  await postgres.end();
}
