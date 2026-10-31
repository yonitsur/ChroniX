import React, { useState, useMemo, useCallback } from 'react';
import confetti from 'canvas-confetti';
import {
  Star,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Layers,
  Flame,
  GripVertical,
  Plus,
  Hourglass,
} from '../icons/ThemeIcons';
import { useLanguage } from '../../context/LanguageContext';
import { getTextDir } from '../../utils/textDirection';
import {
  getEventSortValue,
  formatEventDisplayDate,
  scrubEventSpoilers,
  shuffleArray,
} from './gameUtils';
import { GameHud, GameResults, RoundFeedback, formatPoints, starsForRatio } from './GameChrome';
import useGameCompletionReport from '../../hooks/useGameCompletionReport';

const MAX_DECK_CARDS = 6; // 1 anchor + up to 6 mystery cards = 7-event sequence

export default function SequenceGame({ timeline, onSelectEvent }) {
  const { t, language: lang, contentMode } = useLanguage();
  const isKidsMode = contentMode === 'kids';
  const [sessionSeed, setSessionSeed] = useState(0);
  const [placedEvents, setPlacedEvents] = useState([]);
  const [deck, setDeck] = useState([]);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [turnFeedback, setTurnFeedback] = useState(null); // { isCorrect, card, chosenSlot, correctSlot, formattedDate }
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [dragOverSlot, setDragOverSlot] = useState(null);
  const [isDraggingCard, setIsDraggingCard] = useState(false);

  const validArticles = useMemo(() => {
    const articles = Array.isArray(timeline?.articles) ? timeline.articles : [];
    const withDates = articles.filter(
      (a) => a && a.title && (a.from?.year != null || a.from_?.year != null)
    );
    // Deduplicate events with identical sort value so every slot has a clear answer
    const bySortVal = new Map();
    for (const art of withDates) {
      const key = getEventSortValue(art).toFixed(5);
      if (!bySortVal.has(key)) {
        bySortVal.set(key, art);
      }
    }
    const unique = Array.from(bySortVal.values());
    return unique.length >= 2 ? unique : withDates;
  }, [timeline?.articles]);

  // Decide if month/day should be shown (when multiple events share the same year)
  const includeMonthDay = useMemo(() => {
    const years = validArticles.map((a) => Number(a.from?.year ?? a.from_?.year ?? 0));
    return new Set(years).size < validArticles.length;
  }, [validArticles]);

  const initSession = useCallback(
    (articlesList) => {
      if (!articlesList || articlesList.length < 2) return;
      const shuffled = shuffleArray(articlesList);
      const selected = shuffled.slice(0, Math.min(MAX_DECK_CARDS + 1, shuffled.length));
      const anchor = { ...selected[0], isAnchor: true };
      const remaining = selected.slice(1);
      setPlacedEvents([anchor]);
      setDeck(remaining);
      setCurrentCardIndex(0);
      setTurnFeedback(null);
      setScore(0);
      setCorrectCount(0);
      setStreak(0);
      setIsCompleted(false);
      setDragOverSlot(null);
    },
    []
  );

  // Initialize whenever timeline or sessionSeed changes
  React.useEffect(() => {
    initSession(validArticles);
  }, [validArticles, sessionSeed, initSession]);

  const currentCard = deck[currentCardIndex] || null;
  const totalCards = deck.length;

  useGameCompletionReport({
    game: 'sequence',
    timelineId: timeline?.id,
    contentMode,
    isCompleted,
    stats: (() => {
      const ratio = totalCards > 0 ? correctCount / totalCards : 0;
      return { correct: correctCount, total: totalCards, points: score, ratio, stars: starsForRatio(ratio, 0.85, 0.5) };
    })(),
  });

  const handlePlaceAtSlot = (slotIndex) => {
    if (!currentCard || turnFeedback) return;

    const cardSortVal = getEventSortValue(currentCard);
    const prevEvent = slotIndex > 0 ? placedEvents[slotIndex - 1] : null;
    const nextEvent = slotIndex < placedEvents.length ? placedEvents[slotIndex] : null;

    const prevSortVal = prevEvent ? getEventSortValue(prevEvent) : -Infinity;
    const nextSortVal = nextEvent ? getEventSortValue(nextEvent) : Infinity;

    const isCorrect = cardSortVal >= prevSortVal && cardSortVal <= nextSortVal;

    // Find true chronological insertion index so the sequence remains sorted
    let trueSlot = 0;
    while (
      trueSlot < placedEvents.length &&
      getEventSortValue(placedEvents[trueSlot]) < cardSortVal
    ) {
      trueSlot += 1;
    }

    const updatedPlaced = [...placedEvents];
    updatedPlaced.splice(trueSlot, 0, {
      ...currentCard,
      placedCorrectly: isCorrect,
    });
    setPlacedEvents(updatedPlaced);

    const formattedDate = formatEventDisplayDate(currentCard, lang, includeMonthDay);
    if (isCorrect) {
      const newStreak = streak + 1;
      const earned = 150 + streak * 30;
      setScore((prev) => prev + earned);
      setCorrectCount((prev) => prev + 1);
      setStreak(newStreak);
    } else {
      setStreak(0);
    }

    setTurnFeedback({
      isCorrect,
      card: currentCard,
      chosenSlot: slotIndex,
      correctSlot: trueSlot,
      formattedDate,
    });
    setDragOverSlot(null);
    setIsDraggingCard(false);
  };

  const handleNextTurn = () => {
    if (currentCardIndex + 1 < totalCards) {
      setCurrentCardIndex((prev) => prev + 1);
      setTurnFeedback(null);
    } else {
      setIsCompleted(true);
      setTurnFeedback(null);
      if (totalCards > 0 && correctCount / totalCards >= 0.6) {
        confetti({
          particleCount: isKidsMode ? 75 : 40,
          spread: 65,
          origin: { x: 0.35, y: 0.6 },
          disableForReducedMotion: true,
        });
      }
    }
  };

  const handleRestart = () => {
    setSessionSeed((s) => s + 1);
  };

  const getSlotLabel = (slotIndex) => {
    if (placedEvents.length === 0) return t('quiz.sequence.placeHere');
    if (slotIndex === 0) {
      const firstYear = formatEventDisplayDate(placedEvents[0], lang, includeMonthDay);
      return t('quiz.sequence.slotBeforeFirst').replace('{year}', firstYear);
    }
    if (slotIndex === placedEvents.length) {
      const lastYear = formatEventDisplayDate(
        placedEvents[placedEvents.length - 1],
        lang,
        includeMonthDay
      );
      return t('quiz.sequence.slotAfterLast').replace('{year}', lastYear);
    }
    const prevYear = formatEventDisplayDate(placedEvents[slotIndex - 1], lang, includeMonthDay);
    const nextYear = formatEventDisplayDate(placedEvents[slotIndex], lang, includeMonthDay);
    return t('quiz.sequence.slotBetween')
      .replace('{prevYear}', prevYear)
      .replace('{nextYear}', nextYear);
  };

  if (validArticles.length < 2) {
    return (
      <div className="game-empty">
        <p>{t('quiz.needMoreEvents').replace('{min}', '2')}</p>
      </div>
    );
  }

  const roundResults = deck.map((card) => {
    const placed = placedEvents.find((ev) => ev.id === card.id && !ev.isAnchor);
    if (!placed) return undefined;
    return placed.placedCorrectly ? 'correct' : 'wrong';
  });

  if (isCompleted) {
    const ratio = totalCards > 0 ? correctCount / totalCards : 0;
    const resultsTitle =
      ratio >= 0.85
        ? t('quiz.sequence.resultsTitlePerfect')
        : ratio >= 0.5
        ? t('quiz.sequence.resultsTitleGreat')
        : t('quiz.sequence.resultsTitleGood');

    return (
      <GameResults
        ratio={ratio}
        starCount={starsForRatio(ratio, 0.85, 0.5)}
        title={resultsTitle}
        subtitle={t('quiz.sequence.resultsSubtitle')
          .replace('{correct}', String(correctCount))
          .replace('{total}', String(totalCards))
          .replace('{points}', formatPoints(score, lang))}
        scoreValue={correctCount}
        scoreSuffix={` / ${totalCards}`}
        scoreCaption={t('quiz.sequence.scoreLabel').replace('{points}', formatPoints(score, lang))}
        recapTitle={t('quiz.sequence.finalSequenceTitle')}
        recap={placedEvents.map((ev, idx) => ({
          key: ev.id || idx,
          tone: ev.isAnchor ? 'neutral' : ev.placedCorrectly ? 'correct' : 'wrong',
          title: ev.title,
          detail: ev.isAnchor ? t('quiz.sequence.anchorBadge') : null,
          meta: formatEventDisplayDate(ev, lang, includeMonthDay),
          onClick: onSelectEvent ? () => onSelectEvent(ev) : null,
        }))}
        actions={[
          { key: 'again', label: t('quiz.sequence.playAgainBtn'), Icon: RotateCcw, onClick: handleRestart },
        ]}
      />
    );
  }

  const scrubbedSubtitle = currentCard
    ? scrubEventSpoilers(currentCard.subtitle || currentCard.extract || '', currentCard, {
        scrubYears: true,
        scrubLocation: false,
      })
    : '';

  const renderSlot = (slotIndex) => (
    <li className="seq-slot-item" key={`slot-${slotIndex}`}>
      <button
        type="button"
        className="seq-slot"
        data-over={dragOverSlot === slotIndex || undefined}
        data-dragging={isDraggingCard || undefined}
        onClick={() => handlePlaceAtSlot(slotIndex)}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (dragOverSlot !== slotIndex) setDragOverSlot(slotIndex);
        }}
        onDragLeave={() => {
          if (dragOverSlot === slotIndex) setDragOverSlot(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          handlePlaceAtSlot(slotIndex);
        }}
      >
        <span className="seq-slot-plus" aria-hidden="true"><Plus /></span>
        <span className="seq-slot-label">{getSlotLabel(slotIndex)}</span>
      </button>
    </li>
  );

  return (
    <div className="game-stack seq-game quiz-enter">
      <GameHud
        label={t('quiz.sequence.roundProgress')
          .replace('{current}', String(Math.min(currentCardIndex + 1, totalCards)))
          .replace('{total}', String(totalCards))}
        stats={[
          ...(streak > 1
            ? [{ key: 'streak', Icon: Flame, tone: 'streak', text: t('quiz.sequence.streakLabel').replace('{count}', String(streak)) }]
            : []),
          { key: 'score', Icon: Star, tone: 'score', text: t('quiz.sequence.scoreLabel').replace('{points}', formatPoints(score, lang)) },
        ]}
        total={totalCards}
        current={currentCardIndex}
        results={roundResults}
      />

      {!turnFeedback && currentCard && (
        <article
          className="game-card seq-card"
          data-dragging={isDraggingCard || undefined}
          draggable
          onDragStart={(e) => {
            setIsDraggingCard(true);
            e.dataTransfer.effectAllowed = 'move';
            try {
              e.dataTransfer.setData('text/plain', currentCard.id || 'card');
            } catch {
              // ignore
            }
          }}
          onDragEnd={() => {
            setIsDraggingCard(false);
            setDragOverSlot(null);
          }}
        >
          <header className="seq-card-top">
            <span className="game-eyebrow">
              <GripVertical aria-hidden="true" className="seq-card-grip" />
              {t('quiz.sequence.currentCardEyebrow')}
            </span>
            <span className="game-chip game-chip--mystery">
              <Hourglass aria-hidden="true" />
              {t('quiz.sequence.mysteryYear')}
            </span>
          </header>
          <div className="seq-card-body">
            {currentCard.imageUrl && (
              <img src={currentCard.imageUrl} alt="" className="game-thumb seq-card-thumb" loading="lazy" draggable={false} />
            )}
            <div className="seq-card-text">
              <h4 className="game-title" dir={getTextDir(currentCard.title)}>{currentCard.title}</h4>
              {scrubbedSubtitle && (
                <p className="game-body-text" dir={getTextDir(scrubbedSubtitle)}>{scrubbedSubtitle}</p>
              )}
            </div>
          </div>
          <footer className="game-card-hint">
            <Layers aria-hidden="true" />
            <span>{t('quiz.sequence.dragOrTapHint')}</span>
          </footer>
        </article>
      )}

      {turnFeedback && (
        <RoundFeedback
          tone={turnFeedback.isCorrect ? 'correct' : 'wrong'}
          Icon={turnFeedback.isCorrect ? CheckCircle2 : XCircle}
          title={(turnFeedback.isCorrect ? t('quiz.sequence.placedCorrect') : t('quiz.sequence.placedWrong'))
            .replace('{year}', turnFeedback.formattedDate)}
          onShowEvent={onSelectEvent && turnFeedback.card ? () => onSelectEvent(turnFeedback.card) : null}
          nextLabel={currentCardIndex + 1 < totalCards ? t('quiz.sequence.nextCardBtn') : t('quiz.sequence.finishBtn')}
          onNext={handleNextTurn}
        >
          {turnFeedback.card?.subtitle && (
            <p dir={getTextDir(turnFeedback.card.subtitle)}>{turnFeedback.card.subtitle}</p>
          )}
        </RoundFeedback>
      )}

      <ol className="seq-track" data-placing={!turnFeedback || undefined}>
        {placedEvents.map((ev, idx) => {
          const isJustPlaced = turnFeedback && turnFeedback.card && ev.id === turnFeedback.card.id;
          const state = isJustPlaced ? (turnFeedback.isCorrect ? 'correct' : 'wrong') : ev.isAnchor ? 'anchor' : 'placed';
          return (
            <React.Fragment key={ev.id || idx}>
              {!turnFeedback && renderSlot(idx)}
              <li className="seq-node" data-state={state}>
                <span className="seq-node-date">{formatEventDisplayDate(ev, lang, includeMonthDay)}</span>
                <span className="seq-node-title" dir={getTextDir(ev.title)}>{ev.title}</span>
                {ev.isAnchor && <span className="game-chip seq-anchor-chip">{t('quiz.sequence.anchorBadge')}</span>}
              </li>
            </React.Fragment>
          );
        })}
        {!turnFeedback && renderSlot(placedEvents.length)}
      </ol>
    </div>
  );
}
