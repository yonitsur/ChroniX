import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  Sparkles,
  Check,
  CheckCircle2,
  RotateCcw,
  Eye,
  Lightbulb,
  Shuffle,
  Image as ImageIcon,
  Loader2,
  ChevronDown,
  AlertTriangle,
  Lock,
  Zap,
} from '../icons/ThemeIcons';
import { generateEventImage, getApiKey } from '../../api';
import { useLanguage } from '../../context/LanguageContext';
import { getTextDir } from '../../utils/textDirection';
import {
  formatAiModelName,
  formatUsdDigits,
  getCreditCosts,
  getRemainingPaidCredits,
  isGeminiModel,
  isPremiumCreditsExhausted,
} from '../../utils/modelUtils';
import { formatGameYear } from './gameUtils';
import { RoundFeedback, formatPoints } from './GameChrome';
import useGameCompletionReport from '../../hooks/useGameCompletionReport';

const DIFFICULTIES = [
  { id: 'easy', gridSize: 3, basePoints: 500, parMoves: 12 },
  { id: 'medium', gridSize: 4, basePoints: 850, parMoves: 24 },
  { id: 'hard', gridSize: 5, basePoints: 1250, parMoves: 40 },
];

const MAX_PUZZLE_HINTS = 3;

/**
 * Create a scrambled array [0 .. total-1] guaranteed not to be already solved,
 * and with as few pieces in their home position as possible.
 */
function createScrambledPieces(total) {
  const arr = Array.from({ length: total }, (_, i) => i);
  if (total <= 1) return arr;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    for (let i = total - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    const fixedCount = arr.filter((val, idx) => val === idx).length;
    if (fixedCount === 0) return arr;
    if (attempt >= 5 && fixedCount < total) return arr;
  }

  // Fallback swap if somehow still sorted
  if (arr.every((val, idx) => val === idx)) {
    const tmp = arr[0];
    arr[0] = arr[1];
    arr[1] = tmp;
  }
  return arr;
}

export default function PuzzleGame({ timeline, onSelectEvent, onUpdateTimeline, onQuotaRefresh, quota = null }) {
  const { t, language: lang, contentMode } = useLanguage();
  const isKidsMode = contentMode === 'kids';
  const [hasCustomApiKey, setHasCustomApiKey] = useState(() => Boolean(getApiKey()));
  useEffect(() => {
    const sync = () => setHasCustomApiKey(Boolean(getApiKey()));
    window.addEventListener('focus', sync);
    window.addEventListener('storage', sync);
    window.addEventListener('chronix-api-key-change', sync);
    return () => {
      window.removeEventListener('focus', sync);
      window.removeEventListener('storage', sync);
      window.removeEventListener('chronix-api-key-change', sync);
    };
  }, []);
  const isAdmin = quota?.is_admin === true;
  const imageCreditCost = getCreditCosts(quota).gemini_image;
  const remainingPaidCredits = getRemainingPaidCredits(quota);
  const isGeminiImageBlocked = isPremiumCreditsExhausted(quota, {
    isAdmin,
    hasCustomKey: hasCustomApiKey,
    requiredCredits: imageCreditCost,
  });

  const allArticles = useMemo(() => timeline?.articles || [], [timeline?.articles]);

  // Existing timeline events that already have an image
  const articlesWithImages = useMemo(
    () =>
      allArticles.filter(
        (a) => typeof a?.imageUrl === 'string' && a.imageUrl.trim().length > 0
      ),
    [allArticles]
  );

  // Mode: 'existing' (pick from timeline images) | 'ai' (generate new AI image)
  const [sourceTab, setSourceTab] = useState(() =>
    articlesWithImages.length > 0 ? 'existing' : 'ai'
  );

  // Difficulty: 'easy' (3x3) | 'medium' (4x4) | 'hard' (5x5)
  const [difficultyId, setDifficultyId] = useState('easy');
  const activeDifficulty = useMemo(
    () => DIFFICULTIES.find((d) => d.id === difficultyId) || DIFFICULTIES[0],
    [difficultyId]
  );
  const { gridSize } = activeDifficulty;
  const totalPieces = gridSize * gridSize;

  // Currently active puzzle subject:
  // { id, imageUrl, title, subtitle, year, article, isAiGenerated }
  const [activeItem, setActiveItem] = useState(null);

  // AI generation controls
  const [aiScope, setAiScope] = useState('timeline'); // 'timeline' | 'event'
  const [selectedAiArticleId, setSelectedAiArticleId] = useState(
    () => allArticles[0]?.id || ''
  );
  const [aiStyle, setAiStyle] = useState('auto'); // 'auto' | 'historical' | 'cinematic' | 'illustration'
  const [aiEngine, setAiEngine] = useState('free'); // Always defaults to 'free' (no persistence)
  const effectiveAiEngine = isGeminiImageBlocked ? 'free' : aiEngine;
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiGallery, setAiGallery] = useState([]); // Array of generated puzzle items in this session
  const abortControllerRef = useRef(null);

  // Puzzle board state
  const [pieces, setPieces] = useState([]); // pieces[cellIdx] = originalPieceId
  const [selectedCell, setSelectedCell] = useState(null);
  const [draggedCell, setDraggedCell] = useState(null);
  const [dragOverCell, setDragOverCell] = useState(null);
  const [moves, setMoves] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [justHintedCell, setJustHintedCell] = useState(null);
  const [isPeeking, setIsPeeking] = useState(false);
  const [isSolved, setIsSolved] = useState(false);
  const [score, setScore] = useState(0);

  // Build puzzle item from a timeline article
  const makeItemFromArticle = useCallback(
    (art, customImgUrl = null, isAi = false) => {
      if (!art) return null;
      return {
        id: `art-${art.id}-${isAi ? 'ai' : 'wiki'}`,
        imageUrl: customImgUrl || art.imageUrl,
        title: art.title,
        subtitle: art.subtitle || art.extract || '',
        year: art.from?.year ?? art.from_?.year ?? null,
        article: art,
        isAiGenerated: isAi || art.imageSource === 'ai',
        imageModel: art.imageModel || null,
        imageCostUsd: Number(art.imageCostUsd) > 0 ? Number(art.imageCostUsd) : null,
      };
    },
    []
  );

  // Start / reset board for a given item and grid size
  const startBoard = useCallback((numPieces) => {
    setPieces(createScrambledPieces(numPieces));
    setSelectedCell(null);
    setDraggedCell(null);
    setDragOverCell(null);
    setMoves(0);
    setHintsUsed(0);
    setJustHintedCell(null);
    setIsPeeking(false);
    setIsSolved(false);
    setScore(0);
  }, []);

  // Initialize default puzzle item when timeline loads
  useEffect(() => {
    if (!activeItem && articlesWithImages.length > 0) {
      const initialArt = articlesWithImages[0];
      setActiveItem(makeItemFromArticle(initialArt));
    }
  }, [activeItem, articlesWithImages, makeItemFromArticle]);

  // Whenever activeItem or gridSize changes, scramble the board
  useEffect(() => {
    if (activeItem?.imageUrl) {
      startBoard(gridSize * gridSize);
    }
  }, [activeItem?.id, activeItem?.imageUrl, gridSize, startBoard]);

  useGameCompletionReport({
    game: 'puzzle',
    timelineId: timeline?.id,
    contentMode,
    isCompleted: isSolved,
    resetKey: `${activeItem?.id || ''}|${gridSize}`,
    stats: {
      points: score,
      ratio: activeDifficulty.basePoints > 0 ? Math.min(1, score / activeDifficulty.basePoints) : null,
      difficulty: activeDifficulty.id,
    },
  });

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleSelectExistingArticle = (art) => {
    const item = makeItemFromArticle(art);
    setActiveItem(item);
    startBoard(totalPieces);
  };

  const handlePickRandomExisting = () => {
    if (articlesWithImages.length === 0) return;
    const pool =
      articlesWithImages.length > 1 && activeItem?.article
        ? articlesWithImages.filter((a) => a.id !== activeItem.article.id)
        : articlesWithImages;
    const randomArt = pool[Math.floor(Math.random() * pool.length)];
    handleSelectExistingArticle(randomArt);
  };

  const handleGenerateAiPuzzle = async () => {
    if (isGeneratingAi) return;
    setAiError(null);
    setIsGeneratingAi(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const targetArt =
        aiScope === 'event'
          ? allArticles.find((a) => String(a.id) === String(selectedAiArticleId)) ||
            allArticles[0]
          : null;

      const reqTitle =
        aiScope === 'event' && targetArt
          ? targetArt.title
          : timeline?.title || 'Historical Timeline';
      const reqSubtitle =
        aiScope === 'event' && targetArt
          ? targetArt.subtitle || targetArt.extract || ''
          : timeline?.description || timeline?.overview || '';
      const reqYear =
        aiScope === 'event' && targetArt
          ? targetArt.from?.year ?? targetArt.from_?.year ?? null
          : null;
      const reqLoc =
        aiScope === 'event' && targetArt ? targetArt.locationName || null : null;
      const reqFictional =
        aiScope === 'event' && targetArt
          ? Boolean(targetArt.isFictional)
          : Boolean(allArticles.some((a) => a.isFictional));

      const customDirection =
        aiScope === 'timeline'
          ? 'Create a rich, detailed, visually captivating panoramic scene combining key symbols, atmosphere, and iconic elements of this entire timeline topic. Ideal for a jigsaw puzzle.'
          : 'Create a vivid, richly detailed, visually engaging scene of this milestone with clear focal elements and rich colors, ideal for a jigsaw puzzle.';

      const result = await generateEventImage({
        title: reqTitle,
        subtitle: reqSubtitle,
        year: reqYear,
        timeScale: timeline?.timeScale || 'calendar',
        timelineTopic: timeline?.title || '',
        locationName: reqLoc,
        isFictional: reqFictional,
        customPrompt: customDirection,
        style: aiStyle,
        engine: effectiveAiEngine,
        contentMode,
        timelineId: timeline?.id,
        source: 'puzzle',
        signal: controller.signal,
      });

      if (onQuotaRefresh) onQuotaRefresh();

      if (result?.imageUrl) {
        const genCost = Number(result.imageCostUsd ?? result.tokenUsage?.estimatedCostUsd ?? 0);
        const hasGeminiCost = genCost > 0 && isGeminiModel(result.model);
        const newItem = {
          id: `ai-${Date.now()}`,
          imageUrl: result.imageUrl,
          title: reqTitle,
          subtitle: reqSubtitle,
          year: reqYear,
          article: targetArt || null,
          isAiGenerated: true,
          imageModel: result.model || null,
          imageCostUsd: hasGeminiCost ? genCost : null,
        };
        setAiGallery((prev) => [newItem, ...prev]);
        setActiveItem(newItem);
        setAiEngine('free');

        // If generated for an event that had no image yet, also enrich the timeline event in memory
        if (targetArt && !targetArt.imageUrl && onUpdateTimeline) {
          onUpdateTimeline((prev) => {
            if (!prev?.articles) return prev;
            return {
              ...prev,
              articles: prev.articles.map((a) =>
                a.id === targetArt.id
                  ? {
                      ...a,
                      imageUrl: result.imageUrl,
                      imageSource: 'ai',
                      ...(result.model ? { imageModel: result.model } : {}),
                      ...(hasGeminiCost ? { imageCostUsd: genCost } : {}),
                    }
                  : a
              ),
            };
          });
        }
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        if (err?.status === 402 && onQuotaRefresh) onQuotaRefresh();
        setAiError(err?.message || t('quiz.puzzle.aiError'));
      }
    } finally {
      setIsGeneratingAi(false);
    }
  };

  // Swap two cells on the board and check win condition
  const swapCells = useCallback(
    (cellA, cellB, isHintMove = false) => {
      if (cellA === cellB || isSolved) return;
      if (cellA < 0 || cellB < 0 || cellA >= pieces.length || cellB >= pieces.length) return;

      const nextPieces = [...pieces];
      const tmp = nextPieces[cellA];
      nextPieces[cellA] = nextPieces[cellB];
      nextPieces[cellB] = tmp;

      const nextMoves = isHintMove ? moves : moves + 1;
      const nextHints = isHintMove ? hintsUsed + 1 : hintsUsed;

      setPieces(nextPieces);
      setMoves(nextMoves);
      if (isHintMove) {
        setHintsUsed(nextHints);
      }
      setSelectedCell(null);

      // Check if puzzle is solved
      const solvedNow = nextPieces.every((pieceId, idx) => pieceId === idx);
      if (solvedNow) {
        setIsSolved(true);
        setIsPeeking(false);
        const extraMoves = Math.max(0, nextMoves - activeDifficulty.parMoves);
        const movePenalty = extraMoves * 10;
        const hintPenalty = nextHints * 75;
        const finalPts = Math.max(
          150,
          activeDifficulty.basePoints - movePenalty - hintPenalty
        );
        setScore(finalPts);

        confetti({
          particleCount: isKidsMode ? 80 : 45,
          spread: 68,
          origin: { x: 0.35, y: 0.6 },
          disableForReducedMotion: true,
        });
      }
    },
    [pieces, isSolved, moves, hintsUsed, activeDifficulty, isKidsMode]
  );

  const handleTileClick = (cellIdx) => {
    if (isSolved || isPeeking) return;
    if (selectedCell === null) {
      setSelectedCell(cellIdx);
    } else if (selectedCell === cellIdx) {
      setSelectedCell(null);
    } else {
      swapCells(selectedCell, cellIdx, false);
    }
  };

  const handlePlaceHintPiece = () => {
    if (isSolved || hintsUsed >= MAX_PUZZLE_HINTS) return;
    // Find all cell indices that do NOT currently hold their matching piece
    const misplacedCells = [];
    for (let i = 0; i < pieces.length; i += 1) {
      if (pieces[i] !== i) {
        misplacedCells.push(i);
      }
    }
    if (misplacedCells.length === 0) return;

    // Pick the first misplaced target cell `targetCell`, and find where piece `targetCell` currently sits
    const targetCell = misplacedCells[0];
    const currentHolderCell = pieces.indexOf(targetCell);
    if (currentHolderCell === -1 || currentHolderCell === targetCell) return;

    setJustHintedCell(targetCell);
    swapCells(targetCell, currentHolderCell, true);
  };

  const correctCount = useMemo(
    () => pieces.filter((pieceId, idx) => pieceId === idx).length,
    [pieces]
  );

  const progressPct =
    totalPieces > 0 ? Math.round((correctCount / totalPieces) * 100) : 0;

  const renderThumb = (key, imageUrl, title, isSelected, onClick, year = null) => (
    <li key={key}>
      <button
        type="button"
        className="puz-thumb"
        aria-pressed={isSelected}
        aria-label={title}
        title={title}
        onClick={onClick}
      >
        <img src={imageUrl} alt="" loading="lazy" />
        {year !== null && year !== undefined && <span className="puz-thumb-year">{formatGameYear(year, lang)}</span>}
        {isSelected && <span className="puz-thumb-check" aria-hidden="true"><Check /></span>}
      </button>
    </li>
  );

  return (
    <div className="game-stack puz-game quiz-enter">
      <div className="game-segmented" role="tablist" aria-label={t('quiz.puzzle.title')}>
        <button
          type="button"
          role="tab"
          aria-selected={sourceTab === 'existing'}
          className="game-segment"
          onClick={() => setSourceTab('existing')}
        >
          <ImageIcon aria-hidden="true" />
          <span>{t('quiz.puzzle.tabExisting')}</span>
          <span className="game-segment-count">{articlesWithImages.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sourceTab === 'ai'}
          className="game-segment"
          onClick={() => setSourceTab('ai')}
        >
          <Sparkles aria-hidden="true" />
          <span>{t('quiz.puzzle.tabAi')}</span>
        </button>
      </div>

      {sourceTab === 'existing' ? (
        <section className="game-card puz-source">
          {articlesWithImages.length > 0 ? (
            <>
              <header className="puz-source-head">
                <h4 className="game-section-label">{t('quiz.puzzle.pickEventImageLabel')}</h4>
                {articlesWithImages.length > 1 && (
                  <button type="button" className="game-tool-btn" onClick={handlePickRandomExisting}>
                    <Shuffle aria-hidden="true" />
                    <span>{t('quiz.puzzle.randomImageBtn')}</span>
                  </button>
                )}
              </header>
              <ul className="puz-thumbs">
                {articlesWithImages.map((art) =>
                  renderThumb(
                    art.id,
                    art.imageUrl,
                    art.title,
                    !activeItem?.isAiGenerated && activeItem?.article?.id === art.id,
                    () => handleSelectExistingArticle(art),
                    art.from?.year ?? art.from_?.year ?? null
                  )
                )}
              </ul>
            </>
          ) : (
            <div className="game-empty game-empty--inline">
              <ImageIcon aria-hidden="true" />
              <p>{t('quiz.puzzle.noExistingImages')}</p>
              <button type="button" className="quiz-button quiz-button--primary" onClick={() => setSourceTab('ai')}>
                <Sparkles aria-hidden="true" />
                <span>{t('quiz.puzzle.switchToAiBtn')}</span>
              </button>
            </div>
          )}
        </section>
      ) : (
        <section className="game-card puz-source puz-ai">
          <div className="game-segmented game-segmented--sub" role="radiogroup">
            {['timeline', 'event'].map((scope) => (
              <button
                key={scope}
                type="button"
                role="radio"
                aria-checked={aiScope === scope}
                className="game-segment"
                onClick={() => setAiScope(scope)}
              >
                <span>{t(scope === 'timeline' ? 'quiz.puzzle.aiScopeTimeline' : 'quiz.puzzle.aiScopeEvent')}</span>
              </button>
            ))}
          </div>

          {aiScope === 'event' && allArticles.length > 0 && (
            <div className="game-select">
              <select
                value={selectedAiArticleId}
                onChange={(e) => setSelectedAiArticleId(e.target.value)}
                dir={getTextDir(
                  allArticles.find((a) => String(a.id) === String(selectedAiArticleId))?.title || ''
                )}
              >
                {allArticles.map((art) => {
                  const yr = formatGameYear(art.from?.year ?? art.from_?.year, lang);
                  return (
                    <option key={art.id} value={art.id}>
                      {yr ? `${yr} — ${art.title}` : art.title}
                    </option>
                  );
                })}
              </select>
              <ChevronDown aria-hidden="true" />
            </div>
          )}

          <div className="puz-ai-style">
            <h4 className="game-section-label">{t('eventEditModal.aiImageEngineLabel')}:</h4>
            <div className="game-pills" role="radiogroup">
              <button
                type="button"
                role="radio"
                aria-checked={effectiveAiEngine === 'free'}
                className="game-pill"
                disabled={isGeneratingAi}
                onClick={() => setAiEngine('free')}
                title={t('eventEditModal.aiImageEngineFreeHint')}
              >
                <Zap className="w-3 h-3 inline me-1" aria-hidden="true" />
                {t('eventEditModal.aiImageEngineFree')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={effectiveAiEngine === 'premium'}
                className={`game-pill ${isGeminiImageBlocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={isGeneratingAi || isGeminiImageBlocked}
                onClick={() => {
                  if (!isGeminiImageBlocked) setAiEngine('premium');
                }}
                title={
                  isGeminiImageBlocked
                    ? remainingPaidCredits && remainingPaidCredits > 0
                      ? t('eventEditModal.aiImageEngineInsufficientCreditsHint', {
                          credits: imageCreditCost,
                          remaining: remainingPaidCredits,
                        })
                      : t('eventEditModal.aiImageEngineQuotaExhaustedHint')
                    : hasCustomApiKey || isAdmin
                      ? t('eventEditModal.aiImageEnginePremiumHint')
                      : t('eventEditModal.aiImageEnginePremiumCreditHint', { credits: imageCreditCost })
                }
              >
                {isGeminiImageBlocked ? (
                  <Lock className="w-3 h-3 inline me-1 text-amber-500" aria-hidden="true" />
                ) : (
                  <Sparkles className="w-3 h-3 inline me-1" aria-hidden="true" />
                )}
                {t('eventEditModal.aiImageEnginePremium')}
                {!hasCustomApiKey && !isAdmin ? ` · ${imageCreditCost}` : ''}
              </button>
            </div>
          </div>

          <div className="puz-ai-style">
            <h4 className="game-section-label">{t('quiz.puzzle.aiStyleLabel')}</h4>
            <div className="game-pills" role="radiogroup">
              {['auto', 'historical', 'cinematic', 'illustration'].map((st) => (
                <button
                  key={st}
                  type="button"
                  role="radio"
                  aria-checked={aiStyle === st}
                  className="game-pill"
                  onClick={() => setAiStyle(st)}
                >
                  {t(`quiz.puzzle.style_${st}`)}
                </button>
              ))}
            </div>
          </div>

          {aiError && (
            <div className="quiz-error" role="alert">
              <AlertTriangle aria-hidden="true" />
              <span>{aiError}</span>
            </div>
          )}

          <button
            type="button"
            className="quiz-button quiz-button--primary game-cta"
            disabled={isGeneratingAi}
            onClick={handleGenerateAiPuzzle}
          >
            {isGeneratingAi ? <Loader2 aria-hidden="true" className="game-spin" /> : <Sparkles aria-hidden="true" />}
            <span>{t(isGeneratingAi ? 'quiz.puzzle.generatingAiBtn' : 'quiz.puzzle.generateAiBtn')}</span>
          </button>

          {aiGallery.length > 0 && (
            <ul className="puz-thumbs">
              {aiGallery.map((item) =>
                renderThumb(item.id, item.imageUrl, item.title, activeItem?.id === item.id, () => setActiveItem(item))
              )}
            </ul>
          )}
        </section>
      )}

      {activeItem?.imageUrl && (
        <>
          <section className="game-card puz-stage" data-solved={isSolved || undefined}>
            <header className="puz-stage-head">
              {activeItem.year !== null && activeItem.year !== undefined && (
                <span className="game-chip game-chip--date">{formatGameYear(activeItem.year, lang)}</span>
              )}
              <h4 className="game-title" dir={getTextDir(activeItem.title)}>{activeItem.title}</h4>
              {activeItem.isAiGenerated && Number(activeItem.imageCostUsd) > 0 && isGeminiModel(activeItem.imageModel) && (
                <span className="game-chip" title={formatAiModelName(activeItem.imageModel)}>
                  {t('eventDrawer.aiImageBadgeWithCost', {
                    model: formatAiModelName(activeItem.imageModel),
                    cost: formatUsdDigits(activeItem.imageCostUsd),
                  })}
                </span>
              )}
            </header>

            <div className="puz-stage-bar">
              <div className="game-segmented game-segmented--compact" role="radiogroup" aria-label={t('quiz.puzzle.title')}>
                {DIFFICULTIES.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={difficultyId === d.id}
                    className="game-segment"
                    onClick={() => setDifficultyId(d.id)}
                  >
                    <span>{t(`quiz.puzzle.diff_${d.id}`)}</span>
                    <span className="game-segment-meta" dir="ltr">{`${d.gridSize}×${d.gridSize}`}</span>
                  </button>
                ))}
              </div>
              <div className="game-hud-stats">
                <span className="game-stat">
                  <span>{t('quiz.puzzle.movesLabel').replace('{moves}', String(moves))}</span>
                </span>
                <span className="game-stat" data-tone={isSolved ? 'positive' : 'progress'}>
                  <Check aria-hidden="true" />
                  <span dir="ltr">{`${correctCount}/${totalPieces}`}</span>
                </span>
              </div>
            </div>

            <div className="puz-meter" aria-hidden="true">
              <span style={{ width: `${progressPct}%` }} />
            </div>

            <div className="puz-board" dir="ltr">
              {isPeeking && !isSolved ? (
                <img src={activeItem.imageUrl} alt={activeItem.title} className="puz-peek" />
              ) : (
                <div
                  className="puz-grid"
                  data-solved={isSolved || undefined}
                  style={{
                    gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
                    gridTemplateRows: `repeat(${gridSize}, 1fr)`,
                  }}
                >
                  {pieces.map((pieceId, cellIdx) => {
                    const origRow = Math.floor(pieceId / gridSize);
                    const origCol = pieceId % gridSize;
                    const bgX = gridSize > 1 ? (origCol / (gridSize - 1)) * 100 : 0;
                    const bgY = gridSize > 1 ? (origRow / (gridSize - 1)) * 100 : 0;
                    const isPieceInHome = pieceId === cellIdx;

                    return (
                      <button
                        key={cellIdx}
                        type="button"
                        draggable={!isSolved}
                        onClick={() => handleTileClick(cellIdx)}
                        onDragStart={(e) => {
                          setDraggedCell(cellIdx);
                          if (e.dataTransfer) {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', String(cellIdx));
                          }
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (dragOverCell !== cellIdx) setDragOverCell(cellIdx);
                        }}
                        onDragLeave={() => {
                          if (dragOverCell === cellIdx) setDragOverCell(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOverCell(null);
                          const fromCell =
                            draggedCell !== null
                              ? draggedCell
                              : Number(e.dataTransfer?.getData('text/plain'));
                          setDraggedCell(null);
                          if (Number.isFinite(fromCell) && fromCell !== cellIdx) {
                            swapCells(fromCell, cellIdx, false);
                          }
                        }}
                        onDragEnd={() => {
                          setDraggedCell(null);
                          setDragOverCell(null);
                        }}
                        className="puz-tile"
                        data-selected={selectedCell === cellIdx || undefined}
                        data-over={dragOverCell === cellIdx || undefined}
                        data-home={(!isSolved && isPieceInHome) || undefined}
                        data-hinted={justHintedCell === cellIdx || undefined}
                        style={{
                          backgroundImage: `url("${activeItem.imageUrl}")`,
                          backgroundSize: `${gridSize * 100}% ${gridSize * 100}%`,
                          backgroundPosition: `${bgX}% ${bgY}%`,
                        }}
                        aria-label={`${cellIdx + 1}`}
                        aria-pressed={selectedCell === cellIdx}
                      >
                        {!isSolved && isPieceInHome && (
                          <span className="puz-tile-check" aria-hidden="true"><Check /></span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {!isSolved && (
              <footer className="puz-stage-foot">
                <div className="puz-tools">
                  <button
                    type="button"
                    className="game-tool-btn"
                    disabled={hintsUsed >= MAX_PUZZLE_HINTS}
                    onClick={handlePlaceHintPiece}
                  >
                    <Lightbulb aria-hidden="true" />
                    <span>
                      {hintsUsed >= MAX_PUZZLE_HINTS
                        ? t('quiz.puzzle.allHintsUsed')
                        : t('quiz.puzzle.hintBtn')
                            .replace('{used}', String(hintsUsed))
                            .replace('{max}', String(MAX_PUZZLE_HINTS))}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="game-tool-btn"
                    aria-pressed={isPeeking}
                    onClick={() => setIsPeeking((v) => !v)}
                  >
                    <Eye aria-hidden="true" />
                    <span>{t('quiz.puzzle.peekBtn')}</span>
                  </button>
                  <button type="button" className="game-tool-btn" onClick={() => startBoard(totalPieces)}>
                    <RotateCcw aria-hidden="true" />
                    <span>{t('quiz.puzzle.shuffleBtn')}</span>
                  </button>
                </div>
                <p className="game-caption">{t('quiz.puzzle.instructionsHint')}</p>
              </footer>
            )}
          </section>

          {isSolved && (
            <RoundFeedback
              tone="correct"
              Icon={CheckCircle2}
              title={t('quiz.puzzle.solvedTitle')
                .replace('{moves}', String(moves))
                .replace('{points}', formatPoints(score, lang))}
              onShowEvent={activeItem.article && onSelectEvent ? () => onSelectEvent(activeItem.article) : null}
              nextLabel={articlesWithImages.length > 1 && sourceTab === 'existing' ? t('quiz.puzzle.nextImageBtn') : null}
              onNext={articlesWithImages.length > 1 && sourceTab === 'existing' ? handlePickRandomExisting : null}
              secondaryAction={
                <button type="button" className="quiz-button quiz-button--secondary" onClick={() => startBoard(totalPieces)}>
                  <RotateCcw aria-hidden="true" />
                  <span>{t('quiz.puzzle.playAgainSameBtn')}</span>
                </button>
              }
            >
              {activeItem.subtitle && <p dir={getTextDir(activeItem.subtitle)}>{activeItem.subtitle}</p>}
            </RoundFeedback>
          )}
        </>
      )}
    </div>
  );
}
