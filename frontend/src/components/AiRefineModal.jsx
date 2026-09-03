import React, { useState } from 'react';
import { X, Sparkles, Loader2, ArrowRight } from 'lucide-react';

const REFINE_SUGGESTIONS = [
  "Add 5 more key milestone events with Wikipedia links",
  "Add more events focused on scientific & technological breakthroughs",
  "Include the social and cultural context during this period",
  "Add events covering the final concluding phases and aftermath"
];

export default function AiRefineModal({
  isOpen,
  onClose,
  onRefine,
  isLoading,
  currentTimelineTitle
}) {
  const [instruction, setInstruction] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!instruction.trim() || isLoading) return;
    onRefine(instruction.trim());
  };

  const handleSuggestionClick = (sug) => {
    setInstruction(sug);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-500/15 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                Refine with AI
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-xs">
                {currentTimelineTitle || 'Current Timeline'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="text-slate-400 hover:text-slate-800 dark:hover:text-white p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-sm text-slate-700 dark:text-slate-300">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              What would you like to add or change?
            </label>
            <textarea
              rows={3}
              required
              dir="auto"
              disabled={isLoading}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. 'Add 5 more events about the naval battles in the Pacific' or 'Expand on scientific discoveries in the 19th century'..."
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-none text-sm"
            />
          </div>

          {/* Prompt Suggestions */}
          <div>
            <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
              Quick prompts:
            </span>
            <div className="flex flex-col gap-1.5">
              {REFINE_SUGGESTIONS.map((sug, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={isLoading}
                  onClick={() => handleSuggestionClick(sug)}
                  className="text-left text-xs bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700/60 rounded-xl px-3 py-2 transition-colors flex items-center justify-between group"
                >
                  <span className="truncate">{sug}</span>
                  <ArrowRight className="w-3 h-3 text-slate-400 dark:text-slate-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors shrink-0 ml-2" />
                </button>
              ))}
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!instruction.trim() || isLoading}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-semibold shadow-lg shadow-indigo-500/25 transition-all disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Refining...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Apply Refinement</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
