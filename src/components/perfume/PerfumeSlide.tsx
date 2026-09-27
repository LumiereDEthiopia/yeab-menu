import React from 'react';
import { Perfume } from '../../lib/data';
import { useAccordColors, useCatalogImages, resolveCatalogImage } from '../../lib/api';
import { motion } from 'motion/react';
import { Star, Hourglass, Wind, Sun, Moon, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

interface PerfumeSlideProps {
  perfume: Perfume;
  onNext: () => void;
  onPrev: () => void;
}

export default function PerfumeSlide({ perfume, onNext, onPrev }: PerfumeSlideProps) {
  const { colors } = useAccordColors();
  const { images: catalogImages } = useCatalogImages();

  const allNotes = [
    ...perfume.notes.top,
    ...perfume.notes.middle,
    ...perfume.notes.base
  ].slice(0, 6);

  return (
    <div className="flex flex-col lg:flex-row w-full h-full bg-[#f4f0ea] lg:rounded-[0.75rem] overflow-hidden shadow-2xl relative">
      
      {/* Left Column (Accords, Profile, Time, Seasons, Footer) - styled like the image */}
      <div className="w-full lg:w-[45%] flex flex-col p-4 lg:p-6 overflow-hidden lg:border-r lg:border-gray-200/50">
        
        <div className="flex-1 flex flex-col gap-y-4 content-start">
          
          {/* Main Accords */}
          <section>
             <h4 className="text-sm text-[#333] mb-2 font-medium">main accords</h4>
             <div className="flex flex-col gap-2">
                {perfume.accords.slice(0, 5).map((accord, idx) => {
                  const barColor = colors[accord.name] || accord.color || '#8b4513';
                  return (
                    <div key={idx} className="relative h-6 w-full bg-white flex items-center">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${accord.value}%` }}
                        transition={{ duration: 1, delay: 0.2 + (idx * 0.1) }}
                        className="absolute top-0 left-0 h-full"
                        style={{ backgroundColor: barColor }}
                      />
                    </div>
                  );
                })}
             </div>
          </section>

          {/* Fragrance Profile */}
          <section>
             <h4 className="text-sm text-[#333] mb-2 font-medium">Fragrance Profile</h4>
             <div className="grid grid-cols-2 gap-3">
                <div className="bg-white px-2 py-1.5 flex items-center gap-2">
                   <Hourglass size={14} className="text-black shrink-0" />
                   <span className="text-xs text-black whitespace-nowrap">
                     <span className="font-bold">{perfume.fragranceProfile?.longevity}</span> Longevity
                   </span>
                </div>
                <div className="bg-white px-2 py-1.5 flex items-center gap-2">
                   <Wind size={14} className="text-black shrink-0" />
                   <span className="text-xs text-black whitespace-nowrap">
                     <span className="font-bold">{perfume.fragranceProfile?.sillage || perfume.fragranceProfile?.projection}</span> Silage
                   </span>
                </div>
             </div>
          </section>

          {/* Day Time */}
          <section>
             <h4 className="text-sm text-[#333] mb-2 font-medium">Day Time</h4>
             <div className="flex h-8 bg-white w-full">
                <div className={cn(
                  "flex-1 h-full flex items-center justify-center gap-2 transition-all duration-300", 
                  perfume.dayNight !== 'Night' ? "bg-[#4ed9f2]" : "bg-gray-200"
                )}>
                   <Sun size={14} className="text-yellow-300 fill-current" />
                   <span className="text-xs font-bold text-black">Day</span>
                </div>
                <div className={cn(
                  "flex-1 h-full flex items-center justify-center gap-2 transition-all duration-300", 
                  perfume.dayNight !== 'Day' ? "bg-[#b0b0b0]" : "bg-gray-200"
                )}>
                   <Moon size={14} className="text-yellow-300 fill-current" />
                   <span className="text-xs font-bold text-black">Night</span>
                </div>
             </div>
          </section>

          {/* Seasons */}
          <section>
             <h4 className="text-sm text-[#333] mb-2 font-medium">Seasons</h4>
             <div className="grid grid-cols-2 gap-3">
                {[
                  { name: 'Winter', color: '#40a9ff' },
                  { name: 'Spring', color: '#b7eb8f' },
                  { name: 'Summer', color: '#ffc53d' },
                  { name: 'Autumn', color: '#ff4d4f' }
                ].map((s) => {
                  const isActive = perfume.seasons.includes(s.name as any);
                  return (
                    <div key={s.name} className="flex h-7 bg-white relative items-center">
                      <div 
                        className="h-full flex items-center justify-center transition-all duration-500 absolute left-0 top-0"
                        style={{ 
                          backgroundColor: s.color, 
                          width: isActive ? '100%' : '0%' 
                        }}
                      />
                      <span className="relative z-10 w-full text-center text-xs font-bold text-black">
                        {s.name}
                      </span>
                    </div>
                  );
                })}
             </div>
          </section>
        </div>

        {/* Footer Navigation & Pricing */}
        <div className="mt-auto flex flex-row items-center justify-between pt-4">
           <div className="flex bg-white shadow-sm">
              <div className="bg-black text-white px-4 py-2 text-sm font-bold flex items-center justify-center">
                Price
              </div>
              <div className="px-4 py-2 text-sm font-bold text-black flex items-center justify-center min-w-[100px]">
                {perfume.price} ETB
              </div>
           </div>
           
           <div className="flex gap-4">
              <button 
                onClick={onPrev}
                className="w-12 h-12 bg-[#0ea04c] text-white rounded-full flex items-center justify-center shadow-md hover:scale-105 active:scale-95 transition-all focus:outline-none"
              >
                <ChevronLeft className="w-6 h-6" strokeWidth={3} />
              </button>
              <button 
                onClick={onNext}
                className="w-12 h-12 bg-[#0ea04c] text-white rounded-full flex items-center justify-center shadow-md hover:scale-105 active:scale-95 transition-all focus:outline-none"
              >
                <div className="rotate-180"><ChevronLeft className="w-6 h-6" strokeWidth={3} /></div>
              </button>
           </div>
        </div>
      </div>

      {/* Right Column (Image, Rating, Notes) */}
      <div className="w-full lg:w-[55%] flex flex-col p-4 lg:p-6 bg-[#fdfaf5] z-10 overflow-hidden relative">
        <h3 className="text-xs font-bold text-gray-400 mb-2 tracking-widest uppercase text-right">Perfume Image</h3>
        
        <div className="flex-1 flex flex-col items-center justify-center min-h-0">
          <div className="relative w-full max-w-[200px] lg:max-w-[280px] aspect-[4/5] overflow-hidden rounded-xl bg-[#fcf9f2]">
             {perfume.galleryImages?.[0] && (
               <motion.img 
                 key={perfume.id + '-shadow'}
                 initial={{ opacity: 0, scale: 0.9 }}
                 animate={{ opacity: 0.4, scale: 1 }}
                 transition={{ duration: 0.8 }}
                 src={perfume.galleryImages[0]} 
                 alt="" 
                 className="absolute inset-0 w-full h-full object-cover object-center blur-2xl z-0 scale-110"
               />
             )}
             <motion.img 
              key={perfume.id + '-img'}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              src={resolveCatalogImage(perfume, catalogImages)}
              alt={perfume.name} 
              className="relative z-10 w-full h-full object-cover object-center"
            />
          </div>

          <div className="mt-4 text-center mb-4">
             <div className="flex items-center justify-center gap-2">
               <span className="text-4xl font-bold text-[#1a2c3d] tracking-tighter">{perfume.rating}</span>
               <div className="flex gap-1 text-[#fcc419]">
                 {[...Array(5)].map((_, i) => (
                   <Star key={i} size={20} fill={i < Math.floor(perfume.rating) ? "currentColor" : "none"} strokeWidth={1} />
                 ))}
               </div>
             </div>
             <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">(25042)</p>
          </div>
        </div>

        {/* Notes Grid */}
        <div className="bg-white p-4 rounded-3xl border border-gray-100 shadow-xl shadow-gray-200/50 mt-auto">
           <h4 className="text-xs font-bold text-gray-300 uppercase tracking-widest mb-3 text-center">Notes</h4>
           <div className="grid grid-cols-6 gap-2">
             {allNotes.map((note, i) => (
               <div key={i} className="flex flex-col items-center gap-1">
                 <div className="w-10 h-10 lg:w-12 lg:h-12 rounded-xl overflow-hidden shadow-sm bg-white p-0.5 border border-gray-50">
                   <img src={note.iconUrl} alt={note.name} className="w-full h-full object-cover rounded-lg" />
                 </div>
                 <span className="text-[9px] font-bold text-gray-500 text-center capitalize leading-tight truncate w-full">{note.name}</span>
               </div>
             ))}
           </div>
        </div>
      </div>

    </div>
  );
}
