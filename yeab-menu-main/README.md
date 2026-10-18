# Lumiere Perfume — Digital Menu

A luxury digital perfume menu for in-store tablets and showrooms. Customers browse
the collection on a touch screen (catalog grid, filters, detail views), while staff
manage everything from a password-protected admin panel.

- **Frontend:** React 18, React Router, Tailwind CSS v4, Motion, Vite
- **Backend:** Express (TypeScript, run with tsx)
- **Database:** SQLite via the built-in `node:sqlite` module (Node 22+)
- **Auth:** JWT-protected admin API

## Quick start

1. Install Node.js **22.13+** (24.x recommended), then:

   ```
   npm install
   ```

2. Copy the environment template and adjust if needed:

   ```
   cp .env.example .env.local
   ```

3. Start the dev server:

   ```
   npm run dev
   ```

4. Open http://localhost:8080 — the catalog lives at `/`, staff tools at `/admin`
   (local development default login `admin` / `admin` — production requires real
   credentials from environment variables, see below).

## Environment variables

| Variable          | Default                                             | Purpose                                        |
| ----------------- | --------------------------------------------------- | ---------------------------------------------- |
| `PORT`            | `8080`                                              | HTTP port (Railway injects it automatically)   |
| `JWT_SECRET`      | random per boot                                     | Signs admin tokens. If unset, a random secret is generated each start, so it is safe but **admin sessions end on every restart**. Set it to keep sessions |
| `ADMIN_USERNAME`  | `admin`                                             | Admin panel username. **Strongly recommended to change** — see *Security* below |
| `ADMIN_PASSWORD`  | `admin`                                             | Admin panel password. **Strongly recommended to change** — see *Security* below |
| `LUMIERE_DATA_DIR`| Windows: `%LOCALAPPDATA%\LumiereMenu`, Linux: `~/.lumiere-menu` | SQLite DB + backups (`/data` in Docker). Set it to a mounted volume or the catalog is wiped on every redeploy (see *Database persistence* below) |
| `LUMIERE_BACKUP_DIR`| `<LUMIERE_DATA_DIR>/backups` | Optional off-volume/non-primary location for automated backups. Strongly recommended in production so backups survive a lost volume |

**The server always starts.** None of these are required to boot — missing or
weak values are reported as warnings in the deploy logs instead of crashing the
container, so a misconfigured deploy stays up and can be fixed from the
dashboard. See [Security](#security) for what each warning means.

Generate a strong `JWT_SECRET` with:

```
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Data & seeding

Everything (perfumes, uploaded images, accord colors, catalog images) lives in a
single SQLite file outside the project folder, so OneDrive/Dropbox never syncs
it and Docker rebuilds never bake it into an image (it is `.dockerignore`d). The
server creates the schema on first boot, snapshots the database **before any
migration** (`perfumes-pre-boot-*.db`), and takes a daily backup that keeps the
last 7. 📚 Full guide: [`docs/DATA_PERSISTENCE.md`](docs/DATA_PERSISTENCE.md).

To load the catalog data:

- `npm run seed` — female / unisex / luxury line from `src/lib/data.ts`
- `npm run seed:male` — the men's line from `scripts/catalog-m.txt`

> ⚠️ **`seed` / `seed:male` are local-setup tools only.** They UPSERT records —
> running them against a production database overwrites live edits for the
> seeded ids. Never run them in the deployment environment.

For an on-demand, consistent snapshot at any time:

- `npm run db:backup` — writes `perfumes-manual-<timestamp>.db` into
  `LUMIERE_BACKUP_DIR` (default `<LUMIERE_DATA_DIR>/backups`). Uses SQLite
  `VACUUM INTO`, so it is safe to run while the server is live.

## Excel import & export (admin)

The admin panel has an **Excel Import & Export** section for bulk-managing the catalog
(📚 full guide: [`docs/IMPORT_EXPORT.md`](docs/IMPORT_EXPORT.md)):

- **Template** — downloads `lumiere-perfume-import-template.xlsx` with the exact columns,
  an example row, and a "How To Fill" guide sheet.
- **Export Catalog** — downloads every product as `.xlsx` (one row per perfume).
- **Import** — uploads a `.xlsx` back. Rows are matched by `id` first, then by `code`:
  a match **updates** the product, an unknown row is **added** as a new product, and rows
  with problems are skipped and reported (per-row errors are shown after the import).

The spreadsheet covers **every Edit Perfume field except images** — name, code, brand,
price, gender, category, stock status, description, rating, accords, fragrance profile,
day/night, seasons and the three note tiers — so it stays small and easy to edit:

- Empty cells never overwrite existing values — only filled cells are applied, so a
  partially filled sheet (e.g. just `code` + `price`) can be used for bulk price updates.
- **No image columns.** Images are handled separately: the import panel has an optional
  **"one image for all"** picker — choose one picture and it is applied to every product
  in the file as **both the main and the mini image**. New products without an image use a
  **Catalog Images** library picture from their Gender × Category bucket when one exists,
  otherwise the default bottle photo; existing images are never touched by a plain import.
  Galleries are edited per product in the Edit Perfume window.
- Notes are plain **names** separated by `|` (e.g. `Rose | Jasmine`). Notes that already
  exist on the product keep their icon; brand-new note names get the default icon.
- Other complex fields use compact formats: lists are separated by `|` (e.g.
  `Winter | Summer`), accords are `Name:strength` pairs (`Woody:80 | Amber:60`) and the
  fragrance profile is `key=value` pairs (`longevity=8H | projection=Moderate`).
  The template's guide sheet documents every column.

Under the hood this uses the `GET /api/admin/perfumes/export`,
`GET /api/admin/perfumes/import/template` and `POST /api/admin/perfumes/import`
(JWT-protected, optional `sharedImage` field) endpoints, powered by `exceljs`.

## Catalog Images (admin)

The admin panel has a **Catalog Images** section for managing bottle photos per
**Gender × Category** bucket (Male / Female / Kids / Unisex × Regular / Brand /
Luxury — the exact tabs of the catalog; 📚 full guide:
[`docs/CATALOG_IMAGES.md`](docs/CATALOG_IMAGES.md)):

- **Add Images** — upload as many pictures as you want into the selected bucket
  (multi-select supported). Everything is stored in the database, so it
  survives redeploys and is never synced by OneDrive.
- **Catalog usage** — products that still show a placeholder bottle photo are
  automatically displayed with an image from their Gender × Category bucket
  (deterministic per product code), and new products created in the admin form
  or via Excel import pick one from the matching bucket when they have no image.
- **Apply to products** — force-writes the bucket's images into every matching
  product (main + mini image).
- A product's own uploaded or pasted image **always wins** over the library.

Endpoints: `GET /api/catalog-images` (public),
`POST /api/admin/catalog-images`, `POST /api/admin/catalog-images/apply` and
`DELETE /api/admin/catalog-images/:id` (admin-only).

## Scripts

| Command          | What it does                          |
| ---------------- | ------------------------------------- |
| `npm run dev`    | Dev server with HMR (Vite middleware) |
| `npm run build`  | Production build into `dist/`         |
| `npm start`      | Serve the built app (`NODE_ENV=production`) |
| `npm run lint`   | Type-check with tsc                   |
| `npm run clean`  | Remove `dist/`                        |
| `npm run db:backup` | Consistent on-demand SQLite backup via `VACUUM INTO`, written to `LUMIERE_BACKUP_DIR` (default `<LUMIERE_DATA_DIR>/backups`) |

## Deploying

This is a Node server (API + static files in one process), so it needs a Node
host — not static hosting like GitHub Pages.

### Docker

```
docker build -t lumiere-menu .
docker run -p 8080:8080 -v lumiere-data:/data lumiere-menu
```

### Render / Railway / Fly.io / any VPS

- **Build command:** `npm ci && npm run build`
- **Start command:** `npm start`
- Set `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` from the table above
- Attach a persistent disk and point `LUMIERE_DATA_DIR` at it (e.g. `/data`) so
  the database survives redeploys

#### Railway, step by step

1. In Railway: **New Project → Deploy from GitHub repo** and pick
   `Lumiere-perfume`. The `railway.json` pins the build to the repo's
   `Dockerfile`, so no build settings are needed.
2. In the service's **Variables** tab, set `JWT_SECRET`, `ADMIN_USERNAME` and
   `ADMIN_PASSWORD`. This step is **optional** — the server boots without them
   (see [Security](#security)), but set them to lock down `/admin`. A local
   `.env` file **cannot** do this: it is listed in both `.gitignore` and
   `.dockerignore`, so it is never copied into the image and never reaches the
   deployed container. Only the Variables injected into the running container
   are read. (Real environment variables also always take precedence over
   `.env` locally, so a stale file can't shadow them.)
3. Go to **Volumes → + New Volume**, mount it at `/data`, then set the
   variable `LUMIERE_DATA_DIR=/data`. Without this the SQLite database is
   wiped on every redeploy (Railway's filesystem is ephemeral). The Dockerfile
   already defaults to `/data`, so this only needs setting if you mount the
   volume somewhere else. Add `LUMIERE_BACKUP_DIR` pointing at a second volume
   (or any off-primary location) so backups survive a lost volume.
4. Under **Settings → Networking**, generate a public domain. The server
   already listens on the `PORT` Railway injects, so no other wiring needed.
   A health check at `/api/health` is already wired up via `railway.json`
   (`healthcheckPath`), so Railway knows when the container is ready.

## Security

The server **always boots** — it never refuses to start over configuration, so a
missed setting can't take the deploy down. In production it prints a startup
report instead, and every item in it is a decision you can make later without a
redeploy being required first:

```
[config] 3 security warning(s) — the server is running, but /admin is exposed:
          - the admin panel uses the default admin/admin credentials. ...
          - JWT_SECRET is not set, so a random one was generated ...
          - ADMIN_PASSWORD is only 5 characters. ...
```

| Warning                          | What it means                                                                                                                                   | Fix                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Default `admin`/`admin`          | `/admin` is reachable from the public internet with credentials that are in this repo's README. Anyone who guesses the URL can edit the whole catalog. | Set `ADMIN_USERNAME` + `ADMIN_PASSWORD` in Variables        |
| `JWT_SECRET` not set             | A random secret is generated per boot. It cannot be guessed, **but every restart invalidates all admin sessions** — including Railway redeploys. | Set `JWT_SECRET` in Variables                               |
| `JWT_SECRET` is a known value    | Anyone holding it (it is public) can **forge an admin token and skip the login form entirely**. This is the most serious of the three. | Generate a unique one and set it in Variables               |
| Short `ADMIN_PASSWORD`           | Trivially brute-forceable.                                                          | Use 8+ characters                                          |
| `LUMIERE_DATA_DIR` not set       | The catalog is written to the container's ephemeral disk and is **deleted on every redeploy**. This one loses data rather than exposing it. | Mount a volume at `/data` (the Dockerfile already defaults to it) |

Nothing above is enforced by the code, so the choice is yours — just make it an
informed one. Nothing in the logs prints a secret value.

The login endpoint is rate limited to 10 failures per IP per 15 minutes, and
credentials are compared in constant time, so a deployed `admin`/`admin` is
unguarded against a *determined* attacker rather than a casual one.

#### Database persistence, backups & recovery

**How it works.** The production database is a single SQLite file at
`<LUMIERE_DATA_DIR>/perfumes.db` (i.e. `/data/perfumes.db` in the container).
It exists **only** because the Railway Volume mounted at `/data` persists
across redeploys. Docker image builds never contain it — `.dockerignore`
excludes `*.db` and `backups/`, and neither `npm ci` nor `npm run build`
touches it.

**What survives a redeploy:**

| Artifact | Where | Survives redeploy? |
| --- | --- | --- |
| SQLite DB (`perfumes.db`) | volume at `/data` | ✅ if volume mounted |
| Daily backups (last 7) + pre-boot snapshots | `LUMIERE_BACKUP_DIR` (default `backups/` on the same volume) | ✅ if volume mounted |
| Built `dist/` (frontend) | rebuilt every deploy | — |
| Uploaded images / catalog images | stored inside the SQLite DB | ✅ if volume mounted |

**Migration safety.** Schema changes are additive (`CREATE TABLE IF NOT EXISTS`,
guarded `ALTER TABLE ADD COLUMN`) and never drop/truncate tables. Before any
migration runs on boot, the existing database is snapshotted to
`perfumes-pre-boot-<timestamp>.db` — a manual rollback point.

**Backups**

- Automatic: on every boot the server copies the DB to
  `perfumes-YYYY-MM-DD.db` (keeps the last 7) and also writes a pre-boot
  snapshot. Set `LUMIERE_BACKUP_DIR` to a **separate volume** so backups are
  not lost with the primary volume.
- Manual: `npm run db:backup` (works live, uses SQLite `VACUUM INTO`).

**Recovery**

1. Stop the service (or scale to zero) to close the DB cleanly.
2. Copy a good backup over the live file:
   `cp <backup-dir>/perfumes-manual-<timestamp>.db /data/perfumes.db`
   (if using a pre-boot snapshot, first restore it to the *data* volume too).
3. Start the service again. On boot the server verifies the file and creates
   any missing tables — it will not delete or reseed existing rows.

**Never do these on production:**

- ❌ Never run `npm run seed` / `npm run seed:male` — they UPSERT and overwrite live rows.
- ❌ Never run raw `DROP` / `DELETE FROM` / `VACUUM` (without `INTO`) against the live file.
- ❌ Never deploy without the `/data` volume mounted.

**Why not PostgreSQL?** The app uses Node's synchronous `node:sqlite` API
everywhere (queries, seeds, backups) with JSON column storage; the workload is a
single-instance, single-writer catalog. Moving to Postgres would require a
full rewrite of every database call, seed and backup tool — a large, risky
change for this scale. SQLite on a mounted, backed-up volume is the supported,
durable choice here. If the app later grows multi-instance/orders, revisit this
with a real migration plan and `npm run db:backup` snapshots as the handover
step.


## Project structure

```
server.ts                  Express API, SQLite schema, static serving
src/                       React app (pages/, components/, lib/)
public/images/perfumes/    Built-in placeholder bottle photos
scripts/                   One-off DB seed scripts + catalog data
docs/                      Feature guides (Excel import & export, catalog images)
```

