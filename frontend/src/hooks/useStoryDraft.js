import { useCallback, useEffect, useRef, useState } from 'react';

// Story Studio drafts live in localStorage so a half-built story survives a refresh or
// closing the studio. Answers are kept per blueprint, so switching story type and back
// does not lose what was typed. (Server-side drafts come with the Gather step.)
const STORAGE_KEY = 'chronix_story_studio_draft_v1';
const SAVE_DELAY_MS = 400;

export const EMPTY_DRAFT = { step: 'story', blueprintKey: null, answersByBlueprint: {}, updatedAt: null };

function readDraft() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_DRAFT;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.answersByBlueprint !== 'object') return EMPTY_DRAFT;
    return { ...EMPTY_DRAFT, ...parsed };
  } catch {
    return EMPTY_DRAFT;
  }
}

export default function useStoryDraft(isOpen) {
  const [draft, setDraftState] = useState(EMPTY_DRAFT);
  const [savedAt, setSavedAt] = useState(null);
  const timerRef = useRef(null);


  useEffect(() => {
    if (isOpen) setDraftState(readDraft());
  }, [isOpen]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const setDraft = useCallback((updater) => {
    setDraftState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      const stamped = { ...next, updatedAt: Date.now() };
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped));
          setSavedAt(stamped.updatedAt);
        } catch {
          // Storage full or unavailable (private mode) - the studio still works, it just won't resume.
        }
      }, SAVE_DELAY_MS);
      return stamped;
    });
  }, []);

  const clearDraft = useCallback(() => {
    clearTimeout(timerRef.current);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setDraftState(EMPTY_DRAFT);
    setSavedAt(null);
  }, []);

  return { draft, setDraft, clearDraft, savedAt };
}
