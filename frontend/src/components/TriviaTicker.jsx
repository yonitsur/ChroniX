import React, { useEffect, useMemo, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const ROTATE_MS = 10000;
const FADE_MS = 450;

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

  return (
    <div
      dir={isRtl ? 'rtl' : 'ltr'}
      className="w-full max-w-lg mx-auto mt-3 sm:mt-4 flex items-start justify-center gap-2.5 px-4 min-h-[3rem] sm:min-h-[2.5rem]"
    >
      <Lightbulb className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-accent shrink-0 mt-0.5" />
      <p
        className={`text-body-sm sm:text-body text-ink-muted font-normal sm:font-medium leading-relaxed text-start transition-opacity ease-out ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ transitionDuration: `${FADE_MS}ms` }}
      >
        <span className="font-bold text-ink dark:text-ink-subtle">{t('trivia.label')} </span>
        {items[index]}
      </p>
    </div>
  );
}
