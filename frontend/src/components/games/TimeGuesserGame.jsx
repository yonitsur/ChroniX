import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Star,
  MapPin,
  Clock,
  Compass,
  RotateCcw,
  CheckCircle2,
  Check,
  Plus,
  Minus,
  Globe,
  Crosshair,
  Sun,
  Moon,
  Layers,
} from '../icons/ThemeIcons';
import { useLanguage } from '../../context/LanguageContext';
import { getTextDir } from '../../utils/textDirection';
import {
  formatGameYear,
  scrubEventSpoilers,
  calculateHaversineKm,
  shuffleArray,
} from './gameUtils';
import { GameHud, GameResults, RoundFeedback, formatPoints, starsForRatio } from './GameChrome';
import useGameCompletionReport from '../../hooks/useGameCompletionReport';

const MAX_ROUNDS = 5;

const GAME_TILE_PROVIDERS = {
  esriStreet: {
    label: 'Esri Atlas',
    getUrl: () =>
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    options: { minZoom: 1, maxZoom: 19, maxNativeZoom: 18 },
    invertInDark: true,
  },
  google: {
    label: 'Google',
    getUrl: (_isDark, lang = 'en') => {
      const mapLang = lang === 'he' ? 'he' : 'en';
      const mapRegion = mapLang === 'he' ? 'IL' : 'US';
      return `https://mt{s}.google.com/vt/lyrs=m&hl=${mapLang}&gl=${mapRegion}&x={x}&y={y}&z={z}`;
    },
    options: { subdomains: ['0', '1', '2', '3'], minZoom: 1, maxZoom: 19 },
    invertInDark: true,
  },
  osm: {
    label: 'OSM',
    getUrl: () => 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { minZoom: 1, maxZoom: 19 },
    invertInDark: true,
  },
  esri: {
    label: 'Esri Canvas',
    getUrl: (isDark) =>
      isDark
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
        : 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    options: { minZoom: 1, maxZoom: 19, maxNativeZoom: 16 },
    invertInDark: false,
  },
};

const GAME_PROVIDER_CYCLE = ['esriStreet', 'google', 'osm', 'esri'];

function hasValidCoords(article) {
  return (
    article &&
    article.lat != null &&
    article.lng != null &&
    Number.isFinite(Number(article.lat)) &&
    Number.isFinite(Number(article.lng))
  );
}

export default function TimeGuesserGame({ timeline, onSelectEvent }) {
  const { t, language: lang, isRtl, contentMode } = useLanguage();
  const isKidsMode = contentMode === 'kids';
  const [sessionSeed, setSessionSeed] = useState(0);
  const [rounds, setRounds] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [guessedYear, setGuessedYear] = useState(1950);
  const [guessedLatLng, setGuessedLatLng] = useState(null);
  const [roundResult, setRoundResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isUiDark, setIsUiDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );
  const [isMapDark, setIsMapDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined;
    const syncUiDark = () => {
      const nextDark = document.documentElement.classList.contains('dark');
      setIsUiDark(nextDark);
    };
    syncUiDark();
    const obs = new MutationObserver(syncUiDark);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    setIsMapDark(isUiDark);
  }, [isUiDark]);

  const [tileProvider, setTileProvider] = useState(() => {
    try {
      const saved = localStorage.getItem('chronix_game_map_provider');
      return GAME_TILE_PROVIDERS[saved] ? saved : 'esriStreet';
    } catch {
      return 'esriStreet';
    }
  });

  const handleCycleProvider = () => {
    const idx = GAME_PROVIDER_CYCLE.indexOf(tileProvider);
    const next = GAME_PROVIDER_CYCLE[(idx + 1) % GAME_PROVIDER_CYCLE.length];
    setTileProvider(next);
    try {
      localStorage.setItem('chronix_game_map_provider', next);
    } catch {
      // ignore
    }
  };

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const guessMarkerRef = useRef(null);
  const actualMarkerRef = useRef(null);
  const lineLayerRef = useRef(null);
  const roundResultRef = useRef(null);
  roundResultRef.current = roundResult;

  const validArticles = useMemo(() => {
    const articles = Array.isArray(timeline?.articles) ? timeline.articles : [];
    return articles.filter(
      (a) => a && a.title && (a.from?.year != null || a.from_?.year != null)
    );
  }, [timeline?.articles]);

  // Compute slider bounds with padding so endpoints don't spoil exact min/max
  const { sliderMin, sliderMax, sliderStep, timelineSpan } = useMemo(() => {
    if (!validArticles.length) {
      return { sliderMin: 1900, sliderMax: 2025, sliderStep: 1, timelineSpan: 125 };
    }
    const years = validArticles.map((a) => Number(a.from?.year ?? a.from_?.year ?? 0));
    const minY = Math.min(...years);
    const maxY = Math.max(...years);
    const rawSpan = Math.max(10, maxY - minY);
    const pad = Math.max(5, Math.round(rawSpan * 0.15));
    const currentCalendarYear = new Date().getFullYear();
    const sMin = Math.round(minY - pad);
    const sMax =
      maxY <= currentCalendarYear
        ? Math.min(currentCalendarYear, Math.round(maxY + pad))
        : Math.round(maxY + pad);
    let step = 1;
    if (rawSpan > 10_000_000) step = 1_000_000;
    else if (rawSpan > 100_000) step = 1000;
    else if (rawSpan > 5000) step = 10;
    return {
      sliderMin: sMin,
      sliderMax: Math.max(sMin + step * 4, sMax),
      sliderStep: step,
      timelineSpan: Math.max(20, rawSpan),
    };
  }, [validArticles]);

  const initSession = useCallback(() => {
    if (!validArticles.length) return;
    const geoEvents = validArticles.filter(hasValidCoords);
    const nonGeoEvents = validArticles.filter((a) => !hasValidCoords(a));

    // Prioritize events with coordinates and images
    const geoWithImg = shuffleArray(geoEvents.filter((a) => a.imageUrl));
    const geoNoImg = shuffleArray(geoEvents.filter((a) => !a.imageUrl));
    const nonGeoShuffled = shuffleArray(nonGeoEvents);

    const pool = [...geoWithImg, ...geoNoImg, ...nonGeoShuffled];
    const selected = pool.slice(0, Math.min(MAX_ROUNDS, pool.length));
    setRounds(selected);
    setCurrentIndex(0);
    setGuessedYear(Math.round((sliderMin + sliderMax) / 2));
    setGuessedLatLng(null);
    setRoundResult(null);
    setHistory([]);
    setIsCompleted(false);
  }, [validArticles, sliderMin, sliderMax]);

  useEffect(() => {
    initSession();
  }, [initSession, sessionSeed]);

  const currentEvent = rounds[currentIndex] || null;
  const currentHasGeo = hasValidCoords(currentEvent);

  // Reset per-round state when currentIndex changes
  useEffect(() => {
    const mid = Math.round((sliderMin + sliderMax) / 2);
    const roundedMid =
      sliderStep > 1 ? Math.round(mid / sliderStep) * sliderStep : mid;
    setGuessedYear(roundedMid);
    setGuessedLatLng(null);
    setRoundResult(null);
  }, [currentIndex, sliderMin, sliderMax, sliderStep]);

  // Initialize / update Esri Leaflet map for geo rounds
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!currentHasGeo || isCompleted || !container) {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      return undefined;
    }

    if (!mapInstanceRef.current) {
      const polarBounds = L.latLngBounds(
        L.latLng(-85.0511, -10000),
        L.latLng(85.0511, 10000)
      );

      const map = L.map(container, {
        center: [22, 12],
        zoom: 2,
        minZoom: 1,
        maxZoom: 19,
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: true,
        doubleClickZoom: true,
        touchZoom: true,
        dragging: true,
        worldCopyJump: true,
        maxBounds: polarBounds,
        maxBoundsViscosity: 0.85,
      });

      const providerCfg = GAME_TILE_PROVIDERS[tileProvider] || GAME_TILE_PROVIDERS.esriStreet;
      tileLayerRef.current = L.tileLayer(
        providerCfg.getUrl(isMapDark, lang),
        providerCfg.options
      ).addTo(map);

      map.on('click', (e) => {
        if (roundResultRef.current) return;
        const { lat, lng } = e.latlng;
        // Wrap longitude to [-180, 180] so pins placed after panning across the dateline score accurately
        const wrappedLng = ((((lng + 180) % 360) + 360) % 360) - 180;
        setGuessedLatLng({ lat, lng: wrappedLng });

        const guessIcon = L.divIcon({
          className: 'tg-map-pin tg-map-pin--guess',
          html: `<div class="tg-pin-dot tg-pin-dot--guess"></div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });

        if (guessMarkerRef.current) {
          guessMarkerRef.current.setLatLng([lat, lng]);
        } else {
          guessMarkerRef.current = L.marker([lat, lng], { icon: guessIcon }).addTo(map);
        }
      });

      mapInstanceRef.current = map;
    } else {
      mapInstanceRef.current.setView([22, 12], 2);
    }

    // Clear previous round's markers and polyline
    if (guessMarkerRef.current) {
      guessMarkerRef.current.remove();
      guessMarkerRef.current = null;
    }
    if (actualMarkerRef.current) {
      actualMarkerRef.current.remove();
      actualMarkerRef.current = null;
    }
    if (lineLayerRef.current) {
      lineLayerRef.current.remove();
      lineLayerRef.current = null;
    }

    // Keep map size synced during drawer width transitions
    const mapRef = mapInstanceRef.current;
    const timers = [
      setTimeout(() => mapRef?.invalidateSize(), 50),
      setTimeout(() => mapRef?.invalidateSize(), 200),
      setTimeout(() => mapRef?.invalidateSize(), 360),
    ];

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        try {
          mapRef?.invalidateSize();
        } catch {
          // ignore
        }
      });
      resizeObserver.observe(container);
    }

    return () => {
      timers.forEach(clearTimeout);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [currentHasGeo, currentIndex, isCompleted, sessionSeed]);

  // Swap tile layer whenever tileProvider, isMapDark, or language changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const providerCfg = GAME_TILE_PROVIDERS[tileProvider] || GAME_TILE_PROVIDERS.esriStreet;
    if (tileLayerRef.current) {
      try {
        map.removeLayer(tileLayerRef.current);
      } catch {
        // ignore
      }
    }
    tileLayerRef.current = L.tileLayer(
      providerCfg.getUrl(isMapDark, lang),
      providerCfg.options
    ).addTo(map);
  }, [tileProvider, isMapDark, lang]);

  // Cleanup map on unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  const handleZoomIn = () => {
    mapInstanceRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    mapInstanceRef.current?.zoomOut();
  };

  const handleResetWorldView = () => {
    mapInstanceRef.current?.setView([22, 12], 1.5, { animate: true });
  };

  const handleLockGuess = () => {
    if (!currentEvent || roundResult) return;
    if (currentHasGeo && !guessedLatLng) return;

    const actualYear = Number(currentEvent.from?.year ?? currentEvent.from_?.year ?? 0);
    const yearDiff = Math.abs(guessedYear - actualYear);
    const maxTimePts = currentHasGeo ? 500 : 1000;
    const normYearErr = yearDiff / Math.max(10, timelineSpan);
    const timeScore =
      yearDiff === 0
        ? maxTimePts
        : Math.max(0, Math.round(maxTimePts * Math.exp(-3.0 * normYearErr)));

    let mapScore = 0;
    let distanceKm = null;

    if (currentHasGeo && guessedLatLng) {
      const actualLat = Number(currentEvent.lat);
      const actualLng = Number(currentEvent.lng);
      distanceKm = calculateHaversineKm(
        guessedLatLng.lat,
        guessedLatLng.lng,
        actualLat,
        actualLng
      );
      mapScore =
        distanceKm <= 25
          ? 500
          : Math.max(0, Math.round(500 * Math.exp(-distanceKm / 1800)));

      // Show actual marker & dashed line on map
      const map = mapInstanceRef.current;
      if (map) {
        const actualIcon = L.divIcon({
          className: 'tg-map-pin tg-map-pin--actual',
          html: `<div class="tg-pin-dot tg-pin-dot--actual"></div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        actualMarkerRef.current = L.marker([actualLat, actualLng], {
          icon: actualIcon,
        }).addTo(map);

        lineLayerRef.current = L.polyline(
          [
            [guessedLatLng.lat, guessedLatLng.lng],
            [actualLat, actualLng],
          ],
          {
            color: '#f59e0b',
            weight: 3,
            dashArray: '6, 6',
            opacity: 0.95,
          }
        ).addTo(map);

        const bounds = L.latLngBounds([
          [guessedLatLng.lat, guessedLatLng.lng],
          [actualLat, actualLng],
        ]);
        map.fitBounds(bounds, { padding: [44, 44], maxZoom: 10 });
      }
    }

    const totalRoundScore = timeScore + mapScore;
    const resultObj = {
      event: currentEvent,
      actualYear,
      guessedYear,
      yearDiff,
      distanceKm,
      timeScore,
      mapScore,
      totalRoundScore,
      hasGeo: currentHasGeo,
    };
    setRoundResult(resultObj);
    setHistory((prev) => [...prev, resultObj]);
  };

  const handleNextRound = () => {
    if (currentIndex + 1 < rounds.length) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setIsCompleted(true);
      const maxPoss = rounds.length * 1000;
      if (maxPoss > 0 && totalScore / maxPoss >= 0.55) {
        confetti({
          particleCount: isKidsMode ? 75 : 40,
          spread: 65,
          origin: { x: 0.35, y: 0.6 },
          disableForReducedMotion: true,
        });
      }
    }
  };

  const totalScore = useMemo(
    () => history.reduce((sum, r) => sum + r.totalRoundScore, 0),
    [history]
  );

  useGameCompletionReport({
    game: 'timeGuesser',
    timelineId: timeline?.id,
    contentMode,
    isCompleted,
    stats: (() => {
      const maxPossible = rounds.length * 1000;
      const ratio = maxPossible > 0 ? totalScore / maxPossible : 0;
      return {
        correct: history.filter((r) => r.totalRoundScore >= 700).length,
        total: rounds.length,
        points: totalScore,
        ratio,
        stars: starsForRatio(ratio, 0.75, 0.45),
      };
    })(),
  });

  if (validArticles.length < 1) {
    return (
      <div className="game-empty">
        <p>{t('quiz.noEvents')}</p>
      </div>
    );
  }

  const toneForRound = (r) => {
    const ratio = r.totalRoundScore / 1000;
    if (ratio >= 0.7) return 'correct';
    if (ratio >= 0.35) return 'partial';
    return 'wrong';
  };

  if (isCompleted) {
    const maxPossible = rounds.length * 1000;
    const ratio = maxPossible > 0 ? totalScore / maxPossible : 0;
    const resultsTitle =
      ratio >= 0.75
        ? t('quiz.timeGuesser.resultsTitlePerfect')
        : ratio >= 0.45
        ? t('quiz.timeGuesser.resultsTitleGreat')
        : t('quiz.timeGuesser.resultsTitleGood');

    return (
      <GameResults
        ratio={ratio}
        starCount={starsForRatio(ratio, 0.75, 0.45)}
        title={resultsTitle}
        subtitle={t('quiz.timeGuesser.resultsSubtitle')
          .replace('{points}', formatPoints(totalScore, lang))
          .replace('{maxPoints}', formatPoints(maxPossible, lang))}
        scoreValue={formatPoints(totalScore, lang)}
        scoreCaption={t('quiz.pointsUnit')}
        recap={history.map((item, idx) => ({
          key: item.event.id || idx,
          tone: toneForRound(item),
          title: item.event.title,
          detail: formatGameYear(item.actualYear, lang),
          meta: `+${formatPoints(item.totalRoundScore, lang)}`,
          onClick: onSelectEvent ? () => onSelectEvent(item.event) : null,
        }))}
        actions={[
          { key: 'again', label: t('quiz.timeGuesser.playAgainBtn'), Icon: RotateCcw, onClick: () => setSessionSeed((s) => s + 1) },
        ]}
      />
    );
  }

  if (!currentEvent) return null;

  const isLocked = Boolean(roundResult);
  const rawSubtitle = currentEvent.subtitle || currentEvent.extract || '';
  const clueSubtitle = isLocked
    ? rawSubtitle
    : scrubEventSpoilers(rawSubtitle, currentEvent, {
        scrubYears: true,
        scrubLocation: true,
      });
  const clueTitle = isLocked
    ? currentEvent.title || ''
    : scrubEventSpoilers(currentEvent.title, currentEvent, {
        scrubYears: true,
        scrubLocation: true,
      });
  const textDir = isRtl ? 'rtl' : 'ltr';

  return (
    <div className="game-stack tg-game quiz-enter">
      <GameHud
        label={t('quiz.timeGuesser.roundProgress')
          .replace('{current}', String(currentIndex + 1))
          .replace('{total}', String(rounds.length))}
        stats={[
          { key: 'score', Icon: Star, tone: 'score', text: t('quiz.timeGuesser.totalPoints').replace('{points}', formatPoints(totalScore, lang)) },
        ]}
        total={rounds.length}
        current={currentIndex}
        results={history.map(toneForRound)}
      />

      <article className="game-card tg-clue">
        {currentEvent.imageUrl && (
          <div className="tg-clue-media">
            <img src={currentEvent.imageUrl} alt="" loading="lazy" />
          </div>
        )}
        <div className="tg-clue-body">
          <span className="game-eyebrow">
            <Compass aria-hidden="true" />
            {t('quiz.timeGuesser.clueEyebrow')}
          </span>
          <h4 className="game-title" dir={getTextDir(clueTitle)}>{clueTitle}</h4>
          {clueSubtitle && (
            <p className="game-body-text" dir={getTextDir(clueSubtitle)}>{clueSubtitle}</p>
          )}
        </div>
      </article>

      <section className="game-card tg-control" aria-label={t('quiz.timeGuesser.whenLabel')}>
        <header className="tg-control-head">
          <span className="game-section-label">
            <Clock aria-hidden="true" />
            {t('quiz.timeGuesser.whenLabel')}
          </span>
        </header>
        {/* LTR so the −/+ buttons sit on the same sides as the slider's min/max */}
        <div className="tg-year-picker" dir="ltr">
          <button
            type="button"
            className="game-icon-btn"
            disabled={isLocked || guessedYear <= sliderMin}
            onClick={() => setGuessedYear((y) => Math.max(sliderMin, y - sliderStep))}
            aria-label={`- ${sliderStep}`}
          >
            <Minus aria-hidden="true" />
          </button>
          <output className="tg-year-readout" aria-live="polite" dir={textDir}>{formatGameYear(guessedYear, lang)}</output>
          <button
            type="button"
            className="game-icon-btn"
            disabled={isLocked || guessedYear >= sliderMax}
            onClick={() => setGuessedYear((y) => Math.min(sliderMax, y + sliderStep))}
            aria-label={`+ ${sliderStep}`}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
        <input
          type="range"
          min={sliderMin}
          max={sliderMax}
          step={sliderStep}
          value={guessedYear}
          disabled={isLocked}
          onChange={(e) => setGuessedYear(Number(e.target.value))}
          className="game-range"
          style={{ '--range-fill': `${((guessedYear - sliderMin) / Math.max(1, sliderMax - sliderMin)) * 100}%` }}
          aria-label={t('quiz.timeGuesser.whenLabel')}
          dir="ltr"
        />
        <div className="tg-range-bounds" dir="ltr">
          <span dir={textDir}>{formatGameYear(sliderMin, lang)}</span>
          <span dir={textDir}>{formatGameYear(sliderMax, lang)}</span>
        </div>
      </section>

      {currentHasGeo ? (
        <section className="game-card tg-control" aria-label={t('quiz.timeGuesser.whereLabel')}>
          <header className="tg-control-head">
            <span className="game-section-label">
              <MapPin aria-hidden="true" />
              {t('quiz.timeGuesser.whereLabel')}
            </span>
            <span className="game-chip" data-tone={guessedLatLng ? 'positive' : 'neutral'}>
              {guessedLatLng ? <Check aria-hidden="true" /> : null}
              {guessedLatLng ? t('quiz.timeGuesser.wherePinPlaced') : t('quiz.timeGuesser.whereHintClick')}
            </span>
          </header>
          <div className="tg-map" dir="ltr" onWheel={(e) => e.stopPropagation()}>
            <div
              ref={mapContainerRef}
              className="tg-leaflet-map"
              data-map-dark={
                (isMapDark &&
                  (GAME_TILE_PROVIDERS[tileProvider]?.invertInDark ?? true)) ||
                undefined
              }
              dir="ltr"
            />
            <div className="tg-map-controls">
              <button type="button" className="tg-map-btn" onClick={handleZoomIn} title={t('toolbar.zoomIn')} aria-label={t('toolbar.zoomIn')}>
                <Plus aria-hidden="true" />
              </button>
              <button type="button" className="tg-map-btn" onClick={handleZoomOut} title={t('toolbar.zoomOut')} aria-label={t('toolbar.zoomOut')}>
                <Minus aria-hidden="true" />
              </button>
              <button type="button" className="tg-map-btn" onClick={handleResetWorldView} title={t('floatingMap.fitBoundsTooltip')} aria-label={t('floatingMap.fitBoundsTooltip')}>
                <Globe aria-hidden="true" />
              </button>
              <button
                type="button"
                className="tg-map-btn"
                onClick={() => setIsMapDark((prev) => !prev)}
                title={t(isMapDark ? 'floatingMap.dayModeTooltip' : 'floatingMap.nightModeTooltip')}
                aria-label={t(isMapDark ? 'floatingMap.dayModeTooltip' : 'floatingMap.nightModeTooltip')}
                aria-pressed={isMapDark}
              >
                {isMapDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
              </button>
            </div>
            {(() => {
              const currentCfg = GAME_TILE_PROVIDERS[tileProvider] || GAME_TILE_PROVIDERS.esriStreet;
              const nextKey =
                GAME_PROVIDER_CYCLE[
                  (GAME_PROVIDER_CYCLE.indexOf(tileProvider) + 1) % GAME_PROVIDER_CYCLE.length
                ];
              const nextCfg = GAME_TILE_PROVIDERS[nextKey];
              const switchTooltip =
                t('floatingMap.switchBasemap', { name: nextCfg.label }) ||
                `Switch basemap to ${nextCfg.label}`;
              return (
                <button
                  type="button"
                  className="tg-map-provider-btn"
                  onClick={handleCycleProvider}
                  title={switchTooltip}
                  aria-label={switchTooltip}
                >
                  <Layers aria-hidden="true" />
                  <span>{currentCfg.label}</span>
                </button>
              );
            })()}
          </div>
        </section>
      ) : (
        <p className="game-note">
          <Clock aria-hidden="true" />
          <span>{t('quiz.timeGuesser.timeOnlyNotice')}</span>
        </p>
      )}

      {!roundResult ? (
        <button
          type="button"
          className="quiz-button quiz-button--primary game-cta"
          disabled={currentHasGeo && !guessedLatLng}
          onClick={handleLockGuess}
        >
          <Crosshair aria-hidden="true" />
          <span>
            {currentHasGeo && !guessedLatLng
              ? t('quiz.timeGuesser.selectPinFirst')
              : t('quiz.timeGuesser.submitGuessBtn')}
          </span>
        </button>
      ) : (
        <RoundFeedback
          tone={toneForRound(roundResult)}
          Icon={toneForRound(roundResult) === 'wrong' ? Compass : CheckCircle2}
          title={t('quiz.timeGuesser.roundTotalLabel').replace('{score}', formatPoints(roundResult.totalRoundScore, lang))}
          onShowEvent={onSelectEvent ? () => onSelectEvent(roundResult.event) : null}
          nextLabel={currentIndex + 1 < rounds.length ? t('quiz.timeGuesser.nextRoundBtn') : t('quiz.timeGuesser.finishBtn')}
          onNext={handleNextRound}
        >
          <ul className="tg-breakdown">
            <li>
              <Clock aria-hidden="true" />
              <span className="tg-breakdown-text">
                {roundResult.yearDiff === 0
                  ? t('quiz.timeGuesser.yearExact').replace('{year}', formatGameYear(roundResult.actualYear, lang))
                  : t('quiz.timeGuesser.yearDiff')
                      .replace('{diff}', formatPoints(roundResult.yearDiff, lang))
                      .replace('{guess}', formatGameYear(roundResult.guessedYear, lang))
                      .replace('{actual}', formatGameYear(roundResult.actualYear, lang))}
              </span>
              <span className="tg-breakdown-score">
                {formatPoints(roundResult.timeScore, lang)}
                <small>/{roundResult.hasGeo ? 500 : formatPoints(1000, lang)}</small>
              </span>
            </li>
            {roundResult.hasGeo && roundResult.distanceKm != null && (
              <li>
                <MapPin aria-hidden="true" />
                <span className="tg-breakdown-text">
                  {(roundResult.distanceKm <= 25
                    ? t('quiz.timeGuesser.distanceSpotOn')
                    : t('quiz.timeGuesser.distanceKm')
                  ).replace('{km}', formatPoints(roundResult.distanceKm, lang))}
                  {roundResult.event.locationName && (
                    <span className="tg-breakdown-place" dir={getTextDir(roundResult.event.locationName)}>
                      {roundResult.event.locationName}
                    </span>
                  )}
                </span>
                <span className="tg-breakdown-score">
                  {formatPoints(roundResult.mapScore, lang)}
                  <small>/500</small>
                </span>
              </li>
            )}
          </ul>
        </RoundFeedback>
      )}
    </div>
  );
}
