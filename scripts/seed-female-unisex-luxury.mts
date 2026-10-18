// Seeds the Female + Unisex perfumes from the app catalog (src/lib/data.ts) into the
// PostgreSQL database and replaces legacy SVG placeholder bottles with the uploaded
// Lumier bottle photos:
//   Female  -> pink.jpg / purple.jpg
//   Unisex  -> normal.jpg (clear) / tan.jpg (gold) / green.jpg
//   Luxury  -> luxury-red.jpg / luxury-black.jpg
// Run with: npm run seed
import 'dotenv/config';
import { Pool } from 'pg';
import { MOCK_PERFUMES, PERFUME_IMAGES } from '../src/lib/data';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('Set DATABASE_URL before seeding the catalog.');
const db = new Pool({ connectionString: databaseUrl });

// Same hash as src/lib/data.ts so DB images match what the UI fallback would show
function bottleIndexFromCode(code: string, count: number): number {
  return code.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % count;
}

function pickImage(gender: string, category: string, code: string): string {
  if (category === 'Luxury Perfume') {
    return bottleIndexFromCode(code, 2) === 0 ? PERFUME_IMAGES.luxuryRed : PERFUME_IMAGES.luxuryBlack;
  }
  if (gender === 'Female') {
    const arr = [PERFUME_IMAGES.pink, PERFUME_IMAGES.purple];
    return arr[bottleIndexFromCode(code, arr.length)];
  }
  if (gender === 'Unisex') {
    const arr = [PERFUME_IMAGES.normal, PERFUME_IMAGES.tan, PERFUME_IMAGES.green];
    return arr[bottleIndexFromCode(code, arr.length)];
  }
  const arr = [PERFUME_IMAGES.purple, PERFUME_IMAGES.green, PERFUME_IMAGES.normal, PERFUME_IMAGES.blue, PERFUME_IMAGES.tan];
  return arr[bottleIndexFromCode(code, arr.length)];
}

const summary: string[] = [];

// --- 1) Seed Female + Unisex perfumes from the catalog data ---
const UPSERT = `INSERT INTO perfumes (
  id, code, name, brand, price, gender, category, stockStatus, description, rating,
  mainImage, miniImage, galleryImages, accords, fragranceProfile, dayNight, seasons, notes
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
  $11, $12, $13, $14, $15, $16, $17, $18
)
ON CONFLICT (id) DO UPDATE SET
  code=EXCLUDED.code, name=EXCLUDED.name, brand=EXCLUDED.brand, price=EXCLUDED.price,
  gender=EXCLUDED.gender, category=EXCLUDED.category, stockstatus=EXCLUDED.stockstatus,
  description=EXCLUDED.description, rating=EXCLUDED.rating, mainimage=EXCLUDED.mainimage,
  miniimage=EXCLUDED.miniimage, galleryimages=EXCLUDED.galleryimages, accords=EXCLUDED.accords,
  fragranceprofile=EXCLUDED.fragranceprofile, daynight=EXCLUDED.daynight, seasons=EXCLUDED.seasons, notes=EXCLUDED.notes`;

let inserted = 0;
let updated = 0;
for (const p of MOCK_PERFUMES) {
  if (p.gender !== 'Female' && p.gender !== 'Unisex') continue;
  const vals = {
    id: p.id,
    code: p.code,
    name: p.name,
    brand: p.brand,
    price: p.price,
    gender: p.gender,
    category: p.category,
    stockStatus: p.stockStatus,
    description: p.description,
    rating: p.rating,
    mainImage: p.mainImage,
    miniImage: p.miniImage || p.mainImage,
    galleryImages: JSON.stringify(p.galleryImages && p.galleryImages.length ? p.galleryImages : [p.mainImage]),
    accords: JSON.stringify(p.accords || []),
    fragranceProfile: JSON.stringify(p.fragranceProfile || {}),
    dayNight: p.dayNight,
    seasons: JSON.stringify(p.seasons || []),
    notes: JSON.stringify(p.notes || {}),
  };
  const values = [
    vals.id, vals.code, vals.name, vals.brand, vals.price, vals.gender, vals.category,
    vals.stockStatus, vals.description, vals.rating, vals.mainImage, vals.miniImage,
    vals.galleryImages, vals.accords, vals.fragranceProfile, vals.dayNight, vals.seasons, vals.notes,
  ];
  const exists = (await db.query('SELECT id FROM perfumes WHERE id = $1', [p.id])).rowCount;
  await db.query(UPSERT, values);
  if (exists) updated++;
  else inserted++;
  summary.push(`${p.code} | ${p.name} | ${p.gender} | ${p.category} | ${p.mainImage} | ${exists ? 'updated' : 'inserted'}`);
}

// --- 2) Replace legacy lumier-*.svg placeholders on existing records ---
const legacy = (await db.query(
  "SELECT id, code, gender, category, mainimage, miniimage, galleryimages FROM perfumes WHERE mainimage LIKE '/images/perfumes/lumier-%.svg'"
)).rows as any[];
for (const row of legacy) {
  const nextImage = pickImage(row.gender || 'Male', row.category || 'Brand Perfume', row.code || row.id);
  const nextMini = (!row.miniimage || row.miniimage === row.mainimage) ? nextImage : row.miniimage;
  let nextGallery = row.galleryimages;
  try {
    const gal = JSON.parse(row.galleryimages || '[]');
    if (Array.isArray(gal)) {
      const replaced = gal.map((g: string) => (g === row.mainimage ? nextImage : g));
      nextGallery = JSON.stringify(replaced.length ? replaced : [nextImage]);
    }
  } catch { nextGallery = JSON.stringify([nextImage]); }
  await db.query('UPDATE perfumes SET mainimage = $1, miniimage = $2, galleryimages = $3 WHERE id = $4',
    [nextImage, nextMini, nextGallery, row.id]);
  summary.push(`${row.code || row.id} | legacy svg -> ${nextImage}`);
}

console.log(summary.join('\n'));
console.log(`Female/Unisex records inserted: ${inserted}, updated: ${updated}`);
console.log(`Legacy SVG placeholders replaced: ${legacy.length}`);
const total = (await db.query('SELECT COUNT(*) AS c FROM perfumes')).rows[0] as { c: string };
console.log('TOTAL in DB: ' + total.c);
await db.end();
