import React, { useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { subscribeAiJobQueue } from '../utils/aiJobPolling';

/**
 * "Waiting in line (N ahead)…" while the server holds an AI job in its queue (SC-07).
 * Renders nothing once the job has started (or when no job is queued).
 */
export default function AiQueueNotice({ className = '' }) {
  const { t } = useLanguage();
  const [queue, setQueue] = useState(null);

  useEffect(() => subscribeAiJobQueue((info) => {
    setQueue((current) => {
      if (info.position > 0) return info;
      // Only the job that was queued clears the notice.
      return current && current.jobId === info.jobId ? null : current;
    });
  }), []);

  if (!queue) return null;
  const text = queue.ahead > 0
    ? t('app.waitingInLine', { ahead: queue.ahead })
    : t('app.waitingInLineNext');
  return (
    <p className={`text-caption leading-snug text-ink-subtle text-center ${className}`} role="status" aria-live="polite">
      {text}
    </p>
  );
}
