import { useState, useEffect, useCallback } from 'react';
import { Perfume, MOCK_PERFUMES, Gender, Category } from './data';

export function usePerfumes() {
  const [perfumes, setPerfumes] = useState<Perfume[]>(MOCK_PERFUMES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/perfumes')
      .then(res => res.json())
      .then(data => {
        if (data && data.length > 0) {
          setPerfumes(data);
        } else {
          // Fallback to MOCK_PERFUMES if DB is empty for demo purposes
          setPerfumes(MOCK_PERFUMES);
        }
      })
      .catch(err => {
        console.error('Failed to fetch perfumes:', err);
        setPerfumes(MOCK_PERFUMES);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return { perfumes, loading, setPerfumes };
}

export function useAccordColors() {
  const [colors, setColors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/accord-colors')
      .then(res => res.json())
      .then(data => setColors(data))
      .catch(err => console.error('Failed to fetch accord colors:', err));
  }, []);

  return { colors, setColors };
}

// Admin-specific variant: NEVER falls back to demo data. The admin panel must
// show what is really in the database — otherwise an edit against a demo row
// looks like it saved while nothing was persisted, masking real data loss
// (e.g. a Railway deploy with no persistent volume starts with an empty DB).
export function useAdminPerfumes() {
  const [perfumes, setPerfumes] = useState<Perfume[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbEmpty, setDbEmpty] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(() => {
    fetch('/api/perfumes')
      .then(res => {
        if (!res.ok) throw new Error(`API responded with status ${res.status}`);
        return res.json();
      })
      .then((data: Perfume[]) => {
        const list = Array.isArray(data) ? data : [];
        setPerfumes(list);
        setDbEmpty(list.length === 0);
        setLoadError(false);
      })
      .catch(err => {
        console.error('Failed to fetch perfumes for admin:', err);
        setPerfumes([]);
        setDbEmpty(true);
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { perfumes, setPerfumes, loading, dbEmpty, loadError, reload };
}

// --- Catalog image library -----------------------------------------------------
// Admins upload images into Gender × Category buckets (e.g. Male × Luxury
// Perfume). The catalog substitutes these images for products that still show
// one of the built-in placeholder bottle photos; a product's own uploaded or
// pasted image always wins.

export interface CatalogImage {
  id: string;
  gender: Gender;
  category: Category;
  image: string;
}

export function useCatalogImages() {
  const [images, setImages] = useState<CatalogImage[]>([]);

  const reload = useCallback(() => {
    fetch('/api/catalog-images')
      .then(res => (res.ok ? res.json() : []))
      .then((data: CatalogImage[]) => setImages(Array.isArray(data) ? data : []))
      .catch(err => console.error('Failed to fetch catalog images:', err));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { images, setImages, reload };
}

// The built-in placeholder bottles live under this folder — library images may
// replace them, but a custom upload (data URL) or pasted URL never.
const PLACEHOLDER_IMAGE_PREFIX = '/images/perfumes/';

/** True when an image is empty or one of the built-in placeholder bottle photos. */
export function isPlaceholderCatalogImage(image?: string | null): boolean {
  const value = (image || '').trim();
  return value.length === 0 || value.startsWith(PLACEHOLDER_IMAGE_PREFIX);
}

const catalogImagePool = (library: CatalogImage[], gender?: Gender, category?: Category): string[] =>
  library
    .filter(img => (!gender || img.gender === gender) && (!category || img.category === category))
    .map(img => img.image);

/** Deterministic pick from a pool: the same product always shows the same image. */
const pickFromPool = (pool: string[], seed: string): string =>
  pool[Math.abs(seed.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0)) % pool.length];

/**
 * The image the catalog should display for a perfume:
 * 1. the perfume's own uploaded/pasted image, if it has one;
 * 2. otherwise a library image from its Gender × Category bucket;
 * 3. falling back to any library image of the same category, then same gender,
 *    then the whole library;
 * 4. otherwise whatever the perfume has stored (placeholder bottle or default).
 */
export function resolveCatalogImage(
  perfume: Pick<Perfume, 'gender' | 'category'> & { mainImage?: string | null; code?: string; id?: string },
  library: CatalogImage[]
): string {
  const stored = (perfume.mainImage || '').trim();
  if (!isPlaceholderCatalogImage(stored)) return stored;

  const seed = perfume.code || perfume.id || stored;
  const exact = catalogImagePool(library, perfume.gender, perfume.category);
  if (exact.length > 0) return pickFromPool(exact, seed);
  const sameCategory = catalogImagePool(library, undefined, perfume.category);
  if (sameCategory.length > 0) return pickFromPool(sameCategory, seed);
  const sameGender = catalogImagePool(library, perfume.gender, undefined);
  if (sameGender.length > 0) return pickFromPool(sameGender, seed);
  const any = catalogImagePool(library);
  if (any.length > 0) return pickFromPool(any, seed);
  return stored || '/images/perfumes/normal.jpg';
}
