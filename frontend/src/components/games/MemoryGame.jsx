import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  Star,
  Flame,
  RotateCcw,
  Eye,
  Sparkles,
  Check,
  CheckCircle2,
  Image as ImageIcon,
  Calendar,
  Crosshair,
} from '../icons/ThemeIcons';
import { useLanguage } from '../../context/LanguageContext';
import { getTextDir } from '../../utils/textDirection';
import ChroniXLogo from '../ChroniXLogo';
import { formatEventDisplayDate, formatGameYear, shuffleArray } from './gameUtils';
import { GameHud, GameResults, formatPoints, starsForRatio } from './GameChrome';
import useGameCompletionReport from '../../hooks/useGameCompletionReport';

const PAIR_OPTIONS = [
  { id: 'easy', pairs: 4, parMoves: 7 },
  { id: 'medium', pairs: 6, parMoves: 11 },
  { id: 'hard', pairs: 8, parMoves: 15 },
];

const MAX_PEEKS = 2;

export default function MemoryGame({ timeline, onSelectEvent }) {
  const { t, language: lang, contentMode } = useLanguage();
  const isKidsMode = contentMode === 'kids';

  const allArticles = useMemo(
    () => (Array.isArray(timeline?.articles) ? timeline.articles.filter((a) => a && a.title) : []),
    [timeline?.articles]
  );

  const articlesWithImages = useMemo(
    () =>
      allArticles.filter(
        (a) => typeof a?.imageUrl === 'string' && a.imageUrl.trim().length > 0
      ),
    [allArticles]
  );

  // Decide if month/day should be shown (when multiple events share the same year)
  const includeMonthDay = useMemo(() => {
    const years = allArticles.map((a) => Number(a.from?.year ?? a.from_?.year ?? 0));
    return new Set(years).size < allArticles.length;
  }, [allArticles]);

  // Play mode:
  // 'smart'  -> Card A: Image (or Date emblem) <-> Card B: Event Title + Year
  // 'visual' -> Card A: Image + Caption        <-> Card B: Image + Caption
  const [playMode, setPlayMode] = useState(() => (isKidsMode ? 'visual' : 'smart'));

  // Difficulty / pair count
  const [difficultyId, setDifficultyId] = useState(() =>
    allArticles.length >= 6 ? 'medium' : 'easy'
  );

  const availablePairOptions = useMemo(() => {
    return PAIR_OPTIONS.filter((opt, idx) => idx === 0 || allArticles.length >= opt.pairs);
  }, [allArticles.length]);

  const activeDifficulty = useMemo(() => {
    const found = availablePairOptions.find((d) => d.id === difficultyId);
    return found || availablePairOptions[availablePairOptions.length - 1] || PAIR_OPTIONS[0];
  }, [availablePairOptions, difficultyId]);

  const targetPairs = Math.min(activeDifficulty.pairs, allArticles.length);

  // Board state
  const [cards, setCards] = useState([]);
  const [selectedEvents, setSelectedEvents] = useState([]);
  const [flippedIndices, setFlippedIndices] = useState([]);
  const [matchedPairIds, setMatchedPairIds] = useState([]);
  const [wrongIndices, setWrongIndices] = useState([]);
  const [moves, setMoves] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [score, setScore] = useState(0);
  const [peeksUsed, setPeeksUsed] = useState(0);
  const [isPeeking, setIsPeeking] = useState(false);
  const [lastMatchedEvent, setLastMatchedEvent] = useState(null);
  const [isCompleted, setIsCompleted] = useState(false);

  const lockBoardRef = useRef(false);
  const flipTimerRef = useRef(null);
  const peekTimerRef = useRef(null);
  const completeTimerRef = useRef(null);

  const clearTimers = useCallback(() => {
    if (flipTimerRef.current) clearTimeout(flipTimerRef.current);
    if (peekTimerRef.current) clearTimeout(peekTimerRef.current);
    if (completeTimerRef.current) clearTimeout(completeTimerRef.current);
  }, []);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  const initGame = useCallback(
    (numPairs, mode) => {
      clearTimers();
      lockBoardRef.current = false;

      if (allArticles.length < 2) return;

      // Prioritize events with images so the board is visually rich
      const withImgs = shuffleArray(articlesWithImages);
      const withoutImgs = shuffleArray(
        allArticles.filter(
          (a) => !(typeof a?.imageUrl === 'string' && a.imageUrl.trim().length > 0)
        )
      );
      const chosen = [...withImgs, ...withoutImgs].slice(0, numPairs);

      const deck = [];
      chosen.forEach((art, pairIdx) => {
        const pairId = String(art.id ?? `pair-${pairIdx}`);
        const hasImage = typeof art.imageUrl === 'string' && art.imageUrl.trim().length > 0;
        const formattedDate = formatEventDisplayDate(art, lang, includeMonthDay);
        const shortYear = formatGameYear(art.from?.year ?? art.from_?.year, lang);

        if (mode === 'smart') {
          // Card A: Visual image card (or stylized date card if no image)
          deck.push({
            uid: `${pairId}-a`,
            pairId,
            kind: hasImage ? 'image' : 'date',
            article: art,
            hasImage,
            imageUrl: art.imageUrl || null,
            title: art.title,
            formattedDate,
            shortYear,
          });
          // Card B: Event Title + Date card
          deck.push({
            uid: `${pairId}-b`,
            pairId,
            kind: 'title',
            article: art,
            hasImage,
            imageUrl: art.imageUrl || null,
            title: art.title,
            formattedDate,
            shortYear,
          });
        } else {
          // 'visual' twin mode: Both cards show the image + caption (or title + date)
          deck.push({
            uid: `${pairId}-a`,
            pairId,
            kind: hasImage ? 'twin-image' : 'title',
            article: art,
            hasImage,
            imageUrl: art.imageUrl || null,
            title: art.title,
            formattedDate,
            shortYear,
          });
          deck.push({
            uid: `${pairId}-b`,
            pairId,
            kind: hasImage ? 'twin-image' : 'title',
            article: art,
            hasImage,
            imageUrl: art.imageUrl || null,
            title: art.title,
            formattedDate,
            shortYear,
          });
        }
      });

      setSelectedEvents(chosen);
      setCards(shuffleArray(deck));
      setFlippedIndices([]);
      setMatchedPairIds([]);
      setWrongIndices([]);
      setMoves(0);
      setStreak(0);
      setBestStreak(0);
      setScore(0);
      setPeeksUsed(0);
      setIsPeeking(false);
      setLastMatchedEvent(null);
      setIsCompleted(false);
    },
    [allArticles, articlesWithImages, clearTimers, includeMonthDay, lang]
  );

  useEffect(() => {
    initGame(targetPairs, playMode);
  }, [targetPairs, playMode, initGame]);

  const handleCardClick = (idx) => {
    if (lockBoardRef.current || isPeeking || isCompleted) return;
    const clickedCard = cards[idx];
    if (!clickedCard) return;
    if (matchedPairIds.includes(clickedCard.pairId)) return;
    if (flippedIndices.includes(idx)) return;

    const nextFlipped = [...flippedIndices, idx];
    setFlippedIndices(nextFlipped);

    if (nextFlipped.length < 2) return;

    // Two cards flipped: evaluate match
    const [firstIdx, secondIdx] = nextFlipped;
    const firstCard = cards[firstIdx];
    const secondCard = cards[secondIdx];
    const nextMoves = moves + 1;
    setMoves(nextMoves);

    if (firstCard.pairId === secondCard.pairId) {
      // Match found!
      const nextMatched = [...matchedPairIds, firstCard.pairId];
      const nextStreak = streak + 1;
      const earned = 150 + streak * 45;
      const nextScore = score + earned;

      setMatchedPairIds(nextMatched);
      setFlippedIndices([]);
      setStreak(nextStreak);
      setBestStreak((prev) => Math.max(prev, nextStreak));
      setScore(nextScore);
      setLastMatchedEvent(firstCard.article);

      if (nextMatched.length === selectedEvents.length) {
        // Board cleared! Add efficiency bonus based on par moves
        const efficiencyBonus = Math.max(0, (activeDifficulty.parMoves - nextMoves) * 25);
        if (efficiencyBonus > 0) {
          setScore((prev) => prev + efficiencyBonus);
        }

        confetti({
          particleCount: isKidsMode ? 80 : 45,
          spread: 68,
          origin: { x: 0.35, y: 0.6 },
          disableForReducedMotion: true,
        });

        completeTimerRef.current = setTimeout(() => {
          setIsCompleted(true);
        }, 850);
      }
    } else {
      // Mismatch: show brief wrong state then flip back
      lockBoardRef.current = true;
      setStreak(0);
      setWrongIndices([firstIdx, secondIdx]);

      flipTimerRef.current = setTimeout(() => {
        setFlippedIndices([]);
        setWrongIndices([]);
        lockBoardRef.current = false;
      }, 950);
    }
  };

  const handlePeek = () => {
    if (isPeeking || peeksUsed >= MAX_PEEKS || isCompleted) return;
    setPeeksUsed((prev) => prev + 1);
    setIsPeeking(true);
    setScore((prev) => Math.max(0, prev - 50));

    peekTimerRef.current = setTimeout(() => {
      setIsPeeking(false);
    }, 1500);
  };

  useGameCompletionReport({
    game: 'memory',
    timelineId: timeline?.id,
    contentMode,
    isCompleted,
    stats: (() => {
      const pairs = selectedEvents.length;
      const par = Math.max(pairs + 2, activeDifficulty.parMoves);
      const ratio = pairs === 0 ? 0 : moves <= par ? 1 : Math.max(0.35, 1 - (moves - par) * 0.08);
      return {
        correct: matchedPairIds.length,
        total: pairs,
        points: score,
        ratio,
        stars: starsForRatio(ratio, 0.85, 0.55),
        difficulty: activeDifficulty.id,
      };
    })(),
  });

  if (allArticles.length < 2) {
    return (
      <div className="game-empty">
        <p>{t('quiz.needMoreEvents').replace('{min}', '2')}</p>
      </div>
    );
  }

  const totalPairs = selectedEvents.length;
  const matchedCount = matchedPairIds.length;

  // Compute star ratio based on move efficiency (perfect <= parMoves, good <= parMoves * 1.6)
  const efficiencyRatio = useMemo(() => {
    if (totalPairs === 0) return 0;
    const minPossibleMoves = totalPairs;
    const par = Math.max(minPossibleMoves + 2, activeDifficulty.parMoves);
    if (moves <= par) return 1;
    const extra = moves - par;
    return Math.max(0.35, 1 - extra * 0.08);
  }, [totalPairs, activeDifficulty.parMoves, moves]);

  if (isCompleted) {
    const ratio = efficiencyRatio;
    const resultsTitle =
      ratio >= 0.85
        ? t('quiz.memory.resultsTitlePerfect')
        : ratio >= 0.55
        ? t('quiz.memory.resultsTitleGreat')
        : t('quiz.memory.resultsTitleGood');

    return (
      <GameResults
        ratio={ratio}
        starCount={starsForRatio(ratio, 0.85, 0.55)}
        title={resultsTitle}
        subtitle={t('quiz.memory.resultsSubtitle')
          .replace('{pairs}', String(totalPairs))
          .replace('{moves}', String(moves))
          .replace('{points}', formatPoints(score, lang))}
        scoreValue={formatPoints(score, lang)}
        scoreCaption={t('quiz.memory.movesSummary')
          .replace('{moves}', String(moves))
          .replace('{streak}', String(bestStreak))}
        recapTitle={t('quiz.memory.matchedEventsTitle')}
        recap={selectedEvents.map((ev, idx) => ({
          key: ev.id || idx,
          tone: 'correct',
          title: ev.title,
          detail: ev.subtitle || null,
          meta: formatEventDisplayDate(ev, lang, includeMonthDay),
          onClick: onSelectEvent ? () => onSelectEvent(ev) : null,
        }))}
        actions={[
          {
            key: 'again',
            label: t('quiz.memory.playAgainBtn'),
            Icon: RotateCcw,
            onClick: () => initGame(targetPairs, playMode),
          },
        ]}
      />
    );
  }

  const hudResults = Array.from({ length: totalPairs }, (_, idx) =>
    idx < matchedCount ? 'correct' : undefined
  );

  return (
    <div className="game-stack mem-game quiz-enter">
      <GameHud
        label={t('quiz.memory.pairsProgress')
          .replace('{matched}', String(matchedCount))
          .replace('{total}', String(totalPairs))}
        stats={[
          {
            key: 'moves',
            text: t('quiz.memory.movesLabel').replace('{moves}', String(moves)),
          },
          ...(streak >= 2
            ? [
                {
                  key: 'streak',
                  Icon: Flame,
                  text: t('quiz.memory.streakLabel').replace('{count}', String(streak)),
                  tone: 'streak',
                },
              ]
            : []),
          {
            key: 'score',
            Icon: Star,
            text: formatPoints(score, lang),
            tone: 'score',
          },
        ]}
        total={totalPairs}
        current={matchedCount}
        results={hudResults}
      />

      {/* Mode & Grid Size Controls */}
      <section className="game-card mem-stage">
        <div className="mem-stage-bar">
          <div
            className="game-segmented game-segmented--compact"
            role="radiogroup"
            aria-label={t('quiz.memory.modeLabel')}
          >
            <button
              type="button"
              role="radio"
              aria-checked={playMode === 'smart'}
              className="game-segment"
              onClick={() => setPlayMode('smart')}
            >
              <Sparkles aria-hidden="true" />
              <span>{t('quiz.memory.modeSmart')}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={playMode === 'visual'}
              className="game-segment"
              onClick={() => setPlayMode('visual')}
            >
              <ImageIcon aria-hidden="true" />
              <span>{t('quiz.memory.modeVisual')}</span>
            </button>
          </div>

          {availablePairOptions.length > 1 && (
            <div
              className="game-segmented game-segmented--compact"
              role="radiogroup"
              aria-label={t('quiz.memory.sizeLabel')}
            >
              {availablePairOptions.map((opt) => {
                const pairCount = Math.min(opt.pairs, allArticles.length);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={activeDifficulty.id === opt.id}
                    className="game-segment"
                    onClick={() => setDifficultyId(opt.id)}
                  >
                    <span>
                      {t('quiz.memory.pairsCountChip').replace('{count}', String(pairCount))}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <p className="game-caption mem-mode-hint">
          {playMode === 'smart'
            ? t('quiz.memory.smartModeHint')
            : t('quiz.memory.visualModeHint')}
        </p>

        {/* Memory Cards Grid */}
        <div
          className="mem-grid"
          data-pairs={totalPairs}
          role="grid"
          aria-label={t('quiz.memory.title')}
        >
          {cards.map((card, idx) => {
            const isMatched = matchedPairIds.includes(card.pairId);
            const isFlipped = flippedIndices.includes(idx) || isMatched || isPeeking;
            const isWrong = wrongIndices.includes(idx);

            return (
              <button
                key={card.uid}
                type="button"
                className="mem-card"
                data-flipped={isFlipped || undefined}
                data-matched={isMatched || undefined}
                data-wrong={isWrong || undefined}
                data-kind={card.kind}
                disabled={isMatched}
                aria-pressed={isFlipped}
                aria-label={
                  isFlipped
                    ? `${card.title} (${card.formattedDate})`
                    : `${t('quiz.memory.cardBackLabel')} ${idx + 1}`
                }
                onClick={() => handleCardClick(idx)}
              >
                <div className="mem-card-inner">
                  {/* Face-down card back */}
                  <div className="mem-card-face mem-card-back" aria-hidden="true">
                    <span className="mem-card-num">{idx + 1}</span>
                    <span className="mem-card-emblem">
                      <ChroniXLogo iconOnly size="none" className="mem-card-logo" />
                    </span>
                  </div>

                  {/* Face-up card front */}
                  <div className="mem-card-face mem-card-front">
                    {card.kind === 'image' && card.imageUrl ? (
                      <div className="mem-card-photo-wrap">
                        <img
                          src={card.imageUrl}
                          alt={card.title}
                          loading="lazy"
                          className="mem-card-photo"
                        />
                        {isMatched && card.shortYear && (
                          <span className="mem-card-photo-badge">{card.shortYear}</span>
                        )}
                      </div>
                    ) : card.kind === 'twin-image' && card.imageUrl ? (
                      <div className="mem-card-photo-wrap">
                        <img
                          src={card.imageUrl}
                          alt={card.title}
                          loading="lazy"
                          className="mem-card-photo"
                        />
                        <div className="mem-card-photo-caption">
                          {card.shortYear && (
                            <span className="mem-card-caption-year">{card.shortYear}</span>
                          )}
                          <span
                            className="mem-card-caption-title"
                            dir={getTextDir(card.title)}
                          >
                            {card.title}
                          </span>
                        </div>
                      </div>
                    ) : card.kind === 'date' ? (
                      <div className="mem-card-text mem-card-text--date">
                        <Calendar className="mem-card-date-icon" aria-hidden="true" />
                        <strong className="mem-card-big-year" dir="ltr">
                          {card.formattedDate}
                        </strong>
                        {card.article?.category && (
                          <span className="mem-card-cat" dir={getTextDir(card.article.category)}>
                            {card.article.category}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="mem-card-text">
                        {card.formattedDate && (
                          <span className="game-chip game-chip--date mem-card-year-chip">
                            {card.formattedDate}
                          </span>
                        )}
                        <span
                          className="mem-card-title"
                          dir={getTextDir(card.title)}
                        >
                          {card.title}
                        </span>
                      </div>
                    )}

                    {isMatched && (
                      <span className="mem-card-check" aria-hidden="true">
                        <Check />
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Bottom Tools */}
        <footer className="puz-stage-foot mem-stage-foot">
          <div className="puz-tools">
            <button
              type="button"
              className="game-tool-btn"
              disabled={peeksUsed >= MAX_PEEKS || isPeeking}
              onClick={handlePeek}
            >
              <Eye aria-hidden="true" />
              <span>
                {peeksUsed >= MAX_PEEKS
                  ? t('quiz.memory.allPeeksUsed')
                  : t('quiz.memory.peekBtn')
                      .replace('{used}', String(peeksUsed))
                      .replace('{max}', String(MAX_PEEKS))}
              </span>
            </button>
            <button
              type="button"
              className="game-tool-btn"
              onClick={() => initGame(targetPairs, playMode)}
            >
              <RotateCcw aria-hidden="true" />
              <span>{t('quiz.memory.shuffleBtn')}</span>
            </button>
          </div>
        </footer>
      </section>

      {/* Spotlight card for the most recently matched event */}
      {lastMatchedEvent && (
        <section
          className="quiz-feedback game-feedback mem-spotlight quiz-enter"
          data-tone="correct"
          role="status"
        >
          <div className="quiz-feedback-title">
            <CheckCircle2 aria-hidden="true" />
            <h4>
              {t('quiz.memory.matchedSpotlightTitle').replace(
                '{year}',
                formatEventDisplayDate(lastMatchedEvent, lang, includeMonthDay)
              )}
            </h4>
          </div>
          <div className="game-feedback-body mem-spotlight-body">
            {lastMatchedEvent.imageUrl && (
              <img
                src={lastMatchedEvent.imageUrl}
                alt=""
                loading="lazy"
                className="mem-spotlight-img"
              />
            )}
            <div className="mem-spotlight-copy">
              <strong dir={getTextDir(lastMatchedEvent.title)}>
                {lastMatchedEvent.title}
              </strong>
              {lastMatchedEvent.subtitle && (
                <p dir={getTextDir(lastMatchedEvent.subtitle)}>
                  {lastMatchedEvent.subtitle}
                </p>
              )}
            </div>
          </div>
          {onSelectEvent && (
            <div className="game-feedback-actions">
              <button
                type="button"
                className="game-link-button"
                onClick={() => onSelectEvent(lastMatchedEvent)}
              >
                <Crosshair aria-hidden="true" />
                <span>{t('quiz.showOnTimeline')}</span>
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
