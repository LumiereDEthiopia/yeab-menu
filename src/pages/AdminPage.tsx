import React, { useEffect, useRef, useState } from 'react';
import { getCatalogSizePrice, getCatalogSizeUnit, useAdminPerfumes, useAccordColors, useCatalogImages, useCatalogSizeImages, useCategorySettings, CatalogImage, CatalogSizeImage, CategorySetting, CategorySettingOption } from '../lib/api';
import { Perfume, Gender, Category, DayNight, Season, StockStatus } from '../lib/data';
import { Plus, Trash, ArrowLeft, Image as ImageIcon, Palette, Edit2, X, Save, Star, FileSpreadsheet, Download, Upload, CircleCheck, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

/** Response shape of POST /api/admin/perfumes/import. */
interface ImportReport {
  success: boolean;
  created: number;
  updated: number;
  skipped: number;
  total: number;
  errors: { row: number; message: string }[];
}

/** Read a File as base64 (without the data-URL prefix) so it can be sent inside the JSON body. */
const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the selected file'));
    reader.readAsDataURL(file);
  });

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('adminToken'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
  const { perfumes, setPerfumes, dbEmpty, loadError, reload: reloadPerfumes } = useAdminPerfumes();
  const { colors, setColors } = useAccordColors();
  const { images: catalogImages, setImages: setCatalogImages } = useCatalogImages();
  const { images: catalogSizeImages, setImages: setCatalogSizeImages } = useCatalogSizeImages();
  const { categories: categorySettings, setCategories: setCategorySettings, reload: reloadCategorySettings, loadError: categorySettingsError } = useCategorySettings();
  
  const [newAccordName, setNewAccordName] = useState('');
  const [newAccordColor, setNewAccordColor] = useState('#000000');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPerfume, setEditingPerfume] = useState<Partial<Perfume> | null>(null);
  const [productImageSize, setProductImageSize] = useState<1 | 2>(1);
  const [isSaving, setIsSaving] = useState(false);
  const [accordDraft, setAccordDraft] = useState({ name: '', value: 75 });

  // --- Excel import / export state ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importFileError, setImportFileError] = useState<string | null>(null);
  const [sharedImage, setSharedImage] = useState<string | null>(null);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);

  // --- Catalog image library state ---
  const [libraryGender, setLibraryGender] = useState<Gender>('Male');
  const [libraryCategory, setLibraryCategory] = useState<Category>('Perfume');
  const [isUploadingLibraryImages, setIsUploadingLibraryImages] = useState(false);
  const [libraryStatus, setLibraryStatus] = useState<string | null>(null);
  const [librarySize, setLibrarySize] = useState<1 | 2>(1);
  const [isSavingSizeImage, setIsSavingSizeImage] = useState(false);
  const [sizeImageStatus, setSizeImageStatus] = useState<string | null>(null);
  const bucketImages = catalogImages.filter(img => img.gender === libraryGender && img.category === libraryCategory);
  const libraryCategorySetting = categorySettings.find(setting => setting.category === libraryCategory);
  const selectedSizeImage = catalogSizeImages.find(image =>
    image.gender === libraryGender && image.category === libraryCategory && image.size === librarySize
  );
  const [selectedCategory, setSelectedCategory] = useState<Category>('Perfume');
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState<CategorySetting>({
    category: 'Perfume',
    unit: 'ml',
    size1: '50',
    size2: '100',
    price1: 0,
    price2: 0,
    image1: null,
    image2: null,
    options: [{ size: '50', price: 0, image: null }, { size: '100', price: 0, image: null }],
  });

  const [noteDrafts, setNoteDrafts] = useState<Record<'top' | 'middle' | 'base', { name: string; iconUrl: string }>>({
    top: { name: '', iconUrl: '' },
    middle: { name: '', iconUrl: '' },
    base: { name: '', iconUrl: '' },
  });

  const initialPerfumeState: Partial<Perfume> = {
    name: '',
    brand: '',
    price: 0,
    unit: 'ml',
    sizePrice1: null,
    sizePrice2: null,
    pricePerGram: null,
    sizeImage1: null,
    sizeImage2: null,
    code: '',
    gender: 'Unisex',
    category: 'Perfume',
    stockStatus: 'In Stock',
    description: '',
    rating: 5,
    mainImage: '/images/perfumes/normal.jpg',
    miniImage: '',
    galleryImages: [],
    accords: [],
    fragranceProfile: { longevity: '8H', projection: 'Moderate', sillage: 'Moderate' },
    dayNight: 'Both',
    seasons: [],
    notes: { top: [], middle: [], base: [] }
  };

  const editingCategorySetting = categorySettings.find(setting => setting.category === editingPerfume?.category);
  const editingProductUnit = editingPerfume?.unit ?? editingCategorySetting?.unit ?? 'ml';
  const getEditingMlPrice = (size: 1 | 2): number => {
    const productPrice = size === 1 ? editingPerfume?.sizePrice1 : editingPerfume?.sizePrice2;
    if (typeof productPrice === 'number') return productPrice;
    const configuredPrice = size === 1 ? editingCategorySetting?.price1 : editingCategorySetting?.price2;
    return configuredPrice && configuredPrice > 0 ? configuredPrice : editingPerfume?.price ?? 0;
  };

  useEffect(() => {
    if (isCreatingCategory) return;
    const selected = categorySettings.find(setting => setting.category === selectedCategory);
    if (selected) setCategoryDraft(selected);
    else if (categorySettings.length > 0) setSelectedCategory(categorySettings[0].category);
  }, [categorySettings, isCreatingCategory, selectedCategory]);

  const getStockBadgeClass = (status?: StockStatus) => {
    if (status === 'Out Stock') return 'bg-red-50 text-red-700 border-red-200';
    if (status === 'Low Stock') return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.token) {
      setToken(data.token);
      localStorage.setItem('adminToken', data.token);
    } else {
      alert('Login failed');
    }
  };

  const handleSaveAccordColor = async () => {
    if (!newAccordName) return;
    try {
      const res = await fetch('/api/admin/accord-colors', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ name: newAccordName, color: newAccordColor })
      });
      
      if (res.status === 401) {
        handleLogout();
        return;
      }

      setColors(prev => ({ ...prev, [newAccordName]: newAccordColor }));
      setNewAccordName('');
    } catch (err) {
      console.error(err);
      alert('Failed to save color');
    }
  };

  const handleDeleteAccordColor = async (name: string) => {
    if (!confirm(`Delete color for "${name}"?`)) return;
    try {
      const res = await fetch(`/api/admin/accord-colors/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.status === 401) {
        handleLogout();
        return;
      }

      setColors(prev => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    } catch (err) {
      console.error(err);
      alert('Failed to delete color');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this perfume?')) return;
    try {
      const res = await fetch(`/api/admin/perfumes/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.status === 401) {
        handleLogout();
        return;
      }

      setPerfumes(perfumes.filter(p => p.id !== id));
    } catch (err) {
      console.error(err);
      alert('Failed to delete');
    }
  };

  const handleLogout = () => {
    setToken(null);
    localStorage.removeItem('adminToken');
  };

  // --- Excel import / export handlers ---

  const downloadAdminFile = async (url: string, filename: string): Promise<boolean> => {
    try {
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.status === 401) {
        handleLogout();
        return false;
      }
      if (!res.ok) {
        alert('Download failed — please try again.');
        return false;
      }
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      return true;
    } catch (err) {
      console.error(err);
      alert('Download failed — please try again.');
      return false;
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await downloadAdminFile(
        '/api/admin/perfumes/export',
        `lumiere-perfumes-${new Date().toISOString().slice(0, 10)}.xlsx`
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadTemplate = async () => {
    await downloadAdminFile('/api/admin/perfumes/import/template', 'lumiere-perfume-import-template.xlsx');
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Capture the file FIRST — clearing the input's value also clears its FileList.
    const file = e.target.files?.[0] ?? null;
    e.target.value = ''; // allow re-picking the same file later: change fires every time
    setImportReport(null);
    if (!file) {
      // Dialog closed without a pick — IMPORT stays disabled.
      setImportFile(null);
      setImportFileError(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      // Not a valid .xlsx workbook — keep IMPORT disabled and explain why.
      setImportFile(null);
      setImportFileError(`"${file.name}" is not an .xlsx workbook. Choose a file with the .xlsx extension.`);
      return;
    }
    // Valid .xlsx — IMPORT enables immediately on the next render.
    setImportFileError(null);
    setImportFile(file);
  };

  // Optional "one image for all": a single picture applied as both the main and
  // the mini image of every product in the import.
  const handleSharedImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readImageFile(file, image => setSharedImage(image));
    e.target.value = ''; // allow re-picking the same file later
  };

  const handleImport = async () => {
    if (!importFile || isImporting) return;
    setIsImporting(true);
    // Safety net: a hung request must never keep the IMPORT button disabled forever.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);
    try {
      const dataBase64 = await fileToBase64(importFile);
      const res = await fetch('/api/admin/perfumes/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ dataBase64, sharedImage: sharedImage ?? undefined }),
        signal: controller.signal
      });

      if (res.status === 401) {
        handleLogout();
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Import failed');
        return;
      }

      setImportReport(data as ImportReport);
      setImportFile(null);
      setImportFileError(null);
      setSharedImage(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      reloadPerfumes();
    } catch (err) {
      console.error(err);
      alert('Import failed — check that the file is a valid .xlsx workbook.');
    } finally {
      clearTimeout(timeoutId);
      setIsImporting(false);
    }
  };

  const openAddModal = () => {
    setEditingPerfume({ ...initialPerfumeState, code: 'P' + Math.floor(1000 + Math.random() * 9000) });
    setProductImageSize(1);
    setIsModalOpen(true);
  };

  const openEditModal = (perfume: Perfume) => {
    setEditingPerfume({ ...perfume });
    setProductImageSize(1);
    setIsModalOpen(true);
  };

  const readImageFile = (file: File, onLoad: (image: string) => void) => {
    const reader = new FileReader();
    reader.onload = () => onLoad(String(reader.result));
    reader.readAsDataURL(file);
  };

  // --- Catalog image library handlers ---

  const readImageFileAsync = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('Could not read the selected file'));
      reader.readAsDataURL(file);
    });

  const handleLibraryFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow re-picking the same files later
    if (files.length === 0 || isUploadingLibraryImages) return;
    setIsUploadingLibraryImages(true);
    setLibraryStatus(`Uploading 1 of ${files.length}…`);
    let added = 0;
    let failed = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        setLibraryStatus(`Uploading ${i + 1} of ${files.length}…`);
        try {
          const image = await readImageFileAsync(files[i]);
          const res = await fetch('/api/admin/catalog-images', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ gender: libraryGender, category: libraryCategory, image })
          });

          if (res.status === 401) {
            handleLogout();
            return;
          }

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || `Failed to upload "${files[i].name}"`);
            failed += 1;
            continue;
          }

          const data = await res.json();
          setCatalogImages((prev: CatalogImage[]) => [...prev, { id: data.id, gender: libraryGender, category: libraryCategory, image }]);
          added += 1;
        } catch (fileErr) {
          console.error(fileErr);
          failed += 1;
        }
      }
    } finally {
      setIsUploadingLibraryImages(false);
      if (added > 0) {
        setLibraryStatus(`Added ${added} image${added === 1 ? '' : 's'} to ${libraryGender} × ${libraryCategory}${failed > 0 ? ` — ${failed} failed` : ''}.`);
        setTimeout(() => setLibraryStatus(null), 4000);
      } else {
        setLibraryStatus(null);
      }
    }
  };

  const handleLibrarySizeImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || isSavingSizeImage) return;
    setIsSavingSizeImage(true);
    setSizeImageStatus('Saving image…');
    try {
      const image = await readImageFileAsync(file);
      const response = await fetch('/api/admin/catalog-size-images', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          gender: libraryGender,
          category: libraryCategory,
          size: librarySize,
          image,
        }),
      });
      if (response.status === 401) {
        handleLogout();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to save size image');
      const saved: CatalogSizeImage = {
        gender: libraryGender,
        category: libraryCategory,
        size: librarySize,
        image,
      };
      setCatalogSizeImages(previous => [
        ...previous.filter(item => !(item.gender === saved.gender && item.category === saved.category && item.size === saved.size)),
        saved,
      ]);
      setSizeImageStatus(`Saved ${libraryGender} ${libraryCategory} ${librarySize === 1 ? libraryCategorySetting?.size1 : libraryCategorySetting?.size2}${libraryCategorySetting?.unit} image.`);
    } catch (err) {
      console.error(err);
      setSizeImageStatus(err instanceof Error ? err.message : 'Failed to save size image.');
    } finally {
      setIsSavingSizeImage(false);
      setTimeout(() => setSizeImageStatus(null), 4000);
    }
  };

  const handleRemoveLibrarySizeImage = async () => {
    if (!selectedSizeImage || isSavingSizeImage) return;
    setIsSavingSizeImage(true);
    try {
      const response = await fetch('/api/admin/catalog-size-images', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          gender: libraryGender,
          category: libraryCategory,
          size: librarySize,
          image: null,
        }),
      });
      if (response.status === 401) {
        handleLogout();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to remove size image');
      setCatalogSizeImages(previous => previous.filter(item =>
        !(item.gender === libraryGender && item.category === libraryCategory && item.size === librarySize)
      ));
      setSizeImageStatus('Size-specific image removed.');
    } catch (err) {
      console.error(err);
      setSizeImageStatus(err instanceof Error ? err.message : 'Failed to remove size image.');
    } finally {
      setIsSavingSizeImage(false);
      setTimeout(() => setSizeImageStatus(null), 4000);
    }
  };

  const handleDeleteCatalogImage = async (id: string) => {
    if (!confirm('Remove this image from the library?')) return;
    try {
      const res = await fetch(`/api/admin/catalog-images/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.status === 401) {
        handleLogout();
        return;
      }

      if (!res.ok) {
        alert('Failed to delete image');
        return;
      }

      setCatalogImages(prev => prev.filter(img => img.id !== id));
    } catch (err) {
      console.error(err);
      alert('Failed to delete image');
    }
  };

  const handleApplyCatalogImages = async () => {
    if (bucketImages.length === 0) {
      alert('This Gender/Category bucket has no images yet — add some first.');
      return;
    }
    if (!confirm(`Apply these ${bucketImages.length} image(s) to EVERY ${libraryGender} × ${libraryCategory} product?\n\nEach product's main and mini image will be replaced by a picture from this bucket.`)) return;
    try {
      const res = await fetch('/api/admin/catalog-images/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ gender: libraryGender, category: libraryCategory })
      });

      if (res.status === 401) {
        handleLogout();
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to apply images');
        return;
      }

      alert(`Done — ${data.updated} product(s) in ${libraryGender} × ${libraryCategory} now use these images.`);
      reloadPerfumes();
    } catch (err) {
      console.error(err);
      alert('An error occurred while applying images.');
    }
  };

  const startNewCategory = () => {
    setIsCreatingCategory(true);
    setCategoryDraft({
      category: '',
      unit: 'ml',
      size1: '1',
      size2: '2',
      price1: 0,
      price2: 0,
      image1: null,
      image2: null,
      options: [{ size: '1', price: 0, image: null }],
    });
  };

  const updateCategoryOption = (optionIndex: number, updates: Partial<CategorySettingOption>) => {
    setCategoryDraft(previous => {
      const options = previous.options.map((option, index) =>
        index === optionIndex ? { ...option, ...updates } : option
      );
      const updated = options[optionIndex];
      const secondSize = options[1]?.size
        ?? (Number(options[0]?.size) === Number(previous.size2)
          ? String(Number(options[0]?.size) + 1)
          : previous.size2);
      const legacyFields = optionIndex === 0
        ? { size1: updated.size, price1: updated.price, image1: updated.image, ...(!options[1] ? { size2: secondSize } : {}) }
        : optionIndex === 1
          ? { size2: updated.size, price2: updated.price, image2: updated.image }
          : {};
      return { ...previous, ...legacyFields, options };
    });
  };

  const addCategoryOption = () => {
    setCategoryDraft(previous => {
      const numericSizes = previous.options.map(option => Number(option.size)).filter(Number.isFinite);
      const newOption: CategorySettingOption = {
        size: String(Math.max(0, ...numericSizes) + 1),
        price: 0,
        image: null,
      };
      const options = [...previous.options, newOption];
      const legacyFields = options.length === 2
        ? { size2: newOption.size, price2: newOption.price, image2: newOption.image }
        : {};
      return { ...previous, ...legacyFields, options };
    });
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingCategory) return;
    const category = categoryDraft.category.trim();
    if (!category) {
      alert('Enter a category name.');
      return;
    }
    setIsSavingCategory(true);
    try {
      const response = await fetch(
        isCreatingCategory
          ? '/api/admin/category-settings'
          : `/api/admin/category-settings/${encodeURIComponent(selectedCategory)}`,
        {
          method: isCreatingCategory ? 'POST' : 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ ...categoryDraft, category }),
        }
      );
      if (response.status === 401) {
        handleLogout();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(data.error || 'Failed to save category settings.');
        return;
      }
      const savedCategory = { ...categoryDraft, category };
      setCategorySettings(previous => isCreatingCategory
        ? [...previous, savedCategory].sort((a, b) => a.category.localeCompare(b.category))
        : previous.map(setting => setting.category === selectedCategory ? savedCategory : setting));
      setSelectedCategory(category);
      setLibraryCategory(category);
      setIsCreatingCategory(false);
      await reloadCategorySettings();
    } catch (err) {
      console.error(err);
      alert('An error occurred while saving category settings.');
    } finally {
      setIsSavingCategory(false);
    }
  };

  const addAccordToEditingPerfume = () => {
    const name = accordDraft.name.trim();
    if (!name || !editingPerfume) return;
    const accord = { name, value: accordDraft.value, color: colors[name] || '#666666' };
    setEditingPerfume({ ...editingPerfume, accords: [...(editingPerfume.accords || []), accord] });
    setAccordDraft({ name: '', value: 75 });
  };

  const addNoteToEditingPerfume = (tier: 'top' | 'middle' | 'base') => {
    const draft = noteDrafts[tier];
    if (!draft.name.trim() || !draft.iconUrl.trim() || !editingPerfume) return;
    const nextNotes = { ...editingPerfume.notes! };
    nextNotes[tier] = [...(nextNotes[tier] || []), { name: draft.name.trim(), iconUrl: draft.iconUrl.trim() }];
    setEditingPerfume({ ...editingPerfume, notes: nextNotes });
    setNoteDrafts({ ...noteDrafts, [tier]: { name: '', iconUrl: '' } });
  };

  const handleSavePerfume = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPerfume) return;

    setIsSaving(true);
    try {
      const isNew = !editingPerfume.id;
      const url = isNew ? '/api/admin/perfumes' : `/api/admin/perfumes/${editingPerfume.id}`;
      const method = isNew ? 'POST' : 'PUT';
      const productToSave: Partial<Perfume> = {
        ...editingPerfume,
        unit: editingProductUnit,
        // Size prices are saved ONLY when explicitly set on the product (the
        // size price inputs above write straight to editingPerfume). We never
        // freeze the display fallback here: doing so used to pin both sizes to
        // the same base price on every save, and product-level prices override
        // the category settings — so the customer card could no longer change
        // its price when the user switched ml on the card. Untouched fields
        // stay null and the category's configured price drives the catalog.
      };

      const res = await fetch(url, {
        method,
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(productToSave)
      });

      if (res.status === 401) {
        handleLogout();
        return;
      }

      if (res.ok) {
        if (isNew) {
          // The server may resolve the main image from the catalog image
          // library — reload so the list shows what was really stored.
          reloadPerfumes();
        } else {
          setPerfumes(prev => prev.map(p => p.id === editingPerfume.id ? (productToSave as Perfume) : p));
        }
        setIsModalOpen(false);
        setEditingPerfume(null);
      } else {
        alert('Failed to save perfume');
      }
    } catch (err) {
      console.error(err);
      alert('An error occurred');
    } finally {
      setIsSaving(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-paper)] p-4">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-[2rem] shadow-xl w-full max-w-md border border-gray-100">
          <div className="text-center mb-8">
            <h1 className="text-4xl text-[#2f3b49] luxury-text font-bold uppercase tracking-widest mb-2">Lumiere</h1>
            <p className="text-xs uppercase tracking-[0.2em] text-gray-400 font-bold">Admin Portal</p>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Username</label>
              <input 
                type="text" 
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-black"
                value={username} onChange={e => setUsername(e.target.value)}
                placeholder="admin"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Password</label>
              <input 
                type="password" 
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 outline-none focus:border-black"
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="admin"
              />
            </div>
            <button className="w-full bg-black text-white rounded-xl py-4 font-bold tracking-widest uppercase mt-4 hover:bg-gray-800 transition-colors">
              Login
            </button>
            <div className="text-center mt-4">
               <Link to="/" className="text-sm font-medium text-gray-400 hover:text-black transition-colors underline underline-offset-4">Back to Menu</Link>
            </div>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-paper)] flex flex-col">
      <header className="bg-white border-b border-gray-200 flex items-center justify-between px-8 py-4 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-4">
          <Link to="/" className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center hover:bg-gray-100 transition-colors border border-gray-200">
             <ArrowLeft size={18} className="text-gray-600" />
          </Link>
          <h1 className="text-2xl text-[var(--color-dark)] luxury-text font-bold">Lumiere Admin</h1>
        </div>
        <button onClick={handleLogout} className="text-sm font-bold text-gray-500 hover:text-red-600 transition-colors">LOGOUT</button>
      </header>

      <main className="flex-1 p-8 max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          
          {/* Accord Management Section */}
          <div className="xl:col-span-1 border-r border-gray-200 pr-8">
            <div className="flex items-center gap-3 mb-6">
              <Palette className="text-[var(--color-gold)]" size={24} />
              <h2 className="text-2xl luxury-text font-bold text-gray-900">Main Accords</h2>
            </div>
            
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 mb-8">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Accord Name</label>
                  <input 
                    type="text" 
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 outline-none focus:border-black"
                    value={newAccordName}
                    onChange={e => setNewAccordName(e.target.value)}
                    placeholder="e.g. Woody"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Color</label>
                  <div className="flex gap-2">
                    <input 
                      type="color" 
                      className="w-12 h-10 p-1 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer"
                      value={newAccordColor}
                      onChange={e => setNewAccordColor(e.target.value)}
                    />
                    <input 
                      type="text" 
                      className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 outline-none focus:border-black"
                      value={newAccordColor}
                      onChange={e => setNewAccordColor(e.target.value)}
                    />
                  </div>
                </div>
                <button 
                  onClick={handleSaveAccordColor}
                  className="w-full bg-[var(--color-gold)] text-white rounded-xl py-3 font-bold tracking-widest uppercase hover:opacity-90 transition-opacity"
                >
                  Save Color
                </button>
              </div>
            </div>

            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest pl-2">Accord Colors</p>
              {Object.entries(colors).map(([name, color]) => (
                <div key={name} className="flex items-center justify-between bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg shadow-inner" style={{ backgroundColor: color }} />
                    <span className="font-semibold text-gray-700">{name}</span>
                  </div>
                  <div className="flex items-center gap-3 uppercase">
                    <span className="text-[10px] font-mono text-gray-400">{color}</span>
                    <button 
                      onClick={() => handleDeleteAccordColor(name)}
                      className="text-gray-300 hover:text-red-500 transition-colors"
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                </div>
              ))}
              {Object.keys(colors).length === 0 && (
                <p className="text-sm text-gray-400 italic pl-2">No custom colors saved.</p>
              )}
            </div>
          </div>

          {/* Perfume Management Section */}
          <div className="xl:col-span-2">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-3xl luxury-text font-bold text-gray-900">Manage Perfumes</h2>
              <button 
                onClick={openAddModal}
                className="flex items-center gap-2 bg-black text-white px-6 py-3 rounded-full font-bold text-sm tracking-widest uppercase hover:bg-gray-800 shadow-lg shadow-black/20 hover:shadow-black/40 transition-all hover:-translate-y-0.5"
              >
                 <Plus size={16} /> Add Perfume
              </button>
            </div>

            <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl mb-8 flex items-start gap-4">
               <ImageIcon className="mt-0.5 flex-shrink-0" />
               <p className="text-sm font-medium">Manage your collection here. You can add new perfumes, edit existing details, or remove scents from the catalog.</p>
            </div>

            {(dbEmpty || loadError) && (
              <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-xl mb-8 flex items-start gap-4">
                <Trash className="mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-bold mb-1">
                    {loadError ? 'Cannot reach the server API.' : 'Your database currently has no saved perfumes.'}
                  </p>
                  <p>
                    {loadError
                      ? 'Check that the server is running, then reload this page.'
                      : 'If perfumes you added earlier disappeared after a Railway deploy, the deployment has no persistent volume — the database file is wiped on every redeploy. Fix: in Railway, open your service → Volumes → + New Volume, set the mount path to /data, then redeploy. Everything you save afterwards survives future deploys. (Any list you saw right after a deploy was demo data, not database content.)'}
                  </p>
                </div>
              </div>
            )}

            {/* Excel Import / Export Section */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 mb-8">
              <div className="flex items-center gap-3 mb-3">
                <FileSpreadsheet size={24} className="text-[var(--color-gold)]" />
                <h3 className="text-xl luxury-text font-bold text-gray-900">Excel Import & Export</h3>
              </div>
              <p className="text-sm text-gray-500 mb-5 max-w-3xl">
                Manage the whole catalog from a spreadsheet — every Edit Perfume field except images. Export every product
                to .xlsx, edit prices, stock and details in Excel, then import the file back: rows are matched by id or
                code and updated, unknown rows are added as new products, and empty cells never overwrite existing values.
                For images, optionally pick one image below — it is applied to every product in the file as both the main
                and the mini image.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="flex items-center gap-2 bg-gray-50 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-gray-100 transition-colors"
                  title="Download an empty .xlsx template with a guide sheet"
                >
                  <Download size={14} /> Template
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={isExporting}
                  className="flex items-center gap-2 bg-gray-50 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-gray-100 transition-colors disabled:opacity-50"
                  title="Download every product as .xlsx"
                >
                  <Download size={14} /> {isExporting ? 'Exporting…' : 'Export Catalog'}
                </button>
                <label
                  className="flex cursor-pointer items-center gap-2 bg-gray-50 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-gray-100 transition-colors max-w-[240px]"
                  title="Choose an .xlsx file to import"
                >
                  <FileSpreadsheet size={14} />
                  <span className="truncate">{importFile ? importFile.name : 'Choose .xlsx'}</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={handleImportFileChange}
                  />
                </label>
                <label
                  className="flex cursor-pointer items-center gap-2 bg-gray-50 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-gray-100 transition-colors max-w-[240px]"
                  title="Optional: pick one image to apply to every product in the import (used as both the main and the mini image)"
                >
                  {sharedImage ? <img src={sharedImage} alt="" className="h-5 w-5 rounded-md object-cover" /> : <ImageIcon size={14} />}
                  <span className="truncate">{sharedImage ? 'Image for all ✓' : 'One image for all'}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleSharedImageChange} />
                </label>
                {sharedImage && (
                  <button
                    type="button"
                    onClick={() => setSharedImage(null)}
                    className="flex items-center justify-center rounded-xl border border-gray-200 bg-gray-50 p-2.5 text-gray-400 hover:text-red-500 transition-colors"
                    title="Remove the shared image"
                  >
                    <X size={14} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={!importFile || isImporting}
                  className="flex items-center gap-2 bg-black text-white px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Import the chosen .xlsx file"
                >
                  <Upload size={14} /> {isImporting ? 'Importing…' : 'Import'}
                </button>
              </div>

              {importFileError && (
                <p className="mt-3 text-sm font-medium text-red-600">{importFileError}</p>
              )}

              {importReport && (
                <div className={cn(
                  'mt-5 rounded-xl border p-4 text-sm',
                  importReport.errors.length > 0
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                )}>
                  <p className="font-bold mb-1 flex items-center gap-2">
                    {importReport.errors.length > 0 ? <TriangleAlert size={15} /> : <CircleCheck size={15} />}
                    Import finished — {importReport.created} added, {importReport.updated} updated
                    {importReport.skipped > 0 ? `, ${importReport.skipped} skipped` : ''}.
                  </p>
                  {importReport.errors.length > 0 && (
                    <>
                      <ul className="list-disc pl-6 space-y-0.5 text-xs">
                        {importReport.errors.slice(0, 10).map(err => (
                          <li key={`${err.row}-${err.message}`}>Row {err.row}: {err.message}</li>
                        ))}
                      </ul>
                      {importReport.errors.length > 10 && (
                        <p className="text-xs mt-1">…and {importReport.errors.length - 10} more.</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Catalog Image Library Section */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 mb-8">
              <div className="flex items-center gap-3 mb-3">
                <ImageIcon size={24} className="text-[var(--color-gold)]" />
                <h3 className="text-xl luxury-text font-bold text-gray-900">Catalog Images</h3>
              </div>
              <p className="text-sm text-gray-500 mb-5 max-w-3xl">
                Create categories and set size options, prices, and optional images for each. Use the image library below to upload additional photos by
                gender and category; products can also use the category's size-specific images in the catalog.
              </p>

              <form onSubmit={handleSaveCategory} className="mb-6 rounded-2xl border border-gray-100 bg-gray-50 p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-gray-900">Category sizes, prices & images</h4>
                    <p className="text-xs text-gray-500">Add one or more size options with a price and optional image for each.</p>
                  </div>
                  <button
                    type="button"
                    onClick={startNewCategory}
                    className="flex items-center gap-2 rounded-xl bg-black px-4 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-gray-800"
                  >
                    <Plus size={14} /> New Category
                  </button>
                </div>

                {categorySettingsError && (
                  <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    Could not load categories. Refresh the page and try again.
                  </p>
                )}

                {!isCreatingCategory && (
                  <div className="mb-4">
                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-gray-400">Category</label>
                    <select
                      value={selectedCategory}
                      onChange={event => {
                        const selected = categorySettings.find(setting => setting.category === event.target.value);
                        if (selected) {
                          setSelectedCategory(selected.category);
                          setCategoryDraft(selected);
                          setLibraryCategory(selected.category);
                        }
                      }}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                    >
                      {categorySettings.map(setting => <option key={setting.category} value={setting.category}>{setting.category}</option>)}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {isCreatingCategory && (
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      New category name
                      <input
                        required
                        maxLength={60}
                        value={categoryDraft.category}
                        onChange={event => setCategoryDraft({ ...categoryDraft, category: event.target.value })}
                        placeholder="e.g. Body Spray"
                        className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-gray-800"
                      />
                    </label>
                  )}
                  <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Unit
                    <select
                      value={categoryDraft.unit}
                      onChange={event => setCategoryDraft({ ...categoryDraft, unit: event.target.value as CategorySetting['unit'] })}
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-gray-800"
                    >
                      <option value="ml">ml</option>
                      <option value="gram">gram</option>
                    </select>
                  </label>
                  {categoryDraft.options.map((option, optionIndex) => {
                    return (
                      <div key={optionIndex} className="rounded-xl border border-gray-200 bg-white p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Option {optionIndex + 1}</p>
                          {(isCreatingCategory ? optionIndex > 0 : optionIndex > 1) && (
                            <button
                              type="button"
                              aria-label={`Remove option ${optionIndex + 1}`}
                              onClick={() => setCategoryDraft(previous => ({
                                ...previous,
                                options: previous.options.filter((_, index) => index !== optionIndex),
                              }))}
                              className="rounded-lg p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash size={14} />
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                            Size ({categoryDraft.unit})
                            <input
                              required
                              type="number"
                              min="0.01"
                              step="any"
                              value={option.size}
                              onChange={event => updateCategoryOption(optionIndex, { size: event.target.value })}
                              className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm font-medium normal-case tracking-normal text-gray-800"
                            />
                          </label>
                          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                            Price (ETB)
                            <input
                              required
                              type="number"
                              min="0"
                              step="1"
                              value={option.price}
                              onChange={event => updateCategoryOption(optionIndex, { price: Number(event.target.value) || 0 })}
                              className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm font-medium normal-case tracking-normal text-gray-800"
                            />
                          </label>
                        </div>
                        <input
                          aria-label={`Image for option ${optionIndex + 1}`}
                          value={option.image || ''}
                          onChange={event => updateCategoryOption(optionIndex, { image: event.target.value || null })}
                          placeholder="Image URL (optional)"
                          className="mt-2 w-full rounded-lg border border-gray-200 px-2 py-2 text-xs text-gray-700"
                        />
                        <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:border-black hover:text-black">
                          <ImageIcon size={13} /> Upload size image
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={event => {
                              const file = event.target.files?.[0];
                              if (file) readImageFile(file, image => updateCategoryOption(optionIndex, { image }));
                              event.target.value = '';
                            }}
                          />
                        </label>
                        {option.image && (
                          <img src={option.image} alt={`Option ${optionIndex + 1} preview`} className="mt-2 h-20 w-full rounded-lg bg-gray-50 object-contain" />
                        )}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={addCategoryOption}
                    className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-white p-3 text-xs font-bold uppercase tracking-widest text-gray-500 transition-colors hover:border-black hover:text-black"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100">
                      <Plus size={18} />
                    </span>
                    Add option
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={isSavingCategory}
                    className="rounded-xl bg-black px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-white hover:bg-gray-800 disabled:opacity-50"
                  >
                    {isSavingCategory ? 'Saving…' : isCreatingCategory ? 'Create Category' : 'Save Category'}
                  </button>
                  {isCreatingCategory && (
                    <button type="button" onClick={() => setIsCreatingCategory(false)} className="text-xs font-bold text-gray-500 hover:text-black">
                      Cancel
                    </button>
                  )}
                </div>
              </form>

              <div className="flex flex-wrap items-end gap-4 mb-4">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Gender</p>
                  <div className="flex bg-gray-50 p-1 rounded-xl gap-1">
                    {(['Male', 'Female', 'Kids', 'Unisex'] as Gender[]).map(gender => (
                      <button
                        key={gender}
                        type="button"
                        onClick={() => setLibraryGender(gender)}
                        className={cn(
                          'px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all',
                          libraryGender === gender ? 'bg-black text-white shadow' : 'text-gray-500 hover:text-black'
                        )}
                      >
                        {gender}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Size image · ml or gram</p>
                  <div className="flex bg-gray-50 p-1 rounded-xl gap-1">
                    {([1, 2] as const).map(size => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setLibrarySize(size)}
                        className={cn(
                          'px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all',
                          librarySize === size ? 'bg-black text-white shadow' : 'text-gray-500 hover:text-black'
                        )}
                      >
                        {size === 1 ? libraryCategorySetting?.size1 : libraryCategorySetting?.size2} {libraryCategorySetting?.unit}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Category</p>
                  <div className="flex flex-wrap bg-gray-50 p-1 rounded-xl gap-1">
                    {categorySettings.map(({ category: value }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setLibraryCategory(value)}
                        className={cn(
                          'px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all',
                          libraryCategory === value ? 'bg-black text-white shadow' : 'text-gray-500 hover:text-black'
                        )}
                      >
                        {value === 'Perfume' ? 'Regular' : value.replace(' Perfume', '')}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
                <label className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-gray-700 hover:bg-gray-100',
                  (isSavingSizeImage || !libraryCategorySetting) && 'pointer-events-none opacity-50'
                )}>
                  <ImageIcon size={14} />
                  {isSavingSizeImage ? 'Saving…' : `Set ${librarySize === 1 ? libraryCategorySetting?.size1 : libraryCategorySetting?.size2} ${libraryCategorySetting?.unit} image`}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleLibrarySizeImageChange}
                    disabled={isSavingSizeImage || !libraryCategorySetting}
                  />
                </label>
                {selectedSizeImage ? (
                  <>
                    <img src={selectedSizeImage.image} alt={`${libraryGender} ${libraryCategory} size ${librarySize}`} className="h-12 w-12 rounded-lg border border-gray-200 bg-white object-contain" />
                    <button
                      type="button"
                      onClick={handleRemoveLibrarySizeImage}
                      disabled={isSavingSizeImage}
                      className="text-xs font-bold text-red-600 hover:text-red-800 disabled:opacity-50"
                    >
                      Remove size image
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-gray-500">No image set for {libraryGender} · {libraryCategory} · {librarySize === 1 ? libraryCategorySetting?.size1 : libraryCategorySetting?.size2} {libraryCategorySetting?.unit === 'gram' ? 'gram' : 'ml'}. The category default or product image will be used.</span>
                )}
                {sizeImageStatus && <span role="status" className="text-xs font-bold text-emerald-700">{sizeImageStatus}</span>}
              </div>

              <div className="flex flex-wrap items-center gap-3 mb-4">
                <label
                  className={cn(
                    'flex cursor-pointer items-center gap-2 bg-gray-50 border border-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-gray-100 transition-colors',
                    isUploadingLibraryImages && 'opacity-50 pointer-events-none'
                  )}
                  title={`Upload one or more pictures to the ${libraryGender} × ${libraryCategory} bucket`}
                >
                  <Upload size={14} />
                  {isUploadingLibraryImages ? 'Uploading…' : 'Add Images'}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleLibraryFilesChange}
                    disabled={isUploadingLibraryImages}
                  />
                </label>
                <button
                  type="button"
                  onClick={handleApplyCatalogImages}
                  disabled={isUploadingLibraryImages}
                  className="flex items-center gap-2 bg-black text-white px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title={`Write these images into every ${libraryGender} × ${libraryCategory} product (replaces main + mini images)`}
                >
                  <ImageIcon size={14} /> Apply to products
                </button>
                {libraryStatus && <span className="text-xs font-bold text-emerald-700">{libraryStatus}</span>}
              </div>

              {bucketImages.length > 0 ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                  {bucketImages.map(img => (
                    <div key={img.id} className="group relative aspect-square rounded-xl overflow-hidden border border-gray-100 bg-gray-50">
                      <img src={img.image} alt={`${img.gender} ${img.category}`} className="w-full h-full object-contain" loading="lazy" />
                      <button
                        type="button"
                        onClick={() => handleDeleteCatalogImage(img.id)}
                        className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-white/90 text-gray-400 hover:text-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove from library"
                      >
                        <Trash size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">
                  No images in this bucket yet — click "Add Images" to upload bottle photos for {libraryGender} × {libraryCategory}.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {perfumes.map(perfume => {
                const setting = categorySettings.find(item => item.category === perfume.category);
                const unit = setting ? getCatalogSizeUnit(perfume, setting) : perfume.unit ?? 'ml';
                const displayedPrices = setting
                  ? `${getCatalogSizePrice(perfume, setting, 1).toLocaleString()} / ${getCatalogSizePrice(perfume, setting, 2).toLocaleString()} ETB`
                  : `${perfume.price.toLocaleString()} ETB`;
                return (
                <div key={perfume.id} className="bg-white p-4 rounded-[1.5rem] border border-gray-100 shadow-sm flex items-center gap-4 group hover:border-[var(--color-gold)]/50 transition-colors">
                  <img src={perfume.mainImage} alt={perfume.name} className="w-16 h-16 rounded-xl object-cover bg-gray-50" />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-gray-900 truncate">{perfume.name}</h3>
                    <span className={cn('mb-1 mt-2 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest', getStockBadgeClass(perfume.stockStatus))}>
                      {perfume.stockStatus || 'In Stock'}
                    </span>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">
                      {perfume.brand} • {unit === 'gram' && typeof perfume.pricePerGram === 'number'
                        ? `${perfume.pricePerGram} ETB/g`
                        : displayedPrices}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => openEditModal(perfume)}
                      className="w-10 h-10 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-600 transition-colors"
                      title="Edit"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button 
                      onClick={() => handleDelete(perfume.id)}
                      className="w-10 h-10 rounded-full bg-red-50 hover:bg-red-100 flex items-center justify-center text-red-600 transition-colors"
                      title="Delete"
                    >
                      <Trash size={16} />
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      {/* Edit/Add Modal */}
      <AnimatePresence>
        {isModalOpen && editingPerfume && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setIsModalOpen(false)}
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-white w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-[2.5rem] shadow-2xl p-8 custom-scrollbar"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-3xl luxury-text font-bold text-gray-900">
                  {editingPerfume.id ? 'Edit Product' : 'Add New Product'}
                </h2>
                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 hover:text-black transition-colors"
                >
                  <X />
                </button>
              </div>

              <form onSubmit={handleSavePerfume} className="space-y-8">
                {/* Category Selection */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Perfume Category</label>
                  <div className="flex bg-gray-50 p-1 rounded-xl gap-1">
                    {categorySettings.map(({ category: cat }) => {
                      const isActive = editingPerfume.category === cat;
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => {
                            setProductImageSize(1);
                            setEditingPerfume({
                              ...editingPerfume,
                              category: cat as Category,
                              brand: cat === 'Brand Perfume' ? '' : editingPerfume.brand || 'Our Fragrance'
                            });
                          }}
                          className={cn(
                            "flex-1 py-3 px-4 rounded-lg text-xs font-bold uppercase tracking-widest transition-all",
                            isActive ? "bg-black text-white shadow-md" : "text-gray-400 hover:text-gray-600"
                          )}
                        >
                          {cat === 'Perfume' ? 'Regular' : cat.replace(' Perfume', '')}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Basic Info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Perfume Name</label>
                      <input 
                        required
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 outline-none focus:border-black"
                        value={editingPerfume.name}
                        onChange={e => setEditingPerfume({ ...editingPerfume, name: e.target.value })}
                        placeholder="e.g. Oud Wood Intense"
                      />
                    </div>
                    {editingPerfume.category === 'Brand Perfume' && (
                      <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Brand</label>
                        <input 
                          required
                          className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 outline-none focus:border-black"
                          value={editingPerfume.brand}
                          onChange={e => setEditingPerfume({ ...editingPerfume, brand: e.target.value })}
                          placeholder="e.g. Tom Ford"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Product size unit</label>
                      <p className="mb-2 text-xs text-gray-400">This choice and its prices apply only to this product.</p>
                      <div className="grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-1">
                        {(['ml', 'gram'] as const).map(unit => (
                          <button
                            key={unit}
                            type="button"
                            aria-pressed={editingProductUnit === unit}
                            onClick={() => setEditingPerfume({ ...editingPerfume, unit })}
                            className={cn(
                              'rounded-lg px-4 py-2.5 text-xs font-bold uppercase tracking-widest transition-colors',
                              editingProductUnit === unit ? 'bg-black text-white shadow-sm' : 'text-gray-500 hover:text-black'
                            )}
                          >
                            {unit}
                          </button>
                        ))}
                      </div>
                    </div>
                    {editingProductUnit === 'ml' && editingCategorySetting ? (
                      <div className="grid grid-cols-2 gap-4">
                        {([1, 2] as const).map(size => {
                          const priceKey = size === 1 ? 'sizePrice1' : 'sizePrice2';
                          const sizeLabel = size === 1 ? editingCategorySetting.size1 : editingCategorySetting.size2;
                          const value = getEditingMlPrice(size);
                          return (
                            <div key={size}>
                              <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                                {sizeLabel} ml price (ETB)
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                required
                                className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 outline-none focus:border-black"
                                value={value}
                                onChange={event => setEditingPerfume({
                                  ...editingPerfume,
                                  [priceKey]: event.target.value === '' ? null : Number(event.target.value),
                                })}
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : editingProductUnit === 'ml' ? (
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest">
                        Price (ETB)
                        <input
                          type="number"
                          min="0"
                          step="any"
                          required
                          className="mt-2 w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 outline-none focus:border-black"
                          value={editingPerfume.price ?? 0}
                          onChange={event => setEditingPerfume({ ...editingPerfume, price: Number(event.target.value) || 0 })}
                        />
                      </label>
                    ) : (
                      <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Price per gram (ETB/g)</label>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          required
                          className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 outline-none focus:border-black"
                          value={editingPerfume.pricePerGram ?? ''}
                          onChange={event => setEditingPerfume({
                            ...editingPerfume,
                            pricePerGram: event.target.value === '' ? null : Number(event.target.value),
                          })}
                          placeholder="e.g. 25"
                        />
                        <p className="mt-1 text-xs text-gray-400">The catalog multiplies this rate by the selected gram size.</p>
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Code</label>
                      <input
                        required
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 outline-none focus:border-black"
                        value={editingPerfume.code}
                        onChange={event => setEditingPerfume({ ...editingPerfume, code: event.target.value })}
                        placeholder="P1234"
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Main Image</label>
                      <input 
                        required
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 outline-none focus:border-black"
                        value={editingPerfume.mainImage}
                        onChange={e => setEditingPerfume({ ...editingPerfume, mainImage: e.target.value })}
                          placeholder="Paste an image URL"
                      />
                        <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-xs font-bold uppercase tracking-widest text-gray-500 hover:border-black hover:text-black">
                          <ImageIcon size={16} /> Choose image from folder
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={e => {
                              const file = e.target.files?.[0];
                              if (file) readImageFile(file, image => setEditingPerfume({ ...editingPerfume, mainImage: image }));
                            }}
                          />
                        </label>
                        {editingPerfume.mainImage && (
                          <img src={editingPerfume.mainImage} alt="Main perfume preview" className="mt-3 h-24 w-full rounded-xl bg-gray-100 object-contain" />
                        )}
                        {(() => {
                          const sizeSetting = categorySettings.find(setting => setting.category === editingPerfume.category);
                          if (!sizeSetting) return null;
                          const sizeImageKey = productImageSize === 1 ? 'sizeImage1' : 'sizeImage2';
                          return (
                            <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3">
                              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-500">Product image by size</p>
                              <div className="mb-3 grid grid-cols-2 gap-2">
                                {([1, 2] as const).map(size => (
                                  <button
                                    key={size}
                                    type="button"
                                    aria-pressed={productImageSize === size}
                                    onClick={() => setProductImageSize(size)}
                                    className={cn(
                                      'rounded-lg border px-3 py-2 text-xs font-bold transition-colors',
                                      productImageSize === size ? 'border-black bg-black text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
                                    )}
                                  >
                                    {size === 1 ? sizeSetting.size1 : sizeSetting.size2} {editingProductUnit}
                                  </button>
                                ))}
                              </div>
                              <input
                                value={editingPerfume[sizeImageKey] || ''}
                                onChange={event => setEditingPerfume({
                                  ...editingPerfume,
                                  [sizeImageKey]: event.target.value || null,
                                })}
                                placeholder={`Paste ${productImageSize === 1 ? sizeSetting.size1 : sizeSetting.size2} ${editingProductUnit} image URL`}
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700"
                              />
                              <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:border-black hover:text-black">
                                <ImageIcon size={14} /> Upload {productImageSize === 1 ? sizeSetting.size1 : sizeSetting.size2} {editingProductUnit} main image
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={event => {
                                    const file = event.target.files?.[0];
                                    if (file) readImageFile(file, image => setEditingPerfume(previous => previous
                                      ? { ...previous, [sizeImageKey]: image }
                                      : previous));
                                    event.target.value = '';
                                  }}
                                />
                              </label>
                              {editingPerfume[sizeImageKey] && (
                                <img
                                  src={editingPerfume[sizeImageKey] || ''}
                                  alt={`${productImageSize === 1 ? sizeSetting.size1 : sizeSetting.size2} ${editingProductUnit} product preview`}
                                  className="mt-3 h-24 w-full rounded-xl bg-white object-contain"
                                />
                              )}
                              {editingPerfume[sizeImageKey] && (
                                <button
                                  type="button"
                                  onClick={() => setEditingPerfume({ ...editingPerfume, [sizeImageKey]: null })}
                                  className="mt-2 text-xs font-bold text-red-600 hover:text-red-800"
                                >
                                  Remove size image
                                </button>
                              )}
                            </div>
                          );
                        })()}
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Mini Image</label>
                      <input 
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 outline-none focus:border-black"
                        value={editingPerfume.miniImage || ''}
                        onChange={e => setEditingPerfume({ ...editingPerfume, miniImage: e.target.value })}
                          placeholder="Paste an image URL"
                      />
                        <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-xs font-bold uppercase tracking-widest text-gray-500 hover:border-black hover:text-black">
                          <ImageIcon size={16} /> Choose mini image from folder
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={e => {
                              const file = e.target.files?.[0];
                              if (file) readImageFile(file, image => setEditingPerfume({ ...editingPerfume, miniImage: image }));
                            }}
                          />
                        </label>
                        {editingPerfume.miniImage && (
                          <img src={editingPerfume.miniImage} alt="Mini perfume preview" className="mt-3 h-24 w-full rounded-xl bg-gray-100 object-contain" />
                        )}
                    </div>
                    {editingPerfume.category === 'Perfume' && (
                      <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Back like Shadow Main Image URL</label>
                        <input 
                          className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 outline-none focus:border-black"
                          value={editingPerfume.galleryImages?.[0] || ''}
                          onChange={e => {
                            const current = editingPerfume.galleryImages || [];
                            const next = [...current];
                            next[0] = e.target.value;
                            setEditingPerfume({ ...editingPerfume, galleryImages: next });
                          }}
                          placeholder="https://..."
                        />
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                       <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Gender</label>
                        <select 
                          className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 outline-none focus:border-black appearance-none"
                          value={editingPerfume.gender}
                          onChange={e => setEditingPerfume({ ...editingPerfume, gender: e.target.value as Gender })}
                        >
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                          <option value="Unisex">Unisex</option>
                          <option value="Kids">Kids</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Stock Status</label>
                        <select
                          className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 outline-none focus:border-black appearance-none"
                          value={editingPerfume.stockStatus || 'In Stock'}
                          onChange={e => setEditingPerfume({ ...editingPerfume, stockStatus: e.target.value as StockStatus })}
                        >
                          <option value="In Stock">In Stock</option>
                          <option value="Low Stock">Low Stock</option>
                          <option value="Out Stock">Out Stock</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-col justify-center">
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Rating ({editingPerfume.rating})</label>
                      <input 
                        type="range" min="1" max="5" step="0.1"
                        className="w-full accent-black mt-2"
                        value={editingPerfume.rating}
                        onChange={e => setEditingPerfume({ ...editingPerfume, rating: parseFloat(e.target.value) })}
                      />
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div>
                   <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Description</label>
                   <textarea 
                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 outline-none focus:border-black h-24"
                    value={editingPerfume.description}
                    onChange={e => setEditingPerfume({ ...editingPerfume, description: e.target.value })}
                   />
                </div>

                {/* Advanced: Seasons & Day/Night */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Seasons</label>
                    <div className="flex flex-wrap gap-2">
                       {['Winter', 'Spring', 'Summer', 'Autumn'].map(s => {
                         const season = s as Season;
                         const isActive = editingPerfume.seasons?.includes(season);
                         return (
                           <button 
                            key={s}
                            type="button"
                            onClick={() => {
                              const current = editingPerfume.seasons || [];
                              const next = isActive ? current.filter(x => x !== season) : [...current, season];
                              setEditingPerfume({ ...editingPerfume, seasons: next });
                            }}
                            className={cn(
                              "px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all",
                              isActive ? "bg-black text-white shadow-lg shadow-black/20" : "bg-gray-50 text-gray-400 border border-gray-100"
                            )}
                           >
                            {s}
                           </button>
                         )
                       })}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Best Wear Time</label>
                    <div className="flex bg-gray-50 p-1 rounded-xl gap-1">
                      {['Day', 'Night', 'Both'].map(t => {
                        const time = t as DayNight;
                        const isActive = editingPerfume.dayNight === time;
                        return (
                          <button 
                            key={t}
                            type="button"
                            onClick={() => setEditingPerfume({ ...editingPerfume, dayNight: time })}
                            className={cn(
                              "flex-1 py-3 px-4 rounded-lg text-xs font-bold uppercase tracking-widest transition-all",
                              isActive ? "bg-white text-black shadow-md" : "text-gray-400"
                            )}
                          >
                            {t}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
                {/* Fragrance Profile */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Longevity</label>
                    <input
                      className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 outline-none focus:border-black"
                      value={editingPerfume.fragranceProfile?.longevity || ''}
                      onChange={e => setEditingPerfume({ ...editingPerfume, fragranceProfile: { ...(editingPerfume.fragranceProfile || { longevity: '', projection: '', sillage: '' }), longevity: e.target.value } })}
                      placeholder="e.g. 8-10 hours"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Projection</label>
                    <input
                      className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 outline-none focus:border-black"
                      value={editingPerfume.fragranceProfile?.projection || ''}
                      onChange={e => setEditingPerfume({ ...editingPerfume, fragranceProfile: { ...(editingPerfume.fragranceProfile || { longevity: '', projection: '', sillage: '' }), projection: e.target.value } })}
                      placeholder="e.g. Moderate"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Sillage</label>
                    <input
                      className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 outline-none focus:border-black"
                      value={editingPerfume.fragranceProfile?.sillage || ''}
                      onChange={e => setEditingPerfume({ ...editingPerfume, fragranceProfile: { ...(editingPerfume.fragranceProfile || { longevity: '', projection: '', sillage: '' }), sillage: e.target.value } })}
                      placeholder="e.g. Strong"
                    />
                  </div>
                </div>

                {/* Accords & Notes */}

                {/* Accords & Notes */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Accords Management */}
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest">Main Accords</label>
                    </div>
                    <div className="mb-3 grid grid-cols-[1fr_80px_auto] gap-2">
                      <input
                        className="min-w-0 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs outline-none focus:border-black"
                        value={accordDraft.name}
                        onChange={e => setAccordDraft({ ...accordDraft, name: e.target.value })}
                        placeholder="Accord name"
                      />
                      <input
                        type="number"
                        min="0"
                        max="100"
                        className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs outline-none focus:border-black"
                        value={accordDraft.value}
                        onChange={e => setAccordDraft({ ...accordDraft, value: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)) })}
                        aria-label="Accord percentage"
                      />
                      <button type="button" onClick={addAccordToEditingPerfume} className="rounded-lg bg-black px-3 text-xs font-bold uppercase text-white">Add</button>
                    </div>
                    <div className="space-y-2">
                       {editingPerfume.accords?.map((accord, idx) => (
                         <div key={idx} className="flex items-center gap-3 bg-gray-50 p-2 rounded-lg border border-gray-100">
                           <div className="w-4 h-4 rounded-full" style={{ backgroundColor: colors[accord.name] || accord.color }} />
                           <span className="flex-1 text-xs font-bold">{accord.name}</span>
                           <span className="text-xs text-gray-400">{accord.value}%</span>
                           <button 
                            type="button"
                            onClick={() => {
                              const next = editingPerfume.accords?.filter((_, i) => i !== idx);
                              setEditingPerfume({ ...editingPerfume, accords: next });
                            }}
                            className="text-red-400 hover:text-red-600"
                           >
                            <Trash size={14} />
                           </button>
                         </div>
                       ))}
                    </div>
                  </div>

                  {/* Notes Management */}
                  <div className="space-y-4">
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest">Fragrance Notes</label>
                    {(['top', 'middle', 'base'] as const).map(tier => (
                      <div key={tier} className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                        <div className="flex items-center justify-between mb-3">
                          <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest capitalize">{tier} Notes</h5>
                        </div>
                        <div className="space-y-2 mb-3">
                          <input
                            className="w-full rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs outline-none focus:border-black"
                            value={noteDrafts[tier].name}
                            onChange={e => setNoteDrafts({ ...noteDrafts, [tier]: { ...noteDrafts[tier], name: e.target.value } })}
                            placeholder="Note name"
                          />
                          <div className="flex gap-2">
                            <input
                              className="min-w-0 flex-1 rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs outline-none focus:border-black"
                              value={noteDrafts[tier].iconUrl}
                              onChange={e => setNoteDrafts({ ...noteDrafts, [tier]: { ...noteDrafts[tier], iconUrl: e.target.value } })}
                              placeholder="Icon image URL"
                            />
                            <label className="flex cursor-pointer items-center justify-center rounded-lg border border-gray-200 bg-white px-3 text-gray-500 hover:text-black" title="Choose note image from folder">
                              <ImageIcon size={15} />
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={e => {
                                  const file = e.target.files?.[0];
                                  if (file) readImageFile(file, image => setNoteDrafts({ ...noteDrafts, [tier]: { ...noteDrafts[tier], iconUrl: image } }));
                                }}
                              />
                            </label>
                            <button type="button" onClick={() => addNoteToEditingPerfume(tier)} className="rounded-lg bg-black px-3 text-xs font-bold uppercase text-white">Add</button>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {editingPerfume.notes?.[tier]?.map((note, idx) => (
                            <div key={idx} className="flex items-center gap-2 bg-white px-2 py-1 rounded-lg border border-gray-100 shadow-sm">
                              <img src={note.iconUrl} alt="" className="w-5 h-5 rounded-md object-cover" />
                              <span className="text-[10px] font-bold">{note.name}</span>
                              <button 
                                type="button"
                                onClick={() => {
                                  const nextNotes = { ...editingPerfume.notes! };
                                  nextNotes[tier] = nextNotes[tier].filter((_, i) => i !== idx);
                                  setEditingPerfume({ ...editingPerfume, notes: nextNotes });
                                }}
                                className="text-gray-300 hover:text-red-500"
                              >
                                <X size={10} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-8 border-t border-gray-100 flex gap-4">
                  <button 
                    type="submit"
                    disabled={isSaving}
                    className="flex-1 bg-black text-white py-4 rounded-xl font-bold uppercase tracking-widest shadow-xl shadow-black/20 hover:shadow-black/40 transition-all hover:-translate-y-1 flex items-center justify-center gap-3 disabled:opacity-50"
                  >
                    {isSaving ? 'Saving...' : <><Save size={18} /> Save Changes</>}
                  </button>
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-8 bg-gray-50 text-gray-500 py-4 rounded-xl font-bold uppercase tracking-widest hover:bg-gray-100 transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
