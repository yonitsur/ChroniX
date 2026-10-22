import React, { useEffect, useMemo, useState } from 'react';
import { ScrollText, Sparkles, useIsToyTheme } from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';

const ROTATE_MS = 10000;
const FADE_MS = 450;

// Matches the 6-color toy brick palette used by .prompt-example-card in index.css
const TOY_STRIPE_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#facc15', // yellow
  '#22c55e', // emerald green
  '#38bdf8', // sky blue
  '#c084fc', // purple
];

// Fisher-Yates shuffle so repeat generations don't always start with the same fact.
function shuffled(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Rotating "did you know" trivia strip shown while a timeline is generating,
 * so the ~30-60s wait feels shorter. Mixes a couple of prompt-relevant lines
 * (templated client-side, no extra AI call) with general history trivia.
 */
export default function TriviaTicker({ prompt }) {
  const { t, isRtl } = useLanguage();
  const isToy = useIsToyTheme();

  const items = useMemo(() => {
    const generic = t('trivia.facts');
    const genericItems = Array.isArray(generic) ? generic : [];
    const promptTemplates = prompt ? t('trivia.promptFacts') : [];
    const promptItems = Array.isArray(promptTemplates)
      ? promptTemplates.map((s) => s.replace(/\{prompt\}/g, `\u201c${prompt}\u201d`))
      : [];
    return shuffled([...promptItems, ...genericItems]);
  }, [prompt, t]);

  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setIndex(0);
    setVisible(true);
  }, [items]);

  useEffect(() => {
    if (items.length <= 1) return undefined;
    const timer = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % items.length);
        setVisible(true);
      }, FADE_MS);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [items]);

  if (!items.length) return null;

  if (isToy) {
    const stripeColor = TOY_STRIPE_COLORS[index % TOY_STRIPE_COLORS.length];
    return (
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        data-trivia-ticker
        className="w-full max-w-lg mx-auto mt-3 sm:mt-4 px-3 sm:px-4"
      >
        <div
          className="trivia-toy-card relative w-full rounded-2xl px-4 py-3 sm:px-5 sm:py-3.5 text-start transition-[border-color] duration-300"
          style={{ '--trivia-stripe-color': stripeColor }}
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="trivia-toy-badge inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs sm:text-[13px] font-bold select-none">
              <ScrollText className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span>{t('trivia.label')}</span>
            </span>
            <Sparkles className="w-4 h-4 shrink-0" />
          </div>
          <p
            className={`text-body-sm sm:text-body text-ink font-semibold leading-relaxed text-start min-h-[2.75rem] sm:min-h-[2.5rem] transition-opacity ease-out ${
              visible ? 'opacity-100' : 'opacity-0'
            }`}
            style={{ transitionDuration: `${FADE_MS}ms` }}
          >
            {items[index]}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      data-trivia-ticker
      className="w-full max-w-lg mx-auto mt-3 sm:mt-4 flex items-start justify-center gap-2.5 px-4 min-h-[3rem] sm:min-h-[2.5rem]"
    >
      <ScrollText className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-ink-subtle shrink-0 mt-0.5" />
      <p
        className={`text-body-sm sm:text-body text-ink-muted font-normal leading-relaxed text-start transition-opacity ease-out ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ transitionDuration: `${FADE_MS}ms` }}
      >
        <span className="font-semibold text-ink">{t('trivia.label')} </span>
        {items[index]}
      </p>
    </div>
  );
}

