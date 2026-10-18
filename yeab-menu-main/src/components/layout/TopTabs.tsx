import { Gender } from '../../lib/data';
import { cn } from '../../lib/utils';
import { motion } from 'motion/react';

interface TopTabsProps {
  activeGender: Gender | 'All';
  setActiveGender: (gender: Gender | 'All') => void;
}

export default function TopTabs({ activeGender, setActiveGender }: TopTabsProps) {
  const tabs: (Gender | 'All')[] = ['All', 'Male', 'Female', 'Kids', 'Unisex'];

  const getTabColors = (tab: string, isActive: boolean) => {
    if (!isActive) return 'bg-[#f0f0f0] text-[#1a2c3d]/60 hover:bg-gray-100';
    
    switch (tab) {
      case 'All': return 'bg-[#1a2c3d] text-white shadow-black/20';
      case 'Male': return 'bg-[#1e52a6] text-white shadow-[#1e52a6]/20';
      case 'Female': return 'bg-[#e7aefa] text-white shadow-[#e7aefa]/20';
      case 'Kids': return 'bg-[#4092ff] text-white shadow-[#4092ff]/20';
      case 'Unisex': return 'bg-black text-white shadow-black/20';
      default: return 'bg-black text-white';
    }
  };

  return (
    <div className="flex bg-[#efe8e0]/60 backdrop-blur-sm p-2 lg:p-3 rounded-lg gap-3 lg:gap-4 w-full shadow-inner border border-white/40">
      {tabs.map((tab) => {
        const isActive = activeGender === tab;
        return (
          <button
            key={tab}
            onClick={() => setActiveGender(tab)}
            className={cn(
              "flex-1 relative px-1 py-2 lg:py-2.5 rounded-[2rem] text-xs lg:text-sm font-bold uppercase tracking-[0.1em] lg:tracking-[0.2em] transition-all duration-300 shadow-md",
              getTabColors(tab, isActive)
            )}
          >
            {isActive && (
              <motion.div 
                layoutId="activeTabIndicator"
                className="absolute inset-0 rounded-[2rem] bg-white opacity-10 pointer-events-none"
                initial={false}
                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
              />
            )}
            <span className="relative z-10">{tab}</span>
          </button>
        );
      })}
    </div>
  );
}

