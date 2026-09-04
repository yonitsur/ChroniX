import React, { useState, useEffect } from 'react';
import { Sparkles, Search, SlidersHorizontal, Loader2, ArrowRight } from 'lucide-react';

const SUGGESTIONS = [
  "Presidents of the United States",
  "Empires",
  "Dinosaurs & Mesozoic Eras",
  "World War II Key Events",
  "Human Evolution & Early Hominids",
  "History of Artificial Intelligence",
  "Space Race & Moon Missions",
  "Rise & Fall of the Roman Empire",
  "Ancient Egypt & Pharaohs",
  "History of Aviation & Flight",
  "Renaissance Masters & Art Movements",
  "Evolution of Video Game Consoles",
  "Timeline of the Universe (Big Bang to Now)"
];


const LOADING_STEPS = [
  "Consulting Gemini AI...",
  "Structuring chronology & swimlanes...",
  "Fetching verified Wikimedia Commons images...",
  "Loading articles into Histropedia engine..."
];

export default function PromptBar({ onGenerate, isLoading }) {
  const [prompt, setPrompt] = useState('');
  const [detailLevel, setDetailLevel] = useState('standard');
  const [loadingStepIdx, setLoadingStepIdx] = useState(0);

  useEffect(() => {
    let interval;
    if (isLoading) {
      setLoadingStepIdx(0);
      interval = setInterval(() => {
        setLoadingStepIdx((prev) => (prev + 1) % LOADING_STEPS.length);
      }, 2200);
    }
    return () => clearInterval(interval);
  }, [isLoading]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!prompt.trim() || isLoading) return;
    onGenerate(prompt.trim(), detailLevel);
  };

  const handleChipClick = (suggestion) => {
    setPrompt(suggestion);
    onGenerate(suggestion, detailLevel);
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 z-20 transition-all">
      <form onSubmit={handleSubmit} className="relative group">
        <div className="relative flex items-center bg-white/95 dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-xl shadow-slate-200/60 dark:shadow-2xl p-2 focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/20 transition-all">
          <div className="pl-3 pr-2 text-slate-400 dark:text-slate-400 flex items-center">
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-sky-500 dark:text-sky-400" />
            ) : (
              <Sparkles className="w-5 h-5 text-sky-500 dark:text-sky-400" />
            )}
          </div>

          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isLoading}
            maxLength={400}
            placeholder={
              isLoading
                ? LOADING_STEPS[loadingStepIdx]
                : "Enter any timeline topic (e.g. 'Presidents of the USA', 'Dinosaurs', 'World War II')..."
            }
            className="w-full bg-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-400 text-base sm:text-lg px-2 py-2 outline-none font-medium"
          />

          {/* Detail Level Selector */}
          <div className="hidden sm:flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200 dark:border-slate-700/50 mr-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <button
              type="button"
              onClick={() => setDetailLevel('overview')}
              className={`px-2.5 py-1.5 rounded-lg transition-all ${
                detailLevel === 'overview'
                  ? 'bg-sky-500 text-white shadow-sm'
                  : 'hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-700/50'
              }`}
              title="~10-15 landmark events"
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => setDetailLevel('standard')}
              className={`px-2.5 py-1.5 rounded-lg transition-all ${
                detailLevel === 'standard'
                  ? 'bg-sky-500 text-white shadow-sm'
                  : 'hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-700/50'
              }`}
              title="~20-30 balanced events"
            >
              Standard
            </button>
            <button
              type="button"
              onClick={() => setDetailLevel('deep_dive')}
              className={`px-2.5 py-1.5 rounded-lg transition-all ${
                detailLevel === 'deep_dive'
                  ? 'bg-sky-500 text-white shadow-sm'
                  : 'hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-700/50'
              }`}
              title="~35-50 granular events"
            >
              Deep Dive
            </button>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={!prompt.trim() || isLoading}
            className="flex items-center gap-1.5 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-4 sm:px-5 py-2.5 rounded-xl shadow-lg shadow-sky-500/25 transition-all active:scale-95 text-sm"
          >
            {!isLoading && <ArrowRight className="w-4 h-4" />}
          </button>
        </div>

        {/* Loading Progress Bar */}
        {isLoading && (
          <div className="absolute -bottom-1 left-4 right-4 h-1 bg-slate-200/60 dark:bg-slate-800 rounded-full overflow-hidden pointer-events-none">
            <div className="h-full w-[28%] bg-gradient-to-r from-transparent via-sky-400 via-blue-500 to-transparent rounded-full shadow-[0_0_8px_rgba(14,165,233,0.8)] animate-progress-indeterminate" />
          </div>
        )}
      </form>

      {/* Suggestion Chips */}
      <div className="flex items-center gap-1.5 mt-2.5 overflow-x-auto pb-1 text-xs no-scrollbar">
        <span className="text-slate-500 dark:text-slate-400 shrink-0 font-medium mr-1">Suggestions:</span>
        {SUGGESTIONS.map((item) => (
          <button
            key={item}
            type="button"
            disabled={isLoading}
            onClick={() => handleChipClick(item)}
            className="shrink-0 bg-white/90 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700/60 shadow-xs rounded-full px-3 py-1 transition-all hover:border-slate-400 dark:hover:border-slate-500"
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}
