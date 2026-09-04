import React, { useState, useEffect } from 'react';
import { AlertTriangle, Info, ChevronDown, ChevronUp } from 'lucide-react';

export default function AiDisclaimerBar({ onOpenModal }) {
  const [isMinimized, setIsMinimized] = useState(() => {
    try {
      return localStorage.getItem('chronix_disclaimer_minimized') === 'true';
    } catch (e) {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('chronix_disclaimer_minimized', isMinimized ? 'true' : 'false');
    } catch (e) {}
  }, [isMinimized]);

  // If minimized, display a sleek floating corner badge
  if (isMinimized) {
    return (
      <div className="fixed bottom-3 left-4 z-30 animate-in fade-in zoom-in-95 duration-200">
        <button
          type="button"
          onClick={() => setIsMinimized(false)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 dark:bg-slate-900/90 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 shadow-md backdrop-blur-md text-[11px] font-medium hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-all hover:scale-105 active:scale-95 cursor-pointer"
          title="Show AI Disclaimer"
        >
          <Info className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
          <span>AI Disclaimer</span>
          <ChevronUp className="w-3 h-3 text-slate-400" />
        </button>
      </div>
    );
  }

  return (
    <footer className="relative z-20 w-full bg-white/85 dark:bg-slate-950/85 backdrop-blur-md border-t border-slate-200/80 dark:border-slate-800/80 text-slate-500 dark:text-slate-400 px-3 sm:px-4 py-1 text-xs select-none transition-all flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 shadow-2xs shrink-0">
      {/* Disclaimer Message */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className="p-1 rounded-md bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400 shrink-0">
          <Info className="w-3.5 h-3.5" />
        </div>
        <p className="text-[11px] truncate font-medium text-slate-600 dark:text-slate-400">
          <span>
            <strong className="text-slate-700 dark:text-slate-300 font-semibold">AI Historical Disclaimer:</strong> Timeline articles are synthetically generated and may occasionally contain inaccuracies or anachronisms. Please verify critical facts.
          </span>
        </p>
      </div>

      {/* Action Controls */}
      <div className="flex items-center gap-1.5 shrink-0 text-[11px]">
        {/* Learn more modal button */}
        <button
          type="button"
          onClick={onOpenModal}
          className="flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium transition-colors shadow-2xs active:scale-95 cursor-pointer"
        >
          <span>Learn More</span>
        </button>

        {/* Minimize button */}
        <button
          type="button"
          onClick={() => setIsMinimized(true)}
          className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          title="Minimize disclaimer bar"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
    </footer>
  );
}
