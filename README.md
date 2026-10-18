# Lumiere Perfume — Digital Menu

A luxury digital perfume menu for in-store tablets and showrooms. Customers browse
the collection on a touch screen (catalog grid, filters, detail views), while staff
manage everything from a password-protected admin panel.

- **Frontend:** React 18, React Router, Tailwind CSS v4, Motion, Vite
- **Backend:** Express (TypeScript, run with tsx)
- **Database:** PostgreSQL via `pg`
- **Auth:** JWT-protected admin API

## Quick start

1. Install Node.js **22.13+** (24.x recommended), then:

   ```
   npm install
   ```

2. Copy the environment template and adjust if needed:

   ```
   cp .env.example .env
   ```

3. Start the dev server:

   ```
   npm run dev
   ```

4. Open http://localhost:8080 — the catalog lives at `/`, staff tools at `/admin`
   (local development default login `admin` / `admin` — production requires real
   credentials from environment variables, see below).

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Required | PostgreSQL connection string. In Railway, reference the PostgreSQL service's `DATABASE_URL`; locally, set it in `.env`. |
| `PORT` | `8080` | HTTP port (Railway injects it automatically). |
| `JWT_SECRET` | random per boot | Signs admin tokens. If unset, a random secret is generated each start, so admin sessions end on every restart. |
| `ADMIN_USERNAME` | `admin` | Admin panel username. Change for production. |
| `ADMIN_PASSWORD` | `admin` | Admin panel password. Change for production. |
| `LUMIERE_BACKUP_DIR` | `./backups` | Optional directory for `pg_dump` backups. |

The server requires a working `DATABASE_URL`; it fails fast rather than silently
starting without persistent storage. Weak or missing authentication settings
are reported in logs. See [Security](#security).

Generate a strong `JWT_SECRET` with:

```
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Data & seeding

Products, uploaded images, accord colors, and catalog settings are stored in
PostgreSQL. The server creates and additively updates its schema on first boot.
See [`docs/DATA_PERSISTENCE.md`](docs/DATA_PERSISTENCE.md) for Railway setup,
SQLite migration, backup, and recovery.

To load the catalog data:

- `npm run seed` — female / unisex / luxury line from `src/lib/data.ts`
- `npm run seed:male` — the men's line from `scripts/catalog-m.txt`

> ⚠️ **`seed` / `seed:male` are local-setup tools only.** They UPSERT records —
> running them against a production database overwrites live edits for the
> seeded ids. Never run them in the deployment environment.

For an on-demand PostgreSQL backup (requires `pg_dump`):

- `npm run db:backup` — writes a custom-format `.dump` into `LUMIERE_BACKUP_DIR`.
- `npm run db:migrate-sqlite` — one-time import of a local SQLite database into
  the PostgreSQL database. See the migration guide before running it.

## Excel import & export (admin)

The admin panel has an **Excel Import & Export** section for bulk-managing the catalog
(📚 full guide: [`docs/IMPORT_EXPORT.md`](docs/IMPORT_EXPORT.md)):

- **Template** — downloads `lumiere-perfume-import-template.xlsx` with the exact columns,
  an example row, and a "How To Fill" guide sheet.
- **Export Catalog** — downloads every product as `.xlsx` (one row per perfume).
- **Import** — uploads a `.xlsx` back. Rows are matched by `id` first, then by `code`:
  a match **updates** the product, an unknown row is **added** as a new product, and rows
  with problems are skipped and reported (per-row errors are shown after the import).

The spreadsheet covers **every Edit Product field except images** — name, code, brand,
unit and size prices, per-gram rate, gender, category, stock status, description, rating,
accords, fragrance profile, day/night, seasons and the three note tiers — so it stays
small and easy to edit:

- The `products` worksheet matches the supplied products workbook format.
  `productType` values `OIL` and `PURE_OIL` map to Oil and 3ml Oil; the
  `Men`/`Women`/`Unisex`/`Kids` category labels map to the Regular Perfume
  category. Exports append product-specific unit, size prices, and per-gram
  pricing so those values survive an import/export round trip.
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

The admin panel has a **Catalog Images** section for creating categories and
setting two sizes, prices, units (ml or gram), and optional size-specific images.
It also manages shared photos per **Gender × Category** bucket (Male / Female /
Kids / Unisex × Regular / Brand / Luxury / Oil / Musk / 3ml Oil / Cream/Jelly,
plus admin-created categories; 📚 full guide:
[`docs/CATALOG_IMAGES.md`](docs/CATALOG_IMAGES.md)):

- **Category setup** — Regular, Brand, and Luxury start with 50 ml and 100 ml
  options. Oil, Musk, 3ml Oil, and Cream/Jelly are also included; admins can
  add further categories and customize both sizes.
- **Size-specific catalog options** — each category size has its own ETB price
  and optional image. Customers select the size in product details.
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

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with HMR (Vite middleware). |
| `npm run build` | Production build into `dist/`. |
| `npm start` | Serve the built app (`NODE_ENV=production`). |
| `npm run lint` | Type-check with tsc. |
| `npm run clean` | Remove `dist/`. |
| `npm run db:backup` | Create a PostgreSQL custom-format backup with `pg_dump`. |
| `npm run db:migrate-sqlite` | Import a local SQLite database into PostgreSQL. |

## Deploying

This is a Node server (API + static files in one process), so it needs a Node
host — not static hosting like GitHub Pages.

### Docker

```
docker build -t lumiere-menu .
docker run -p 8080:8080 -e DATABASE_URL="postgresql://..." lumiere-menu
```

### Render / Railway / Fly.io / any VPS

- **Build command:** `npm ci && npm run build`
- **Start command:** `npm start`
- Set `DATABASE_URL`, `JWT_SECRET`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD`

#### Railway, step by step

1. In Railway: **New Project → Deploy from GitHub repo** and pick
   `Lumiere-perfume`. The `railway.json` pins the build to the repo's
   `Dockerfile`, so no build settings are needed.
2. Add a PostgreSQL service to the project.
3. In the app service's **Variables**, add a reference to the PostgreSQL
   service's `DATABASE_URL`. Also set `JWT_SECRET`, `ADMIN_USERNAME`, and
   `ADMIN_PASSWORD`. `.env` is ignored and excluded from Docker, so it must not
   be used to configure deployed services.
4. Under **Settings → Networking**, generate a public domain. The server
   already listens on the `PORT` Railway injects, so no other wiring needed.
   A health check at `/api/health` is already wired up via `railway.json`
   (`healthcheckPath`), so Railway knows when the container is ready.

## Security

The server requires `DATABASE_URL` and exits with a clear startup error if it is
missing or PostgreSQL cannot be reached. Authentication misconfiguration is
reported at startup:

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

Nothing above is enforced by the code, so the choice is yours — just make it an
informed one. Nothing in the logs prints a secret value.

The login endpoint is rate limited to 10 failures per IP per 15 minutes, and
credentials are compared in constant time, so a deployed `admin`/`admin` is
unguarded against a *determined* attacker rather than a casual one.

## Project structure

```
server.ts                  Express API, PostgreSQL schema, static serving
src/                       React app (pages/, components/, lib/)
public/images/perfumes/    Built-in placeholder bottle photos
scripts/                   PostgreSQL seed, backup, migration scripts + catalog data
docs/                      Feature guides (Excel import & export, catalog images)
```
