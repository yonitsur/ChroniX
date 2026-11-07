import { useEffect, useRef } from 'react';
import { reportGameCompleted } from '../api';

/**
 * Reports a finished game to the backend activity log exactly once per play-through.
 * The play timer starts on mount and restarts whenever `isCompleted` flips back to false
 * (i.e. "play again") or `resetKey` changes (e.g. a freshly generated question set).
 */
export default function useGameCompletionReport({ game, timelineId, contentMode, isCompleted, stats, resetKey }) {
  const startedAtRef = useRef(Date.now());
  const reportedRef = useRef(false);
  const statsRef = useRef(stats);
  statsRef.current = stats;

  useEffect(() => {
    if (!isCompleted) {
      startedAtRef.current = Date.now();
      reportedRef.current = false;
      return;
    }
    if (reportedRef.current) return;
    reportedRef.current = true;
    reportGameCompleted({
      game,
      timelineId,
      contentMode,
      durationMs: Date.now() - startedAtRef.current,
      ...(statsRef.current || {}),
    });
  }, [isCompleted, game, timelineId, contentMode, resetKey]);
}
