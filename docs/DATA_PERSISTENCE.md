# PostgreSQL data persistence and migration

The app stores its catalog in PostgreSQL using the Node.js `pg` client. Local
development and hosted deployments use the same database implementation; there
is no SQLite database in the runtime application.

## Database contents

The server creates and additively updates these tables during startup:

- `perfumes` — product fields, including uploaded images and JSON-encoded
  catalog data.
- `accord_colors` — custom accord colors.
- `catalog_images` and `catalog_size_images` — shared category imagery.
- `category_settings` — product category size, unit, and price settings.

Startup requires a working `DATABASE_URL`. The app does not fall back to a
local file or create a database server. Schema setup uses `CREATE TABLE IF NOT
EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; it does not drop or
truncate existing tables.

## Configure PostgreSQL locally

1. Start a PostgreSQL instance and create a database for the app.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL` to the database connection string, for example:

   ```dotenv
   DATABASE_URL=postgresql://username:password@localhost:5432/lumiere
   ```

4. Set a unique `JWT_SECRET` and non-default admin credentials before exposing
   the app to a network.
5. Run `npm run dev`. The server initializes the application schema on startup.

Never commit `.env` or put real credentials in `.env.example`.

## Railway deployment

1. Add a PostgreSQL service to the Railway project.
2. In the app service's **Variables**, add a reference to that PostgreSQL
   service's `DATABASE_URL`.
3. Set `JWT_SECRET`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` in the app service.
4. Deploy the app. It requires PostgreSQL to be reachable and initializes the
   schema during startup.

Railway injects the database URL at runtime. Do not paste a production URL into
source files, Docker build arguments, or committed environment templates.

## Import an existing SQLite catalog

The one-time importer copies products and related settings/images from the
existing local SQLite file. It does not modify the source file. The destination
must be the intended PostgreSQL database, and importing updates rows with
matching primary keys; take a PostgreSQL backup first if the target already
contains data.

1. Configure `DATABASE_URL` for the destination PostgreSQL database.
2. Start the app once against that database so the schema is initialized, then
   stop it.
3. If the SQLite source is not at the default location, set `SQLITE_DB_PATH` to
   its path. The default is `%LOCALAPPDATA%\\LumiereMenu\\perfumes.db` on
   Windows or `~/.lumiere-menu/perfumes.db` on other systems.
4. Run:

   ```sh
   npm run db:migrate-sqlite
   ```

5. Check the importer row counts and verify the catalog in the app before
   switching production traffic to the new database.

The importer uses one transaction for the destination data. A missing
destination table or an import failure rolls back the import and reports the
error. Source-side optional tables absent from an older SQLite database are
skipped and reported; the required `perfumes` table must exist.
`DATABASE_URL` must point to the intended destination; no hosted database is
selected automatically.

## Backups and restore

Create a custom-format PostgreSQL backup with:

```sh
npm run db:backup
```

This requires PostgreSQL client tools (`pg_dump`) and `DATABASE_URL`. By
default, the output is written under `./backups`; set `LUMIERE_BACKUP_DIR` to
choose another directory. Store copies outside the database host and restrict
access because a backup contains the full catalog and any uploaded images.

To restore a dump, first stop app writes and confirm the destination database.
Use PostgreSQL's `pg_restore` client, for example:

```sh
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" path/to/backup.dump
```

`--clean` drops objects present in the dump before restoring them, so only use
this against a database you intend to replace. For a safer merge-style restore,
restore into a separate empty database and verify it before directing the app
to it. After restore, restart the app and verify `/api/health` and the catalog.

## Seed scripts

`npm run seed` and `npm run seed:male` UPSERT catalog entries and may overwrite
admin edits for seeded product IDs. They are local setup tools and should not
be run against production unless that overwrite is intentional.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL connection string. |
| `JWT_SECRET` | Signs admin JWTs; configure a stable, unique secret for deployments. |
| `ADMIN_USERNAME` | Admin login name. |
| `ADMIN_PASSWORD` | Admin password. |
| `LUMIERE_BACKUP_DIR` | Optional `pg_dump` output directory; defaults to `./backups`. |
| `SQLITE_DB_PATH` | Optional source path used only by the SQLite importer. |

## Related files

| Concern | Location |
| --- | --- |
| PostgreSQL pool, schema, and API | `server.ts` |
| SQLite-to-PostgreSQL importer | `scripts/migrate-sqlite-to-postgres.mts` |
| PostgreSQL backup | `scripts/backup-db.mts` |
| Database scripts and dependencies | `package.json` |
| Railway deployment configuration | `railway.json` and `Dockerfile` |
