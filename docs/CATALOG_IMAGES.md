# Catalog Images — Full Guide

The admin panel's **Catalog Images** section manages category sizes and photos
as well as the shared photo library organized by **Gender × Category** bucket.
Each category has two size/price options with optional size-specific images;
the catalog lets customers choose between those options. The seeded categories
are Regular, Brand, Luxury, Oil, Musk, 3ml Oil, and Cream/Jelly, and admins
can create additional categories.

Everything below is implemented in `server.ts` (SQLite table, endpoints,
automatic image resolution for new products) and `src/` (catalog resolver +
admin UI).

---

## Where to find it

Log in at `/admin`. The **Catalog Images** card sits between **Excel Import &
Export** and the perfume list. It has:

| Control | What it does |
| --- | --- |
| **Category sizes, prices & images** | Create categories and configure their two sizes, ml/gram unit, prices, and optional images. Regular, Brand, and Luxury start at 50 ml and 100 ml. |
| **Gender tabs** | `Male` / `Female` / `Kids` / `Unisex` — picks the gender bucket you are editing. |
| **Size image** | Choose either configured size below Gender and upload an image for the selected Gender × Category × Size. |
| **Add Images** | Multi-select upload of as many pictures as you like into the current bucket (JPG / PNG / WebP). Shows `Uploading 1 of N…` progress, then a green confirmation. |
| **Apply to products** | Force-writes the current bucket's images into **every** matching product (main + mini image), deterministic per product code. |
| **Thumbnail grid** | Every image in the current bucket, with a hover trash button to remove it from the library. |

Every available category has a separate bucket for each of the 4 genders.
Upload, edit, and delete in one bucket without affecting the others.
Size-specific images are saved separately for each Gender × Category × Size
and take precedence over the shared category size image on catalog cards.
Customers can switch sizes directly on a card to update its image and price;
the same controls work for ml and gram categories.

### Add a category with two size options
1. Select **New Category**, enter its name, and choose `ml` or `gram`.
2. Enter two distinct sizes and their ETB prices.
3. Optionally upload or paste one image for each size, then save.
4. The new category appears in the catalog filter and admin product editor.
   Customers can select a size in product details to see its price and image.

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

### Set up the whole library
Repeat the two steps above for every Gender × Category combination that has
products. The shared image library only replaces placeholder product images;
an explicitly configured size-specific category image is used for that size.

### Roll out new seasonal photography
Delete the old photos from a bucket, upload the new ones, and click
**Apply to products**. Because pick is deterministic, re-running apply after
adding images rotates products across the new set; deleting the bucket's images
and applying again resets matching products to their stored/placeholder image.

---

## How the catalog uses category images and the library

When a customer opens the catalog `/`, the images are resolved like this for
each product:

1. **Gender + size image.** If configured, the selected size's image for the
   product's gender and category is used. Otherwise the category's shared
   size-specific image is used.
2. **Product's own image wins over the shared library.** If `mainImage` is anything *other* than a
   built-in placeholder bottle, it is used as-is (uploaded pictures, pasted
   URLs, `Apply to products` results).
3. **Exact bucket.** Otherwise the library is searched for the product's exact
   Gender × Category bucket
   (e.g. `Female` × `Brand Perfume`) and one image is picked deterministically.
4. **Same category, then same gender, then anything.** If the exact bucket is
   empty, the resolver falls back to any library image of the same category,
   then the same gender, then the whole library.
5. **Stored fallback.** If the library is empty, the product's stored image is
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
| Male, Female, Kids, Unisex | Oil | `Oil` |
| Male, Female, Kids, Unisex | Musk | `Musk` |
| Male, Female, Kids, Unisex | 3ml Oil | `3ml Oil` |
| Male, Female, Kids, Unisex | Cream/Jelly | `Cream/Jelly` |

The initial sizes are 50/100 ml for Regular, Brand, and Luxury; 3/6 ml for Oil
and 3ml Oil; 6/12 gram for Musk; and 30/50 gram for Cream/Jelly. Admins can
edit both sizes and choose either `ml` or `gram` for every category.
For gram-based products, admins can set an individual product's ETB-per-gram
rate in the product editor; the customer card calculates the selected weight's
total from that rate. If no per-gram rate is set, the configured size price (or
product fallback price) is used.
Add/Edit Product also provides size buttons and separate main-image uploads for
each size. A product's own size image takes priority over the shared
Gender × Category × Size image, so customers see the right product photo when
they switch sizes.

Images are stored as **data URLs** (from file uploads) or **URLs/paths**
(pasted), one row per picture. Image data lives **inside the SQLite database**
(like perfume uploads), so the library survives redeploys and is **not** synced
by OneDrive.

Maximum upload per image: ~12 MB of base64. The image format is validated on
the server (`data:image/...` only for uploads).

---

## API reference

### Category settings

`GET /api/category-settings` is public and returns each category's two sizes,
unit, prices, and optional images. The admin-only
`POST /api/admin/category-settings` creates a category, while
`PUT /api/admin/category-settings/:category` updates an existing category.
Sizes must be positive and distinct; prices are non-negative whole ETB amounts.

Category and image write endpoints require admin authentication; both settings and catalog-image read endpoints are public.

`GET /api/catalog-size-images` returns size images keyed by gender, category,
and size option. Admins set or remove one with
`PUT /api/admin/catalog-size-images`, passing `gender`, `category`, `size`
(`1` or `2`), and `image` (or `null` to remove it).

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
| `Select an existing category` | The selected category has not been created in category settings |
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

Category options are stored separately in `category_settings` with two sizes,
prices, and optional images. Older databases receive the price columns during
server startup; existing category settings are preserved.

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
| Bucket categories & placeholders | `server.ts` — `category_settings`, `CATALOG_IMAGE_GENDERS`, `PLACEHOLDER_IMAGE_PREFIX`, `FALLBACK_BOTTLE_IMAGE` |
| Deterministic pick helper | `server.ts` — `hashSeed()`, `pickCatalogImage()` |
| REST endpoints | `server.ts` — `GET /api/catalog-images`, `POST /api/admin/catalog-images`, `POST /api/admin/catalog-images/apply`, `DELETE /api/admin/catalog-images/:id` |
| New-product image resolution (form + Excel import) | `server.ts` — `POST /api/admin/perfumes` and import upsert (`resolvedImage`) |
| Catalog resolver (display fallback chain) | `src/lib/api.ts` — `resolveCatalogImage()`, `isPlaceholderCatalogImage()`, `useCatalogImages()` |
| Catalog pages that use it | `src/pages/CatalogPage.tsx`, `src/components/perfume/PerfumeCard.tsx`, `PerfumeSlide.tsx`, `PerfumeDetailsModal.tsx` |
| Category settings & Admin UI | `server.ts` — category settings endpoints; `src/pages/AdminPage.tsx` — **Catalog Images** category editor and photo library |