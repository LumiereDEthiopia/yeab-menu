import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import os from 'os';
import ExcelJS from 'exceljs';
import type { Workbook } from 'exceljs';
import { createHash, timingSafeEqual, randomBytes, randomUUID } from 'node:crypto';
import dotenv from 'dotenv';

// Load a local .env file before any variable below is read, so `npm run dev`
// and `npm start` honour it. `override` stays false on purpose: real
// environment variables (Railway Variables, `docker run -e`, CI secrets)
// always win over the file, so a checked-out .env can never shadow them.
// Deployments have no .env to load — it is gitignored and .dockerignored —
// so production must receive these values from the platform's dashboard.
dotenv.config({ quiet: true });

// --- Environment configuration -------------------------------------------------
// Authentication configuration is deliberately forgiving: a missing or weak
// secret is reported as a loud warning instead of a fatal error. Database
// configuration is required separately because the application cannot serve
// catalog data without PostgreSQL.
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

/** Reads an env var, tracking whether the value came from the environment. */
function readEnv(
  name: string,
  fallback: string
): { value: string; fromEnv: boolean } {
  const raw = process.env[name];
  if (typeof raw === 'string' && raw.trim().length > 0) return { value: raw, fromEnv: true };
  if (!IS_PRODUCTION) {
    console.warn(
      `[config] ${name} is not set — using a development-only fallback. This is NOT safe outside local development.`
    );
  }
  return { value: fallback, fromEnv: false };
}

// JWT signing secret. When it is not provided we generate a strong random one
// per boot rather than falling back to a hardcoded string: a hardcoded secret
// is public the moment the repo is, and anyone holding it can mint admin tokens
// without ever touching the login form. A per-boot secret is unknowable, so the
// only cost is that issued sessions end when the process restarts.
const jwtSecret = readEnv(
  'JWT_SECRET',
  IS_PRODUCTION ? randomBytes(48).toString('base64url') : 'fallback-secret-for-dev'
);
const JWT_SECRET = jwtSecret.value;

// Admin panel credentials. These fall back to admin/admin so the app is usable
// straight out of the box; the consequences are logged loudly at boot.
const adminUsername = readEnv('ADMIN_USERNAME', 'admin');
const adminPassword = readEnv('ADMIN_PASSWORD', 'admin');
const ADMIN_USERNAME = adminUsername.value;
const ADMIN_PASSWORD = adminPassword.value;

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

// --- Startup security report ---------------------------------------------------
// Authentication warnings make risky defaults visible in deployment logs
// instead of silently shipping a wide-open admin panel.
if (IS_PRODUCTION) {
  const warnings: string[] = [];

  if (KNOWN_PUBLIC_SECRETS.has(JWT_SECRET) || KNOWN_PUBLIC_SECRETS.has(normalizedSecret)) {
    warnings.push(
      'JWT_SECRET is a publicly known example value, so anyone can forge admin tokens and bypass the\n' +
        '          login form entirely. This is the one setting most worth changing. Generate a unique one:\n' +
        '            node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'
    );
  } else if (!jwtSecret.fromEnv) {
    warnings.push(
      'JWT_SECRET is not set, so a random one was generated for this process only. It is safe but not\n' +
        '          stable: every restart (including Railway redeploys) invalidates all issued admin sessions,\n' +
        '          so admins are silently logged out. Set it in Railway -> Variables to keep sessions.'
    );
  }

  if (ADMIN_USERNAME === 'admin' && ADMIN_PASSWORD === 'admin') {
    warnings.push(
      'the admin panel uses the default admin/admin credentials. Anyone who guesses this URL has full\n' +
        '          read/write access to the catalog. Set ADMIN_USERNAME and ADMIN_PASSWORD in Railway ->\n' +
        '          Variables when you are ready to lock it down.'
    );
  } else if (!adminUsername.fromEnv || !adminPassword.fromEnv) {
    warnings.push(
      'only one of ADMIN_USERNAME / ADMIN_PASSWORD is set; the other falls back to "admin".\n' +
        '          Set both in Railway -> Variables to avoid a half-default account.'
    );
  }

  if (ADMIN_PASSWORD.length < 8) {
    warnings.push(`ADMIN_PASSWORD is only ${ADMIN_PASSWORD.length} characters.`);
  }

  if (warnings.length > 0) {
    console.warn(
      `[config] ${warnings.length} security warning(s) — the server is running, but /admin is exposed:\n` +
        warnings.map((w) => `          - ${w}`).join('\n')
    );
  } else {
    console.log('[config] admin credentials and JWT secret are all set from the environment.');
  }
}

/** Length-safe, timing-safe string comparison (both sides are hashed first, so lengths always match). */
function timingSafeEqualStr(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(a, 'utf8').digest(),
    createHash('sha256').update(b, 'utf8').digest()
  );
}

const normalizeStockStatus = (status?: string) => status === 'Low Stock' || status === 'Out Stock' ? status : 'In Stock';
const isValidStockStatus = (status: unknown): status is 'In Stock' | 'Low Stock' | 'Out Stock' =>
  status === 'In Stock' || status === 'Low Stock' || status === 'Out Stock';

const DATABASE_URL = process.env.DATABASE_URL?.trim();
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Configure it in .env locally or your hosting provider.');
}
const pool = new Pool({ connectionString: DATABASE_URL });

const DATABASE_COLUMN_NAMES: Record<string, string> = {
  sizeprice1: 'sizePrice1',
  sizeprice2: 'sizePrice2',
  pricepergram: 'pricePerGram',
  sizeimage1: 'sizeImage1',
  sizeimage2: 'sizeImage2',
  stockstatus: 'stockStatus',
  stockstatus1: 'stockStatus1',
  stockstatus2: 'stockStatus2',
  mainimage: 'mainImage',
  miniimage: 'miniImage',
  galleryimages: 'galleryImages',
  fragranceprofile: 'fragranceProfile',
  daynight: 'dayNight',
};
const normalizeDatabaseRow = <T extends Record<string, unknown>>(row: T): T =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [
    DATABASE_COLUMN_NAMES[key] ?? key,
    value,
  ])) as T;
const toPostgresPlaceholders = (sql: string): string => {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
};
const db = {
  async query(sql: string, values?: unknown[]) {
    const result = await pool.query(toPostgresPlaceholders(sql), values);
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    return { ...result, rows: rows.map(normalizeDatabaseRow) };
  },
  prepare(sql: string) {
    return {
      all: async (...values: unknown[]) => (await db.query(sql, values)).rows,
      get: async (...values: unknown[]) => (await db.query(sql, values)).rows[0],
      run: async (...values: unknown[]) => db.query(sql, values),
    };
  },
  async exec(sql: string) {
    return pool.query(sql);
  },
  async close() {
    await pool.end();
  },
};

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

  await db.query(`
    CREATE TABLE IF NOT EXISTS perfumes (
      id TEXT PRIMARY KEY,
      name TEXT,
      code TEXT,
      brand TEXT,
      price DOUBLE PRECISION,
      unit TEXT,
      sizePrice1 DOUBLE PRECISION,
      sizePrice2 DOUBLE PRECISION,
      pricePerGram DOUBLE PRECISION,
      sizeImage1 TEXT,
      sizeImage2 TEXT,
      gender TEXT,
      category TEXT,
      stockStatus TEXT DEFAULT 'In Stock',
      stockStatus1 TEXT,
      stockStatus2 TEXT,
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
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_catalog_images_bucket ON catalog_images (gender, category);

    CREATE TABLE IF NOT EXISTS catalog_size_images (
      gender TEXT NOT NULL,
      category TEXT NOT NULL,
      size INTEGER NOT NULL CHECK (size IN (1, 2)),
      image TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (gender, category, size)
    );

    CREATE TABLE IF NOT EXISTS category_settings (
      category TEXT PRIMARY KEY,
      unit TEXT NOT NULL DEFAULT 'ml',
      size1 TEXT NOT NULL DEFAULT '50',
      size2 TEXT NOT NULL DEFAULT '100',
      price1 DOUBLE PRECISION NOT NULL DEFAULT 0,
      price2 DOUBLE PRECISION NOT NULL DEFAULT 0,
      image1 TEXT,
      image2 TEXT,
      options_json TEXT
    );
    ALTER TABLE perfumes ADD COLUMN IF NOT EXISTS stockStatus TEXT DEFAULT 'In Stock';
    ALTER TABLE perfumes ADD COLUMN IF NOT EXISTS stockStatus1 TEXT;
    ALTER TABLE perfumes ADD COLUMN IF NOT EXISTS stockStatus2 TEXT;
    ALTER TABLE perfumes ADD COLUMN IF NOT EXISTS miniImage TEXT;
    ALTER TABLE perfumes ADD COLUMN IF NOT EXISTS pricePerGram DOUBLE PRECISION;
    ALTER TABLE perfumes ADD COLUMN IF NOT EXISTS unit TEXT;
    ALTER TABLE perfumes ADD COLUMN IF NOT EXISTS sizePrice1 DOUBLE PRECISION;
    ALTER TABLE perfumes ADD COLUMN IF NOT EXISTS sizePrice2 DOUBLE PRECISION;
    ALTER TABLE perfumes ADD COLUMN IF NOT EXISTS sizeImage1 TEXT;
    ALTER TABLE perfumes ADD COLUMN IF NOT EXISTS sizeImage2 TEXT;
    ALTER TABLE category_settings ADD COLUMN IF NOT EXISTS price1 DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE category_settings ADD COLUMN IF NOT EXISTS price2 DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE category_settings ADD COLUMN IF NOT EXISTS options_json TEXT;
  `);

  // Backfill: ensure every perfume has a stored mini image (defaults to its main image)
  await db.query('UPDATE perfumes SET miniImage = mainImage WHERE miniImage IS NULL OR miniImage = \'\'');

  // --- Catalog image library -----------------------------------------------------
  // Admins can upload any number of images per Gender × configured Category
  // bucket. The catalog uses these images in two ways:
  //   1. products created without their own photo (admin form or Excel import)
  //      pick one from the matching bucket, and
  //   2. the catalog UI substitutes a bucket image for products that still show
  //      one of the built-in placeholder bottle photos under public/images/perfumes.
  // A custom uploaded/pasted image on a product always wins over the library.

  const CATALOG_IMAGE_GENDERS = ['Male', 'Female', 'Kids', 'Unisex'];
  const PLACEHOLDER_IMAGE_PREFIX = '/images/perfumes/';
  const FALLBACK_BOTTLE_IMAGE = '/images/perfumes/normal.jpg';

  // --- Category size settings ----------------------------------------------------
  // Every category has two sizes, prices, and optional photos. Rows are seeded
  // once with defaults; ON CONFLICT DO NOTHING
  // keeps any values the admin has already edited in later boots.
  const CATEGORY_SIZE_DEFAULTS: [category: string, unit: string, size1: string, size2: string][] = [
    ['Perfume', 'ml', '50', '100'],
    ['Brand Perfume', 'ml', '50', '100'],
    ['Luxury Perfume', 'ml', '50', '100'],
    ['Oil', 'ml', '3', '6'],
    ['Musk', 'gram', '6', '12'],
    ['3ml Oil', 'ml', '3', '6'],
    ['Cream/Jelly', 'gram', '30', '50'],
  ];
  for (const [category, unit, size1, size2] of CATEGORY_SIZE_DEFAULTS) {
    await db.query(
      'INSERT INTO category_settings (category, unit, size1, size2, price1, price2) VALUES ($1, $2, $3, $4, 0, 0) ON CONFLICT (category) DO NOTHING',
      [category, unit, size1, size2]
    );
  }

  /** True when an image is empty or one of the built-in placeholder bottle photos. */
  const isPlaceholderImage = (image: unknown): boolean =>
    typeof image !== 'string' || image.trim().length === 0 || image.trim().startsWith(PLACEHOLDER_IMAGE_PREFIX);

  /** Stable hash of a seed string — the same product code always picks the same image. */
  const hashSeed = (seed: unknown): number =>
    Math.abs(String(seed ?? '').split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0));

  /** Pick an image from the Gender × Category bucket (deterministic per seed code). */
  const pickCatalogImage = async (gender: unknown, category: unknown, seed: unknown): Promise<string | null> => {
    const rows = (await db.query(
      'SELECT image FROM catalog_images WHERE gender = $1 AND category = $2 ORDER BY created_at, id',
      [String(gender ?? ''), String(category ?? '')]
    )).rows as { image: string }[];
    const pool = rows.map(row => row.image).filter(img => typeof img === 'string' && img.length > 0);
    if (pool.length === 0) return null;
    return pool[hashSeed(seed) % pool.length];
  };

  const categoryExists = async (category: unknown): Promise<boolean> =>
    typeof category === 'string'
    && Boolean((await db.query('SELECT 1 FROM category_settings WHERE category = $1', [category.trim()])).rowCount);

  const isValidOptionalImage = (image: unknown): boolean => {
    if (image === null || image === undefined || image === '') return true;
    if (typeof image !== 'string' || image.length > 12_000_000) return false;
    return image.startsWith('data:image/')
      || image.startsWith('/')
      || image.startsWith('http://')
      || image.startsWith('https://');
  };

  const optionalNonNegativePrice = (value: unknown): number | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const price = Number(value);
    return Number.isFinite(price) && price >= 0 ? price : NaN;
  };

  console.log('[data] PostgreSQL schema is ready.');

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
  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
    } catch (error) {
      console.error('Database health check failed:', error);
      return res.status(503).json({ status: 'unavailable', error: 'Database unavailable' });
    }
    res.json({
      status: 'ok',
      environment: NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/accord-colors', async (req, res) => {
    try {
      const stmt = db.prepare('SELECT * FROM accord_colors');
      const rows = await stmt.all() as { name: string, color: string }[];
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

  app.post('/api/admin/accord-colors', authenticateAdmin, async (req, res) => {
    try {
      const { name, color } = req.body;
      const stmt = db.prepare('INSERT INTO accord_colors (name, color) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET color = EXCLUDED.color');
      await stmt.run(name, color);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to save accord color' });
    }
  });

  app.delete('/api/admin/accord-colors/:name', authenticateAdmin, async (req, res) => {
    try {
      const stmt = db.prepare('DELETE FROM accord_colors WHERE name = ?');
      await stmt.run(req.params.name);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to delete accord color' });
    }
  });

  app.get('/api/category-settings', async (_req, res) => {
    try {
      const rows = await db.prepare(
        'SELECT category, unit, size1, size2, price1, price2, image1, image2, options_json FROM category_settings ORDER BY lower(category)'
      ).all() as {
        category: string;
        unit: 'ml' | 'gram';
        size1: string;
        size2: string;
        price1: number;
        price2: number;
        image1: string | null;
        image2: string | null;
        options_json: string | null;
      }[];
      res.json(rows.map(({ options_json, ...setting }) => ({
        ...setting,
        options: options_json
          ? JSON.parse(options_json)
          : [
              { size: setting.size1, price: setting.price1, image: setting.image1 },
              { size: setting.size2, price: setting.price2, image: setting.image2 },
            ],
      })));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load category settings' });
    }
  });

  const parseCategorySetting = (body: unknown) => {
    const value = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const unit = value.unit;
    const size1 = typeof value.size1 === 'string' ? value.size1.trim() : String(value.size1 ?? '').trim();
    const size2 = typeof value.size2 === 'string' ? value.size2.trim() : String(value.size2 ?? '').trim();
    const price1 = Number(value.price1);
    const price2 = Number(value.price2);
    const imageValue = (key: 'image1' | 'image2'): string | null | undefined => {
      const image = value[key];
      if (image === null || image === undefined || image === '') return null;
      if (typeof image !== 'string' || image.length > 12_000_000) return undefined;
      const allowed = image.startsWith('data:image/')
        || image.startsWith('/')
        || image.startsWith('http://')
        || image.startsWith('https://');
      return allowed ? image : undefined;
    };
    const image1 = imageValue('image1');
    const image2 = imageValue('image2');
    const rawOptions = value.options;
    const options = Array.isArray(rawOptions)
      ? rawOptions.map((option: unknown) => {
          const item = option && typeof option === 'object' ? option as Record<string, unknown> : {};
          const size = typeof item.size === 'string' ? item.size.trim() : String(item.size ?? '').trim();
          const price = Number(item.price);
          const image = item.image === null || item.image === undefined || item.image === ''
            ? null
            : typeof item.image === 'string' && item.image.length <= 12_000_000
              && (item.image.startsWith('data:image/') || item.image.startsWith('/') || item.image.startsWith('http://') || item.image.startsWith('https://'))
              ? item.image
              : undefined;
          return { size, price, image };
        })
      : [
          { size: typeof value.size1 === 'string' ? value.size1.trim() : String(value.size1 ?? '').trim(), price: Number(value.price1), image: image1 },
          { size: typeof value.size2 === 'string' ? value.size2.trim() : String(value.size2 ?? '').trim(), price: Number(value.price2), image: image2 },
        ];

    if (unit !== 'ml' && unit !== 'gram') return { error: 'Unit must be ml or gram' } as const;
    if (!size1 || !size2 || size1.length > 20 || size2.length > 20) {
      return { error: 'Enter both sizes using no more than 20 characters' } as const;
    }
    if (!Number.isFinite(Number(size1)) || Number(size1) <= 0 || !Number.isFinite(Number(size2)) || Number(size2) <= 0) {
      return { error: 'Both sizes must be positive numbers' } as const;
    }
    if (size1 === size2) return { error: 'The two sizes must be different' } as const;
    if (!Number.isSafeInteger(price1) || price1 < 0 || !Number.isSafeInteger(price2) || price2 < 0) {
      return { error: 'Prices must be non-negative whole numbers' } as const;
    }
    if (image1 === undefined || image2 === undefined) {
      return { error: 'Images must be JPG, PNG, or WebP uploads, paths, or URLs' } as const;
    }
    if (options.length === 0 || options.some(option =>
      !option.size
      || option.size.length > 20
      || !Number.isFinite(Number(option.size))
      || Number(option.size) <= 0
      || !Number.isSafeInteger(option.price)
      || option.price < 0
      || option.image === undefined
    )) {
      return { error: 'Each option must have a positive size, a non-negative whole-number price, and a valid image' } as const;
    }
    if (new Set(options.map(option => Number(option.size))).size !== options.length) {
      return { error: 'Option sizes must be different' } as const;
    }
    return { value: { unit, size1, size2, price1, price2, image1, image2, options } } as const;
  };

  app.post('/api/admin/category-settings', authenticateAdmin, async (req, res) => {
    try {
      const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
      if (!category || category.length > 60) {
        return res.status(400).json({ error: 'Category name is required and must be 60 characters or fewer' });
      }
      const parsed = parseCategorySetting(req.body);
      if ('error' in parsed) return res.status(400).json({ error: parsed.error });
      const duplicate = await db.prepare('SELECT category FROM category_settings WHERE lower(category) = lower(?)').get(category);
      if (duplicate) return res.status(409).json({ error: 'A category with that name already exists' });
      await db.prepare(`
        INSERT INTO category_settings (category, unit, size1, size2, price1, price2, image1, image2, options_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(category, parsed.value.unit, parsed.value.size1, parsed.value.size2, parsed.value.price1, parsed.value.price2, parsed.value.image1, parsed.value.image2, JSON.stringify(parsed.value.options));
      res.status(201).json({ success: true, category });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to create category' });
    }
  });

  app.put('/api/admin/category-settings/:category', authenticateAdmin, async (req, res) => {
    try {
      const category = req.params.category.trim();
      if (!await categoryExists(category)) return res.status(404).json({ error: 'Category not found' });
      const parsed = parseCategorySetting(req.body);
      if ('error' in parsed) return res.status(400).json({ error: parsed.error });
      await db.prepare(`
        UPDATE category_settings
        SET unit = ?, size1 = ?, size2 = ?, price1 = ?, price2 = ?, image1 = ?, image2 = ?, options_json = ?
        WHERE category = ?
      `).run(parsed.value.unit, parsed.value.size1, parsed.value.size2, parsed.value.price1, parsed.value.price2, parsed.value.image1, parsed.value.image2, JSON.stringify(parsed.value.options), category);
      res.json({ success: true, category });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to update category' });
    }
  });

  app.delete('/api/admin/category-settings/:category', authenticateAdmin, async (req, res) => {
    try {
      const category = req.params.category.trim();
      if (!await categoryExists(category)) return res.status(404).json({ error: 'Category not found' });
      const hasProducts = await db.prepare('SELECT 1 FROM perfumes WHERE category = ? LIMIT 1').get(category);
      const hasImages = await db.prepare('SELECT 1 FROM catalog_images WHERE category = ? LIMIT 1').get(category);
      const hasSizeImages = await db.prepare('SELECT 1 FROM catalog_size_images WHERE category = ? LIMIT 1').get(category);
      if (hasProducts || hasImages || hasSizeImages) {
        return res.status(409).json({ error: 'This category is in use by products or catalog images and cannot be removed' });
      }
      await db.prepare('DELETE FROM category_settings WHERE category = ?').run(category);
      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to delete category' });
    }
  });

  app.get('/api/catalog-size-images', async (_req, res) => {
    try {
      const rows = await db.prepare('SELECT gender, category, size, image FROM catalog_size_images').all();
      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load size-specific catalog images' });
    }
  });

  app.put('/api/admin/catalog-size-images', authenticateAdmin, async (req, res) => {
    try {
      const { gender, category, size, image } = req.body ?? {};
      const categoryName = typeof category === 'string' ? category.trim() : '';
      if (!CATALOG_IMAGE_GENDERS.includes(gender) || !await categoryExists(categoryName)) {
        return res.status(400).json({ error: 'Select a valid gender and category' });
      }
      if (size !== 1 && size !== 2) {
        return res.status(400).json({ error: 'Size must be option 1 or 2' });
      }
      if (image === null || image === '') {
        await db.prepare('DELETE FROM catalog_size_images WHERE gender = ? AND category = ? AND size = ?')
          .run(gender, categoryName, size);
        return res.json({ success: true, gender, category: categoryName, size, image: null });
      }
      if (typeof image !== 'string' || image.length === 0 || image.length > 12_000_000) {
        return res.status(400).json({ error: 'The image is missing or too large — pick a smaller picture.' });
      }
      const allowed = image.startsWith('data:image/')
        || image.startsWith('/')
        || image.startsWith('http://')
        || image.startsWith('https://');
      if (!allowed) {
        return res.status(400).json({ error: 'Unsupported image format — choose a JPG, PNG or WebP picture.' });
      }
      await db.prepare(`
        INSERT INTO catalog_size_images (gender, category, size, image)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(gender, category, size)
        DO UPDATE SET image = excluded.image, updated_at = CURRENT_TIMESTAMP
      `).run(gender, categoryName, size, image);
      res.json({ success: true, gender, category: categoryName, size, image });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to save size-specific catalog image' });
    }
  });

  // --- Catalog image library: REST endpoints -------------------------------------
  // Public read (the catalog page needs the buckets without logging in); all
  // writes are admin-only. Images are stored as data URLs (same as perfume
  // uploads) or plain paths/URLs, one row per picture.

  app.get('/api/catalog-images', async (_req, res) => {
    try {
      const rows = await db.prepare('SELECT id, gender, category, image FROM catalog_images ORDER BY gender, category, created_at, id').all();
      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load catalog images' });
    }
  });

  app.get('/api/perfume-default-images', (_req, res) => {
    try {
      const folder = path.join(process.cwd(), 'public', 'images', 'perfumes');
      if (!fs.existsSync(folder)) {
        return res.json([]);
      }
      const images = fs.readdirSync(folder, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.(png|jpe?g|gif|webp|svg)$/i.test(entry.name))
        .map((entry) => `/images/perfumes/${entry.name}`)
        .sort((a, b) => a.localeCompare(b));
      res.json(images);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load default perfume images' });
    }
  });

  app.post('/api/admin/catalog-images', authenticateAdmin, async (req, res) => {
    try {
      const { gender, category, image } = req.body ?? {};
      if (!CATALOG_IMAGE_GENDERS.includes(gender)) {
        return res.status(400).json({ error: `Gender must be one of: ${CATALOG_IMAGE_GENDERS.join(', ')}` });
      }
      const categoryName = typeof category === 'string' ? category.trim() : '';
      if (!await categoryExists(categoryName)) {
        return res.status(400).json({ error: 'Select an existing category' });
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
      await db.prepare('INSERT INTO catalog_images (id, gender, category, image) VALUES (?, ?, ?, ?)').run(id, gender, categoryName, image);
      res.json({ success: true, id, gender, category: categoryName, image });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to save catalog image' });
    }
  });

  // Write the bucket's images into EVERY matching product (main + mini image),
  // picking deterministically per product code so the same product always gets
  // the same picture. This is the explicit "force these photos" action — the
  // passive catalog substitution only replaces placeholder bottles.
  app.post('/api/admin/catalog-images/apply', authenticateAdmin, async (req, res) => {
    try {
      const { gender, category } = req.body ?? {};
      const categoryName = typeof category === 'string' ? category.trim() : '';
      if (!CATALOG_IMAGE_GENDERS.includes(gender) || !await categoryExists(categoryName)) {
        return res.status(400).json({ error: 'Gender and category are required' });
      }
      const images = (await db.prepare('SELECT image FROM catalog_images WHERE gender = ? AND category = ? ORDER BY created_at, id')
        .all(gender, categoryName) as { image: string }[]).map(row => row.image).filter(img => img.length > 0);
      if (images.length === 0) {
        return res.status(400).json({ error: 'This Gender/Category bucket has no images yet — add some first.' });
      }
      const products = await db.prepare('SELECT id, code FROM perfumes WHERE gender = ? AND category = ?')
        .all(gender, categoryName) as { id: string; code: string | null }[];
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const product of products) {
          const image = images[hashSeed(product.code || product.id) % images.length];
          await client.query('UPDATE perfumes SET mainimage = $1, miniimage = $1 WHERE id = $2', [image, product.id]);
        }
        await client.query('COMMIT');
      } catch (txError) {
        await client.query('ROLLBACK');
        throw txError;
      } finally {
        client.release();
      }
      res.json({ success: true, updated: products.length });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to apply catalog images' });
    }
  });

  app.delete('/api/admin/catalog-images/:id', authenticateAdmin, async (req, res) => {
    try {
      await db.prepare('DELETE FROM catalog_images WHERE id = ?').run(req.params.id);
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
    // from the environment, defaulting to admin/admin; anything weak about them
    // is reported as a startup warning rather than blocking the boot.
    if (timingSafeEqualStr(username, ADMIN_USERNAME) && timingSafeEqualStr(password, ADMIN_PASSWORD)) {
      clearLoginFailures(clientIp);
      const token = jwt.sign({ username: ADMIN_USERNAME, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
      res.json({ token });
    } else {
      recordLoginFailure(clientIp);
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });

  app.get('/api/perfumes', async (req, res) => {
    try {
      const stmt = db.prepare('SELECT * FROM perfumes ORDER BY created_at DESC');
      const rows = await stmt.all() as any[];
      
      const parsedPerfumes = rows.map(row => ({
        ...row,
        stockStatus: normalizeStockStatus(row.stockStatus),
        stockStatus1: row.stockStatus1 ? normalizeStockStatus(row.stockStatus1) : null,
        stockStatus2: row.stockStatus2 ? normalizeStockStatus(row.stockStatus2) : null,
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

  app.post('/api/admin/perfumes', authenticateAdmin, async (req, res) => {
    try {
      const p = req.body;
      const pricePerGram = p.pricePerGram === null || p.pricePerGram === undefined || p.pricePerGram === ''
        ? null
        : Number(p.pricePerGram);
      const sizePrice1 = optionalNonNegativePrice(p.sizePrice1);
      const sizePrice2 = optionalNonNegativePrice(p.sizePrice2);
      if (['stockStatus1', 'stockStatus2'].some(key => p[key] != null && p[key] !== '' && !isValidStockStatus(p[key]))) {
        return res.status(400).json({ error: 'Size stock status must be In Stock, Low Stock, or Out Stock' });
      }
      if (p.unit !== undefined && p.unit !== 'ml' && p.unit !== 'gram') {
        return res.status(400).json({ error: 'Product unit must be ml or gram' });
      }
      if (Number.isNaN(sizePrice1) || Number.isNaN(sizePrice2)) {
        return res.status(400).json({ error: 'Size prices must be non-negative numbers' });
      }
      if (p.pricePerGram !== null && p.pricePerGram !== undefined && p.pricePerGram !== ''
        && (!Number.isFinite(pricePerGram) || pricePerGram < 0)) {
        return res.status(400).json({ error: 'Price per gram must be a non-negative number' });
      }
      if (!isValidOptionalImage(p.sizeImage1) || !isValidOptionalImage(p.sizeImage2)) {
        return res.status(400).json({ error: 'Size images must be image uploads, paths, or URLs no larger than 12 MB' });
      }
      const id = Date.now().toString(); // rudimentary ID definition
      
      const stmt = db.prepare(`
        INSERT INTO perfumes (
          id, name, code, brand, price, unit, sizePrice1, sizePrice2, pricePerGram, sizeImage1, sizeImage2, gender, category, stockStatus, stockStatus1, stockStatus2, description, rating,
          mainImage, miniImage, galleryImages, accords, fragranceProfile, dayNight, seasons, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      // New products without their own photo (or still showing a placeholder
      // bottle) pick one from the catalog image library for their Gender ×
      // Category bucket — deterministic per product code.
      const mainImage = isPlaceholderImage(p.mainImage)
        ? (await pickCatalogImage(p.gender, p.category, p.code || id) ?? p.mainImage ?? FALLBACK_BOTTLE_IMAGE)
        : p.mainImage;
      const miniImage = p.miniImage && !isPlaceholderImage(p.miniImage) ? p.miniImage : mainImage;

      await stmt.run(
        id, p.name, p.code, p.brand, p.price, p.unit ?? null, sizePrice1 ?? null, sizePrice2 ?? null, pricePerGram, p.sizeImage1 || null, p.sizeImage2 || null, p.gender, p.category, normalizeStockStatus(p.stockStatus), p.stockStatus1 ? normalizeStockStatus(p.stockStatus1) : null, p.stockStatus2 ? normalizeStockStatus(p.stockStatus2) : null, p.description, p.rating,
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

  app.put('/api/admin/perfumes/:id', authenticateAdmin, async (req, res) => {
    try {
      const p = req.body;
      const id = req.params.id;
      const pricePerGram = p.pricePerGram === null || p.pricePerGram === undefined || p.pricePerGram === ''
        ? null
        : Number(p.pricePerGram);
      const sizePrice1 = optionalNonNegativePrice(p.sizePrice1);
      const sizePrice2 = optionalNonNegativePrice(p.sizePrice2);
      if (['stockStatus1', 'stockStatus2'].some(key => p[key] != null && p[key] !== '' && !isValidStockStatus(p[key]))) {
        return res.status(400).json({ error: 'Size stock status must be In Stock, Low Stock, or Out Stock' });
      }
      if (p.unit !== undefined && p.unit !== 'ml' && p.unit !== 'gram') {
        return res.status(400).json({ error: 'Product unit must be ml or gram' });
      }
      if (Number.isNaN(sizePrice1) || Number.isNaN(sizePrice2)) {
        return res.status(400).json({ error: 'Size prices must be non-negative numbers' });
      }
      if ('pricePerGram' in p && p.pricePerGram !== null && p.pricePerGram !== ''
        && (!Number.isFinite(pricePerGram) || pricePerGram < 0)) {
        return res.status(400).json({ error: 'Price per gram must be a non-negative number' });
      }
      if (('sizeImage1' in p && !isValidOptionalImage(p.sizeImage1))
        || ('sizeImage2' in p && !isValidOptionalImage(p.sizeImage2))) {
        return res.status(400).json({ error: 'Size images must be image uploads, paths, or URLs no larger than 12 MB' });
      }

      // If the perfume isn't in the database (e.g. the admin edited a built-in
      // demo perfume while the DB is empty), store it as a new row instead of
      // silently updating nothing.
      const existing = await db.prepare('SELECT id FROM perfumes WHERE id = ?').get(id);
      if (!existing) {
        const insertStmt = db.prepare(`
          INSERT INTO perfumes (
              id, name, code, brand, price, unit, sizePrice1, sizePrice2, pricePerGram, sizeImage1, sizeImage2, gender, category, stockStatus, stockStatus1, stockStatus2, description, rating,
            mainImage, miniImage, galleryImages, accords, fragranceProfile, dayNight, seasons, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        await insertStmt.run(
            id, p.name, p.code, p.brand, p.price, p.unit ?? null, sizePrice1 ?? null, sizePrice2 ?? null, pricePerGram, p.sizeImage1 || null, p.sizeImage2 || null, p.gender, p.category, normalizeStockStatus(p.stockStatus), p.stockStatus1 ? normalizeStockStatus(p.stockStatus1) : null, p.stockStatus2 ? normalizeStockStatus(p.stockStatus2) : null, p.description, p.rating,
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
        unit: b => b.unit ?? null,
        sizePrice1: b => b.sizePrice1 ?? null,
        sizePrice2: b => b.sizePrice2 ?? null,
        pricePerGram: b => b.pricePerGram === null || b.pricePerGram === '' ? null : Number(b.pricePerGram),
        sizeImage1: b => b.sizeImage1 || null,
        sizeImage2: b => b.sizeImage2 || null,
        gender: b => b.gender,
        category: b => b.category,
        stockStatus: b => normalizeStockStatus(b.stockStatus),
        stockStatus1: b => b.stockStatus1 ? normalizeStockStatus(b.stockStatus1) : null,
        stockStatus2: b => b.stockStatus2 ? normalizeStockStatus(b.stockStatus2) : null,
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
        await stmt.run(...updateValues);
      }

      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to update perfume' });
    }
  });

  app.delete('/api/admin/perfumes/:id', authenticateAdmin, async (req, res) => {
    try {
      const stmt = db.prepare('DELETE FROM perfumes WHERE id = ?');
      await stmt.run(req.params.id);
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

  const EXCEL_SHEET_NAME = 'products';

  // Same fallbacks the admin form and seed data use.
  const DEFAULT_PERFUME_IMAGE = '/images/perfumes/normal.jpg';
  const DEFAULT_NOTE_ICON = 'https://images.unsplash.com/photo-1615634260167-c8cdede054de?w=100&h=100&fit=crop';

  const EXCEL_COLUMNS: { header: string; key: string; width: number }[] = [
    { header: 'id', key: 'id', width: 14 },
    { header: 'name', key: 'name', width: 30 },
    { header: 'code', key: 'code', width: 12 },
    { header: 'productType', key: 'productType', width: 14 },
    { header: 'brand', key: 'brand', width: 22 },
    { header: 'price', key: 'price', width: 10 },
    { header: 'gender', key: 'gender', width: 12 },
    { header: 'category', key: 'category', width: 16 },
    { header: 'stockStatus', key: 'stockStatus', width: 12 },
    { header: 'stockStatus1', key: 'stockStatus1', width: 14 },
    { header: 'stockStatus2', key: 'stockStatus2', width: 14 },
    { header: 'description', key: 'description', width: 40 },
    { header: 'rating', key: 'rating', width: 8 },
    { header: 'accords', key: 'accords', width: 36 },
    { header: 'fragranceProfile', key: 'fragranceProfile', width: 44 },
    { header: 'dayNight', key: 'dayNight', width: 10 },
    { header: 'seasons', key: 'seasons', width: 24 },
    { header: 'notes.top', key: 'notes.top', width: 32 },
    { header: 'notes.middle', key: 'notes.middle', width: 32 },
    { header: 'notes.base', key: 'notes.base', width: 32 },
    { header: 'pricePerGram', key: 'pricePerGram', width: 14 },
    { header: 'unit', key: 'unit', width: 10 },
    { header: 'sizePrice1', key: 'sizePrice1', width: 14 },
    { header: 'sizePrice2', key: 'sizePrice2', width: 14 },
  ];

  const EXCEL_GENDERS = ['Male', 'Female', 'Kids', 'Unisex'];
  const EXCEL_DAY_NIGHT = ['Day', 'Night', 'Both'];
  const EXCEL_STOCK_STATUSES = ['In Stock', 'Low Stock', 'Out Stock'];
  const EXCEL_SEASONS = ['Winter', 'Spring', 'Summer', 'Autumn'];
  const EXCEL_PRODUCT_TYPES = ['PERFUME', 'OIL', 'PURE_OIL'];

  const excelProductTypeForCategory = (category: string): string => {
    if (category === 'Oil') return 'OIL';
    if (category === '3ml Oil') return 'PURE_OIL';
    return 'PERFUME';
  };

  const excelCategoryForProduct = (category: string, gender: string): string => {
    if (category !== 'Perfume') return category;
    if (gender === 'Male') return 'Men';
    if (gender === 'Female') return 'Women';
    return gender;
  };

  const normalizeExcelProductCategory = async (rawCategory: string, rawProductType: string): Promise<string> => {
    const normalizedType = rawProductType.trim().toUpperCase();
    if (normalizedType && !EXCEL_PRODUCT_TYPES.includes(normalizedType)) {
      throw new Error(`Unknown productType "${rawProductType}". Use PERFUME, OIL, or PURE_OIL.`);
    }
    if (normalizedType === 'OIL') return 'Oil';
    if (normalizedType === 'PURE_OIL') return '3ml Oil';

    const value = rawCategory.trim();
    const regularAliases = ['men', 'male', 'women', 'woman', 'female', 'unisex', 'kids', 'kid'];
    if (regularAliases.includes(value.toLowerCase())) return 'Perfume';
    const match = await db.prepare('SELECT category FROM category_settings WHERE lower(category) = lower(?)').get(value) as { category: string } | undefined;
    if (match) return match.category;
    throw new Error(`Unknown category "${rawCategory}". Create it in admin Category settings first.`);
  };

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
      productType: excelProductTypeForCategory(String(p.category ?? 'Perfume')),
      brand: (p.brand as string) ?? '',
      price: typeof p.price === 'number' ? p.price : 0,
      gender: (p.gender as string) ?? '',
      category: excelCategoryForProduct(String(p.category ?? 'Perfume'), String(p.gender ?? 'Unisex')),
      stockStatus: normalizeStockStatus(p.stockStatus as string | undefined) === 'Out Stock' ? 'Out of Stock' : normalizeStockStatus(p.stockStatus as string | undefined),
      stockStatus1: p.stockStatus1 ? (normalizeStockStatus(p.stockStatus1 as string) === 'Out Stock' ? 'Out of Stock' : normalizeStockStatus(p.stockStatus1 as string)) : '',
      stockStatus2: p.stockStatus2 ? (normalizeStockStatus(p.stockStatus2 as string) === 'Out Stock' ? 'Out of Stock' : normalizeStockStatus(p.stockStatus2 as string)) : '',
      description: (p.description as string) ?? '',
      rating: typeof p.rating === 'number' ? p.rating : '',
      accords: accords
        .filter(accord => accord && typeof accord.name === 'string')
        .map(accord => `${accord.name}:${typeof accord.value === 'number' ? accord.value : 75}${typeof accord.customColor === 'string' ? `:${accord.customColor}` : ''}`)
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
      pricePerGram: typeof p.pricePerGram === 'number' ? p.pricePerGram : '',
      unit: typeof p.unit === 'string' ? p.unit : '',
      sizePrice1: typeof p.sizePrice1 === 'number' ? p.sizePrice1 : '',
      sizePrice2: typeof p.sizePrice2 === 'number' ? p.sizePrice2 : '',
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
      productType: 'PERFUME',
      brand: 'Our Fragrance',
      price: 2500,
      gender: 'Unisex',
      category: 'Unisex',
      stockStatus: 'In Stock',
      stockStatus1: 'In Stock',
      stockStatus2: 'Low Stock',
      description: 'A warm amber fragrance with a woody base.',
      rating: 4.5,
      accords: 'Amber:80:#d99e4c | Woody:65:#a16207',
      fragranceProfile: 'longevity=8H | projection=Moderate | sillage=Moderate',
      dayNight: 'Both',
      seasons: 'Autumn | Winter',
      'notes.top': 'Bergamot | Pink Pepper',
      'notes.middle': 'Rose',
      'notes.base': 'Sandalwood | Vanilla',
      pricePerGram: '',
      unit: 'ml',
      sizePrice1: 2500,
      sizePrice2: 4500,
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
      ['productType', 'no', 'PERFUME, OIL, or PURE_OIL. OIL products import into Oil; PURE_OIL products import into 3ml Oil. Defaults from category.'],
      ['brand', 'no', 'Brand name. New regular perfumes default to "Our Fragrance".'],
      ['price', 'no', 'Whole number in ETB (e.g. 2500). Defaults to 0.'],
      ['pricePerGram', 'no', 'For products in gram-based categories, the product price per gram in ETB. The catalog multiplies this by the selected gram size.'],
      ['unit', 'no', 'Product-specific size unit: ml or gram. If omitted, the category unit is used.'],
      ['sizePrice1 / sizePrice2', 'no', 'Product-specific prices for the category’s first and second configured sizes when unit is ml.'],
      ['gender', 'no', 'Male, Female, Kids or Unisex. Defaults to Unisex (spelling is case-insensitive).'],
      ['category', 'no', 'Any category configured in Admin > Catalog Images. Defaults to Perfume; unknown categories are rejected.'],
      ['category mapping', '-', 'Men, Women, Unisex, or Kids maps to the Regular (Perfume) catalog category. Brand Perfume and Luxury Perfume stay as selected.'],
      ['stockStatus', 'no', 'In Stock, Low Stock or Out Stock. Defaults to In Stock.'],
      ['stockStatus1 / stockStatus2', 'no', 'Optional stock status for the category’s first and second configured sizes. When blank, the product stockStatus is used.'],
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
      const rows = await db.prepare('SELECT * FROM perfumes ORDER BY created_at DESC').all() as Record<string, unknown>[];
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
      (await db.prepare('SELECT name, color FROM accord_colors').all() as { name: string; color: string }[])
        .forEach(row => accordColors.set(row.name.toLowerCase(), row.color));

      const parseAccords = (raw: string): { name: string; value: number; color: string }[] =>
        splitExcelList(raw)
          .map(part => {
            const [rawName, rawValue, ...rawColor] = part.split(':');
            const name = rawName.trim();
            const value = rawValue === undefined ? NaN : Number(rawValue);
            const color = rawColor.join(':').trim();
            const customColor = /^#[\da-f]{6}$/i.test(color) ? color : undefined;
            return {
              name,
              value: Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 75,
              color: customColor ?? accordColors.get(name.toLowerCase()) ?? '#666666',
              ...(customColor ? { customColor } : {}),
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
      (await db.prepare('SELECT id, code FROM perfumes').all() as { id: string; code: string | null }[]).forEach(row => {
        knownIds.add(row.id);
        if (row.code) codeToId.set(row.code, row.id);
      });

      const client = await pool.connect();
      const txDb = {
        prepare(sql: string) {
          const statement = toPostgresPlaceholders(sql);
          return {
            all: async (...values: unknown[]) => (await client.query(statement, values)).rows.map(normalizeDatabaseRow),
            get: async (...values: unknown[]) => {
              const result = await client.query(statement, values);
              return result.rows[0] ? normalizeDatabaseRow(result.rows[0]) : undefined;
            },
            run: async (...values: unknown[]) => client.query(statement, values),
          };
        },
      };
      const insertStmt = txDb.prepare(`
        INSERT INTO perfumes (
          id, name, code, brand, price, unit, sizePrice1, sizePrice2, pricePerGram, gender, category, stockStatus, stockStatus1, stockStatus2, description, rating,
          mainImage, miniImage, galleryImages, accords, fragranceProfile, dayNight, seasons, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let created = 0;
      let updated = 0;
      let skipped = 0;
      let generatedSequence = 0;
      const errors: { row: number; message: string }[] = [];

      await client.query('BEGIN');
      try {
        for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
          const row = sheet.getRow(rowNumber);
          if (row.cellCount === 0) continue;
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
            const pricePerGramRaw = cellText(row, 'pricePerGram');
            if (pricePerGramRaw !== '') {
              const pricePerGram = Number(pricePerGramRaw.replace(/[,\s]/g, ''));
              if (!Number.isFinite(pricePerGram) || pricePerGram < 0) {
                throw new Error(`Price per gram "${pricePerGramRaw}" must be a non-negative number`);
              }
              fields.pricePerGram = pricePerGram;
            }
            const unitRaw = cellText(row, 'unit');
            if (unitRaw) {
              const unit = unitRaw.trim().toLowerCase();
              if (unit !== 'ml' && unit !== 'gram') throw new Error(`Unknown unit "${unitRaw}". Use ml or gram.`);
              fields.unit = unit;
            }
            for (const [column, header] of [['sizePrice1', 'sizePrice1'], ['sizePrice2', 'sizePrice2']] as const) {
              const raw = cellText(row, header);
              if (raw === '') continue;
              const price = Number(raw.replace(/[,\s]/g, ''));
              if (!Number.isFinite(price) || price < 0) {
                throw new Error(`${header} must be a non-negative number`);
              }
              fields[column] = price;
            }
            const gender = cellText(row, 'gender');
            if (gender) fields.gender = matchExcelEnum(gender, EXCEL_GENDERS, 'Unisex');
            const category = cellText(row, 'category');
            const productType = cellText(row, 'productType');
            if (productType && !EXCEL_PRODUCT_TYPES.includes(productType.trim().toUpperCase())) {
              throw new Error(`Unknown productType "${productType}". Use PERFUME, OIL, or PURE_OIL.`);
            }
            if (category || productType) {
              fields.category = await normalizeExcelProductCategory(
                category || (productType.trim().toUpperCase() === 'OIL'
                  ? 'Oil'
                  : productType.trim().toUpperCase() === 'PURE_OIL' ? '3ml Oil' : 'Perfume'),
                productType
              );
            }
            const stockStatus = cellText(row, 'stockStatus');
            if (stockStatus) {
              const normalizedStockStatus = stockStatus.trim().toLowerCase() === 'out of stock'
                ? 'Out Stock'
                : matchExcelEnum(stockStatus, EXCEL_STOCK_STATUSES, 'In Stock');
              fields.stockStatus = normalizedStockStatus;
            }
            for (const key of ['stockStatus1', 'stockStatus2'] as const) {
              const rawStatus = cellText(row, key);
              if (!rawStatus) continue;
              const normalizedStatus = rawStatus.trim().toLowerCase() === 'out of stock'
                ? 'Out Stock'
                : matchExcelEnum(rawStatus, EXCEL_STOCK_STATUSES, '');
              if (!normalizedStatus) {
                throw new Error(`${key} must be In Stock, Low Stock, or Out Stock`);
              }
              fields[key] = normalizedStatus;
            }
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
                const current = await txDb.prepare('SELECT fragranceProfile FROM perfumes WHERE id = ?').get(targetId) as { fragranceProfile: string | null } | undefined;
                const existing = safeJsonParse<Record<string, string>>(current?.fragranceProfile, {});
                fields.fragranceProfile = JSON.stringify({
                  longevity: profileUpdate.longevity ?? existing.longevity ?? '',
                  projection: profileUpdate.projection ?? existing.projection ?? '',
                  sillage: profileUpdate.sillage ?? existing.sillage ?? '',
                });
              }
              if (Object.keys(notesUpdate).length > 0) {
                const current = await txDb.prepare('SELECT notes FROM perfumes WHERE id = ?').get(targetId) as { notes: string | null } | undefined;
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
                await txDb.prepare(`UPDATE perfumes SET ${setKeys.map(key => `${key} = ?`).join(', ')} WHERE id = ?`)
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
                ?? await pickCatalogImage((fields.gender as string) ?? 'Unisex', (fields.category as string) ?? 'Perfume', name)
                ?? DEFAULT_PERFUME_IMAGE;
              const insertedCode = code || `IMP-${Date.now().toString(36)}-${rowNumber}`;
              await insertStmt.run(
                newId,
                name,
                insertedCode,
                (fields.brand as string) ?? 'Our Fragrance',
                (fields.price as number) ?? 0,
                (fields.unit as string) ?? null,
                (fields.sizePrice1 as number) ?? null,
                (fields.sizePrice2 as number) ?? null,
                (fields.pricePerGram as number) ?? null,
                (fields.gender as string) ?? 'Unisex',
                (fields.category as string) ?? 'Perfume',
                (fields.stockStatus as string) ?? 'In Stock',
                (fields.stockStatus1 as string) ?? null,
                (fields.stockStatus2 as string) ?? null,
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
        }
        await client.query('COMMIT');
      } catch (transactionError) {
        await client.query('ROLLBACK');
        throw transactionError;
      } finally {
        client.release();
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
  // in-flight requests, then close the PostgreSQL connection pool.
  const shutdown = (signal: string) => {
    console.log(`${signal} received — shutting down gracefully...`);
    server.close(async () => {
      try {
        await db.close();
        console.log('Database pool closed. Goodbye.');
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
