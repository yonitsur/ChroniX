import React, { useState, useEffect, useRef, useMemo } from 'react';
import confetti from 'canvas-confetti';
import {
  Sparkles,
  Star,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  RotateCcw,
  RefreshCw,
  Search,
  Eye,
  Loader2,
  AlertTriangle,
  Hourglass,
  X,
  HelpCircle,
} from '../icons/ThemeIcons';
import { GameWhoAmIIcon } from '../icons/GameIcons';
import { generateTimelineWhoAmI, cancelAiJob } from '../../api';
import { useLanguage } from '../../context/LanguageContext';
import { getTextDir } from '../../utils/textDirection';
import { formatGameYear, getEventSortValue } from './gameUtils';
import { GameHud, GameResults, RoundFeedback, formatPoints, starsForRatio } from './GameChrome';
import useGameCompletionReport from '../../hooks/useGameCompletionReport';

export default function WhoAmIGame({
  timeline,
  contentMode = 'classic',
  onWhoAmIGenerated,
  onSelectEvent,
}) {
  const { t, language: lang, isRtl } = useLanguage();
  const isKidsMode = contentMode === 'kids';

  const [items, setItems] = useState(() =>
    Array.isArray(timeline?.whoami) && timeline.whoami.length > 0 ? timeline.whoami : []
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealedCount, setRevealedCount] = useState(1);
  const [wrongEventIds, setWrongEventIds] = useState([]);
  const [directionHint, setDirectionHint] = useState(null);
  const [roundOutcome, setRoundOutcome] = useState(null); // { solved: bool, points: number }
  const [totalPoints, setTotalPoints] = useState(0);
  const [solvedCount, setSolvedCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCompleted, setIsCompleted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [askedEventIdsHistory, setAskedEventIdsHistory] = useState([]);
  const [roundResults, setRoundResults] = useState([]);

  const abortControllerRef = useRef(null);
  const activeJobIdRef = useRef(null);
  const prevTimelineIdRef = useRef(timeline?.id);

  // Sync when timeline switches
  useEffect(() => {
    if (prevTimelineIdRef.current !== timeline?.id) {
      prevTimelineIdRef.current = timeline?.id;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      const nextItems =
        Array.isArray(timeline?.whoami) && timeline.whoami.length > 0
          ? timeline.whoami
          : [];
      setItems(nextItems);
      setCurrentIndex(0);
      setRevealedCount(1);
      setWrongEventIds([]);
      setDirectionHint(null);
      setRoundOutcome(null);
      setTotalPoints(0);
      setSolvedCount(0);
      setRoundResults([]);
      setSearchQuery('');
      setIsCompleted(false);
      setIsLoading(false);
      setError(null);
      setAskedEventIdsHistory(nextItems.map((it) => it.target_event_id).filter(Boolean));
    } else if (
      Array.isArray(timeline?.whoami) &&
      timeline.whoami.length > 0 &&
      items.length === 0
    ) {
      setItems(timeline.whoami);
    }
  }, [timeline?.id, timeline?.whoami, items.length]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const articlesById = useMemo(() => {
    const map = {};
    for (const a of timeline?.articles || []) {
      if (a?.id) map[a.id] = a;
    }
    return map;
  }, [timeline?.articles]);

  const sortedArticles = useMemo(() => {
    const list = Array.isArray(timeline?.articles) ? [...timeline.articles] : [];
    return list.sort((a, b) => getEventSortValue(a) - getEventSortValue(b));
  }, [timeline?.articles]);

  const resetRoundState = () => {
    setRevealedCount(1);
    setWrongEventIds([]);
    setDirectionHint(null);
    setRoundOutcome(null);
    setSearchQuery('');
  };

  const handleGenerate = async (isFresh = false) => {
    if (!timeline?.articles?.length || isLoading) return;
    setError(null);
    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    activeJobIdRef.current = null;

    const prevIds = isFresh
      ? Array.from(
          new Set([
            ...askedEventIdsHistory,
            ...items.map((it) => it.target_event_id).filter(Boolean),
          ])
        )
      : [];

    try {
      const result = await generateTimelineWhoAmI(
        timeline,
        prevIds,
        controller.signal,
        (jobId) => {
          activeJobIdRef.current = jobId;
        },
        contentMode
      );

      const newItems = Array.isArray(result?.items) ? result.items : [];
      if (newItems.length === 0) {
        throw new Error(t('quiz.errorGenerating'));
      }

      setItems(newItems);
      setCurrentIndex(0);
      resetRoundState();
      setTotalPoints(0);
      setSolvedCount(0);
      setRoundResults([]);
      setIsCompleted(false);
      setAskedEventIdsHistory((prev) =>
        Array.from(
          new Set([
            ...prev,
            ...newItems.map((it) => it.target_event_id).filter(Boolean),
          ])
        )
      );

      if (onWhoAmIGenerated) {
        onWhoAmIGenerated(timeline.id, newItems, result?.tokenUsage);
      }
    } catch (err) {
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        return;
      }
      setError(err?.message || t('quiz.errorGenerating'));
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        activeJobIdRef.current = null;
        setIsLoading(false);
      }
    }
  };

  const handleCancelGeneration = () => {
    const jobId = activeJobIdRef.current;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    activeJobIdRef.current = null;
    setIsLoading(false);
    if (jobId) {
      cancelAiJob(jobId);
    }
  };

  const currentMystery = items[currentIndex] || null;
  const targetEvent = currentMystery
    ? articlesById[currentMystery.target_event_id]
    : null;
  const clues = currentMystery?.clues || [];
  const potentialPoints = Math.max(100, 600 - revealedCount * 100);

  const handleRevealNextClue = () => {
    if (!currentMystery || roundOutcome || revealedCount >= clues.length) return;
    setRevealedCount((c) => Math.min(clues.length, c + 1));
  };

  const handleGuessEvent = (guessedArticle) => {
    if (!currentMystery || !guessedArticle || roundOutcome) return;
    if (wrongEventIds.includes(guessedArticle.id)) return;

    if (guessedArticle.id === currentMystery.target_event_id) {
      // Correct!
      const pts = potentialPoints;
      setRoundOutcome({ solved: true, points: pts });
      setTotalPoints((prev) => prev + pts);
      setSolvedCount((prev) => prev + 1);
      setRoundResults((prev) => [...prev, wrongEventIds.length > 0 ? 'partial' : 'correct']);
      setRevealedCount(clues.length);
      setDirectionHint(null);
    } else {
      // Wrong guess: eliminate option, give chronological hint, and reveal next clue
      const nextWrongs = [...wrongEventIds, guessedArticle.id];
      setWrongEventIds(nextWrongs);

      if (targetEvent) {
        const guessedYear = Number(
          guessedArticle.from?.year ?? guessedArticle.from_?.year ?? 0
        );
        const actualYear = Number(
          targetEvent.from?.year ?? targetEvent.from_?.year ?? 0
        );
        if (actualYear < guessedYear) {
          setDirectionHint(t('quiz.whoAmI.wrongGuessHintEarlier'));
        } else if (actualYear > guessedYear) {
          setDirectionHint(t('quiz.whoAmI.wrongGuessHintLater'));
        } else {
          setDirectionHint(t('quiz.whoAmI.wrongGuessHintSameYear'));
        }
      }

      if (revealedCount < clues.length) {
        setRevealedCount((c) => Math.min(clues.length, c + 1));
      }
    }
  };

  const handleGiveUp = () => {
    if (!currentMystery || roundOutcome) return;
    setRoundOutcome({ solved: false, points: 0 });
    setRoundResults((prev) => [...prev, 'wrong']);
    setRevealedCount(clues.length);
    setDirectionHint(null);
  };

  const handleNextMystery = () => {
    if (currentIndex + 1 < items.length) {
      setCurrentIndex((i) => i + 1);
      resetRoundState();
    } else {
      setIsCompleted(true);
      if (items.length > 0 && solvedCount / items.length >= 0.6) {
        confetti({
          particleCount: isKidsMode ? 75 : 40,
          spread: 65,
          origin: { x: 0.35, y: 0.6 },
          disableForReducedMotion: true,
        });
      }
    }
  };

  const handlePlayAgainSame = () => {
    setCurrentIndex(0);
    resetRoundState();
    setTotalPoints(0);
    setSolvedCount(0);
    setRoundResults([]);
    setIsCompleted(false);
  };

  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedArticles;
    return sortedArticles.filter((art) => {
      const titleMatch = (art.title || '').toLowerCase().includes(q);
      const yearStr = String(art.from?.year ?? art.from_?.year ?? '');
      const locMatch = (art.locationName || '').toLowerCase().includes(q);
      return titleMatch || yearStr.includes(q) || locMatch;
    });
  }, [sortedArticles, searchQuery]);

  const NextArrow = isRtl ? ArrowLeft : ArrowRight;
  const totalEventsCount = timeline?.articles?.length || 0;

  useGameCompletionReport({
    game: 'whoAmI',
    timelineId: timeline?.id,
    contentMode,
    isCompleted,
    resetKey: items,
    stats: (() => {
      const ratio = items.length > 0 ? solvedCount / items.length : 0;
      return { correct: solvedCount, total: items.length, points: totalPoints, ratio, stars: starsForRatio(ratio, 0.85, 0.5) };
    })(),
  });

  if (isLoading) {
    return (
      <section className="quiz-welcome quiz-enter">
        <span className="quiz-hero-icon quiz-hero-icon--loading" aria-hidden="true"><Loader2 /></span>
        <div role="status">
          <span className="quiz-eyebrow">{t('quiz.generatingEyebrow')}</span>
          <h3>{t('quiz.whoAmI.generatingTitle')}</h3>
          <p className="quiz-description">{t('quiz.whoAmI.generatingDesc')}</p>
        </div>
        <div className="quiz-skeleton" aria-hidden="true">
          {['78%', '58%', '84%', '64%'].map((width, idx) => (
            <div key={idx} className="quiz-skeleton-row" style={{ animationDelay: `${idx * 120}ms` }}>
              <span className="quiz-skeleton-badge" />
              <span className="quiz-skeleton-line" style={{ width }} />
            </div>
          ))}
        </div>
        <button type="button" className="quiz-button quiz-button--quiet" onClick={handleCancelGeneration}>
          {t('quiz.cancelBtn')}
        </button>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="quiz-welcome quiz-enter">
        <span className="quiz-hero-icon" aria-hidden="true"><GameWhoAmIIcon /></span>
        <span className="quiz-eyebrow">{t('quiz.introEyebrow')}</span>
        <h3>{t('quiz.whoAmI.introTitle')}</h3>
        <p className="quiz-description">{t('quiz.whoAmI.introDesc')}</p>
        <div className="quiz-details">
          <span>{t('quiz.eventsCountBadge').replace('{count}', String(totalEventsCount))}</span>
          <span><Eye aria-hidden="true" />{t('quiz.whoAmI.cardDesc')}</span>
        </div>
        {error && (
          <div className="quiz-error" role="alert">
            <AlertTriangle aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        <button
          type="button"
          className="quiz-button quiz-button--primary"
          onClick={() => handleGenerate(false)}
          disabled={totalEventsCount === 0}
        >
          <Sparkles aria-hidden="true" />
          <span>{t('quiz.whoAmI.createBtn')}</span>
          <NextArrow aria-hidden="true" />
        </button>
      </section>
    );
  }

  if (isCompleted) {
    const ratio = items.length > 0 ? solvedCount / items.length : 0;
    const resultsTitle =
      ratio >= 0.85
        ? t('quiz.whoAmI.resultsTitlePerfect')
        : ratio >= 0.5
        ? t('quiz.whoAmI.resultsTitleGreat')
        : t('quiz.whoAmI.resultsTitleGood');

    return (
      <GameResults
        ratio={ratio}
        starCount={starsForRatio(ratio, 0.85, 0.5)}
        title={resultsTitle}
        subtitle={t('quiz.whoAmI.resultsSubtitle')
          .replace('{solved}', String(solvedCount))
          .replace('{total}', String(items.length))
          .replace('{points}', formatPoints(totalPoints, lang))}
        scoreValue={solvedCount}
        scoreSuffix={` / ${items.length}`}
        scoreCaption={t('quiz.sequence.scoreLabel').replace('{points}', formatPoints(totalPoints, lang))}
        recap={items.map((it, idx) => {
          const art = articlesById[it.target_event_id];
          return {
            key: it.target_event_id || idx,
            tone: roundResults[idx] === 'wrong' ? 'wrong' : roundResults[idx] ? 'correct' : 'neutral',
            title: it.target_title || art?.title,
            meta: art ? formatGameYear(art.from?.year ?? art.from_?.year, lang) : null,
            onClick: onSelectEvent && art ? () => onSelectEvent(art) : null,
          };
        })}
        actions={[
          { key: 'new', label: t('quiz.whoAmI.newMysteriesBtn'), Icon: RefreshCw, onClick: () => handleGenerate(true) },
          { key: 'again', label: t('quiz.whoAmI.playAgainBtn'), Icon: RotateCcw, onClick: handlePlayAgainSame, variant: 'secondary' },
        ]}
      />
    );
  }

  return (
    <div className="game-stack wai-game quiz-enter">
      <GameHud
        label={t('quiz.whoAmI.roundProgress')
          .replace('{current}', String(currentIndex + 1))
          .replace('{total}', String(items.length))}
        stats={[
          {
            key: 'value',
            Icon: Star,
            tone: 'score',
            text: t('quiz.whoAmI.potentialPoints').replace(
              '{points}',
              formatPoints(roundOutcome ? roundOutcome.points : potentialPoints, lang)
            ),
          },
        ]}
        total={items.length}
        current={currentIndex}
        results={roundResults}
      />

      <section className="game-card wai-clues" aria-live="polite">
        <header className="wai-clues-head">
          <span className="game-eyebrow">
            <HelpCircle aria-hidden="true" />
            <span dir={getTextDir(currentMystery?.category_hint || '')}>
              {currentMystery?.category_hint || t('quiz.whoAmI.title')}
            </span>
          </span>
          <span className="wai-clue-meter">
            <span className="wai-clue-count">
              {t('quiz.whoAmI.cluesRevealed')
                .replace('{current}', String(revealedCount))
                .replace('{total}', String(clues.length))}
            </span>
            <span className="wai-clue-pips" aria-hidden="true">
              {clues.map((_, idx) => (
                <i key={idx} data-on={idx < revealedCount || undefined} />
              ))}
            </span>
          </span>
        </header>

        <ol className="wai-clue-list">
          {clues.slice(0, revealedCount).map((clueText, idx) => (
            <li
              key={idx}
              className="wai-clue"
              data-latest={(idx === revealedCount - 1 && !roundOutcome) || undefined}
              dir={getTextDir(clueText)}
            >
              <span className="wai-clue-num" aria-label={t('quiz.whoAmI.clueNumber').replace('{num}', String(idx + 1))}>
                {idx + 1}
              </span>
              <p>{clueText}</p>
            </li>
          ))}
        </ol>

        {!roundOutcome && (
          <footer className="wai-clue-actions">
            {revealedCount < clues.length ? (
              <button type="button" className="game-tool-btn" onClick={handleRevealNextClue}>
                <Eye aria-hidden="true" />
                <span>{t('quiz.whoAmI.revealNextClue')}</span>
              </button>
            ) : (
              <span className="game-chip">{t('quiz.whoAmI.allCluesRevealed')}</span>
            )}
            <button type="button" className="game-text-btn" onClick={handleGiveUp}>
              {t('quiz.whoAmI.giveUpBtn')}
            </button>
          </footer>
        )}
      </section>

      {!roundOutcome && directionHint && (
        <p className="game-note game-note--warning quiz-enter" role="status">
          <Hourglass aria-hidden="true" />
          <span>{directionHint}</span>
        </p>
      )}

      {roundOutcome ? (
        <RoundFeedback
          tone={roundOutcome.solved ? 'correct' : 'wrong'}
          Icon={roundOutcome.solved ? CheckCircle2 : Eye}
          title={roundOutcome.solved
            ? t('quiz.whoAmI.solvedTitle').replace('{points}', formatPoints(roundOutcome.points, lang))
            : t('quiz.whoAmI.revealedTitle')}
          onShowEvent={onSelectEvent && targetEvent ? () => onSelectEvent(targetEvent) : null}
          nextLabel={currentIndex + 1 < items.length ? t('quiz.whoAmI.nextMysteryBtn') : t('quiz.whoAmI.finishBtn')}
          onNext={handleNextMystery}
        >
          <div className="game-event-tile">
            {targetEvent?.imageUrl && (
              <img src={targetEvent.imageUrl} alt="" className="game-thumb" loading="lazy" />
            )}
            <div className="game-event-tile-text">
              <strong dir={getTextDir(currentMystery.target_title)}>{currentMystery.target_title}</strong>
              {targetEvent && (
                <span>{formatGameYear(targetEvent.from?.year ?? targetEvent.from_?.year, lang)}</span>
              )}
            </div>
          </div>
          {currentMystery.fun_fact && (
            <p dir={getTextDir(currentMystery.fun_fact)}>{currentMystery.fun_fact}</p>
          )}
        </RoundFeedback>
      ) : (
        <section className="wai-picker" aria-label={t('quiz.whoAmI.pickEventPrompt')}>
          <h4 className="game-section-label">{t('quiz.whoAmI.pickEventPrompt')}</h4>
          {sortedArticles.length > 5 && (
            <label className="game-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('quiz.whoAmI.searchEventsPlaceholder')}
                aria-label={t('quiz.whoAmI.searchEventsPlaceholder')}
              />
            </label>
          )}
          <ul className="wai-options">
            {filteredEvents.map((art) => {
              const isEliminated = wrongEventIds.includes(art.id);
              return (
                <li key={art.id}>
                  <button
                    type="button"
                    disabled={isEliminated}
                    className="wai-option"
                    data-eliminated={isEliminated || undefined}
                    onClick={() => handleGuessEvent(art)}
                  >
                    <span className="wai-option-year">{formatGameYear(art.from?.year ?? art.from_?.year, lang)}</span>
                    <span className="wai-option-title" dir={getTextDir(art.title)}>{art.title}</span>
                    {isEliminated && <X aria-hidden="true" className="wai-option-x" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
