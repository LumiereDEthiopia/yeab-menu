import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import jwt from 'jsonwebtoken';
import os from 'os';
import ExcelJS from 'exceljs';
import type { Workbook } from 'exceljs';
import { createHash, timingSafeEqual } from 'node:crypto';

// --- Environment configuration -------------------------------------------------
// Secrets have no defaults in production: the server refuses to start unless
// JWT_SECRET, ADMIN_USERNAME and ADMIN_PASSWORD are set in the environment
// (Railway → Variables). Local development keeps the old fallbacks with a
// console warning so `npm run dev` works exactly as before.
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

function readRequiredEnv(name: string, devFallback: string): string {
  const value = process.env[name];
  if (typeof value === 'string' && value.length > 0) return value;
  if (!IS_PRODUCTION) {
    console.warn(
      `[config] ${name} is not set — using a development-only fallback. This is NOT safe outside local development.`
    );
    return devFallback;
  }
  console.error(
    `[config] FATAL: ${name} is not set. In production the server refuses to start without it — set it in your deployment environment (Railway → Variables).`
  );
  process.exit(1);
}

const JWT_SECRET = readRequiredEnv('JWT_SECRET', 'fallback-secret-for-dev');
const ADMIN_USERNAME = readRequiredEnv('ADMIN_USERNAME', 'admin');
const ADMIN_PASSWORD = readRequiredEnv('ADMIN_PASSWORD', 'admin');

// Secrets that appear in public documentation or tools. Using one in
// production is equivalent to having no secret at all, since anyone can
// forge admin tokens with it.
const KNOWN_PUBLIC_SECRETS = new Set([
  'a-string-secret-at-least-256-bits-long', // jwt.io debugger default
  'your-256-bit-secret', // jwt.io legacy placeholder
  'change-me-to-a-long-random-string', // this repo's .env.example placeholder
  'fallback-secret-for-dev', // this repo's dev fallback
  'secret',
  'changeme',
  'change-me',
]);

// Trailing punctuation variants of a known secret (e.g. with a stray '?')
// are just as guessable — normalize before comparing.
const normalizedSecret = JWT_SECRET.trim().replace(/[.!?,;:'"()[\]]+$/, '').toLowerCase();

if (IS_PRODUCTION && (KNOWN_PUBLIC_SECRETS.has(JWT_SECRET) || KNOWN_PUBLIC_SECRETS.has(normalizedSecret))) {
  console.error(
    "[config] FATAL: JWT_SECRET is a publicly known example value — anyone could forge admin tokens with it. Generate a unique one instead, e.g.: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\""
  );
  process.exit(1);
}
if (IS_PRODUCTION && ADMIN_USERNAME === 'admin' && ADMIN_PASSWORD === 'admin') {
  console.error('[config] FATAL: refusing to start in production with the default admin/admin credentials. Set ADMIN_USERNAME and ADMIN_PASSWORD.');
  process.exit(1);
}
if (IS_PRODUCTION && ADMIN_PASSWORD.length < 8) {
  console.warn('[config] WARNING: ADMIN_PASSWORD is shorter than 8 characters — use a long, unique value in production.');
}

/** Length-safe, timing-safe string comparison (both sides are hashed first, so lengths always match). */
function timingSafeEqualStr(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(a, 'utf8').digest(),
    createHash('sha256').update(b, 'utf8').digest()
  );
}

const normalizeStockStatus = (status?: string) => status === 'Low Stock' || status === 'Out Stock' ? status : 'In Stock';

// --- Data directory (SQLite DB + backups) --------------------------------------
// All data (perfumes and their uploaded images, which live inside the DB) is
// stored outside the project folder so OneDrive doesn't sync it: on Windows
// that's %LOCALAPPDATA%\LumiereMenu, everywhere else ~/.lumiere-menu.
// Override with LUMIERE_DATA_DIR — in production this MUST point at persistent
// storage (Railway: mount a Volume at /data and set LUMIERE_DATA_DIR=/data).
function resolveDataDir(): string {
  if (process.env.LUMIERE_DATA_DIR && process.env.LUMIERE_DATA_DIR.trim().length > 0) {
    return process.env.LUMIERE_DATA_DIR.trim();
  }
  if (IS_PRODUCTION) {
    // Fail fast instead of silently writing to the container's ephemeral
    // filesystem, where every redeploy would wipe the database.
    console.error(
      '[config] FATAL: LUMIERE_DATA_DIR is not set. In production it MUST point at persistent storage ' +
      '(Railway: Service → Volumes → + New Volume, mount it at /data, then set LUMIERE_DATA_DIR=/data). ' +
      "Without a mounted volume the SQLite database lives on the container's ephemeral filesystem and is deleted on every redeploy."
    );
    process.exit(1);
  }
  return process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'LumiereMenu')
    : path.join(os.homedir(), '.lumiere-menu');
}

const DATA_DIR = resolveDataDir();
const DB_PATH = path.join(DATA_DIR, 'perfumes.db');
// Optional off-volume backup location (e.g. a second mounted volume or network
// share). Defaults to <DATA_DIR>/backups when unset. Keeping backups off the
// primary volume protects the data even if the main volume is lost.
const BACKUP_DIR = (process.env.LUMIERE_BACKUP_DIR && process.env.LUMIERE_BACKUP_DIR.trim().length > 0)
  ? process.env.LUMIERE_BACKUP_DIR.trim()
  : path.join(DATA_DIR, 'backups');
const LEGACY_DB = path.join(process.cwd(), 'perfumes.db'); // old location inside the OneDrive project folder

fs.mkdirSync(DATA_DIR, { recursive: true });
try {
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch {
  console.error(`[config] FATAL: data directory is not writable: ${DATA_DIR}`);
  process.exit(1);
}

/**
 * Consistent snapshot of the database file. A plain file copy is safe because
 * the server runs with SQLite's default rollback journal and FULL sync, so the
 * .db file on disk is always current (there is no WAL sidecar to checkpoint).
 */
function backupDatabaseFile(label: string): string | null {
  if (!fs.existsSync(DB_PATH)) return null;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(BACKUP_DIR, `${label}-${stamp}.db`);
    fs.copyFileSync(DB_PATH, target);
    console.log(`[data] Backup saved: ${target}`);
    return target;
  } catch (e) {
    console.error('[data] Backup failed:', e);
    return null;
  }
}

const countPerfumesIn = (file: string): number => {
  try {
    const handle = new DatabaseSync(file);
    const row = handle.prepare('SELECT count(*) AS c FROM perfumes').get() as { c: number } | undefined;
    handle.close();
    return row?.c ?? 0;
  } catch {
    return 0;
  }
};

try {
  const legacyCount = fs.existsSync(LEGACY_DB) ? countPerfumesIn(LEGACY_DB) : 0;
  const localCount = fs.existsSync(DB_PATH) ? countPerfumesIn(DB_PATH) : 0;
  if (legacyCount > 0 && localCount <= 0) {
    fs.copyFileSync(LEGACY_DB, DB_PATH);
    console.log(`Adopted existing database (${legacyCount} perfumes) from project folder into local storage.`);
  } else if (legacyCount > 0 && localCount > 0) {
    console.log(`Note: old OneDrive database has ${legacyCount} perfumes; using local database (${localCount} perfumes) at ${DB_PATH}.`);
  }
} catch (e) {
  console.error('Legacy database check failed:', e);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 8080;

  // Railway terminates TLS and proxies requests — trust the first proxy hop so
  // req.ip is the real client IP (used by the login rate limiter below).
  app.set('trust proxy', 1);

  // Minimal security headers. Safe for the SPA and does not alter API behavior.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(express.json({ limit: '50mb' }));

  // --- Login rate limiting (in-memory, per IP — no extra dependencies) ---
  const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  const LOGIN_MAX_ATTEMPTS = 10;
  const loginFailures = new Map<string, { count: number; windowStart: number }>();

  const pruneLoginFailures = (now: number) => {
    for (const [ip, entry] of loginFailures) {
      if (now - entry.windowStart > LOGIN_WINDOW_MS) loginFailures.delete(ip);
    }
  };
  const isLoginBlocked = (ip: string): boolean => {
    const now = Date.now();
    const entry = loginFailures.get(ip);
    if (!entry) return false;
    if (now - entry.windowStart > LOGIN_WINDOW_MS) {
      loginFailures.delete(ip);
      return false;
    }
    return entry.count >= LOGIN_MAX_ATTEMPTS;
  };
  const recordLoginFailure = (ip: string) => {
    const now = Date.now();
    const entry = loginFailures.get(ip);
    if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
      loginFailures.set(ip, { count: 1, windowStart: now });
    } else {
      entry.count += 1;
    }
    if (loginFailures.size > 1000) pruneLoginFailures(now);
  };
  const clearLoginFailures = (ip: string) => loginFailures.delete(ip);

  // Initialize SQLite database (LOCAL storage, outside OneDrive sync)
  const db = new DatabaseSync(DB_PATH);
  console.log(`Local data folder (not OneDrive-synced): ${DATA_DIR}`);
  console.log(`[data] Database file: ${DB_PATH}`);
  if (IS_PRODUCTION) {
    console.log('[data] WARNING: this path must be a MOUNTED VOLUME (Railway: Service → Volumes → /data). It is the only thing that survives redeploys — confirm it is NOT the container\'s ephemeral filesystem.');
  }

  // Wait up to 5s for a separate process's lock (e.g. a backup) instead of
  // failing immediately with "database is locked".
  db.exec('PRAGMA busy_timeout = 5000;');

  // Pre-boot safety snapshot: if a database already exists, snapshot it BEFORE
  // today's automatic schema migrations run, so every upgrade has a rollback point.
  backupDatabaseFile('perfumes-pre-boot');

  // Create tables if they don't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS perfumes (
      id TEXT PRIMARY KEY,
      name TEXT,
      code TEXT,
      brand TEXT,
      price INTEGER,
      gender TEXT,
      category TEXT,
      stockStatus TEXT DEFAULT 'In Stock',
      description TEXT,
      rating REAL,
      mainImage TEXT,
      miniImage TEXT,
      galleryImages TEXT,
      accords TEXT,
      fragranceProfile TEXT,
      dayNight TEXT,
      seasons TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS accord_colors (
      name TEXT PRIMARY KEY,
      color TEXT
    );

    CREATE TABLE IF NOT EXISTS catalog_images (
      id TEXT PRIMARY KEY,
      gender TEXT NOT NULL,
      category TEXT NOT NULL,
      image TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_catalog_images_bucket ON catalog_images (gender, category);
  `);

  const perfumeColumns = db.prepare('PRAGMA table_info(perfumes)').all() as { name: string }[];
  if (!perfumeColumns.some(column => column.name === 'stockStatus')) {
    db.exec("ALTER TABLE perfumes ADD COLUMN stockStatus TEXT DEFAULT 'In Stock'");
  }
  if (!perfumeColumns.some(column => column.name === 'miniImage')) {
    db.exec('ALTER TABLE perfumes ADD COLUMN miniImage TEXT');
  }

  // Backfill: ensure every perfume has a stored mini image (defaults to its main image)
  db.prepare("UPDATE perfumes SET miniImage = mainImage WHERE miniImage IS NULL OR miniImage = ''").run();

  // --- Catalog image library -----------------------------------------------------
  // Admins can upload any number of images per Gender × Category bucket
  // (Male/Female/Kids/Unisex × Perfume/Brand Perfume/Luxury Perfume). The
  // catalog uses these images in two ways:
  //   1. products created without their own photo (admin form or Excel import)
  //      pick one from the matching bucket, and
  //   2. the catalog UI substitutes a bucket image for products that still show
  //      one of the built-in placeholder bottle photos under public/images/perfumes.
  // A custom uploaded/pasted image on a product always wins over the library.

  const CATALOG_IMAGE_GENDERS = ['Male', 'Female', 'Kids', 'Unisex'];
  const CATALOG_IMAGE_CATEGORIES = ['Perfume', 'Brand Perfume', 'Luxury Perfume'];
  const PLACEHOLDER_IMAGE_PREFIX = '/images/perfumes/';
  const FALLBACK_BOTTLE_IMAGE = '/images/perfumes/normal.jpg';

  /** True when an image is empty or one of the built-in placeholder bottle photos. */
  const isPlaceholderImage = (image: unknown): boolean =>
    typeof image !== 'string' || image.trim().length === 0 || image.trim().startsWith(PLACEHOLDER_IMAGE_PREFIX);

  /** Stable hash of a seed string — the same product code always picks the same image. */
  const hashSeed = (seed: unknown): number =>
    Math.abs(String(seed ?? '').split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0));

  /** Pick an image from the Gender × Category bucket (deterministic per seed code). */
  const pickCatalogImage = (gender: unknown, category: unknown, seed: unknown): string | null => {
    try {
      const rows = db.prepare('SELECT image FROM catalog_images WHERE gender = ? AND category = ? ORDER BY created_at, rowid')
        .all(String(gender ?? ''), String(category ?? '')) as { image: string }[];
      const pool = rows.map(row => row.image).filter(img => typeof img === 'string' && img.length > 0);
      if (pool.length === 0) return null;
      return pool[hashSeed(seed) % pool.length];
    } catch {
      return null;
    }
  };

  // Automatic daily database backup (keeps the last 7). Honors LUMIERE_BACKUP_DIR
  // so the rotation can live on a second, off-volume location.
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const dailyFile = path.join(BACKUP_DIR, `perfumes-${stamp}.db`);
    fs.copyFileSync(DB_PATH, dailyFile);
    const stale = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('perfumes-') && f.endsWith('.db'))
      .sort()
      .slice(0, -7);
    stale.forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
    console.log(`[data] Daily backup saved: ${dailyFile}`);
  } catch (e) {
    console.error('DB backup failed:', e);
  }

  // JWT-based authentication middleware for admin routes
  const authenticateAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      (req as any).user = decoded;
      next();
    } catch (err) {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  };

  // --- API Routes ---

  // Health check for Railway / uptime monitors.
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      environment: NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/accord-colors', (req, res) => {
    try {
      const stmt = db.prepare('SELECT * FROM accord_colors');
      const rows = stmt.all() as { name: string, color: string }[];
      const colors: Record<string, string> = {};
      rows.forEach(row => {
        colors[row.name] = row.color;
      });
      res.json(colors);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/admin/accord-colors', authenticateAdmin, (req, res) => {
    try {
      const { name, color } = req.body;
      const stmt = db.prepare('INSERT OR REPLACE INTO accord_colors (name, color) VALUES (?, ?)');
      stmt.run(name, color);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to save accord color' });
    }
  });

  app.delete('/api/admin/accord-colors/:name', authenticateAdmin, (req, res) => {
    try {
      const stmt = db.prepare('DELETE FROM accord_colors WHERE name = ?');
      stmt.run(req.params.name);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to delete accord color' });
    }
  });

  // --- Catalog image library: REST endpoints -------------------------------------
  // Public read (the catalog page needs the buckets without logging in); all
  // writes are admin-only. Images are stored as data URLs (same as perfume
  // uploads) or plain paths/URLs, one row per picture.

  app.get('/api/catalog-images', (_req, res) => {
    try {
      const rows = db.prepare('SELECT id, gender, category, image FROM catalog_images ORDER BY gender, category, created_at, rowid').all();
      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load catalog images' });
    }
  });

  app.post('/api/admin/catalog-images', authenticateAdmin, (req, res) => {
    try {
      const { gender, category, image } = req.body ?? {};
      if (!CATALOG_IMAGE_GENDERS.includes(gender)) {
        return res.status(400).json({ error: `Gender must be one of: ${CATALOG_IMAGE_GENDERS.join(', ')}` });
      }
      if (!CATALOG_IMAGE_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: `Category must be one of: ${CATALOG_IMAGE_CATEGORIES.join(', ')}` });
      }
      if (typeof image !== 'string' || image.length === 0 || image.length > 12_000_000) {
        return res.status(400).json({ error: 'The image is missing or too large — pick a smaller picture.' });
      }
      const isAllowedImage = image.startsWith('data:image/')
        || image.startsWith('/')
        || image.startsWith('http://')
        || image.startsWith('https://');
      if (!isAllowedImage) {
        return res.status(400).json({ error: 'Unsupported image format — choose a JPG, PNG or WebP picture.' });
      }
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      db.prepare('INSERT INTO catalog_images (id, gender, category, image) VALUES (?, ?, ?, ?)').run(id, gender, category, image);
      res.json({ success: true, id, gender, category, image });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to save catalog image' });
    }
  });

  // Write the bucket's images into EVERY matching product (main + mini image),
  // picking deterministically per product code so the same product always gets
  // the same picture. This is the explicit "force these photos" action — the
  // passive catalog substitution only replaces placeholder bottles.
  app.post('/api/admin/catalog-images/apply', authenticateAdmin, (req, res) => {
    try {
      const { gender, category } = req.body ?? {};
      if (!CATALOG_IMAGE_GENDERS.includes(gender) || !CATALOG_IMAGE_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: 'Gender and category are required' });
      }
      const pool = (db.prepare('SELECT image FROM catalog_images WHERE gender = ? AND category = ? ORDER BY created_at, rowid')
        .all(gender, category) as { image: string }[]).map(row => row.image).filter(img => img.length > 0);
      if (pool.length === 0) {
        return res.status(400).json({ error: 'This Gender/Category bucket has no images yet — add some first.' });
      }
      const products = db.prepare('SELECT id, code FROM perfumes WHERE gender = ? AND category = ?')
        .all(gender, category) as { id: string; code: string | null }[];
      const update = db.prepare('UPDATE perfumes SET mainImage = ?, miniImage = ? WHERE id = ?');
      db.exec('BEGIN');
      try {
        products.forEach(product => {
          const image = pool[hashSeed(product.code || product.id) % pool.length];
          update.run(image, image, product.id);
        });
        db.exec('COMMIT');
      } catch (txError) {
        db.exec('ROLLBACK');
        throw txError;
      }
      res.json({ success: true, updated: products.length });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to apply catalog images' });
    }
  });

  app.delete('/api/admin/catalog-images/:id', authenticateAdmin, (req, res) => {
    try {
      db.prepare('DELETE FROM catalog_images WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to delete catalog image' });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    const clientIp = req.ip || 'unknown';
    if (isLoginBlocked(clientIp)) {
      return res.status(429).json({ error: 'Too many failed login attempts. Please try again in a few minutes.' });
    }
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    // One shared admin account, compared in constant time. Credentials come
    // from the environment — in production the server refuses to start unless
    // ADMIN_USERNAME / ADMIN_PASSWORD / JWT_SECRET are all set explicitly.
    if (timingSafeEqualStr(username, ADMIN_USERNAME) && timingSafeEqualStr(password, ADMIN_PASSWORD)) {
      clearLoginFailures(clientIp);
      const token = jwt.sign({ username: ADMIN_USERNAME, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
      res.json({ token });
    } else {
      recordLoginFailure(clientIp);
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });

  app.get('/api/perfumes', (req, res) => {
    try {
      const stmt = db.prepare('SELECT * FROM perfumes ORDER BY created_at DESC');
      const rows = stmt.all() as any[];
      
      const parsedPerfumes = rows.map(row => ({
        ...row,
        stockStatus: normalizeStockStatus(row.stockStatus),
        galleryImages: JSON.parse(row.galleryImages || '[]'),
        accords: JSON.parse(row.accords || '[]'),
        fragranceProfile: JSON.parse(row.fragranceProfile || '{}'),
        seasons: JSON.parse(row.seasons || '[]'),
        notes: JSON.parse(row.notes || '{}')
      }));
      
      res.json(parsedPerfumes);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/admin/perfumes', authenticateAdmin, (req, res) => {
    try {
      const p = req.body;
      const id = Date.now().toString(); // rudimentary ID definition
      
      const stmt = db.prepare(`
        INSERT INTO perfumes (
          id, name, code, brand, price, gender, category, stockStatus, description, rating,
          mainImage, miniImage, galleryImages, accords, fragranceProfile, dayNight, seasons, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      // New products without their own photo (or still showing a placeholder
      // bottle) pick one from the catalog image library for their Gender ×
      // Category bucket — deterministic per product code.
      const mainImage = isPlaceholderImage(p.mainImage)
        ? (pickCatalogImage(p.gender, p.category, p.code || id) ?? p.mainImage ?? FALLBACK_BOTTLE_IMAGE)
        : p.mainImage;
      const miniImage = p.miniImage && !isPlaceholderImage(p.miniImage) ? p.miniImage : mainImage;

      stmt.run(
        id, p.name, p.code, p.brand, p.price, p.gender, p.category, normalizeStockStatus(p.stockStatus), p.description, p.rating,
        mainImage,
        miniImage,
        JSON.stringify(p.galleryImages || []),
        JSON.stringify(p.accords || []),
        JSON.stringify(p.fragranceProfile || {}),
        p.dayNight,
        JSON.stringify(p.seasons || []),
        JSON.stringify(p.notes || {})
      );
      
      res.json({ success: true, id });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to create perfume' });
    }
  });

  app.put('/api/admin/perfumes/:id', authenticateAdmin, (req, res) => {
    try {
      const p = req.body;
      const id = req.params.id;

      // If the perfume isn't in the database (e.g. the admin edited a built-in
      // demo perfume while the DB is empty), store it as a new row instead of
      // silently updating nothing.
      const existing = db.prepare('SELECT id FROM perfumes WHERE id = ?').get(id);
      if (!existing) {
        const insertStmt = db.prepare(`
          INSERT INTO perfumes (
            id, name, code, brand, price, gender, category, stockStatus, description, rating,
            mainImage, miniImage, galleryImages, accords, fragranceProfile, dayNight, seasons, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        insertStmt.run(
          id, p.name, p.code, p.brand, p.price, p.gender, p.category, normalizeStockStatus(p.stockStatus), p.description, p.rating,
          p.mainImage,
          p.miniImage || p.mainImage || null,
          JSON.stringify(p.galleryImages || []),
          JSON.stringify(p.accords || []),
          JSON.stringify(p.fragranceProfile || {}),
          p.dayNight,
          JSON.stringify(p.seasons || []),
          JSON.stringify(p.notes || {})
        );
        return res.json({ success: true, id, created: true });
      }

      // Partial, non-destructive update: only the columns present in the
      // request body are written. Anything the client did not send keeps its
      // current value in the database, so a stale or partial payload can never
      // wipe fields (images, accords, notes, ...) it didn't include. The key
      // set is fixed here (never taken from user input), and all values are
      // passed as bound parameters — no SQL injection is possible.
      const columnMappers: Record<string, (body: any) => unknown> = {
        name: b => b.name,
        code: b => b.code,
        brand: b => b.brand,
        price: b => b.price,
        gender: b => b.gender,
        category: b => b.category,
        stockStatus: b => normalizeStockStatus(b.stockStatus),
        description: b => b.description,
        rating: b => b.rating,
        mainImage: b => b.mainImage,
        miniImage: b => b.miniImage || b.mainImage || null,
        galleryImages: b => JSON.stringify(b.galleryImages ?? []),
        accords: b => JSON.stringify(b.accords ?? []),
        fragranceProfile: b => JSON.stringify(b.fragranceProfile ?? {}),
        dayNight: b => b.dayNight,
        seasons: b => JSON.stringify(b.seasons ?? []),
        notes: b => JSON.stringify(b.notes ?? {}),
      };

      const setClauses: string[] = [];
      const updateValues: any[] = [];
      for (const [column, mapValue] of Object.entries(columnMappers)) {
        if (column in p) {
          setClauses.push(`${column} = ?`);
          updateValues.push(mapValue(p));
        }
      }

      const stmt = setClauses.length > 0
        ? db.prepare(`UPDATE perfumes SET ${setClauses.join(', ')} WHERE id = ?`)
        : null;
      
      if (stmt) {
        updateValues.push(id);
        stmt.run(...updateValues);
      }

      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to update perfume' });
    }
  });

  app.delete('/api/admin/perfumes/:id', authenticateAdmin, (req, res) => {
    try {
      const stmt = db.prepare('DELETE FROM perfumes WHERE id = ?');
      stmt.run(req.params.id);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to delete perfume' });
    }
  });

  // --- Excel import / export ----------------------------------------------------
  // The whole catalog can be managed from a spreadsheet: admins download an
  // .xlsx of every product (Export), edit it in Excel, and upload it back
  // (Import). Rows are matched by id first, then by code — a match updates the
  // product, an unknown row becomes a new product. Empty cells never overwrite
  // a stored value, so a partially filled sheet is always safe to import.
  //
  // The spreadsheet carries no images at all — every editable field of the
  // Edit Perfume form fits in plain cells, and notes are just names. Images
  // are handled separately: the admin panel's import has an optional
  // "one image for all" picker that applies a single picture (as both the main
  // and the mini image) to every product in the file, and new products without
  // any image get the default bottle photo.

  const EXCEL_SHEET_NAME = 'Perfumes';

  // Same fallbacks the admin form and seed data use.
  const DEFAULT_PERFUME_IMAGE = '/images/perfumes/normal.jpg';
  const DEFAULT_NOTE_ICON = 'https://images.unsplash.com/photo-1615634260167-c8cdede054de?w=100&h=100&fit=crop';

  const EXCEL_COLUMNS: { header: string; key: string; width: number }[] = [
    { header: 'id', key: 'id', width: 14 },
    { header: 'name', key: 'name', width: 30 },
    { header: 'code', key: 'code', width: 12 },
    { header: 'brand', key: 'brand', width: 22 },
    { header: 'price', key: 'price', width: 10 },
    { header: 'gender', key: 'gender', width: 12 },
    { header: 'category', key: 'category', width: 16 },
    { header: 'stockStatus', key: 'stockStatus', width: 12 },
    { header: 'description', key: 'description', width: 40 },
    { header: 'rating', key: 'rating', width: 8 },
    { header: 'accords', key: 'accords', width: 36 },
    { header: 'fragranceProfile', key: 'fragranceProfile', width: 44 },
    { header: 'dayNight', key: 'dayNight', width: 10 },
    { header: 'seasons', key: 'seasons', width: 24 },
    { header: 'notes.top', key: 'notes.top', width: 32 },
    { header: 'notes.middle', key: 'notes.middle', width: 32 },
    { header: 'notes.base', key: 'notes.base', width: 32 },
  ];

  const EXCEL_GENDERS = ['Male', 'Female', 'Kids', 'Unisex'];
  const EXCEL_CATEGORIES = ['Perfume', 'Brand Perfume', 'Luxury Perfume'];
  const EXCEL_DAY_NIGHT = ['Day', 'Night', 'Both'];
  const EXCEL_STOCK_STATUSES = ['In Stock', 'Low Stock', 'Out Stock'];
  const EXCEL_SEASONS = ['Winter', 'Spring', 'Summer', 'Autumn'];

  /** ExcelJS cell values can be primitives or objects (rich text, formula results, hyperlinks) — flatten everything to trimmed text. */
  const excelCellText = (value: unknown): string => {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const obj = value as { text?: unknown; result?: unknown; richText?: { text?: string }[]; error?: unknown };
    if (Array.isArray(obj.richText)) return obj.richText.map(part => part?.text ?? '').join('').trim();
    if (obj.error != null) return '';
    if (obj.result != null) return excelCellText(obj.result);
    if (obj.text != null) return excelCellText(obj.text);
    return '';
  };

  /** Case-insensitive match against a fixed set of allowed values, with a fallback. */
  const matchExcelEnum = (raw: string, options: string[], fallback: string): string => {
    const needle = raw.trim().toLowerCase();
    return options.find(option => option.toLowerCase() === needle) ?? fallback;
  };

  const splitExcelList = (raw: string): string[] =>
    raw.length === 0 ? [] : raw.split('|').map(part => part.trim()).filter(part => part.length > 0);

  const joinExcelList = (values: unknown): string =>
    Array.isArray(values) ? values.filter(v => typeof v === 'string' && v.length > 0).join(' | ') : '';

  const safeJsonParse = <T,>(raw: string | null | undefined, fallback: T): T => {
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      return (parsed ?? fallback) as T;
    } catch {
      return fallback;
    }
  };

  /** Flatten one stored perfume (JSON columns already parsed) into a flat spreadsheet row. */
  const perfumeToExcelRow = (p: Record<string, unknown>): Record<string, string | number> => {
    const profile = (p.fragranceProfile && typeof p.fragranceProfile === 'object' ? p.fragranceProfile : {}) as Record<string, unknown>;
    const notes = (p.notes && typeof p.notes === 'object' ? p.notes : {}) as Record<string, unknown>;
    const notesTierCell = (tier: string): string => {
      const tierNotes = Array.isArray(notes[tier]) ? (notes[tier] as Record<string, unknown>[]) : [];
      return tierNotes.map(note => (typeof note?.name === 'string' ? note.name.trim() : '')).filter(Boolean).join(' | ');
    };
    const accords = Array.isArray(p.accords) ? (p.accords as Record<string, unknown>[]) : [];
    return {
      id: (p.id as string) ?? '',
      name: (p.name as string) ?? '',
      code: (p.code as string) ?? '',
      brand: (p.brand as string) ?? '',
      price: typeof p.price === 'number' ? p.price : 0,
      gender: (p.gender as string) ?? '',
      category: (p.category as string) ?? '',
      stockStatus: normalizeStockStatus(p.stockStatus as string | undefined),
      description: (p.description as string) ?? '',
      rating: typeof p.rating === 'number' ? p.rating : '',
      accords: accords
        .filter(accord => accord && typeof accord.name === 'string')
        .map(accord => `${accord.name}:${typeof accord.value === 'number' ? accord.value : 75}`)
        .join(' | '),
      fragranceProfile: (['longevity', 'projection', 'sillage'] as const)
        .filter(key => profile[key] != null && String(profile[key]).length > 0)
        .map(key => `${key}=${profile[key]}`)
        .join(' | '),
      dayNight: (p.dayNight as string) ?? '',
      seasons: joinExcelList(p.seasons),
      'notes.top': notesTierCell('top'),
      'notes.middle': notesTierCell('middle'),
      'notes.base': notesTierCell('base'),
    };
  };

  /** Template workbook: header row + example row + a "How To Fill" guide sheet. */
  const buildImportTemplateWorkbook = (): Workbook => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Lumiere Admin';

    const sheet = workbook.addWorksheet(EXCEL_SHEET_NAME);
    sheet.columns = EXCEL_COLUMNS;
    sheet.addRow({
      id: '',
      name: 'Example Perfume',
      code: 'P1234',
      brand: 'Our Fragrance',
      price: 2500,
      gender: 'Unisex',
      category: 'Perfume',
      stockStatus: 'In Stock',
      description: 'A warm amber fragrance with a woody base.',
      rating: 4.5,
      accords: 'Amber:80 | Woody:65',
      fragranceProfile: 'longevity=8H | projection=Moderate | sillage=Moderate',
      dayNight: 'Both',
      seasons: 'Autumn | Winter',
      'notes.top': 'Bergamot | Pink Pepper',
      'notes.middle': 'Rose',
      'notes.base': 'Sandalwood | Vanilla',
    });
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const guide = workbook.addWorksheet('How To Fill');
    guide.columns = [
      { header: 'Column', key: 'column', width: 20 },
      { header: 'Required', key: 'required', width: 12 },
      { header: 'What goes in it', key: 'meaning', width: 110 },
    ];
    const guideRows: [string, string, string][] = [
      ['id', 'no', 'Leave empty for new products. Existing products are matched by id first, then by code — a match updates the product instead of creating a duplicate.'],
      ['name', 'YES', 'Product name. Required for new rows; rows that match an existing product by id or code may leave it empty to keep the current name.'],
      ['code', 'no', 'Unique product code (e.g. P1234). New rows without a code get one generated automatically.'],
      ['brand', 'no', 'Brand name. New regular perfumes default to "Our Fragrance".'],
      ['price', 'no', 'Whole number in ETB (e.g. 2500). Defaults to 0.'],
      ['gender', 'no', 'Male, Female, Kids or Unisex. Defaults to Unisex (spelling is case-insensitive).'],
      ['category', 'no', 'Perfume, Brand Perfume or Luxury Perfume. Defaults to Perfume.'],
      ['stockStatus', 'no', 'In Stock, Low Stock or Out Stock. Defaults to In Stock.'],
      ['description', 'no', 'Free text shown in the details modal.'],
      ['rating', 'no', 'Number between 0 and 5 (decimals allowed). Defaults to 5.'],
      ['accords', 'no', 'Pairs of "Name:strength" (0-100) separated by " | ". Example: Woody:80 | Amber:60. Empty keeps the current accords.'],
      ['fragranceProfile', 'no', '"key=value" pairs separated by " | " — keys: longevity, projection, sillage. Missing keys keep their current value.'],
      ['dayNight', 'no', 'Day, Night or Both. Defaults to Both.'],
      ['seasons', 'no', 'Any of Winter, Spring, Summer, Autumn separated by " | ".'],
      ['notes.top', 'no', 'Top note names separated by " | ". Existing notes keep their icon; new notes get the default icon. Filling replaces the whole tier; empty keeps it.'],
      ['notes.middle', 'no', 'Middle note names, same format as notes.top.'],
      ['notes.base', 'no', 'Base note names, same format as notes.top.'],
      ['(images)', '-', 'The spreadsheet carries no images. To give products an image, use the optional "one image for all" picker in the admin import panel — it sets the main and mini image of every product in the file. New products without an image use a Catalog Images library picture from their Gender × Category bucket (see the Catalog Images section in the admin panel) when one exists, otherwise the default bottle photo. Galleries are edited per product in the Edit Perfume window.'],
      ['(all columns)', '-', 'Golden rule: empty cells never overwrite existing values when updating — only filled cells are applied.'],
    ];
    guideRows.forEach(([column, required, meaning]) => guide.addRow({ column, required, meaning }));
    guide.getRow(1).font = { bold: true };
    guide.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };

    return workbook;
  };

  const sendExcelWorkbook = async (workbook: Workbook, res: express.Response, filename: string): Promise<void> => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  };

  // Export the whole catalog as an .xlsx workbook.
  app.get('/api/admin/perfumes/export', authenticateAdmin, async (_req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM perfumes ORDER BY created_at DESC').all() as Record<string, unknown>[];
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Lumiere Admin';
      const sheet = workbook.addWorksheet(EXCEL_SHEET_NAME);
      sheet.columns = EXCEL_COLUMNS;
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];

      rows.forEach(row => {
        sheet.addRow(perfumeToExcelRow({
          ...row,
          galleryImages: safeJsonParse<unknown[]>(row.galleryImages as string, []),
          accords: safeJsonParse<unknown[]>(row.accords as string, []),
          fragranceProfile: safeJsonParse<Record<string, unknown>>(row.fragranceProfile as string, {}),
          seasons: safeJsonParse<unknown[]>(row.seasons as string, []),
          notes: safeJsonParse<Record<string, unknown>>(row.notes as string, {}),
        }));
      });

      await sendExcelWorkbook(workbook, res, `lumiere-perfumes-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to export perfumes' });
    }
  });

  // Download an empty template with an example row and a guide sheet.
  app.get('/api/admin/perfumes/import/template', authenticateAdmin, async (_req, res) => {
    try {
      await sendExcelWorkbook(buildImportTemplateWorkbook(), res, 'lumiere-perfume-import-template.xlsx');
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to generate the template' });
    }
  });

  // Import products from an uploaded .xlsx workbook. The client sends the file
  // as base64 inside the JSON body (same approach as image uploads — no
  // multipart handling needed), plus an optional `sharedImage`: a single
  // picture applied as BOTH the main and the mini image of every product in
  // the file. Rows are upserted in a single transaction and a per-row report
  // is returned; invalid rows are skipped, not fatal.
  app.post('/api/admin/perfumes/import', authenticateAdmin, async (req, res) => {
    try {
      const dataBase64 = (req.body ?? {}).dataBase64;
      if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
        return res.status(400).json({ error: 'No spreadsheet received — choose an .xlsx file first.' });
      }
      const sharedImageRaw = (req.body ?? {}).sharedImage;
      const sharedImage = typeof sharedImageRaw === 'string' && sharedImageRaw.trim().length > 0 ? sharedImageRaw.trim() : null;

      const workbook = new ExcelJS.Workbook();
      try {
        await workbook.xlsx.load(Buffer.from(dataBase64, 'base64'));
      } catch {
        return res.status(400).json({ error: "Could not read the file — make sure it's an .xlsx workbook (old .xls files are not supported)." });
      }

      const sheet = workbook.getWorksheet(EXCEL_SHEET_NAME) ?? workbook.worksheets[0];
      if (!sheet || sheet.rowCount < 2) {
        return res.status(400).json({ error: 'The spreadsheet needs a header row plus at least one product row.' });
      }

      // Map header names → column numbers (case-insensitive).
      const headerIndex: Record<string, number> = {};
      sheet.getRow(1).eachCell((cell: { value: unknown }, colNumber: number) => {
        const key = excelCellText(cell.value).toLowerCase();
        if (key) headerIndex[key] = colNumber;
      });
      if (!headerIndex['name']) {
        return res.status(400).json({ error: 'The spreadsheet has no "name" column — download the template for the exact format.' });
      }
      const cellText = (row: { getCell: (col: number) => { value: unknown } }, key: string): string => {
        const col = headerIndex[key.toLowerCase()];
        if (!col) return '';
        return excelCellText(row.getCell(col).value);
      };

      // Accord colors are global (accord_colors table) — load once and reuse.
      const accordColors = new Map<string, string>();
      try {
        (db.prepare('SELECT name, color FROM accord_colors').all() as { name: string; color: string }[])
          .forEach(row => accordColors.set(row.name.toLowerCase(), row.color));
      } catch { /* table may not exist yet — the fallback color is used */ }

      const parseAccords = (raw: string): { name: string; value: number; color: string }[] =>
        splitExcelList(raw)
          .map(part => {
            const colon = part.indexOf(':');
            const name = (colon === -1 ? part : part.slice(0, colon)).trim();
            const value = colon === -1 ? NaN : Number(part.slice(colon + 1));
            return {
              name,
              value: Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 75,
              color: accordColors.get(name.toLowerCase()) ?? '#666666',
            };
          })
          .filter(accord => accord.name.length > 0);

      // Notes are plain names ("Rose | Jasmine"). A legacy "Name@iconUrl"
      // suffix from older exports is stripped — icons are resolved from the
      // product's existing notes or fall back to the default icon.
      const parseNoteNames = (raw: string): string[] =>
        splitExcelList(raw)
          .map(part => (part.indexOf('@') === -1 ? part : part.slice(0, part.indexOf('@'))).trim())
          .filter(noteName => noteName.length > 0);

      // id and code indexes for matching rows to existing products. Both are
      // kept in sync while the file is processed, so duplicate codes inside
      // one file behave predictably (first row creates, later rows update it).
      const knownIds = new Set<string>();
      const codeToId = new Map<string, string>();
      (db.prepare('SELECT id, code FROM perfumes').all() as { id: string; code: string | null }[]).forEach(row => {
        knownIds.add(row.id);
        if (row.code) codeToId.set(row.code, row.id);
      });

      const insertStmt = db.prepare(`
        INSERT INTO perfumes (
          id, name, code, brand, price, gender, category, stockStatus, description, rating,
          mainImage, miniImage, galleryImages, accords, fragranceProfile, dayNight, seasons, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let created = 0;
      let updated = 0;
      let skipped = 0;
      let generatedSequence = 0;
      const errors: { row: number; message: string }[] = [];

      db.exec('BEGIN');
      try {
        sheet.eachRow({ includeEmpty: false }, (row: { getCell: (col: number) => { value: unknown } }, rowNumber: number) => {
          if (rowNumber === 1) return; // header row
          try {
            const name = cellText(row, 'name');
            const code = cellText(row, 'code');
            const rowId = cellText(row, 'id');

            // --- find the target row: by id first, then by code ---
            const targetId = (rowId && knownIds.has(rowId) ? rowId : null) ?? (code ? codeToId.get(code) ?? null : null);

            // A name is required for new rows. Rows that match an existing
            // product (by id or code) may omit it — every empty cell simply
            // means "keep the current value".
            if (!name && !targetId) throw new Error('Product name is required for new rows (or provide an id/code that matches an existing product)');

            // --- read filled cells only (an empty cell means "keep current value") ---
            const fields: Record<string, unknown> = {};
            if (name) fields.name = name;
            if (code) fields.code = code;
            const brand = cellText(row, 'brand');
            if (brand) fields.brand = brand;
            const priceRaw = cellText(row, 'price');
            if (priceRaw !== '') {
              const price = Math.round(Number(priceRaw.replace(/[,\s]/g, '')));
              if (!Number.isFinite(price)) throw new Error(`Price "${priceRaw}" is not a valid number`);
              fields.price = price;
            }
            const gender = cellText(row, 'gender');
            if (gender) fields.gender = matchExcelEnum(gender, EXCEL_GENDERS, 'Unisex');
            const category = cellText(row, 'category');
            if (category) fields.category = matchExcelEnum(category, EXCEL_CATEGORIES, 'Perfume');
            const stockStatus = cellText(row, 'stockStatus');
            if (stockStatus) fields.stockStatus = matchExcelEnum(stockStatus, EXCEL_STOCK_STATUSES, 'In Stock');
            const description = cellText(row, 'description');
            if (description) fields.description = description;
            const ratingRaw = cellText(row, 'rating');
            if (ratingRaw !== '') {
              const rating = Number(ratingRaw);
              fields.rating = Number.isFinite(rating) ? Math.min(5, Math.max(0, rating)) : 5;
            }
            const accords = cellText(row, 'accords');
            if (accords) fields.accords = JSON.stringify(parseAccords(accords));
            const dayNight = cellText(row, 'dayNight');
            if (dayNight) fields.dayNight = matchExcelEnum(dayNight, EXCEL_DAY_NIGHT, 'Both');
            const seasons = cellText(row, 'seasons');
            if (seasons) {
              fields.seasons = JSON.stringify(
                splitExcelList(seasons).map(s => matchExcelEnum(s, EXCEL_SEASONS, '')).filter(s => s !== '')
              );
            }

            // fragranceProfile merges per key; notes merge per tier.
            const profileUpdate: Record<string, string> = {};
            const profileRaw = cellText(row, 'fragranceProfile');
            if (profileRaw) {
              splitExcelList(profileRaw).forEach(part => {
                const eq = part.indexOf('=');
                if (eq === -1) return;
                const key = part.slice(0, eq).trim().toLowerCase();
                if (key === 'longevity' || key === 'projection' || key === 'sillage') {
                  profileUpdate[key] = part.slice(eq + 1).trim();
                }
              });
            }
            const notesUpdate: Partial<Record<'top' | 'middle' | 'base', string[]>> = {};
            (['top', 'middle', 'base'] as const).forEach(tier => {
              const tierRaw = cellText(row, `notes.${tier}`);
              if (tierRaw) notesUpdate[tier] = parseNoteNames(tierRaw);
            });

            // --- apply: update the matched row, or insert a new product ---
            if (targetId) {
              // Partial, non-destructive update — mirrors the PUT endpoint:
              // only cells with content are written.
              if (Object.keys(profileUpdate).length > 0) {
                const current = db.prepare('SELECT fragranceProfile FROM perfumes WHERE id = ?').get(targetId) as { fragranceProfile: string | null } | undefined;
                const existing = safeJsonParse<Record<string, string>>(current?.fragranceProfile, {});
                fields.fragranceProfile = JSON.stringify({
                  longevity: profileUpdate.longevity ?? existing.longevity ?? '',
                  projection: profileUpdate.projection ?? existing.projection ?? '',
                  sillage: profileUpdate.sillage ?? existing.sillage ?? '',
                });
              }
              if (Object.keys(notesUpdate).length > 0) {
                const current = db.prepare('SELECT notes FROM perfumes WHERE id = ?').get(targetId) as { notes: string | null } | undefined;
                const existing = safeJsonParse<Record<string, unknown>>(current?.notes, {});
                const existingTier = (tier: 'top' | 'middle' | 'base'): { name: string; iconUrl: string }[] =>
                  Array.isArray(existing[tier]) ? (existing[tier] as { name: string; iconUrl: string }[]) : [];
                // Re-imported notes keep the icon they already had; brand-new
                // note names get the shared default icon.
                const iconFor = (tier: 'top' | 'middle' | 'base', noteName: string): string => {
                  const match = existingTier(tier).find(note => typeof note?.name === 'string' && note.name.toLowerCase() === noteName.toLowerCase());
                  return match?.iconUrl && match.iconUrl.length > 0 ? match.iconUrl : DEFAULT_NOTE_ICON;
                };
                fields.notes = JSON.stringify({
                  top: notesUpdate.top ? notesUpdate.top.map(noteName => ({ name: noteName, iconUrl: iconFor('top', noteName) })) : existingTier('top'),
                  middle: notesUpdate.middle ? notesUpdate.middle.map(noteName => ({ name: noteName, iconUrl: iconFor('middle', noteName) })) : existingTier('middle'),
                  base: notesUpdate.base ? notesUpdate.base.map(noteName => ({ name: noteName, iconUrl: iconFor('base', noteName) })) : existingTier('base'),
                });
              }
              // "One image for all": applies to every product in the file.
              if (sharedImage) {
                fields.mainImage = sharedImage;
                fields.miniImage = sharedImage;
              }
              const setKeys = Object.keys(fields);
              if (setKeys.length > 0) {
                // setKeys contains only the fixed column names above — no user input.
                db.prepare(`UPDATE perfumes SET ${setKeys.map(key => `${key} = ?`).join(', ')} WHERE id = ?`)
                  .run(...(setKeys.map(key => fields[key]) as never[]), targetId);
              }
              if (code) codeToId.set(code, targetId);
              updated += 1;
            } else {
              // New product — fill gaps with the same defaults the admin form uses.
              const newId = rowId && !knownIds.has(rowId) ? rowId : `${Date.now()}-${rowNumber}-${++generatedSequence}`;
              // "One image for all" wins; otherwise a library image for the
              // row's Gender × Category; otherwise the default bottle photo.
              const resolvedImage = sharedImage
                ?? pickCatalogImage((fields.gender as string) ?? 'Unisex', (fields.category as string) ?? 'Perfume', name)
                ?? DEFAULT_PERFUME_IMAGE;
              const insertedCode = code || `IMP-${Date.now().toString(36)}-${rowNumber}`;
              insertStmt.run(
                newId,
                name,
                insertedCode,
                (fields.brand as string) ?? 'Our Fragrance',
                (fields.price as number) ?? 0,
                (fields.gender as string) ?? 'Unisex',
                (fields.category as string) ?? 'Perfume',
                (fields.stockStatus as string) ?? 'In Stock',
                (fields.description as string) ?? '',
                (fields.rating as number) ?? 5,
                resolvedImage,
                resolvedImage,
                '[]',
                (fields.accords as string) ?? '[]',
                JSON.stringify({
                  longevity: profileUpdate.longevity ?? '8H',
                  projection: profileUpdate.projection ?? 'Moderate',
                  sillage: profileUpdate.sillage ?? 'Moderate',
                }),
                (fields.dayNight as string) ?? 'Both',
                (fields.seasons as string) ?? '[]',
                JSON.stringify({
                  top: (notesUpdate.top ?? []).map(noteName => ({ name: noteName, iconUrl: DEFAULT_NOTE_ICON })),
                  middle: (notesUpdate.middle ?? []).map(noteName => ({ name: noteName, iconUrl: DEFAULT_NOTE_ICON })),
                  base: (notesUpdate.base ?? []).map(noteName => ({ name: noteName, iconUrl: DEFAULT_NOTE_ICON })),
                })
              );
              knownIds.add(newId);
              codeToId.set(insertedCode, newId);
              created += 1;
            }
          } catch (rowError) {
            skipped += 1;
            errors.push({ row: rowNumber, message: rowError instanceof Error ? rowError.message : 'Unknown error' });
          }
        });
        db.exec('COMMIT');
      } catch (transactionError) {
        db.exec('ROLLBACK');
        throw transactionError;
      }

      res.json({ success: true, created, updated, skipped, total: created + updated + skipped, errors: errors.slice(0, 50) });
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to import perfumes' });
    }
  });

  // Unknown API routes must return JSON 404s — never the SPA's index.html.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // --- Vite Middleware (Development & SPA mapping) ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production serving
    const distPath = path.join(process.cwd(), 'dist');
    if (!fs.existsSync(path.join(distPath, 'index.html'))) {
      console.error(`[static] Built frontend not found at ${distPath} — run "npm run build" first.`);
    }
    app.use(express.static(distPath));
    // SPA fallback: /admin, /jwt and any other client-side route.
    app.get('*', (req, res, next) => {
      res.sendFile(path.join(distPath, 'index.html'), (err) => (err ? next(err) : undefined));
    });
  }

  // Central error handler — never leaks stack traces or internals to clients.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const type = (err as { type?: string } | null)?.type;
    if (type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    if (type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body too large' });
    }
    console.error('Unhandled server error:', err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error' });
  });

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);

const networkInterfaces = os.networkInterfaces();

for (const name of Object.keys(networkInterfaces)) {
  for (const net of networkInterfaces[name] || []) {
    if (net.family === 'IPv4' && !net.internal) {
      console.log(`Network access: http://${net.address}:${PORT}`);
    }
  }
}
  });

  // Convert listen failures (e.g. port already in use) into a clean exit
  // instead of an unhandled 'error' event with a raw stack trace.
  server.on('error', (listenError) => {
    console.error('FATAL: server could not start listening:', listenError);
    process.exit(1);
  });

  // Graceful shutdown — Railway sends SIGTERM on every redeploy. Finish
  // in-flight requests, then close the SQLite handle cleanly so the database
  // file is never left in a corrupted state.
  const shutdown = (signal: string) => {
    console.log(`${signal} received — shutting down gracefully...`);
    server.close(() => {
      try {
        db.close();
        console.log('Database closed. Goodbye.');
      } catch (closeError) {
        console.error('Error while closing database:', closeError);
      }
      process.exit(0);
    });
    // Safety net if keep-alive connections would keep the process alive.
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((startError) => {
  console.error('FATAL: server failed to start:', startError);
  process.exit(1);
});
