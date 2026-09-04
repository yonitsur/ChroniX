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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/95 dark:bg-slate-900/95 text-amber-600 dark:text-amber-400 border border-amber-300/80 dark:border-amber-700/60 shadow-lg backdrop-blur-md text-[11px] font-medium hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-all hover:scale-105 active:scale-95 cursor-pointer"
          title="Show AI Disclaimer"
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>AI Disclaimer</span>
          <ChevronUp className="w-3 h-3 text-slate-400" />
        </button>
      </div>
    );
  }

  return (
    <footer className="relative z-20 w-full bg-amber-50/90 dark:bg-slate-900/95 backdrop-blur-md border-t border-amber-200/70 dark:border-slate-800 text-slate-700 dark:text-slate-300 px-3 sm:px-4 py-1.5 text-xs select-none transition-all flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 shadow-2xs shrink-0">
      {/* Disclaimer Message */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className="p-1 rounded-md bg-amber-500/15 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
          <AlertTriangle className="w-3.5 h-3.5" />
        </div>
        <p className="text-[11px] sm:text-xs truncate font-medium text-amber-900/90 dark:text-amber-200/90">
          <span>
            <strong>Disclaimer:</strong> Timeline data is AI-generated and may contain inaccuracies, incorrect dates, or hallucinated events. Please verify critical historical facts.
          </span>
        </p>
      </div>

      {/* Action Controls */}
      <div className="flex items-center gap-1.5 shrink-0 text-[11px]">
        {/* Learn more modal button */}
        <button
          type="button"
          onClick={onOpenModal}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600 text-white font-medium transition-all shadow-2xs active:scale-95 cursor-pointer"
        >
          <Info className="w-3.5 h-3.5" />
          <span>Learn More</span>
        </button>

        {/* Minimize button */}
        <button
          type="button"
          onClick={() => setIsMinimized(true)}
          className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
          title="Minimize disclaimer bar"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
    </footer>
  );
}
