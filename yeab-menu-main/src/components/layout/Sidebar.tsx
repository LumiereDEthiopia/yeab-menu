import React from 'react';
import { Category } from '../../lib/data';
import { cn } from '../../lib/utils';
import { LayoutGrid, Droplet, Gem, Star, Settings, X, Crown, KeyRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';

interface SidebarProps {
  activeCategory: Category | 'All';
  setActiveCategory: (cat: Category | 'All') => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export default function Sidebar({ activeCategory, setActiveCategory, isOpen, setIsOpen }: SidebarProps) {
  const categories: { name: Category | 'All'; icon: React.ReactNode }[] = [
    { name: 'All', icon: <LayoutGrid size={20} /> },
    { name: 'Perfume', icon: <Droplet size={20} /> },
    { name: 'Brand Perfume', icon: <Star size={20} /> },
    { name: 'Luxury Perfume', icon: <Gem size={20} /> },
  ];

  const content = (
    <div className="h-full flex flex-col pt-8 pb-8 px-4 bg-[#f8f7f5] border-r border-[#e5e5e5]">
      {/* Close button inside mobile sidebar */}
      <button 
        className="lg:hidden absolute top-4 right-4 p-2 text-black/50 hover:text-black transition-colors z-20"
        onClick={() => setIsOpen(false)}
      >
        <X size={24} />
      </button>

      <div className="flex flex-col items-center mb-12">
        <div className="text-center relative">
          <div className="flex flex-col items-center gap-0.5">
            <div className="relative mb-2">
               <Crown size={42} className="text-[#c19253]" strokeWidth={1} />
               <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-[#c19253] rounded-full" />
            </div>
            <h1 className="text-5xl font-serif tracking-tighter text-[#1a2c3d] font-bold leading-none mb-1">LUMIERE</h1>
            <p className="text-[10px] tracking-[0.3em] font-bold uppercase text-[#1a2c3d]/90">LUXURY PERFUME</p>
            <p className="text-xl font-serif mt-1 text-[#1a2c3d] font-medium leading-tight">ሉሜር ሽቶ</p>
          </div>
          
          <div className="relative mt-4 flex items-center justify-center">
             <div className="h-[2px] w-44 bg-gradient-to-r from-transparent via-[#c19253] to-transparent" />
             <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-[#c19253] rotate-45" />
          </div>
        </div>
      </div>

      <nav className="flex-1 flex flex-col gap-6 pt-10 px-4">
        {categories.map((cat) => {
          const isActive = activeCategory === cat.name;
          return (
            <button
              key={cat.name}
              onClick={() => {
                setActiveCategory(cat.name);
                setIsOpen(false);
              }}
              className={cn(
                "w-full h-12 flex items-center justify-between px-4 transition-all duration-300 shadow-lg",
                "text-[13px] font-bold tracking-wider uppercase",
                isActive 
                  ? "bg-[#3dbdf9] text-white shadow-[#3dbdf9]/30" 
                  : "bg-white text-[#1a2c3d] border border-gray-100"
              )}
            >
              <span className="flex-1 text-left">{cat.name}</span>
              <div className="w-10 h-full bg-white/10 -mr-4 flex items-center justify-center border-l border-white/20">
                {/* Visual block to match mockup tab look */}
              </div>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-1 px-2">
        <Link
          to="/jwt"
          className="flex items-center justify-center gap-2 p-3 text-[10px] font-bold tracking-[0.2em] uppercase text-gray-400 hover:text-[#1a2b3c] transition-colors rounded-xl border border-transparent hover:border-gray-200"
        >
          <KeyRound size={14} />
          JWT Debugger
        </Link>
        <Link
          to="/admin"
          className="flex items-center justify-center gap-2 p-3 text-[10px] font-bold tracking-[0.2em] uppercase text-gray-400 hover:text-[#1a2b3c] transition-colors rounded-xl border border-transparent hover:border-gray-200"
        >
          <Settings size={14} />
          Admin Access
        </Link>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-[240px] h-full z-10">
        {content}
      </aside>

      <motion.aside 
        className="fixed inset-y-0 left-0 w-[80vw] max-w-[280px] bg-white z-50 lg:hidden shadow-2xl"
        initial={{ x: '-100%' }}
        animate={{ x: isOpen ? '0%' : '-100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      >
        {content}
      </motion.aside>
    </>
  );
}

