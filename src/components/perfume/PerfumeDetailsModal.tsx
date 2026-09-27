import React, { useEffect } from 'react';
import { Perfume } from '../../lib/data';
import { useAccordColors, useCatalogImages, resolveCatalogImage, isPlaceholderCatalogImage } from '../../lib/api';
import { motion, AnimatePresence } from 'motion/react';
import { X, Star, Hourglass, Wind, Sun, Moon, ArrowRight } from 'lucide-react';
import { cn } from '../../lib/utils';

interface PerfumeDetailsModalProps {
  perfume: Perfume;
  onClose: () => void;
}

export default function PerfumeDetailsModal({ perfume, onClose }: PerfumeDetailsModalProps) {
  const { colors } = useAccordColors();
  const { images: catalogImages } = useCatalogImages();

  // Catalog image library: placeholder bottles are replaced by the matching
  // Gender × Category bucket image; custom uploads/pastes stay untouched.
  const resolvedMainImage = resolveCatalogImage(perfume, catalogImages);
  const resolvedMiniImage = isPlaceholderCatalogImage(perfume.miniImage)
    ? resolvedMainImage
    : (perfume.miniImage as string);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 lg:p-8">
      <motion.div
        className="absolute inset-0 bg-[var(--color-paper)]/80 backdrop-blur-xl"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      <motion.div
        layoutId={`card-${perfume.id}`}
        className="
    relative 
    w-full 
    max-w-6xl 
    h-[95vh]
    overflow-y-auto
    lg:overflow-hidden 
    overscroll-contain
    bg-white 
    rounded-[2rem] 
    shadow-2xl 
    flex 
    flex-col 
    lg:flex-row
  "
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 sm:top-6 sm:right-6 z-20 w-9 h-9 sm:w-10 sm:h-10 bg-black/5 hover:bg-black/10 rounded-full flex items-center justify-center transition-colors"
        >
          <X size={20} className="text-gray-600" />
        </button>

        {/* LEFT PANE */}
        <div className="
    w-full 
    lg:w-[45%] 
    lg:h-full
    p-4 
    sm:p-6 
    lg:p-10 
    flex 
    flex-col 
    lg:grid
    lg:grid-rows-[minmax(0,1fr)_auto]
    bg-[#fcfbfa] 
    border-r 
    border-gray-100 
    relative
    flex-shrink-0
    lg:flex-shrink-0
    lg:overflow-hidden
  ">

          {/* IMAGE */}
          <div className="
      w-full 
      aspect-[4/5] 
      lg:aspect-auto
      lg:h-full
      lg:min-h-0
      relative 
      rounded-[1.5rem] 
      overflow-hidden 
      bg-[#fcf9f2] 
      flex-shrink-0
    ">
            <motion.img
              layoutId={`image-${perfume.id}`}
              src={resolvedMainImage}
              alt={perfume.name}
              className={`
          w-full 
          h-full  
          object-contain
        `}
            />

            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-white px-4 py-1.5 rounded-full text-[16px] font-bold text-gray-900 shadow-sm border border-black/5 tracking-widest whitespace-nowrap">
              {perfume.code}
            </div>

            {/* MINI IMAGE PREVIEW — right corner, height = half of the main image card */}
            <div className="absolute bottom-4 right-4 z-10 w-20 sm:w-24 h-1/2 rounded-lg sm:rounded-xl overflow-hidden bg-white shadow-md border border-black/10">
              <img
                src={resolvedMiniImage}
                alt={`${perfume.name} mini`}
                className="w-full h-full object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>

          {/* CORE INFO */}
          <div className="
      mt-5 
      sm:mt-8 
      lg:mt-4
      text-center 
      flex 
      flex-col 
      items-center 
      flex-1
      lg:flex-none
    ">
            <div className="flex gap-1 mb-4 sm:mb-6">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  size={24}
                  className={cn(
                    "fill-current transition-colors",
                    star <= Math.floor(perfume.rating)
                      ? "text-[#fcd34d]"
                      : "text-gray-200"
                  )}
                />
              ))}

              <span className="ml-2 font-bold text-xl">
                {perfume.rating}
              </span>
            </div>

            <h2 className="
        luxury-text 
        text-3xl 
        sm:text-4xl 
        lg:text-5xl 
        font-bold 
        text-gray-900 
        leading-tight 
        mb-2
      ">
              {perfume.name}
            </h2>

            <p className="
        text-sm 
        sm:text-lg 
        text-gray-400 
        tracking-widest 
        uppercase 
        mb-6 
        sm:mb-10
      ">
              {perfume.brand}
            </p>

            {/* PRICE */}
            <div className="
        mt-auto 
        w-full 
        flex 
        items-center 
        justify-between 
        bg-black 
        p-2 
        pl-6 
        rounded-full 
        text-white
      ">
              <span className="font-bold text-lg tracking-wider">
                {perfume.price.toLocaleString()} ETB
              </span>

              <button className="
          w-12 
          h-12 
          bg-white/20 
          hover:bg-white/30 
          rounded-full 
          flex 
          items-center 
          justify-center 
          transition-colors
        ">
                <ArrowRight size={20} className="text-white" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Pane - Details */}
        <div className="
    w-full 
    lg:w-[55%] 
    lg:h-full
    p-4 
    sm:p-6 
    lg:p-10 
    pb-10 
    lg:pb-24 
    lg:overflow-y-auto
    lg:overscroll-contain
  ">
          {/* Main Accords */}
          <section className="mb-12">
            <h3 className="text-2xl luxury-text font-semibold mb-6 text-gray-900 border-b border-gray-100 pb-2">Main Accords</h3>
            <div className="space-y-4">
              {perfume.accords.map((accord, idx) => {
                const barColor = colors[accord.name] || accord.color || '#cccccc';
                return (
                  <motion.div
                    key={idx}
                    className="relative h-10 w-full bg-gray-100 rounded-lg overflow-hidden flex items-center shadow-sm"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.5, delay: 0.3 + (idx * 0.1) }}
                  >
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${accord.value}%` }}
                      transition={{ duration: 1.2, delay: 0.5 + (idx * 0.1), ease: "easeOut" }}
                      className="absolute top-0 left-0 h-full"
                      style={{ backgroundColor: barColor }}
                    />
                    <span
                      className="relative z-10 px-4 text-[10px] font-bold text-white tracking-[0.2em] uppercase"
                      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.2)' }}
                    >
                      {accord.name}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </section>

          {/* Fragrance Profile */}
          <section className="mb-12">
            <h3 className="text-xl luxury-text font-semibold mb-6 text-gray-900">Fragrance Profile</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gray-50 flex items-center gap-3 p-4 rounded-2xl border border-gray-100">
                <Hourglass size={20} className="text-gray-500" />
                <div>
                  <div className="text-xs text-gray-400 font-bold uppercase tracking-wider">Longevity</div>
                  <div className="font-bold text-gray-900">{perfume.fragranceProfile?.longevity}</div>
                </div>
              </div>
              <div className="bg-gray-50 flex items-center gap-3 p-4 rounded-2xl border border-gray-100">
                <ArrowRight size={20} className="text-gray-500" />
                <div>
                  <div className="text-xs text-gray-400 font-bold uppercase tracking-wider">Projection</div>
                  <div className="font-bold text-gray-900">{perfume.fragranceProfile?.projection}</div>
                </div>
              </div>
              <div className="bg-gray-50 flex items-center gap-3 p-4 rounded-2xl border border-gray-100">
                <Wind size={20} className="text-gray-500" />
                <div>
                  <div className="text-xs text-gray-400 font-bold uppercase tracking-wider">Sillage</div>
                  <div className="font-bold text-gray-900">{perfume.fragranceProfile?.sillage}</div>
                </div>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
            {/* Day / Time */}
            <section>
              <h3 className="text-xl luxury-text font-semibold mb-4 text-gray-900">Day Time</h3>
              <div className="flex h-12 rounded-xl overflow-hidden border border-gray-100">
                <div className={cn("flex-1 flex items-center justify-center gap-2 font-bold text-sm", perfume.dayNight !== 'Night' ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-400")}>
                  <Sun size={16} /> Day
                </div>
                <div className={cn("flex-1 flex items-center justify-center gap-2 font-bold text-sm", perfume.dayNight !== 'Day' ? "bg-slate-800 text-slate-100" : "bg-gray-100 text-gray-400")}>
                  <Moon size={16} /> Night
                </div>
              </div>
            </section>

            {/* Seasons */}
            <section>
              <h3 className="text-xl luxury-text font-semibold mb-4 text-gray-900">Seasons</h3>
              <div className="grid grid-cols-2 gap-2">
                {['Winter', 'Spring', 'Summer', 'Autumn'].map(season => {
                  const isActive = perfume.seasons.includes(season as any);
                  return (
                    <div key={season} className={cn("py-3 text-center rounded-xl text-sm font-bold border", isActive ? "bg-black text-white border-black" : "bg-white text-gray-400 border-gray-200")}>
                      {season}
                    </div>
                  )
                })}
              </div>
            </section>
          </div>

          {/* Notes */}
          <section>
            <h3 className="text-2xl luxury-text font-semibold mb-6 text-gray-900 border-b border-gray-100 pb-2">Notes</h3>
            <div className="space-y-8">
              <NoteSection title="Top Notes" notes={perfume.notes.top} delay={0.1} />
              <NoteSection title="Middle Notes" notes={perfume.notes.middle} delay={0.2} />
              <NoteSection title="Base Notes" notes={perfume.notes.base} delay={0.3} />
            </div>
          </section>
        </div>
      </motion.div>
    </div>
  );
}

function NoteSection({ title, notes, delay }: { title: string, notes: { name: string, iconUrl: string }[], delay: number }) {
  if (!notes || notes.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">{title}</h4>
      <div className="flex flex-wrap gap-4">
        {notes.map((note, idx) => (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: delay + (idx * 0.1) }}
            key={idx}
            className="flex flex-col items-center gap-2 w-20"
          >
            <div className="w-16 h-16 rounded-full overflow-hidden shadow-sm border-2 border-white bg-gray-50">
              <img src={note.iconUrl} alt={note.name} className="w-full h-full object-cover" />
            </div>
            <span className="text-[11px] font-semibold text-center text-gray-700 leading-tight">{note.name}</span>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
