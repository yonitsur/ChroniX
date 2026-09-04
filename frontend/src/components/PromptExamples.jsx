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
  return (
    <div className="w-full max-w-4xl mx-auto mt-4 px-2 sm:px-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {PROMPT_EXAMPLES.map((item, idx) => {
          const isHebrew = item.lang === 'he';

          return (
            <button
              key={idx}
              type="button"
              disabled={isGenerating}
              onClick={() => onSelectPrompt?.(item.prompt, item.detailLevel)}
              dir={isHebrew ? 'rtl' : 'ltr'}
              className={`group text-start p-3.5 rounded-xl border transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                isHebrew ? 'text-right' : 'text-left'
              } bg-white dark:bg-slate-900/70 hover:bg-slate-50 dark:hover:bg-slate-800/80 border-slate-200/90 dark:border-slate-800 hover:border-sky-400 dark:hover:border-sky-500 shadow-2xs hover:shadow-xs active:scale-[0.99]`}
            >
              <p className="text-xs sm:text-[13px] text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white leading-relaxed line-clamp-3 font-normal transition-colors">
                {item.prompt}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
