# Data Persistence on Railway — Full Guide

This document explains how the application stores data, how it survives (or
fails to survive) Docker rebuilds and re-deployments on Railway, what has been
hardened, and the exact backup/recovery procedures.

---

## The stack

| Question | Answer |
| --- | --- |
| Database engine | **SQLite** (Node built-in `node:sqlite`, `DatabaseSync`) |
| Database file | `<LUMIERE_DATA_DIR>/perfumes.db` |
| Data stored | `perfumes`, `accord_colors`, `catalog_images` (including uploaded images, which live inside the DB) |
| In production (Docker) | `/data/perfumes.db` (`LUMIERE_DATA_DIR=/data` from the Dockerfile) |
| Backups | `LUMIERE_BACKUP_DIR` (default `<LUMIERE_DATA_DIR>/backups`) |
| In production (Docker) | `/backups/...` if `LUMIERE_BACKUP_DIR=/backups` is set, else `/data/backups/...` |

PostgreSQL is **not** used. Rationale: every database access in the codebase
uses Node's synchronous `node:sqlite` API with JSON column storage; the workload
is a single-instance, single-writer catalog/menu. Migrating to Postgres would be
a full rewrite with real risk to existing data — SQLite on a mounted volume is
the supported, durable pattern here.

---

## Does the data survive a Railway redeploy?

**Yes, if and only if a Railway Volume is mounted at `/data`.**

- Railway's container filesystem is **ephemeral**: it is destroyed on every
  redeploy/restart.
- The SQLite database must therefore live on a **Volume**. The Dockerfile
  already sets `LUMIERE_DATA_DIR=/data`, and `.dockerignore` excludes `*.db`
  and `backups/` so the database is never baked into the image.
- A deploy with no volume simply creates a brand-new empty database under
  `/data` on the ephemeral disk — all previously stored perfumes, images and
  settings are gone the moment the container is replaced.

### How to verify you are persisted

1. In Railway open the service → **Settings → Volumes**. There must be a volume.
2. Check its **Mount Path** equals `/data`.
3. In the service logs, on boot you should see:
   `[data] Database file: /data/perfumes.db` and the
   `[data] WARNING: ... MOUNTED VOLUME ...` line (present in production).
4. Add at least one product in the admin panel, redeploy, and confirm it is
   still there.

> If the server refuses to start with
> `[config] FATAL: LUMIERE_DATA_DIR is not set`, create the volume, mount it at
> `/data`, and set `LUMIERE_DATA_DIR=/data` in Variables. This fail-fast guard
> exists precisely so a misconfigured deploy cannot silently write to an
> ephemeral disk.

---

## What could cause data loss

| Risk | Mitigation (already in place / now hardened) |
| --- | --- |
| No volume mounted at `/data` | Hardened: production now refuses to start without `LUMIERE_DATA_DIR`; docs require the volume. |
| Misconfigured service writing to ephemeral FS | Hardened: `resolveDataDir()` fails fast in `NODE_ENV=production` when the variable is missing. |
| A future buggy schema migration | Hardened: the server snapshots `perfumes-pre-boot-<timestamp>.db` **before** migrations run on every boot. Current migrations are additive only. |
| Losing the primary volume takes backups with it | Hardened: `LUMIERE_BACKUP_DIR` can point at a second volume. |
| Running `npm run seed*` against production | Hardened: documented as forbidden; seed scripts are local-only tools and are **not** wired into the Dockerfile, `railway.json` or `package.json` lifecycle scripts. |
| Manual destructive SQL | Documented as forbidden (no `DROP`, no plain `DELETE`, no `VACUUM` without `INTO`). |
| Hard crash / redeploy mid-write | SQLite's default rollback journal + full sync together with the graceful `SIGTERM` handler (closes the DB before exit) keep the file durable. A 5s `busy_timeout` prevents spurious "database is locked" during concurrent backups. |

---

## Directory layout (by default)

```
/data/                  ← Railway Volume (must be mounted)
  perfumes.db           ← the live database
  backups/              ← automatic backups (unless LUMIERE_BACKUP_DIR is set)
    perfumes-YYYY-MM-DD.db          (daily, keeps last 7)
    perfumes-pre-boot-<stamp>.db    (before every migration run)
    perfumes-manual-<stamp>.db      (npm run db:backup)
```

Set `LUMIERE_BACKUP_DIR=/backups` and mount a second volume at `/backups` to
keep backups independent of the primary volume.

---

## Backup procedures

### Automatic (on every boot)
The server:
1. snapshots the existing DB to `perfumes-pre-boot-<stamp>.db` (before schema
   migrations),
2. copies the DB to `perfumes-YYYY-MM-DD.db` (retention: 7),
3. prints `[data] Backup saved: <path>`.

### Manual, on demand (safe while the app is running)
```bash
npm run db:backup
```
Writes `perfumes-manual-<stamp>.db` into `LUMIERE_BACKUP_DIR`. Uses SQLite
`VACUUM INTO`, which produces a transactionally consistent snapshot without
interrupting readers/writers.

### Off-platform copy (recommended schedule)
Back the volume up externally (download `/data/perfumes.db`), e.g. weekly or
before any major deploy, so a full-platform incident still has recovery data.

---

## Recovery procedures

```bash
# 1. Stop the service (scale to zero) so the DB is closed cleanly.
# 2. Restore a good snapshot over the live file. If LUMIERE_BACKUP_DIR is a
#    separate volume copy from there; otherwise from /data/backups.
cp <backup-dir>/perfumes-manual-<timestamp>.db /data/perfumes.db

# 3. Restart the service. On boot the server:
#      - creates any missing tables (additive only),
#      - runs the pre-boot snapshot,
#      - starts serving.
#    It will NOT delete, truncate, or reseed existing rows.
```

Recovery is manual on purpose: nothing at deploy time resets or re-seeds data.

---

## Migration safety

- Migrations are **additive only**: `CREATE TABLE IF NOT EXISTS`, and
  `ALTER TABLE ... ADD COLUMN` guarded by `PRAGMA table_info(...)` checks.
- There is no `DROP`, `TRUNCATE`, or destructive reset anywhere in startup,
  `Dockerfile`, `railway.json`, or `package.json` scripts.
- The pre-boot snapshot gives a manual rollback point per upgrade.
- Seed scripts (`npm run seed`, `npm run seed:male`) are **not** part of any
  deploy path and upsert seeded ids only — treat them as local-setup tools.

---

## Environment variables reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `LUMIERE_DATA_DIR` | `%LOCALAPPDATA%\LumiereMenu` (Win) / `~/.lumiere-menu` (Linux) | Live SQLite DB location. **Required in production** (server refuses to start without it). |
| `LUMIERE_BACKUP_DIR` | `<LUMIERE_DATA_DIR>/backups` | Backup location. Set to a second volume in production. |

All other settings (`PORT`, `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`)
do not affect storage.

---

## Files involved

| Concern | Location |
| --- | --- |
| Data-dir resolution + production guard | `server.ts` — `resolveDataDir()`, `BACKUP_DIR` |
| Pre-boot snapshot + `busy_timeout` | `server.ts` — `backupDatabaseFile('perfumes-pre-boot')`, `PRAGMA busy_timeout` |
| Daily backup rotation | `server.ts` — daily backup block (keeps 7) |
| On-demand backup | `scripts/backup-db.mts` — `npm run db:backup` |
| Image / Volume config | `Dockerfile` — `ENV LUMIERE_DATA_DIR=/data`; `.dockerignore` — excludes `*.db`, `backups/` |
| Deploy config | `railway.json`, `package.json` (no destructive hooks) |