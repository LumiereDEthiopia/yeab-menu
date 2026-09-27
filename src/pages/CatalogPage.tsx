import React, { useState, useEffect } from 'react';
import Sidebar from '../components/layout/Sidebar';
import TopTabs from '../components/layout/TopTabs';
import { Category, Gender, Perfume } from '../lib/data';
import { usePerfumes, useCatalogImages, resolveCatalogImage } from '../lib/api';
import PerfumeSlide from '../components/perfume/PerfumeSlide';
import PerfumeDetailsModal from '../components/perfume/PerfumeDetailsModal';
import { AnimatePresence, motion } from 'motion/react';
import { Menu, ChevronLeft, Search, X } from 'lucide-react';

export default function CatalogPage() {
  const { perfumes, loading } = usePerfumes();
  const { images: catalogImages } = useCatalogImages();
  const [activeCategory, setActiveCategory] = useState<Category | 'All'>('All');
  const [activeGender, setActiveGender] = useState<Gender | 'All'>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [direction, setDirection] = useState(0);
  const [selectedPerfume, setSelectedPerfume] = useState<Perfume | null>(null);

  const filteredPerfumes = perfumes.filter((perfume) => {
    const categoryMatch = activeCategory === 'All' || perfume.category === activeCategory;
    const genderMatch = activeGender === 'All' || perfume.gender === activeGender;
    const q = searchQuery.trim().toLowerCase();
    const searchMatch =
      q === '' ||
      perfume.name.toLowerCase().includes(q) ||
      perfume.brand.toLowerCase().includes(q) ||
      perfume.code.toLowerCase().includes(q);
    return categoryMatch && genderMatch && searchMatch;
  });

  // Reset index when filters or search change
  useEffect(() => {
    setCurrentIndex(0);
  }, [activeCategory, activeGender, searchQuery]);

  const handleNext = () => {
    if (filteredPerfumes.length === 0) return;
    setDirection(1);
    setCurrentIndex((prev) => (prev + 1) % filteredPerfumes.length);
  };

  const handlePrev = () => {
    if (filteredPerfumes.length === 0) return;
    setDirection(-1);
    setCurrentIndex((prev) => (prev - 1 + filteredPerfumes.length) % filteredPerfumes.length);
  };

  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 1000 : -1000,
      opacity: 0
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1
    },
    exit: (direction: number) => ({
      zIndex: 0,
      x: direction < 0 ? 1000 : -1000,
      opacity: 0
    })
  };

  const currentPerfume = filteredPerfumes[currentIndex];

  const getStockBadgeClass = (status = 'In Stock') => {
    if (status === 'Out Stock') return 'bg-red-50 text-red-700 border-red-200';
    if (status === 'Low Stock') return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  };

  const swipeConfidenceThreshold = 10000;
  const swipePower = (offset: number, velocity: number) => {
    return Math.abs(offset) * velocity;
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#dedede]">
      {/* Sidebar Toggle Button for minimized mode */}
      {!isSidebarOpen && (
        <button 
          onClick={() => setIsSidebarOpen(true)}
          className="fixed left-4 top-1/2 -translate-y-1/2 z-30 bg-white p-2 rounded-full shadow-lg border border-gray-200"
        >
          <Menu size={20} />
        </button>
      )}

      {/* Sidebar */}
      <div className={isSidebarOpen ? 'block' : 'hidden lg:hidden'}>
        <Sidebar 
          activeCategory={activeCategory} 
          setActiveCategory={setActiveCategory as any} 
          isOpen={isSidebarOpen}
          setIsOpen={setIsSidebarOpen}
        />
      </div>

      {/* Main Container */}
      <main className="flex-1 flex flex-col min-h-0 relative bg-[#dedede] p-1.5 lg:p-2.5 overflow-hidden">
        
        {/* Top Header with Gender Tabs */}
        <div className="flex items-center gap-2 lg:gap-4 mb-2 lg:mb-3 flex-shrink-0">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="hidden lg:flex flex-shrink-0 items-center justify-center w-7 h-7 bg-white rounded-full shadow-md text-gray-400 hover:text-black transition-all hover:bg-gray-50 border border-gray-100"
          >
            <ChevronLeft size={16} className={isSidebarOpen ? 'transition-transform duration-300' : 'rotate-180 transition-transform duration-300'} />
          </button>
          
          <div className="flex-1 overflow-x-auto lg:overflow-visible hide-scrollbar py-0.5">
            <TopTabs activeGender={activeGender} setActiveGender={setActiveGender as any} />
          </div>

          {/* Search Bar */}
          <div className="relative flex-shrink-0 w-36 sm:w-52 lg:w-72">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search perfumes..."
              className="w-full bg-white rounded-full shadow-md border border-gray-100 pl-9 pr-8 py-2 text-xs font-medium text-gray-700 placeholder-gray-400 outline-none focus:border-gray-300 focus:ring-2 focus:ring-black/5 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
              >
                <X size={11} strokeWidth={3} />
              </button>
            )}
          </div>
        </div>

        {/* Content Slider Area */}
        <div className="flex-1 relative min-h-0">
          <AnimatePresence initial={false} custom={direction}>
            {loading ? (
              <div key="loading" className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-[var(--color-gold)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredPerfumes.length > 0 ? (
              <motion.div
                key="all-grid"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="absolute inset-0 overflow-y-auto hide-scrollbar sm:custom-scrollbar pb-20 px-2 lg:px-4"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 lg:gap-6 pt-3 sm:pt-4">
                  {filteredPerfumes.map(perfume => (
                    <div 
                      key={perfume.id} 
                      onClick={() => {
                        setSelectedPerfume(perfume);
                      }}
                      className="min-w-0 bg-white rounded-[1.5rem] p-3 sm:p-4 lg:p-5 flex flex-col items-center cursor-pointer shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all border border-gray-100"
                    >
                      <div className="w-full aspect-[4/5] bg-[#fcf9f2] rounded-xl overflow-hidden mb-4">
                        <img
                          src={resolveCatalogImage(perfume, catalogImages)}
                          alt={perfume.name}
                          className={`w-full h-full object-center ${perfume.category === 'Luxury Perfume' ? 'object-contain p-3' : 'object-cover'}`} 
                        />
                      </div>
                      <div className="w-full text-left flex flex-col flex-1">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="text-[9px] lg:text-[10px] font-bold text-gray-400 tracking-widest uppercase">
                            {perfume.code}
                          </div>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[8px] lg:text-[9px] font-bold uppercase tracking-widest ${getStockBadgeClass(perfume.stockStatus)}`}>
                            {perfume.stockStatus || 'In Stock'}
                          </span>
                        </div>
                        <h3 className="font-bold text-xs lg:text-sm text-[#1a2c3d] leading-tight mb-2 flex-1 line-clamp-2">
                          {perfume.name}
                        </h3>
                        <div className="font-bold text-sm sm:text-base text-black mt-auto">
                          {perfume.price} ETB
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 flex flex-col items-center justify-center bg-white rounded-[2rem] shadow-xl text-center p-12"
              >
                 <p className="text-2xl luxury-text mb-4 text-[#1a2c3d]">No perfumes found for this selection.</p>
                 <button 
                  onClick={() => { setActiveCategory('All'); setActiveGender('All'); setSearchQuery(''); }}
                  className="bg-black text-white px-10 py-4 rounded-full font-bold uppercase tracking-[0.2em] text-xs hover:bg-gray-800 transition-colors shadow-lg"
                 >
                   Reset Menu
                 </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <AnimatePresence>
        {selectedPerfume && (
          <PerfumeDetailsModal 
            perfume={selectedPerfume} 
            onClose={() => setSelectedPerfume(null)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}
