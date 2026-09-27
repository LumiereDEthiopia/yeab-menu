import React from 'react';
import { Perfume } from '../../lib/data';
import { useAccordColors, useCatalogImages, resolveCatalogImage } from '../../lib/api';
import { motion } from 'motion/react';
import { Star } from 'lucide-react';

interface PerfumeCardProps {
  perfume: Perfume;
  onClick: () => void;
}

export const PerfumeCard: React.FC<PerfumeCardProps> = ({ perfume, onClick }) => {
  const { colors } = useAccordColors();
  const { images: catalogImages } = useCatalogImages();

  return (
    <motion.div 
      layoutId={`card-${perfume.id}`}
      onClick={onClick}
      className="group relative cursor-pointer flex flex-col bg-white rounded-[1.5rem] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)] transition-all duration-300 border border-gray-100/50"
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="absolute top-6 right-6 z-10 bg-white/90 backdrop-blur-md px-3 py-1 rounded-full text-xs font-bold text-gray-900 tracking-wider shadow-sm">
        {perfume.code}
      </div>

      <div className="relative w-full aspect-[4/5] rounded-[1rem] overflow-hidden bg-[#fcf9f2] mb-5">
        {/* Abstract background shape for image */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
        <motion.img
          layoutId={`image-${perfume.id}`}
          src={resolveCatalogImage(perfume, catalogImages)}
          alt={perfume.name}
          className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-700 ease-out"
          loading="lazy"
        />
        
        {/* Hover mini-accords preview */}
        <div className="absolute bottom-4 left-4 right-4 z-20 flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform translate-y-2 group-hover:translate-y-0 transition-transform duration-500">
           {perfume.accords.slice(0, 3).map((accord, idx) => {
             const barColor = colors[accord.name] || accord.color || '#cccccc';
             return (
               <div key={idx} className="h-1.5 w-full bg-white/20 rounded-full overflow-hidden backdrop-blur-sm">
                 <motion.div 
                   initial={{ width: 0 }}
                   whileHover={{ width: `${accord.value}%` }} // Animate on hover of the card
                   animate={{ width: `${accord.value}%` }}
                   className="h-full"
                   style={{ backgroundColor: barColor }}
                 />
               </div>
             )
           })}
        </div>
      </div>

      <div className="px-2 flex-col flex flex-1">
        <h3 className="luxury-text text-2xl font-semibold text-gray-900 leading-tight mb-1">
          {perfume.name}
        </h3>
        <p className="text-gray-400 text-sm font-medium tracking-wide mb-4">
          {perfume.brand}
        </p>

        <div className="flex flex-wrap gap-1 mb-4 opacity-70 group-hover:opacity-100 transition-opacity">
           {perfume.accords.slice(0, 3).map((accord, idx) => (
             <span key={idx} className="text-[9px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full bg-gray-50 border border-gray-100 text-gray-500">
               {accord.name}
             </span>
           ))}
        </div>

        <div className="auto-mt-spacer flex-1" />

        <div className="flex items-center justify-between mt-auto">
          <div className="flex items-center gap-1.5 p-1.5 pr-3 bg-gray-50 rounded-full border border-gray-100">
            <div className="w-6 h-6 rounded-full bg-white flex items-center justify-center shadow-sm">
              <Star size={12} className="fill-[#fcd34d] text-[#fcd34d]" />
            </div>
            <span className="text-sm font-bold text-gray-900">{perfume.rating}</span>
          </div>

          <div className="text-right">
            <span className="text-sm border-b border-gray-300 pb-0.5 text-gray-900 font-bold tracking-wide">
              {perfume.price.toLocaleString()} ETB
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
