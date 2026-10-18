# Excel Import & Export — Full Guide

The admin panel's **Excel Import & Export** section lets staff manage the entire
catalog from a spreadsheet: export every product to `.xlsx`, edit prices, stock
and details in Excel, then import the file back. Every field of the **Edit
Perfume** form is covered **except images**.

Everything below is implemented in `server.ts` (API + workbook generation) and
`src/pages/AdminPage.tsx` (admin UI).

---

## Where to find it

Log in at `/admin` and scroll to the **Excel Import & Export** card. It has:

| Control | What it does |
| --- | --- |
| **Template** | Downloads `lumiere-perfume-import-template.xlsx` — the exact columns, one example row, and a **"How To Fill"** guide sheet documenting every column. |
| **Export Catalog** | Downloads every product as `lumiere-perfumes-YYYY-MM-DD.xlsx` (one row per perfume, header row frozen, newest products first). |
| **Choose .xlsx** | Picks the file to import. The picker accepts `.xlsx` only; anything else shows an error and keeps **Import** disabled. |
| **One image for all** *(optional)* | Picks one picture that is applied to **every product in the file** as both the main and the mini image. A ✕ button clears it. |
| **Import** | Uploads the chosen file. Disabled until a valid `.xlsx` is chosen; shows `Importing…` while the request runs (60-second safety timeout). |

After a successful import a report banner appears:
`Import finished — N added, M updated, K skipped`, followed by the first
10 per-row errors (if any) and the catalog refreshes automatically.

---

## Quick workflows

### Bulk price / stock update
1. Click **Export Catalog**.
2. Open the downloaded file in Excel — the `id` and `code` columns already
   match the database, so every row is recognized as an existing product.
3. Change only the `price` (and/or `stockStatus`) cells. Leave everything else
   untouched — empty cells never overwrite stored values.
4. Save as `.xlsx` and click **Choose .xlsx → Import**.

### Adding new products
1. Click **Template** and fill one row per new perfume.
2. Only `name` is required for a new row; every other empty cell falls back to
   the standard defaults (see *Defaults for new products* below).
3. `id` may be left empty — the server generates one. `code` too, but giving
   your own code (e.g. `P1234`) makes future re-imports match reliably.
4. Optionally pick **One image for all** first so the new products are not
   created with the default bottle photo.
5. Import. The report tells you exactly how many rows were added.

---

## Column reference

The sheet name is **`Perfumes`** (any first worksheet is accepted on import, and
headers are matched case-insensitively). Lists are separated by ` | `.

| Column | Required? | Format / allowed values | Example |
| --- | --- | --- | --- |
| `id` | No | Existing product id | `1731948…` |
| `name` | **Yes for new rows** | Free text | `Amber Noir` |
| `code` | Recommended | Free text; unique key | `P1234` |
| `brand` | No | Free text | `Our Fragrance` |
| `price` | No | Number (`,` and spaces allowed) | `2,500` |
| `gender` | No | `Male` `Female` `Kids` `Unisex` | `Unisex` |
| `category` | No | `Perfume` `Brand Perfume` `Luxury Perfume` | `Perfume` |
| `stockStatus` | No | `In Stock` `Low Stock` `Out Stock` | `In Stock` |
| `description` | No | Free text | `A warm amber fragrance…` |
| `rating` | No | Number 0–5 | `4.5` |
| `accords` | No | `Name:strength` pairs | `Amber:80 \| Woody:65` |
| `fragranceProfile` | No | `key=value` pairs (`longevity`, `projection`, `sillage`) | `longevity=8H \| projection=Moderate` |
| `dayNight` | No | `Day` `Night` `Both` | `Both` |
| `seasons` | No | `Winter` `Spring` `Summer` `Autumn` | `Autumn \| Winter` |
| `notes.top` | No | Note names | `Bergamot \| Pink Pepper` |
| `notes.middle` | No | Note names | `Rose` |
| `notes.base` | No | Note names | `Sandalwood \| Vanilla` |

> **Golden rule:** an empty cell means *"keep the current value"*. Only filled
> cells are applied, so a partially filled sheet is always safe to import.

---

## How rows are matched (upsert rules)

For every data row the server finds the target product:

1. **By `id` first** — if the `id` matches an existing product, that product is updated.
2. **Then by `code`** — if the `id` is empty/unknown but the `code` matches, that product is updated.
3. **Otherwise the row creates a new product.**

Consequences and edge cases:

- A row that matches an existing product **may omit `name`** — every empty cell
  simply keeps the current value.
- A row that matches **nothing** must have a `name`, otherwise it is skipped
  with the error *"Product name is required for new rows…"*.
- Duplicate codes **inside one file** behave predictably: the first row creates
  the product, later rows with the same code update it (the id/code indexes are
  kept in sync while the file is processed).
- A custom `id` on a new row is honored **only if it is not already taken**;
  otherwise one is generated (`<timestamp>-<row>-<n>`).
- A new row without a `code` gets an auto code: `IMP-<timestamp>-<rowNumber>`.

### Updates are partial and non-destructive

- Only cells with content are written — mirrors the single-product **PUT** endpoint.
- `fragranceProfile` merges **per key**: sending only `longevity=12H` leaves the
  stored `projection`/`sillage` untouched.
- `notes.top` / `notes.middle` / `notes.base` each replace their **own tier** only.
- Notes are plain **names**. Re-imported notes keep the icon they already had;
  brand-new names get the default note icon. A legacy `Name@iconUrl` suffix from
  older exports is stripped automatically.

### Defaults for new products

Any value not filled in falls back to the same defaults the admin form uses:

| Field | Default |
| --- | --- |
| `brand` | `Our Fragrance` |
| `price` | `0` |
| `gender` | `Unisex` |
| `category` | `Perfume` |
| `stockStatus` | `In Stock` |
| `rating` | `5` |
| `dayNight` | `Both` |
| `fragranceProfile` | `longevity=8H`, `projection=Moderate`, `sillage=Moderate` |
| `seasons` | none |
| `galleryImages` | empty |
| Main + mini image | The shared image if picked, otherwise a **Catalog Images** library picture for the row's Gender × Category (falling back to `/images/perfumes/normal.jpg`) |

### Images

The spreadsheet carries **no image columns at all**. Images are handled separately:

- The optional **"One image for all"** picker applies one picture (as **both**
  main and mini image) to **every product in the file**.
- New products without a shared image use a **Catalog Images** library picture
  from their Gender × Category bucket when one exists, otherwise the default
  bottle photo.
- A plain import **never touches** existing images. Galleries are edited per
  product in the **Edit Perfume** window.

---

## Validation rules (what happens to bad values)

| Situation | Behavior |
| --- | --- |
| Enum value in the wrong case (`male`, `IN STOCK`) | Accepted — matching is case-insensitive |
| Unknown `gender` / `category` / `stockStatus` / `dayNight` | Falls back to the default (`Unisex` / `Perfume` / `In Stock` / `Both`) |
| Unknown season name in `seasons` | Silently dropped from the list |
| `price` with commas/spaces (`2,500`) | Accepted — cleaned then rounded to an integer |
| `price` not a number (`abc`) | **Row skipped**, error `Price "abc" is not a valid number` |
| `rating` outside 0–5 or non-numeric | Clamped to 0–5, or defaults to 5 |
| Accord strength missing | Defaults to `75` |
| Accord strength outside 0–100 | Clamped |
| Accord color not in the accord-colors table | Uses the fallback color `#666666` |
| Cell containing rich text / formula results | Flattened to plain text automatically |

Bad rows are **skipped, not fatal**: the rest of the file is still imported and
each skipped row is reported with its row number.

---

## API reference

All three endpoints are JWT-protected — send `Authorization: Bearer <admin token>`.

### `GET /api/admin/perfumes/export`
Exports the whole catalog. Returns an `.xlsx` attachment named
`lumiere-perfumes-YYYY-MM-DD.xlsx` (sheet `Perfumes`, bold frozen header row,
one row per perfume, ordered newest first).

### `GET /api/admin/perfumes/import/template`
Returns `lumiere-perfume-import-template.xlsx` — header row, one example row
(`Example Perfume`, `P1234`, `2500`, …) and the **How To Fill** guide sheet
that documents every column and the formats above.

### `POST /api/admin/perfumes/import`
Imports a workbook. The client sends the file as **base64 inside a JSON body**
(same approach as image uploads — no multipart needed):

```json
{
  "dataBase64": "<base64 of the .xlsx file>",
  "sharedImage": "data:image/jpeg;base64,…"
}
```

- `dataBase64` — required.
- `sharedImage` — optional data URL; applied as main **and** mini image of every
  product in the file.

**Success response** (`200`):

```json
{
  "success": true,
  "created": 2,
  "updated": 10,
  "skipped": 1,
  "total": 13,
  "errors": [
    { "row": 7, "message": "Price \"abc\" is not a valid number" }
  ]
}
```

`errors` is capped at 50 entries; each entry names the spreadsheet row and the
reason it was skipped.

**Error responses** (`400`):

| Error | Cause |
| --- | --- |
| `No spreadsheet received — choose an .xlsx file first.` | `dataBase64` missing/empty |
| `Could not read the file — make sure it's an .xlsx workbook (old .xls files are not supported).` | Corrupt file or legacy `.xls` |
| `The spreadsheet needs a header row plus at least one product row.` | Empty sheet |
| `The spreadsheet has no "name" column — download the template for the exact format.` | Missing required header |

### Transaction semantics
All rows are processed inside a **single SQLite transaction**: individual bad
rows are skipped and reported, while an unexpected failure rolls the whole file
back — the database is never left half-imported.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| *"…is not an .xlsx workbook"* | Save the file as **Excel Workbook (.xlsx)** — Excel 97-2003 `.xls` and CSV are not supported. |
| *"The spreadsheet has no name column"* | Keep the header row from the template; headers are matched case-insensitively but the `name` header must exist. |
| A row was skipped: *"Product name is required for new rows…"* | Fill `name`, or put a valid `id`/`code` so the row matches an existing product. |
| Prices came in wrong | Check the `price` cell is numeric; text like `2.500 USD` fails, `2,500` works. |
| Import button never enables | The chosen file must end in `.xlsx` (checked before upload). |
| Images didn't change | Expected — import never touches images unless **One image for all** is picked; galleries are edited per product. |
| Nothing seemed to happen | The request has a 60-second client timeout; very large files should be split. The report banner shows the outcome either way. |
| Afraid of overwriting data | Export first, edit that file, re-import. Empty cells never overwrite; unmatched rows become new products rather than edits. |

---

## Implementation map

| Concern | Location |
| --- | --- |
| Column definitions, enum lists, defaults | `server.ts` — `EXCEL_COLUMNS`, `EXCEL_GENDERS`, `EXCEL_CATEGORIES`, … |
| Export endpoint | `server.ts` — `GET /api/admin/perfumes/export` |
| Template generation | `server.ts` — `buildImportTemplateWorkbook()` |
| Import endpoint (parsing, matching, upsert, report) | `server.ts` — `POST /api/admin/perfumes/import` |
| Admin UI (buttons, file validation, report banner) | `src/pages/AdminPage.tsx` — Excel Import & Export card |
| XLSX engine | [`exceljs`](https://github.com/exceljs/exceljs) |


