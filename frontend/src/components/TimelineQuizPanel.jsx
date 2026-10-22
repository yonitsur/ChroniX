import React, { useState, useEffect, useRef, useMemo } from 'react';
import confetti from 'canvas-confetti';
import {
  Trophy,
  Puzzle,
  X,
  Sparkles,
  Check,
  CheckCircle2,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  Star,
  Crosshair,
  Loader2,
  AlertTriangle,
  LayoutGrid,
} from './icons/ThemeIcons';
import {
  GameTriviaIcon,
  GamePuzzleIcon,
  GameTimeGuesserIcon,
  GameMemoryIcon,
  GameWordleIcon,
  GameSequenceIcon,
  GameWhoAmIIcon,
} from './icons/GameIcons';
import { useLanguage } from '../context/LanguageContext';
import { getTextDir } from '../utils/textDirection';
import { generateTimelineQuiz, cancelAiJob } from '../api';
import { EVENT_DRAWER_MIN_WIDTH, EVENT_DRAWER_KEY_STEP, clampEventDrawerWidth } from './EventDrawer';
import SequenceGame from './games/SequenceGame';
import TimeGuesserGame from './games/TimeGuesserGame';
import WhoAmIGame from './games/WhoAmIGame';
import WordleGame from './games/WordleGame';
import PuzzleGame from './games/PuzzleGame';
import MemoryGame from './games/MemoryGame';
import PanelNavButtons from './PanelNavButtons';
import useGameCompletionReport from '../hooks/useGameCompletionReport';
import '../styles/timelineQuiz.css';

const HEBREW_OPTION_LABELS = ['א', 'ב', 'ג', 'ד'];
const LATIN_OPTION_LABELS = ['A', 'B', 'C', 'D'];

export default function TimelineQuizPanel({
  timeline,
  isOpen,
  onClose,
  // Active game mode: 'hub' | 'sequence' | 'timeGuesser' | 'trivia' | 'whoAmI' | ... - owned by the
  // side panel history so choosing a game is a step that Back can return from.
  activeGame = 'hub',
  onSelectGame,
  // Show the "All Games" hub link inside a game (hidden when Back already leads to the hub).
  showHubLink = true,
  // Side panel Back/Forward descriptor (see PanelNavButtons); null when there's no history.
  panelNav = null,
  onQuizGenerated,
  onWhoAmIGenerated,
  onFocusArticle,
  onAfterGenerating,
  onWideModeChange,
  width = null,
  onWidthChange,
  style,
}) {
  const { t, isRtl, contentMode } = useLanguage();
  const isKidsMode = contentMode === 'kids';

  // Trivia state
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [isCompleted, setIsCompleted] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [previousQuestionsHistory, setPreviousQuestionsHistory] = useState([]);

  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [vh, setVh] = useState(() => window.innerHeight);
  const [snap, setSnap] = useState('full');
  const [dragDelta, setDragDelta] = useState(null);
  const touchStartYRef = useRef(null);
  const abortControllerRef = useRef(null);
  const activeJobIdRef = useRef(null);
  const lastTimelineIdRef = useRef(null);
  const panelRef = useRef(null);
  const bodyRef = useRef(null);
  const headingRef = useRef(null);
  const returnFocusRef = useRef(null);
  const resizeDragRef = useRef(null);
  const [liveWidth, setLiveWidth] = useState(null);
  const canResize = Boolean(onWidthChange) && !isMobile;

  const handleResizePointerDown = (e) => {
    if (e.button !== 0 || !panelRef.current) return;
    e.preventDefault();
    const startWidth = panelRef.current.getBoundingClientRect().width;
    resizeDragRef.current = { startX: e.clientX, startWidth, width: startWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
    setLiveWidth(startWidth);
  };
  const handleResizePointerMove = (e) => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    drag.width = clampEventDrawerWidth(drag.startWidth + e.clientX - drag.startX);
    setLiveWidth(drag.width);
  };
  const handleResizePointerEnd = () => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    resizeDragRef.current = null;
    setLiveWidth(null);
    if (Math.abs(drag.width - drag.startWidth) >= 1) onWidthChange(drag.width);
  };
  const handleResizeKeyDown = (e) => {
    const current = panelRef.current?.getBoundingClientRect().width || EVENT_DRAWER_MIN_WIDTH;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? EVENT_DRAWER_KEY_STEP : -EVENT_DRAWER_KEY_STEP;
      onWidthChange(clampEventDrawerWidth(current + delta));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onWidthChange(null);
    }
  };

  const isWideGame =
    activeGame === 'sequence' ||
    activeGame === 'timeGuesser' ||
    activeGame === 'wordle' ||
    activeGame === 'puzzle' ||
    activeGame === 'memory' ||
    activeGame === 'whoAmI';

  useEffect(() => {
    onWideModeChange?.(Boolean(isOpen && isWideGame));
  }, [isOpen, isWideGame, onWideModeChange]);

  useEffect(() => {
    const currentId = timeline?.id || null;
    if (currentId !== lastTimelineIdRef.current) {
      lastTimelineIdRef.current = currentId;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      if (activeJobIdRef.current) {
        cancelAiJob(activeJobIdRef.current);
        activeJobIdRef.current = null;
      }
      const existingQuiz = Array.isArray(timeline?.quiz) ? timeline.quiz : [];
      setQuestions(existingQuiz);
      setCurrentIndex(0);
      setSelectedAnswers({});
      setIsCompleted(false);
      setIsGenerating(false);
      setError(null);
      setPreviousQuestionsHistory(existingQuiz.map((q) => q.question).filter(Boolean));
    } else if (!questions.length && timeline?.quiz?.length && !isGenerating) {
      setQuestions(timeline.quiz);
      setPreviousQuestionsHistory(timeline.quiz.map((q) => q.question).filter(Boolean));
    }
  }, [timeline?.id, timeline?.quiz, questions.length, isGenerating]);

  useEffect(() => () => {
    abortControllerRef.current?.abort();
    if (activeJobIdRef.current) cancelAiJob(activeJobIdRef.current);
  }, []);

  useEffect(() => {
    const onResize = () => {
      setIsMobile(window.innerWidth < 768);
      setVh(window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    returnFocusRef.current = document.activeElement;
    setSnap('full');
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      if (panelRef.current?.contains(document.activeElement)) {
        returnFocusRef.current?.focus({ preventScroll: true });
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    bodyRef.current?.scrollTo({ top: 0 });
    if (!isGenerating) headingRef.current?.focus({ preventScroll: true });
  }, [activeGame, currentIndex, isCompleted, isGenerating, isOpen, questions]);

  const snapHeight = Math.round(vh * (snap === 'full' ? 0.88 : 0.56));
  const handleTouchEnd = (e) => {
    if (touchStartYRef.current === null) return;
    const delta = e.changedTouches[0].clientY - touchStartYRef.current;
    touchStartYRef.current = null;
    setDragDelta(null);
    if (delta < -50) setSnap('full');
    else if (delta > 60) {
      if (snap === 'full') setSnap('half');
      else onClose?.();
    }
  };

  const handleCancelGeneration = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (activeJobIdRef.current) {
      cancelAiJob(activeJobIdRef.current);
      activeJobIdRef.current = null;
    }
    setIsGenerating(false);
  };

  const handleGenerateQuiz = async (isFreshNewQuiz = false) => {
    if (!timeline || isGenerating) return;
    setError(null);
    setIsGenerating(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    activeJobIdRef.current = null;
    try {
      const result = await generateTimelineQuiz(
        timeline,
        isFreshNewQuiz ? previousQuestionsHistory : [],
        controller.signal,
        (jobId) => { activeJobIdRef.current = jobId; },
        contentMode
      );
      if (controller.signal.aborted) return;
      const generatedQuestions = Array.isArray(result?.questions) ? result.questions : [];
      if (!generatedQuestions.length) throw new Error(t('quiz.errorGenerating'));
      setQuestions(generatedQuestions);
      setCurrentIndex(0);
      setSelectedAnswers({});
      setIsCompleted(false);
      setPreviousQuestionsHistory((prev) => Array.from(new Set([
        ...prev, ...generatedQuestions.map((q) => q.question).filter(Boolean),
      ])).slice(-40));
      onQuizGenerated?.(generatedQuestions);
      onAfterGenerating?.();
    } catch (err) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      console.error('Failed to generate timeline quiz:', err);
      setError(err?.message || t('quiz.errorGenerating'));
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        activeJobIdRef.current = null;
        setIsGenerating(false);
      }
    }
  };

  const handleSelectEventFromGame = (article) => {
    if (!article || !onFocusArticle) return;
    if (isMobile) setSnap('half');
    onFocusArticle(article);
  };

  const currentQuestion = questions[currentIndex];
  const currentSelectedIdx = selectedAnswers[currentIndex];
  const hasAnsweredCurrent = currentSelectedIdx !== undefined;
  const currentCorrectIdx = currentQuestion?.correct_index ?? currentQuestion?.correctIndex ?? 0;
  const answeredCount = Object.keys(selectedAnswers).length;
  const firstUnanswered = questions.findIndex((_, idx) => selectedAnswers[idx] === undefined);
  const correctCount = useMemo(() => questions.reduce((count, q, idx) => (
    selectedAnswers[idx] === (q.correct_index ?? q.correctIndex ?? 0) ? count + 1 : count
  ), 0), [questions, selectedAnswers]);
  const relatedArticle = useMemo(() => {
    const articles = timeline?.articles || [];
    if (!currentQuestion || !articles.length) return null;
    const eventId = currentQuestion?.event_id ?? currentQuestion?.eventId;
    if (eventId != null) {
      const exact = articles.find((article) => String(article.id) === String(eventId));
      if (exact) return exact;
    }
    // Fallback for older cached quiz questions without event_id: match by token overlap
    const correctOption = (currentQuestion.options || [])[currentCorrectIdx] || '';
    const queryText = `${currentQuestion.question || ''} ${correctOption} ${currentQuestion.explanation || ''}`.toLowerCase();
    const tokens = queryText.match(/[\p{L}\p{N}]{3,}/gu) || [];
    if (!tokens.length) return articles[currentIndex % articles.length] || null;
    let bestArticle = null;
    let bestScore = 0;
    for (const art of articles) {
      const yearStr = art.from?.year != null ? String(Math.abs(art.from.year)) : '';
      const haystack = `${art.title || ''} ${art.subtitle || ''} ${art.extract || ''} ${art.locationName || ''} ${yearStr}`.toLowerCase();
      let score = 0;
      for (const tok of tokens) {
        if (haystack.includes(tok)) {
          score += (art.title || '').toLowerCase().includes(tok) ? 3 : 1;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestArticle = art;
      }
    }
    return bestArticle || articles[currentIndex % articles.length] || null;
  }, [currentQuestion, currentCorrectIdx, currentIndex, timeline?.articles]);

  const handleNext = () => {
    if (!hasAnsweredCurrent) return;
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((index) => index + 1);
    } else if (firstUnanswered !== -1) {
      setCurrentIndex(firstUnanswered);
    } else {
      setIsCompleted(true);
      if (correctCount / questions.length >= 0.6) {
        confetti({
          particleCount: isKidsMode ? 75 : 40,
          spread: 65,
          origin: { x: isMobile ? 0.5 : 0.2, y: 0.6 },
          disableForReducedMotion: true,
        });
      }
    }
  };

  const titleDir = getTextDir(timeline?.title || '', isRtl);
  const questionDir = getTextDir(currentQuestion?.question || '', titleDir === 'rtl');
  const optionLabels = questionDir === 'rtl' ? HEBREW_OPTION_LABELS : LATIN_OPTION_LABELS;
  const eventsCount = timeline?.articles?.length || 0;
  const scoreRatio = questions.length ? correctCount / questions.length : 0;
  const starsEarned = scoreRatio === 1 ? 3 : scoreRatio >= 0.6 ? 2 : scoreRatio > 0 ? 1 : 0;

  useGameCompletionReport({
    game: 'trivia',
    timelineId: timeline?.id,
    contentMode,
    isCompleted: isCompleted && questions.length > 0,
    resetKey: questions,
    stats: { correct: correctCount, total: questions.length, ratio: scoreRatio, stars: starsEarned },
  });
  const PrevArrowIcon = isRtl ? ArrowRight : ArrowLeft;
  const NextArrowIcon = isRtl ? ArrowLeft : ArrowRight;
  const isPlayingTrivia = activeGame === 'trivia' && questions.length > 0 && !isCompleted && !isGenerating;
  const questionProgress = t('quiz.questionProgress', { current: currentIndex + 1, total: questions.length });

  const gameMeta = useMemo(() => {
    switch (activeGame) {
      case 'sequence':
        return { Icon: GameSequenceIcon, title: t('quiz.sequence.title') };
      case 'timeGuesser':
        return { Icon: GameTimeGuesserIcon, title: t('quiz.timeGuesser.title') };
      case 'wordle':
        return { Icon: GameWordleIcon, title: t('quiz.wordle.title') };
      case 'puzzle':
        return { Icon: GamePuzzleIcon, title: t('quiz.puzzle.title') };
      case 'memory':
        return { Icon: GameMemoryIcon, title: t('quiz.memory.title') };
      case 'whoAmI':
        return { Icon: GameWhoAmIIcon, title: t('quiz.whoAmI.title') };
      case 'trivia':
        return { Icon: GameTriviaIcon, title: t('quiz.title') };
      default:
        return { Icon: Puzzle, title: t('quiz.hubTitle') };
    }
  }, [activeGame, t]);

  const hubCards = useMemo(() => [
    {
      id: 'trivia',
      Icon: GameTriviaIcon,
      accent: 'amber',
      title: t('quiz.title'),
      desc: t('quiz.cardDesc'),
      minEvents: 1,
    },
    {
      id: 'puzzle',
      Icon: GamePuzzleIcon,
      accent: 'violet',
      title: t('quiz.puzzle.title'),
      desc: t('quiz.puzzle.cardDesc'),
      minEvents: 1,
    },
    {
      id: 'timeGuesser',
      Icon: GameTimeGuesserIcon,
      accent: 'emerald',
      title: t('quiz.timeGuesser.title'),
      desc: t('quiz.timeGuesser.cardDesc'),
      minEvents: 1,
    },
    {
      id: 'memory',
      Icon: GameMemoryIcon,
      accent: 'teal',
      title: t('quiz.memory.title'),
      desc: t('quiz.memory.cardDesc'),
      minEvents: 2,
    },
    {
      id: 'wordle',
      Icon: GameWordleIcon,
      accent: 'sky',
      title: t('quiz.wordle.title'),
      desc: t('quiz.wordle.cardDesc'),
      minEvents: 1,
    },
    {
      id: 'sequence',
      Icon: GameSequenceIcon,
      accent: 'indigo',
      title: t('quiz.sequence.title'),
      desc: t('quiz.sequence.cardDesc'),
      minEvents: 2,
    },
    {
      id: 'whoAmI',
      Icon: GameWhoAmIIcon,
      accent: 'rose',
      title: t('quiz.whoAmI.title'),
      desc: t('quiz.whoAmI.cardDesc'),
      minEvents: 2,
    },
  ], [t]);

  const ActiveHeaderIcon = gameMeta.Icon;

  return (
    <>
      {isMobile && isOpen && snap === 'full' && (
        <div className="quiz-backdrop" onClick={() => setSnap('half')} aria-hidden="true" />
      )}
      <aside
        ref={panelRef}
        style={isMobile ? {
          ...style,
          top: 'auto',
          height: dragDelta === null ? snapHeight : Math.max(vh * 0.3, Math.min(vh * 0.92, snapHeight - dragDelta)),
          ...(dragDelta === null ? {} : { transition: 'none' }),
        } : {
          ...style,
          ...(canResize && (liveWidth ?? width) ? { width: liveWidth ?? clampEventDrawerWidth(width) } : {}),
        }}
        dir={isRtl ? 'rtl' : 'ltr'}
        tabIndex={-1}
        aria-label={gameMeta.title}
        aria-busy={isGenerating}
        inert={!isOpen}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose?.();
          }
        }}
        className={`chronix-side-drawer quiz-panel ${isOpen ? 'is-open' : ''} ${isKidsMode ? 'quiz-panel--kids' : ''} ${isWideGame ? 'quiz-panel--wide' : ''} ${liveWidth != null ? 'select-none' : ''}`}
      >
        {canResize && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('eventDrawer.resize')}
            title={t('eventDrawer.resize')}
            tabIndex={0}
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerEnd}
            onPointerCancel={handleResizePointerEnd}
            onDoubleClick={() => onWidthChange(null)}
            onKeyDown={handleResizeKeyDown}
            style={{ touchAction: 'none' }}
            className="group/resize absolute top-0 bottom-0 -right-1.5 w-3 z-30 flex items-center justify-center cursor-col-resize focus-visible:outline-none"
          >
            <span
              className={`h-full w-0.5 transition-colors ${
                liveWidth != null ? 'bg-ink-subtle' : 'bg-transparent group-hover/resize:bg-line-strong group-focus-visible/resize:bg-ink-subtle'
              }`}
            />
            <span
              className={`absolute top-1/2 -translate-y-1/2 h-10 w-1.5 rounded-full border border-line bg-surface-raised shadow-control transition-opacity ${
                liveWidth != null ? 'opacity-100' : 'opacity-0 group-hover/resize:opacity-100 group-focus-visible/resize:opacity-100'
              }`}
            />
          </div>
        )}
        {isMobile && (
          <div
            className="quiz-drag-zone"
            onTouchStart={(e) => {
              touchStartYRef.current = e.touches[0].clientY;
              setDragDelta(0);
            }}
            onTouchMove={(e) => {
              if (touchStartYRef.current !== null) setDragDelta(e.touches[0].clientY - touchStartYRef.current);
            }}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={() => { touchStartYRef.current = null; setDragDelta(null); }}
          >
            <button
              type="button"
              className="quiz-drag-handle"
              aria-label={t(snap === 'full' ? 'quiz.collapsePanel' : 'quiz.expandPanel')}
              aria-expanded={snap === 'full'}
              onClick={() => setSnap((value) => value === 'full' ? 'half' : 'full')}
            ><span /></button>
          </div>
        )}
        <header className="quiz-header">
          <div className="quiz-header-start">
            {panelNav && (
              <>
                <PanelNavButtons nav={panelNav} />
                <span className="quiz-header-divider" aria-hidden="true" />
              </>
            )}
            {activeGame !== 'hub' && showHubLink && (
              <>
                <button
                  type="button"
                  className="quiz-back-hub-btn"
                  onClick={() => onSelectGame?.('hub')}
                >
                  <LayoutGrid aria-hidden="true" />
                  <span>{t('quiz.backToHub')}</span>
                </button>
                <span className="quiz-header-divider" aria-hidden="true" />
              </>
            )}
            <span className="quiz-header-label">
              <ActiveHeaderIcon aria-hidden="true" />
              <span>{gameMeta.title}</span>
            </span>
          </div>
          <button type="button" className="quiz-icon-button" onClick={onClose} aria-label={t('common.close')} title={t('common.close')}>
            <X aria-hidden="true" />
          </button>
        </header>

        <div ref={bodyRef} className="quiz-body">
          {activeGame === 'hub' && timeline?.title && (
            <h2 className="quiz-context-title" dir={titleDir}>{timeline.title}</h2>
          )}

          {/* GAMES HUB LOBBY */}
          {activeGame === 'hub' && (
            <section className="games-hub quiz-enter">
              <div className="games-hub-intro">
                <span className="quiz-eyebrow">{t('quiz.hubEyebrow')}</span>
                <h3 ref={headingRef} tabIndex={-1}>{t('quiz.hubIntroTitle')}</h3>
                <p className="quiz-description">{t('quiz.hubIntroDesc')}</p>
                <p className="games-hub-meta">
                  <span>{t('quiz.eventsCountBadge', { count: eventsCount })}</span>
                </p>
              </div>

              <ul className="games-hub-list">
                {hubCards.map((card) => {
                  const CardIcon = card.Icon;
                  const disabled = eventsCount < card.minEvents;
                  return (
                    <li key={card.id}>
                      <button
                        type="button"
                        disabled={disabled}
                        className="games-hub-card"
                        data-accent={card.accent}
                        onClick={() => onSelectGame?.(card.id)}
                      >
                        <span className="games-hub-icon" aria-hidden="true">
                          <CardIcon />
                        </span>
                        <span className="games-hub-card-body">
                          <span className="games-hub-card-heading">
                            <span className="games-hub-card-title">{card.title}</span>
                          </span>
                          <span className="games-hub-card-desc">{card.desc}</span>
                          {disabled && (
                            <span className="games-hub-card-note">
                              {t('quiz.needMoreEvents', { min: card.minEvents })}
                            </span>
                          )}
                        </span>
                        {!disabled && (
                          <span className="games-hub-card-go" aria-hidden="true">
                            <NextArrowIcon />
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* GAME 1: BUILD THE SEQUENCE */}
          {activeGame === 'sequence' && (
            <SequenceGame
              timeline={timeline}
              onSelectEvent={handleSelectEventFromGame}
            />
          )}

          {/* GAME 2: TIMEGUESSER / WHERE & WHEN */}
          {activeGame === 'timeGuesser' && (
            <TimeGuesserGame
              timeline={timeline}
              onSelectEvent={handleSelectEventFromGame}
            />
          )}

          {/* GAME 3: TIMELINE WORDLE */}
          {activeGame === 'wordle' && (
            <WordleGame
              timeline={timeline}
              onSelectEvent={handleSelectEventFromGame}
            />
          )}

          {/* GAME 4: TIMELINE PUZZLE */}
          {activeGame === 'puzzle' && (
            <PuzzleGame
              timeline={timeline}
              onSelectEvent={handleSelectEventFromGame}
              onQuotaRefresh={onAfterGenerating}
            />
          )}

          {/* GAME 5: TIMELINE MEMORY MATCH */}
          {activeGame === 'memory' && (
            <MemoryGame
              timeline={timeline}
              onSelectEvent={handleSelectEventFromGame}
            />
          )}

          {/* GAME 6: WHO / WHAT EVENT AM I? */}
          {activeGame === 'whoAmI' && (
            <WhoAmIGame
              timeline={timeline}
              contentMode={contentMode}
              onWhoAmIGenerated={(tlId, newItems, tokenUsage) => {
                onWhoAmIGenerated?.(newItems, tokenUsage);
                onAfterGenerating?.();
              }}
              onSelectEvent={handleSelectEventFromGame}
            />
          )}

          {/* GAME 4: TRIVIA QUIZ */}
          {activeGame === 'trivia' && (
            <>
              {error && !isGenerating && (
                <div className="quiz-error" role="alert">
                  <AlertTriangle aria-hidden="true" />
                  <span>{error}</span>
                  <button type="button" onClick={() => handleGenerateQuiz(questions.length > 0)}>{t('quiz.retryBtn')}</button>
                </div>
              )}

              {!questions.length && !isGenerating && (
                <section className="quiz-welcome quiz-enter">
                  <span className="quiz-hero-icon" aria-hidden="true"><GameTriviaIcon /></span>
                  <span className="quiz-eyebrow">{t('quiz.introEyebrow')}</span>
                  <h3 ref={headingRef} tabIndex={-1}>{t('quiz.introTitle')}</h3>
                  <p className="quiz-description">{t('quiz.introDesc')}</p>
                  <div className="quiz-details">
                    <span>{t('quiz.eventsCountBadge', { count: eventsCount })}</span>
                    <span><CheckCircle2 aria-hidden="true" />{t('quiz.instantFeedback')}</span>
                  </div>
                  <button type="button" className="quiz-button quiz-button--primary" disabled={!eventsCount} onClick={() => handleGenerateQuiz()}>
                    <Sparkles aria-hidden="true" />{t('quiz.createBtn')}<NextArrowIcon aria-hidden="true" />
                  </button>
                  <p className="quiz-footnote">{t(eventsCount ? 'quiz.noTimer' : 'quiz.noEvents')}</p>
                </section>
              )}

              {isGenerating && (
                <section className="quiz-welcome quiz-enter">
                  <span className="quiz-hero-icon quiz-hero-icon--loading" aria-hidden="true"><Loader2 /></span>
                  <div role="status">
                    <span className="quiz-eyebrow">{t('quiz.generatingEyebrow')}</span>
                    <h3>{t('quiz.generatingTitle')}</h3>
                    <p className="quiz-description">{t('quiz.generatingDesc')}</p>
                  </div>
                  <div className="quiz-skeleton" dir={titleDir} aria-hidden="true">
                    {['72%', '54%', '82%', '62%'].map((width, idx) => (
                      <div key={idx} className="quiz-skeleton-row" style={{ animationDelay: `${idx * 120}ms` }}>
                        <span className="quiz-skeleton-badge" />
                        <span className="quiz-skeleton-line" style={{ width }} />
                      </div>
                    ))}
                  </div>
                  <button type="button" className="quiz-button quiz-button--quiet" onClick={handleCancelGeneration}>{t('quiz.cancelBtn')}</button>
                </section>
              )}

              {isPlayingTrivia && currentQuestion && (
                <>
                  <div className="quiz-progress-copy">
                    <span>{questionProgress}</span>
                    <span className="quiz-score"><CheckCircle2 aria-hidden="true" />{t('quiz.correctCount', { count: correctCount })}</span>
                  </div>
                  <div
                    className="quiz-progress-track"
                    role="progressbar"
                    aria-label={t('quiz.answeredProgress')}
                    aria-valuemin={0}
                    aria-valuemax={questions.length}
                    aria-valuenow={answeredCount}
                  ><span style={{ width: `${answeredCount / questions.length * 100}%` }} /></div>
                  <nav className="quiz-question-nav" aria-label={t('quiz.questionNavigation')}>
                    {questions.map((q, idx) => {
                      const answer = selectedAnswers[idx];
                      const state = answer === undefined ? 'unanswered' : answer === (q.correct_index ?? q.correctIndex ?? 0) ? 'correct' : 'incorrect';
                      return (
                        <button
                          key={q.id || idx}
                          type="button"
                          className="quiz-question-step"
                          data-state={state}
                          aria-current={idx === currentIndex ? 'step' : undefined}
                          aria-label={`${t('quiz.questionProgress', { current: idx + 1, total: questions.length })}. ${t(`quiz.${state}`)}`}
                          onClick={() => setCurrentIndex(idx)}
                        ><span>{answer === undefined ? idx + 1 : state === 'correct' ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}</span></button>
                      );
                    })}
                  </nav>
                  <section key={currentIndex} className="quiz-question quiz-enter" dir={questionDir} aria-label={questionProgress}>
                    <h3 ref={headingRef} tabIndex={-1}>{currentQuestion.question}</h3>
                    <div className="quiz-question-toolbar">
                      <p className="quiz-answer-hint">{t(hasAnsweredCurrent ? 'quiz.answerRecorded' : 'quiz.chooseAnswer')}</p>
                      {!hasAnsweredCurrent && relatedArticle && onFocusArticle && (
                        <button
                          type="button"
                          className="game-tool-btn quiz-hint-btn"
                          onClick={() => handleSelectEventFromGame(relatedArticle)}
                          title={t('quiz.focusEventHintTooltip')}
                        >
                          <Crosshair aria-hidden="true" />
                          <span>{t('quiz.focusEventHintBtn')}</span>
                        </button>
                      )}
                    </div>
                    <div className="quiz-options" role="group" aria-label={t('quiz.chooseAnswer')}>
                      {(currentQuestion.options || []).map((text, idx) => {
                        const isSelected = currentSelectedIdx === idx;
                        const state = !hasAnsweredCurrent ? 'idle' : idx === currentCorrectIdx ? 'correct' : isSelected ? 'incorrect' : 'muted';
                        return (
                          <button
                            key={idx}
                            type="button"
                            className="quiz-option"
                            data-state={state}
                            aria-pressed={isSelected}
                            aria-disabled={hasAnsweredCurrent}
                            onClick={() => {
                              if (!hasAnsweredCurrent) setSelectedAnswers((prev) => ({ ...prev, [currentIndex]: idx }));
                            }}
                          >
                            <span className="quiz-option-letter" aria-hidden="true">{optionLabels[idx] || idx + 1}</span>
                            <span className="quiz-option-text">{text}</span>
                            {state === 'correct' && <><CheckCircle2 className="quiz-option-status" aria-hidden="true" /><span className="sr-only">{t('quiz.correctAnswer')}</span></>}
                            {state === 'incorrect' && <><X className="quiz-option-status" aria-hidden="true" /><span className="sr-only">{t('quiz.yourAnswer')}</span></>}
                          </button>
                        );
                      })}
                    </div>
                    {hasAnsweredCurrent && (
                      <div className="quiz-feedback quiz-enter" role="status" data-correct={currentSelectedIdx === currentCorrectIdx}>
                        <div className="quiz-feedback-title">
                          {currentSelectedIdx === currentCorrectIdx ? <CheckCircle2 aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                          <h4>{t(currentSelectedIdx === currentCorrectIdx ? 'quiz.correctTitle' : 'quiz.wrongTitle')}</h4>
                        </div>
                        {currentQuestion.explanation && <p dir={getTextDir(currentQuestion.explanation, questionDir === 'rtl')}>{currentQuestion.explanation}</p>}
                        {relatedArticle && onFocusArticle && (
                          <button type="button" className="quiz-event-link" onClick={() => handleSelectEventFromGame(relatedArticle)}>
                            <Crosshair aria-hidden="true" />
                            <span>{t('quiz.showOnTimeline')}<b dir={getTextDir(relatedArticle.title || '', isRtl)}>{relatedArticle.title}</b></span>
                            <NextArrowIcon aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                </>
              )}

              {!!questions.length && isCompleted && !isGenerating && (
                <section className="quiz-results quiz-enter">
                  <span className="quiz-eyebrow">{t('quiz.completedEyebrow')}</span>
                  <div className="quiz-result-ring" style={{ '--quiz-score-angle': `${scoreRatio * 360}deg` }}>
                    <div><Trophy aria-hidden="true" /><strong>{correctCount}<span> / {questions.length}</span></strong><span>{t('quiz.correctAnswers')}</span></div>
                  </div>
                  <div className="quiz-stars" role="img" aria-label={t('quiz.starsEarned', { count: starsEarned, total: 3 })}>
                    {[1, 2, 3].map((idx) => <Star key={idx} aria-hidden="true" data-earned={idx <= starsEarned} />)}
                  </div>
                  <h3 ref={headingRef} tabIndex={-1}>{t(scoreRatio === 1 ? 'quiz.resultsTitlePerfect' : scoreRatio >= 0.6 ? 'quiz.resultsTitleGreat' : 'quiz.resultsTitleGood')}</h3>
                  <p className="quiz-description">{t('quiz.resultsSubtitle', { score: correctCount, total: questions.length, title: timeline?.title || '' })}</p>
                  <div className="quiz-result-actions">
                    <button type="button" className="quiz-button quiz-button--primary" onClick={() => { setCurrentIndex(0); setIsCompleted(false); }}>
                      <CheckCircle2 aria-hidden="true" />{t('quiz.reviewQuestions')}
                    </button>
                    <button type="button" className="quiz-button quiz-button--secondary" onClick={() => handleGenerateQuiz(true)}>
                      <Sparkles aria-hidden="true" />{t('quiz.newQuizBtn')}
                    </button>
                    <button type="button" className="quiz-button quiz-button--quiet" onClick={() => { setSelectedAnswers({}); setCurrentIndex(0); setIsCompleted(false); }}>
                      <RefreshCw aria-hidden="true" />{t('quiz.playAgainBtn')}
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {isPlayingTrivia && (
          <footer className="quiz-footer">
            <button type="button" className="quiz-button quiz-button--secondary" disabled={currentIndex === 0} onClick={() => setCurrentIndex((idx) => idx - 1)}>
              <PrevArrowIcon aria-hidden="true" />{t('quiz.prevQuestion')}
            </button>
            <button type="button" className="quiz-button quiz-button--primary" disabled={!hasAnsweredCurrent} onClick={handleNext}>
              {t(currentIndex === questions.length - 1 && firstUnanswered === -1 ? 'quiz.finishQuiz' : 'quiz.nextQuestion')}
              <NextArrowIcon aria-hidden="true" />
            </button>
          </footer>
        )}
      </aside>
    </>
  );
}
