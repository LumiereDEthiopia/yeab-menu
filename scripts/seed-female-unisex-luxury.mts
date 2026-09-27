// Seeds the Female + Unisex perfumes from the app catalog (src/lib/data.ts) into the
// local SQLite database and replaces legacy SVG placeholder bottles with the uploaded
// Lumier bottle photos:
//   Female  -> pink.jpg / purple.jpg
//   Unisex  -> normal.jpg (clear) / tan.jpg (gold) / green.jpg
//   Luxury  -> luxury-red.jpg / luxury-black.jpg
// Run with: npm run seed
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { MOCK_PERFUMES, PERFUME_IMAGES } from '../src/lib/data';

const dataDir = process.env.LUMIERE_DATA_DIR
  || (process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'LumiereMenu')
    : join(homedir(), '.lumiere-menu'));
const dbPath = join(dataDir, 'perfumes.db');
if (!existsSync(dbPath)) { console.error('DB NOT FOUND: ' + dbPath); process.exit(1); }
const db = new DatabaseSync(dbPath);

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
const UPSERT_UPDATE = `UPDATE perfumes SET
  code=@code, name=@name, brand=@brand, price=@price, gender=@gender, category=@category,
  stockStatus=@stockStatus, description=@description, rating=@rating, mainImage=@mainImage,
  miniImage=@miniImage, galleryImages=@galleryImages, accords=@accords,
  fragranceProfile=@fragranceProfile, dayNight=@dayNight, seasons=@seasons, notes=@notes
  WHERE id=@id`;
const UPSERT_INSERT = `INSERT INTO perfumes (
  id, code, name, brand, price, gender, category, stockStatus, description, rating,
  mainImage, miniImage, galleryImages, accords, fragranceProfile, dayNight, seasons, notes
) VALUES (
  @id, @code, @name, @brand, @price, @gender, @category, @stockStatus, @description, @rating,
  @mainImage, @miniImage, @galleryImages, @accords, @fragranceProfile, @dayNight, @seasons, @notes
)`;

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
  const exists = db.prepare('SELECT id FROM perfumes WHERE id = ?').get(p.id);
  if (exists) { db.prepare(UPSERT_UPDATE).run(vals); updated++; }
  else { db.prepare(UPSERT_INSERT).run(vals); inserted++; }
  summary.push(`${p.code} | ${p.name} | ${p.gender} | ${p.category} | ${p.mainImage} | ${exists ? 'updated' : 'inserted'}`);
}

// --- 2) Replace legacy lumier-*.svg placeholders on existing records ---
const legacy = db.prepare(
  "SELECT id, code, gender, category, mainImage, miniImage, galleryImages FROM perfumes WHERE mainImage LIKE '/images/perfumes/lumier-%.svg'"
).all() as any[];
for (const row of legacy) {
  const nextImage = pickImage(row.gender || 'Male', row.category || 'Brand Perfume', row.code || row.id);
  const nextMini = (!row.miniImage || row.miniImage === row.mainImage) ? nextImage : row.miniImage;
  let nextGallery = row.galleryImages;
  try {
    const gal = JSON.parse(row.galleryImages || '[]');
    if (Array.isArray(gal)) {
      const replaced = gal.map((g: string) => (g === row.mainImage ? nextImage : g));
      nextGallery = JSON.stringify(replaced.length ? replaced : [nextImage]);
    }
  } catch { nextGallery = JSON.stringify([nextImage]); }
  db.prepare('UPDATE perfumes SET mainImage = ?, miniImage = ?, galleryImages = ? WHERE id = ?')
    .run(nextImage, nextMini, nextGallery, row.id);
  summary.push(`${row.code || row.id} | legacy svg -> ${nextImage}`);
}

console.log(summary.join('\n'));
console.log(`Female/Unisex records inserted: ${inserted}, updated: ${updated}`);
console.log(`Legacy SVG placeholders replaced: ${legacy.length}`);
const total = db.prepare('SELECT COUNT(*) c FROM perfumes').get() as { c: number };
console.log('TOTAL in DB: ' + total.c);
