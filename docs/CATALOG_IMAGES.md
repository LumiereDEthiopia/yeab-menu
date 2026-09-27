# Catalog Images — Full Guide

The admin panel's **Catalog Images** section is a photo library organized by
**Gender × Category** bucket. Staff upload as many bottle photos as they want
per bucket, and the catalog uses those photos automatically — so the whole
collection can be re-photographed from one place instead of editing each
product's image by hand.

Everything below is implemented in `server.ts` (SQLite table, endpoints,
automatic image resolution for new products) and `src/` (catalog resolver +
admin UI).

---

## Where to find it

Log in at `/admin`. The **Catalog Images** card sits between **Excel Import &
Export** and the perfume list. It has:

| Control | What it does |
| --- | --- |
| **Gender tabs** | `Male` / `Female` / `Kids` / `Unisex` — picks the gender bucket you are editing. |
| **Category tabs** | `Regular` / `Brand` / `Luxury` — picks the category bucket (`Perfume`, `Brand Perfume`, `Luxury Perfume`). |
| **Add Images** | Multi-select upload of as many pictures as you like into the current bucket (JPG / PNG / WebP). Shows `Uploading 1 of N…` progress, then a green confirmation. |
| **Apply to products** | Force-writes the current bucket's images into **every** matching product (main + mini image), deterministic per product code. |
| **Thumbnail grid** | Every image in the current bucket, with a hover trash button to remove it from the library. |

The 4 genders × 3 categories = **12 buckets**. Upload, edit, and delete in one
bucket without affecting the others.

---

## Quick workflows

### Give every "Male × Luxury" product a real photo
1. Open **Catalog Images**, set Gender = **Male**, Category = **Luxury**.
2. Click **Add Images** and select the luxury bottle photos (several at once).
3. The catalog now automatically shows these photos on every male luxury
   product that still displayed a placeholder bottle.
4. (Optional) Click **Apply to products** to also *persist* the images onto the
   products' main/mini image fields — useful if staff later export to Excel and
   want the images baked in.

### Set up the whole library for all 12 buckets
Repeat the two steps above for every Gender × Category combination that has
products. Products whose own image was uploaded/pasted in **Edit Perfume** keep
their photo no matter what — only products with a placeholder bottle are
replaced by the library.

### Roll out new seasonal photography
Delete the old photos from a bucket, upload the new ones, and click
**Apply to products**. Because pick is deterministic, re-running apply after
adding images rotates products across the new set; deleting the bucket's images
and applying again resets matching products to their stored/placeholder image.

---

## How the catalog uses the library

When a customer opens the catalog `/`, the images are resolved like this for
each product:

1. **Product's own image wins.** If `mainImage` is anything *other* than a
   built-in placeholder bottle, it is used as-is (uploaded pictures, pasted
   URLs, `Apply to products` results).
2. **Exact bucket.** Otherwise the library is searched for the product's exact
   Gender × Category bucket
   (e.g. `Female` × `Brand Perfume`) and one image is picked deterministically.
3. **Same category, then same gender, then anything.** If the exact bucket is
   empty, the resolver falls back to any library image of the same category,
   then the same gender, then the whole library.
4. **Stored fallback.** If the library is empty, the product's stored image is
   shown (placeholder bottle or the default photo).

Because the pick is seeded from the product `code` (or `id`), **the same
product always shows the same library image** across page loads and refreshes.

This substitution is **display-only** — it does not modify the product row. The
explicit **Apply to products** action is what writes images into the database.

### New products created later
- **Admin form** (`Add Perfume`): if the form sends no image (or a placeholder),
  the server picks from the matching Gender × Category bucket for the new
  product.
- **Excel import**: a new row with no shared image picks from the bucket of the
  row's `gender` / `category`, falling back to the default bottle photo.

---

## Buckets

| Gender | Category (labels in the UI) | Stored category values |
| --- | --- | --- |
| Male, Female, Kids, Unisex | Regular | `Perfume` |
| Male, Female, Kids, Unisex | Brand | `Brand Perfume` |
| Male, Female, Kids, Unisex | Luxury | `Luxury Perfume` |

Images are stored as **data URLs** (from file uploads) or **URLs/paths**
(pasted), one row per picture. Image data lives **inside the SQLite database**
(like perfume uploads), so the library survives redeploys and is **not** synced
by OneDrive.

Maximum upload per image: ~12 MB of base64. The image format is validated on
the server (`data:image/...` only for uploads).

---

## API reference

Three endpoints are JWT-protected (send `Authorization: Bearer <admin token>`);
the read endpoint is public so the catalog page loads the library without
logging in.

### `GET /api/catalog-images` (public)
Returns every library image:

```json
[
  {
    "id": "mtkksy7z-58fwna",
    "gender": "Male",
    "category": "Perfume",
    "image": "data:image/png;base64,iVBOR..."
  }
]
```

Ordered by gender, then category, then insert order.

### `POST /api/admin/catalog-images`
Adds one image to a bucket.

```json
{
  "gender": "Male",
  "category": "Perfume",
  "image": "data:image/png;base64,..."
}
```

Validation errors (`400`):

| Error | Cause |
| --- | --- |
| `Gender must be one of: Male, Female, Kids, Unisex` | Bad gender value |
| `Category must be one of: Perfume, Brand Perfume, Luxury Perfume` | Bad category value |
| `The image is missing or too large — pick a smaller picture.` | Empty or > ~12 MB payload |
| `Unsupported image format — choose a JPG, PNG or WebP picture.` | Not a `data:image/`, `/`, `http://` or `https://` value |

Success returns the stored row with its generated `id`.

### `POST /api/admin/catalog-images/apply`
Writes the bucket's images into every matching product. Body:

```json
{ "gender": "Female", "category": "Brand Perfume" }
```

- Looks up the bucket's pooled images (must be non-empty).
- Updates **all** `perfumes` where `gender = 'Female' AND category = 'Brand Perfume'`,
  setting `mainImage` and `miniImage` to a deterministically chosen photo
  (seeded per product `code`, falling back to `id`).
- Runs in a single SQLite transaction (all-or-nothing).
- Response: `{ "success": true, "updated": 12 }`.

### `DELETE /api/admin/catalog-images/:id`
Removes a single image from the library. Response: `{ "success": true }`.
(Existing products are not touched — they keep whatever `mainImage` they
already have.)

---

## Database schema

```
CREATE TABLE catalog_images (
  id          TEXT PRIMARY KEY,
  gender      TEXT NOT NULL,
  category    TEXT NOT NULL,
  image       TEXT NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_catalog_images_bucket ON catalog_images (gender, category);
```

The table is created automatically on server boot (via `CREATE TABLE IF NOT
EXISTS`), so no migration step is needed.

---

## Troubleshooting

| Symptom | Explanation / Fix |
| --- | --- |
| Upload fails with *"image is missing or too large"* | The file is empty or bigger than the ~12 MB base64 limit — resize the photo first. |
| Upload fails with *"Unsupported image format"* | Only JPG / PNG / WebP uploads are accepted. |
| Catalog still shows the old bottle photo | The product must have a **placeholder** bottle (`/images/perfumes/...`) in its `mainImage` for the library to substitute. An image set in **Edit Perfume** always wins. Use **Apply to products** to force-write library images onto products. |
| Images don't rotate between products | Pick is deterministic per product code — each product keeps the same image. Re-run **Apply** after changing the bucket's set to re-assign. |
| *"This Gender/Category bucket has no images yet"* | Add at least one image to the bucket before clicking **Apply to products**. |
| New products fall back to `normal.jpg` | The bucket for their Gender × Category is empty — add images to it, then create the product again. |
| After deleting a library image, products still show it | Delete only affects the library. Run **Apply to products** on that bucket to re-resolve/clear product images (or edit each product in **Edit Perfume**). |
| Library images lost on Railway | Same root cause as the DB: the deployment needs a persistent volume at `/data` with `LUMIERE_DATA_DIR=/data` (see README → Deploying → Railway). |

---

## Implementation map

| Concern | Location |
| --- | --- |
| Schema (`catalog_images` + bucket index) | `server.ts` — `CREATE TABLE IF NOT EXISTS catalog_images` |
| Bucket enums & placeholders | `server.ts` — `CATALOG_IMAGE_GENDERS`, `CATALOG_IMAGE_CATEGORIES`, `PLACEHOLDER_IMAGE_PREFIX`, `FALLBACK_BOTTLE_IMAGE` |
| Deterministic pick helper | `server.ts` — `hashSeed()`, `pickCatalogImage()` |
| REST endpoints | `server.ts` — `GET /api/catalog-images`, `POST /api/admin/catalog-images`, `POST /api/admin/catalog-images/apply`, `DELETE /api/admin/catalog-images/:id` |
| New-product image resolution (form + Excel import) | `server.ts` — `POST /api/admin/perfumes` and import upsert (`resolvedImage`) |
| Catalog resolver (display fallback chain) | `src/lib/api.ts` — `resolveCatalogImage()`, `isPlaceholderCatalogImage()`, `useCatalogImages()` |
| Catalog pages that use it | `src/pages/CatalogPage.tsx`, `src/components/perfume/PerfumeCard.tsx`, `PerfumeSlide.tsx`, `PerfumeDetailsModal.tsx` |
| Admin UI | `src/pages/AdminPage.tsx` — **Catalog Images** card (tabs, Add Images, Apply, thumbnail grid) |