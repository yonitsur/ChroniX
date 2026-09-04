import React from 'react';

export const PROMPT_EXAMPLES = [
  // Simple Prompts (2 Hebrew, 4 English)
  {
    prompt: 'מצרים העתיקה: פרעונים, פירמידות והשושלות הגדולות',
    detailLevel: 'standard',
    lang: 'he'
  },
  {
    prompt: 'הנחיתה על הירח ומבצעי אפולו של נאס"א',
    detailLevel: 'standard',
    lang: 'he'
  },
  {
    prompt: 'World War II: Major Battles and Turning Points (1939-1945)',
    detailLevel: 'standard',
    lang: 'en'
  },
  {
    prompt: 'History of Aviation: From Wright Brothers to Commercial Jet Age',
    detailLevel: 'standard',
    lang: 'en'
  },
  {
    prompt: 'Rise and Fall of the Roman Empire: From Republic to Fall of Rome',
    detailLevel: 'standard',
    lang: 'en'
  },
  {
    prompt: "Harry Potter: Chronological storyline from the Philosopher's Stone to the Battle of Hogwarts",
    detailLevel: 'standard',
    lang: 'en'
  },

  // Complex Prompts (2 Hebrew, 4 English)
  {
    prompt: 'מבצעי העלייה הגדולים לישראל במאה ה-20: חלוקה לנתיבים עבור עליות המזרח, אתיופיה וברה"מ לשעבר',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  {
    prompt: 'מהלך מלחמת יום הכיפורים (אוקטובר 1973): ציר זמן מפורט המחולק לחזית סיני מול חזית רמת הגולן',
    detailLevel: 'deep_dive',
    lang: 'he'
  },
  {
    prompt: 'The Space Race (1955–1975): Comparative timeline contrasting Soviet milestones with NASA achievements',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  {
    prompt: "The Targaryen Dynasty: Complete chronology from Aegon's Conquest to Robert's Rebellion",
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  {
    prompt: 'History of Artificial Intelligence: From Turing Test and Dartmouth Workshop to modern LLMs and Generative AI',
    detailLevel: 'deep_dive',
    lang: 'en'
  },
  {
    prompt: 'The Manhattan Project and Cold War Nuclear Proliferation (1939–1962): From Trinity test to the Cuban Missile Crisis',
    detailLevel: 'deep_dive',
    lang: 'en'
  }
];

export default function PromptExamples({ onSelectPrompt, isGenerating = false }) {
  // Duplicate for seamless infinite loop
  const doubledExamples = [...PROMPT_EXAMPLES, ...PROMPT_EXAMPLES];

  return (
    <div className="w-full max-w-6xl mx-auto mt-4 px-2 sm:px-4 relative select-none">
      {/* Edge gradient fade masks for that infinite cinema look */}
      <div className="absolute left-0 top-0 bottom-0 w-12 sm:w-20 bg-gradient-to-r from-slate-100 dark:from-slate-950 to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-12 sm:w-20 bg-gradient-to-l from-slate-100 dark:from-slate-950 to-transparent z-10 pointer-events-none" />

      {/* Row container with overflow hidden and vertical padding for hover scale */}
      <div className="overflow-hidden py-4 px-2">
        <div className="animate-infinite-marquee gap-3.5 group/track">
          {doubledExamples.map((item, idx) => {
            const isHebrew = item.lang === 'he';

            return (
              <button
                key={idx}
                type="button"
                disabled={isGenerating}
                onClick={() => onSelectPrompt?.(item.prompt, item.detailLevel)}
                dir={isHebrew ? 'rtl' : 'ltr'}
                className={`group/card relative flex flex-col justify-between text-start p-4 rounded-2xl border transition-all duration-250 ease-out cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  isHebrew ? 'text-right' : 'text-left'
                } w-64 sm:w-72 h-36 sm:h-40 shrink-0 bg-white/95 dark:bg-slate-900/90 hover:bg-white dark:hover:bg-slate-850 border-slate-200 dark:border-slate-800/90 hover:border-sky-400 dark:hover:border-sky-400 hover:scale-105 sm:hover:scale-108 hover:-translate-y-1 hover:z-30 hover:shadow-2xl hover:shadow-sky-500/20 shadow-xs group-hover/track:opacity-75 hover:!opacity-100`}
              >
                <p className="text-xs sm:text-[13px] text-slate-700 dark:text-slate-200 group-hover/card:text-slate-950 dark:group-hover/card:text-white leading-relaxed line-clamp-3 font-medium transition-colors">
                  {item.prompt}
                </p>
                <div className="flex items-center justify-between text-[11px] pt-2 border-t border-slate-100 dark:border-slate-800/60 mt-auto w-full">
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${
                      item.detailLevel === 'deep_dive'
                        ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border-indigo-200/70 dark:border-indigo-800/50'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700/60'
                    }`}
                  >
                    {item.detailLevel === 'deep_dive' ? '🔬 Deep' : '⚡ Standard'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
