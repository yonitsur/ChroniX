import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Minimize2,
  MapPin,
  MapPinOff,
  ExternalLink,
  Navigation,
  Sparkles,
  Info,
  Calendar,
  Eye,
  ChevronRight,
  X,
  Plus,
  Minus,
  Globe,
  Pencil
} from 'lucide-react';
import { getDistinctCategories, getCategoryColor } from '../data/laneColors';
import { useLanguage } from '../context/LanguageContext';
import { isSameArticleId } from './TimelineView';

// Available basemap tile providers: 'esri' | 'osm'
// Configurable via VITE_MAP_TILE_PROVIDER in .env, or by setting ACTIVE_TILE_PROVIDER below.
export const ACTIVE_TILE_PROVIDER = import.meta.env?.VITE_MAP_TILE_PROVIDER === 'osm' ? 'osm' : 'esri';

const TILE_PROVIDERS = {
  osm: {
    getUrl: () => 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: (isDark) => ({
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      opacity: isDark ? 0.85 : 0.95
    }),
    invertInDark: true
  },
  esri: {
    getUrl: (isDark) => isDark
      ? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
      : 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    options: () => ({
      maxZoom: 16,
      attribution: '&copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
      opacity: 0.95
    }),
    invertInDark: false
  },
  carto: {
    getUrl: (isDark) => isDark
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    options: () => ({
      subdomains: 'abcd',
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      opacity: 0.95
    }),
    invertInDark: false
  }
};

// Module-level cache to remember last user-navigated map view coordinates per timeline across mode switches/theme changes:
const lastMapViewMap = new Map();

// Pins the hover bubble open (desktop click)
const setPinBubble = (marker, open) => {
  marker.getElement()?.classList.toggle('chronix-pin-bubble-open', open);
};

const escapeHtml = (str) =>
  String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Escaped text with **bold** / *italic* emphasis rendered (descriptions carry light Markdown).
const escapeInlineMarkdown = (str) =>
  escapeHtml(str)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');

// Every pin card shares one footprint so stepping through a tour never changes its size.
// Width leaves room for the bottom-right zoom controls (right-4 + ~40px column + gap).
const MAP_CONTROLS_INSET = 64;
const getPopupCardSize = (mapWidth) => ({
  w: Math.round(Math.max(232, Math.min(320, (mapWidth || 390) - MAP_CONTROLS_INSET - 8))),
  h: Math.round(Math.max(248, Math.min(320, (typeof window !== 'undefined' ? window.innerHeight : 800) * 0.36))),
});

// Clamp the description to however many whole lines fit its flex-allotted slot.
const fitPopupDescription = (popupEl) => {
  const slot = popupEl?.querySelector('.chronix-popup-desc-slot');
  const desc = slot?.querySelector('.chronix-popup-desc');
  if (!slot || !desc) return;
  const apply = () => {
    const lineH = parseFloat(window.getComputedStyle(desc).lineHeight) || 19;
    desc.style.webkitLineClamp = String(Math.max(1, Math.floor(slot.clientHeight / lineH)));
  };
  apply();
  // Title wrapping can settle after open (web font load), which resizes the slot.
  if (!slot._chronixFitObserver && typeof ResizeObserver !== 'undefined') {
    slot._chronixFitObserver = new ResizeObserver(apply);
    slot._chronixFitObserver.observe(slot);
  }
};

// Height of the fixed mobile top bar that overlaps the top of the map pane.
const getTopOverlayInset = (mapEl) => {
  const bar = document.getElementById('chronix-mobile-top-bar');
  if (!bar || !mapEl) return 0;
  return Math.max(0, bar.getBoundingClientRect().bottom - mapEl.getBoundingClientRect().top);
};

export default function GeoMapView({
  articles = [],
  lanes = [],
  selectedArticleId,
  hoveredArticleId = null,
  onHoverArticle,
  timelineId = null,
  onSelectArticle,
  onOpenDetails,
  onFocusArticle,
  theme = 'light',
  className = '',
  // Active lane/theme filters synchronized from the timeline. An empty selection shows all.
  // { mode: 'theme' | 'lane', items: [{ id, matchKeys, color, name }] } or null.
  activeFilter = null,
  // Starred-only filter, synchronized from the timeline's star filter.
  filterStarredOnly = false,
  starredArticleIds = null,
  tileProvider = ACTIVE_TILE_PROVIDER,
  isExploring = false,
  isMobile: isMobileProp,
  hasRightDrawer = false,
  // Called with a required pixel height (popup + pin clearance) whenever a popup opens
  // on a narrow/mobile viewport, so the parent can grow the map's split-pane share if
  // it's currently too short for the card to fit without being clipped.
  onRequestMapHeight
}) {
  const { t, formatDatePart, formatTimeSpan, isRtl } = useLanguage();
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const tileLayerRef = useRef(null);
  const isRestoringPopupRef = useRef(false);
  const prevSelectedArticleIdRef = useRef(null);
  const bubbleArticleIdRef = useRef(null);

  const articlesRef = useRef(articles);
  articlesRef.current = articles;
  const timelineIdRef = useRef(timelineId);
  useEffect(() => {
    timelineIdRef.current = timelineId;
  }, [timelineId]);
  const onOpenDetailsRef = useRef(onOpenDetails);
  onOpenDetailsRef.current = onOpenDetails;
  const onFocusArticleRef = useRef(onFocusArticle);
  onFocusArticleRef.current = onFocusArticle;
  const onHoverArticleRef = useRef(onHoverArticle);
  useEffect(() => {
    onHoverArticleRef.current = onHoverArticle;
  }, [onHoverArticle]);
  const onRequestMapHeightRef = useRef(onRequestMapHeight);
  onRequestMapHeightRef.current = onRequestMapHeight;

  // Track whether initial fitBounds has run for the current timeline dataset
  const hasFittedBoundsRef = useRef(false);
  const prevArticlesSignatureRef = useRef(null);
  const routeCoordinatesRef = useRef([]);

  const articlesSignature = useMemo(() => {
    if (!articles || articles.length === 0) return '';
    return `${timelineId || ''}_${articles.length}_${articles[0]?.id || ''}_${articles[articles.length - 1]?.id || ''}`;
  }, [timelineId, articles]);

  useEffect(() => {
    if (articlesSignature !== prevArticlesSignatureRef.current) {
      prevArticlesSignatureRef.current = articlesSignature;
      const currentKey = timelineIdRef.current || (articlesRef.current[0]?.id ? `tl_${articlesRef.current.length}_${articlesRef.current[0].id}` : null);
      if (!currentKey || !lastMapViewMap.has(currentKey)) {
        hasFittedBoundsRef.current = false;
      }
    }
  }, [articlesSignature]);

  // Synchronize incoming hoveredArticleId and selectedArticleId classes dynamically on Leaflet marker DOM elements
  useEffect(() => {
    if (!markersRef.current) return;
    Object.entries(markersRef.current).forEach(([id, marker]) => {
      const el = marker.getElement();
      if (!el) return;
      const isHovered = hoveredArticleId && isSameArticleId(id, hoveredArticleId);
      const isSelected = selectedArticleId && isSameArticleId(id, selectedArticleId);
      if (isHovered) {
        el.classList.add('chronix-pin-cross-hovered');
        marker.setZIndexOffset(2000);
      } else {
        el.classList.remove('chronix-pin-cross-hovered');
        marker.setZIndexOffset(isSelected ? 1000 : 0);
      }
    });
  }, [hoveredArticleId, selectedArticleId]);

  // Responsive breakpoint detection (< 768px = mobile / small screens)
  const [isNarrowScreen, setIsNarrowScreen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  useEffect(() => {
    const handleResize = () => setIsNarrowScreen(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const isMobile = isMobileProp !== undefined ? isMobileProp : isNarrowScreen;

  // Mobile interaction refs: tracking long-press and tap states
  const longPressTimerRef = useRef(null);
  const longPressConsumedRef = useRef(false);
  const longPressStartRef = useRef(null);
  const isMobileRef = useRef(isMobile);
  useEffect(() => {
    isMobileRef.current = isMobile;
  }, [isMobile]);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const [showGlobalEvents, setShowGlobalEvents] = useState(false);
  const [isCenterPopupDismissed, setIsCenterPopupDismissed] = useState(false);

  // Reset center popup dismissal whenever the active event changes
  useEffect(() => {
    setIsCenterPopupDismissed(false);
  }, [selectedArticleId]);

  const isDark = theme === 'dark';

  // Filter articles with valid coordinates
  const geoArticles = useMemo(() => {
    return articles.filter(
      (a) =>
        a.lat !== undefined &&
        a.lat !== null &&
        a.lng !== undefined &&
        a.lng !== null &&
        !isNaN(Number(a.lat)) &&
        !isNaN(Number(a.lng)) &&
        Math.abs(Number(a.lat)) <= 90 &&
        Math.abs(Number(a.lng)) <= 180
    );
  }, [articles]);

  const nonGeoArticles = useMemo(() => {
    return articles.filter(
      (a) =>
        a.lat === undefined ||
        a.lat === null ||
        a.lng === undefined ||
        a.lng === null ||
        isNaN(Number(a.lat)) ||
        isNaN(Number(a.lng))
    );
  }, [articles]);


  // Topic (`category`) drives pin color, independent of the lane/timeline split
  // which only controls which parallel track an event sits in.
  const categories = useMemo(() => getDistinctCategories(articles), [articles]);

  // Resolves the color a pin should use: topic color if categorized, else accent.
  const getPinColor = (art) => {
    if (art?.category) {
      return getCategoryColor(art.category, categories);
    }
    return isDark ? '#71717a' : '#3f3f46';
  };



  // Matches an article against the externally-supplied starred-only + lane AND category
  // filters (both dimensions synchronized from the timeline; empty/null = show all for that dimension).
  const matchesFilter = (art) => {
    if (filterStarredOnly && starredArticleIds && !starredArticleIds.has(art.id)) return false;
    if (activeFilter?.laneItems?.length) {
      if (!activeFilter.laneItems.some((item) => item.matchKeys.includes(art.lane))) return false;
    }
    if (activeFilter?.categoryItems?.length) {
      if (!activeFilter.categoryItems.some((item) => item.matchKeys.includes(art.category || ''))) return false;
    }
    return true;
  };

  const filteredGeoArticles = useMemo(
    () => geoArticles.filter(matchesFilter),
    [geoArticles, activeFilter, filterStarredOnly, starredArticleIds]
  );

  const filteredNonGeoArticles = useMemo(
    () => nonGeoArticles.filter(matchesFilter),
    [nonGeoArticles, activeFilter, filterStarredOnly, starredArticleIds]
  );

  // Event number = chronological rank among ALL currently-visible events (geo + non-geo),
  // so a pin's number matches the tour counter instead of its map-route position. Events
  // without a location leave gaps in the on-map sequence (e.g. 2, 5, 6).
  const eventNumberMap = useMemo(() => {
    const sorted = [...articles.filter(matchesFilter)].sort((a, b) => {
      const ya = a.from?.year ?? 0;
      const yb = b.from?.year ?? 0;
      if (ya !== yb) return ya - yb;
      const ma = a.from?.month ?? 1;
      const mb = b.from?.month ?? 1;
      if (ma !== mb) return ma - mb;
      return (a.from?.day ?? 1) - (b.from?.day ?? 1);
    });
    const map = {};
    sorted.forEach((a, i) => { map[a.id] = i + 1; });
    return map;
  }, [articles, activeFilter, filterStarredOnly, starredArticleIds]);

  // 1. Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Destroy existing instance if any
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const container = mapContainerRef.current;
    const initialWidth = container ? container.clientWidth || 800 : 800;
    // Felt-inspired continuous cylindrical projection:
    // Allow zooming out to global scope (minZoom: 1) and continuous horizontal looping:
    const globalMinZoom = 1;
    // Soft polar latitude bounds (-85.0511 to 85.0511) without horizontal clamping, enabling infinite horizontal panning:
    const polarBounds = L.latLngBounds(L.latLng(-85.0511, -10000), L.latLng(85.0511, 10000));

    let initialCenter = [25, 10];
    let initialZoom = 2;

    const currentTimelineKey = timelineIdRef.current || (articlesRef.current[0]?.id ? `tl_${articlesRef.current.length}_${articlesRef.current[0].id}` : null);
    const savedState = currentTimelineKey ? lastMapViewMap.get(currentTimelineKey) : null;
    if (savedState && savedState.center && savedState.zoom) {
      initialCenter = savedState.center;
      initialZoom = Math.max(savedState.zoom, globalMinZoom);
      hasFittedBoundsRef.current = true;
    }

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
      minZoom: globalMinZoom,
      maxBounds: polarBounds,
      maxBoundsViscosity: 0.85,
      worldCopyJump: true
    }).setView(initialCenter, initialZoom);

    // Immediately attach the base tile layer so the map is never blank on mount
    const providerKey = (tileProvider === 'osm' || tileProvider === 'esri') ? tileProvider : 'esri';
    const provider = TILE_PROVIDERS[providerKey];
    const initialTileLayer = L.tileLayer(provider.getUrl(isDark), provider.options(isDark)).addTo(map);
    tileLayerRef.current = initialTileLayer;
    currentProviderRef.current = providerKey;

    mapInstanceRef.current = map;

    map.on('click', () => {
      const marker = markersRef.current[bubbleArticleIdRef.current];
      bubbleArticleIdRef.current = null;
      if (marker) setPinBubble(marker, false);
    });

    const handleMoveEnd = () => {
      if (!mapInstanceRef.current) return;
      // Never cache uninitialized placeholder coordinates
      if (!hasFittedBoundsRef.current) return;
      try {
        const center = mapInstanceRef.current.getCenter();
        const zoom = mapInstanceRef.current.getZoom();
        const currentKey = timelineIdRef.current || (articlesRef.current[0]?.id ? `tl_${articlesRef.current.length}_${articlesRef.current[0].id}` : null);
        if (currentKey) {
          lastMapViewMap.set(currentKey, {
            center: [center.lat, center.lng],
            zoom
          });
        }
      } catch (e) { }
    };
    map.on('moveend', handleMoveEnd);

    const updateConstraints = () => {
      if (!mapInstanceRef.current) return;
      mapInstanceRef.current.invalidateSize();
    };

    // Resize observer to ensure full rendering and dynamic zoom/bounds adaptation when container size changes
    const resizeObserver = new ResizeObserver(() => {
      try {
        updateConstraints();
      } catch (e) {
        // ignore during unmount
      }
    });
    // Delegated click handler on the container to open details when clicking the popup card or its details button
    const handleContainerClick = (e) => {
      const detailsBtn = e.target.closest('button[data-action="details"]');
      if (detailsBtn) {
        const card = detailsBtn.closest('.chronix-popup-clickable');
        const articleId = detailsBtn.getAttribute('data-article-id') || card?.getAttribute('data-article-id');
        if (articleId) {
          const clickedArt = articlesRef.current.find((a) => String(a.id) === String(articleId));
          if (clickedArt) {
            if (onFocusArticleRef.current) onFocusArticleRef.current(clickedArt);
            if (onOpenDetailsRef.current) onOpenDetailsRef.current(clickedArt);
          }
        }
        return;
      }
      const card = e.target.closest('.chronix-popup-clickable');
      if (!card) {
        // Tapped outside popup: dismiss location-less event card if active
        setIsCenterPopupDismissed(true);
        return;
      }
      const articleId = card.getAttribute('data-article-id');
      if (!articleId) return;
      const clickedArt = articlesRef.current.find((a) => String(a.id) === String(articleId));
      if (clickedArt) {
        if (onFocusArticleRef.current) onFocusArticleRef.current(clickedArt);
        if (onOpenDetailsRef.current) onOpenDetailsRef.current(clickedArt);
      }
    };
    // Delegated pointerdown / long-press handler on the container for mobile map pins
    const LONG_PRESS_MS = 500;
    const LONG_PRESS_MOVE_TOLERANCE = 12;

    const handleContainerPointerDown = (e) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen' && e.button !== 0) return;
      if (!isMobileRef.current) return;

      const pinEl = e.target.closest('[data-pin-article-id]');
      if (!pinEl) return;

      const articleId = pinEl.getAttribute('data-pin-article-id');
      const targetArt = articlesRef.current.find((a) => String(a.id) === String(articleId));
      if (!targetArt) return;

      clearLongPressTimer();
      longPressConsumedRef.current = false;
      longPressStartRef.current = { x: e.clientX, y: e.clientY };

      const onPointerMove = (moveEvt) => {
        if (!longPressTimerRef.current || !longPressStartRef.current) return;
        if (
          Math.abs(moveEvt.clientX - longPressStartRef.current.x) > LONG_PRESS_MOVE_TOLERANCE ||
          Math.abs(moveEvt.clientY - longPressStartRef.current.y) > LONG_PRESS_MOVE_TOLERANCE
        ) {
          clearLongPressTimer();
        }
      };

      const onPointerUp = () => {
        clearLongPressTimer();
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);

      longPressTimerRef.current = setTimeout(() => {
        longPressTimerRef.current = null;
        longPressConsumedRef.current = true;
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);

        // Long press on pin: focus timeline on this event and open event details directly on mobile
        if (onFocusArticleRef.current) {
          onFocusArticleRef.current(targetArt);
        }
        if (onOpenDetailsRef.current) {
          onOpenDetailsRef.current(targetArt);
        }
      }, LONG_PRESS_MS);
    };

    const handleContextMenu = (e) => {
      if (e.target.closest('[data-pin-article-id]')) {
        longPressConsumedRef.current = true;
        clearLongPressTimer();
      }
    };

    container.addEventListener('click', handleContainerClick, true);
    container.addEventListener('pointerdown', handleContainerPointerDown);
    container.addEventListener('contextmenu', handleContextMenu);

    // Delegated mouseover/mouseout listeners for timeline cross-highlighting
    const handleMouseOver = (e) => {
      const pinEl = e.target.closest('[data-pin-article-id]');
      if (pinEl) {
        const id = pinEl.getAttribute('data-pin-article-id');
        if (id) onHoverArticleRef.current?.(id);
      }
    };

    const handleMouseOut = (e) => {
      const pinEl = e.target.closest('[data-pin-article-id]');
      if (pinEl) {
        onHoverArticleRef.current?.(null);
      }
    };

    container.addEventListener('mouseover', handleMouseOver);
    container.addEventListener('mouseout', handleMouseOut);

    return () => {
      container.removeEventListener('click', handleContainerClick, true);
      container.removeEventListener('pointerdown', handleContainerPointerDown);
      container.removeEventListener('contextmenu', handleContextMenu);
      container.removeEventListener('mouseover', handleMouseOver);
      container.removeEventListener('mouseout', handleMouseOut);
      clearLongPressTimer();
      resizeObserver.disconnect();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.off('moveend', handleMoveEnd);
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      tileLayerRef.current = null;
    };
  }, []);

  // 2. Update Tiles on Theme or Provider Change (Live swap without tearing down layer if unnecessary)
  const currentProviderRef = useRef(tileProvider);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const providerKey = (tileProvider === 'osm' || tileProvider === 'esri') ? tileProvider : 'esri';
    const provider = TILE_PROVIDERS[providerKey];
    const tileUrl = provider.getUrl(isDark);
    const tileOptions = provider.options(isDark);

    // If tile layer is missing from map or provider changed, attach fresh layer
    if (!tileLayerRef.current || !map.hasLayer(tileLayerRef.current) || currentProviderRef.current !== providerKey) {
      if (tileLayerRef.current) {
        try {
          map.removeLayer(tileLayerRef.current);
        } catch (e) { }
      }
      currentProviderRef.current = providerKey;
      const tileLayer = L.tileLayer(tileUrl, tileOptions).addTo(map);
      tileLayerRef.current = tileLayer;
      return;
    }

    // Same provider already on the map: smooth live update without tearing down the layer
    if (providerKey === 'osm') {
      tileLayerRef.current.setOpacity(isDark ? 0.85 : 0.95);
    } else if (typeof tileLayerRef.current.setUrl === 'function') {
      tileLayerRef.current.setUrl(tileUrl);
    }
  }, [isDark, tileProvider]);

  // Frame the map around a marker.
  // withCard = true: frames the pin near the bottom edge so the popup card fits above it.
  // withCard = false: centers the pin in the visible map area (accounting for the 420px
  // right drawer when open on desktop).
  const focusMarker = useCallback((marker, withCard = false) => {
    const map = mapInstanceRef.current;
    if (!map || !marker) return;
    map.invalidateSize();
    const targetZoom = Math.max(map.getZoom(), 6);
    const size = map.getSize();
    if (!size || size.x <= 0 || size.y <= 0) return;

    const pinX = withCard
      ? Math.min(size.x / 2, size.x - MAP_CONTROLS_INSET - getPopupCardSize(size.x).w / 2)
      : size.x / 2;
    const pinWorld = map.project(marker.getLatLng(), targetZoom);

    let pinY;
    if (withCard) {
      const BOTTOM_PAD = 12; // keep the pin a little above the bottom edge
      pinY = Math.max(size.y - BOTTOM_PAD, size.y * 0.5);
    } else {
      pinY = size.y / 2;
    }

    const target = map.unproject(
      L.point(pinWorld.x + size.x / 2 - pinX, pinWorld.y + size.y / 2 - pinY),
      targetZoom
    );
    map.flyTo(target, targetZoom, { duration: 0.9, easeLinearity: 0.25 });
  }, [isMobile]);

  const focusMarkerRef = useRef(focusMarker);
  useEffect(() => {
    focusMarkerRef.current = focusMarker;
  }, [focusMarker]);

  // 3. Render Markers & Polyline
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Detect if any marker currently has an open popup before wiping old markers:
    let popupArticleIdToRestore = null;
    for (const [id, marker] of Object.entries(markersRef.current)) {
      if (marker && typeof marker.isPopupOpen === 'function' && marker.isPopupOpen()) {
        popupArticleIdToRestore = id;
        break;
      }
    }
    const isSelectionChange = prevSelectedArticleIdRef.current !== selectedArticleId;
    prevSelectedArticleIdRef.current = selectedArticleId;

    if (isSelectionChange && !isSameArticleId(bubbleArticleIdRef.current, selectedArticleId)) {
      bubbleArticleIdRef.current = null;
    }

    if (isSelectionChange && selectedArticleId) {
      if (isMobile) {
        popupArticleIdToRestore = selectedArticleId;
      } else {
        // Desktop: do not auto-open popup on event transition; cleanly reset/close any open popup
        popupArticleIdToRestore = null;
        try {
          map.closePopup();
        } catch (e) { }
      }
    }

    // Clear previous markers
    Object.values(markersRef.current).forEach((marker) => marker.remove());
    markersRef.current = {};

    if (filteredGeoArticles.length === 0) return;

    // Sort chronologically for polyline
    const sortedGeoArticles = [...filteredGeoArticles].sort((a, b) => {
      const ya = a.from?.year ?? 0;
      const yb = b.from?.year ?? 0;
      if (ya !== yb) return ya - yb;
      const ma = a.from?.month ?? 1;
      const mb = b.from?.month ?? 1;
      if (ma !== mb) return ma - mb;
      return (a.from?.day ?? 1) - (b.from?.day ?? 1);
    });

    const routeCoordinates = [];
    const cardSize = getPopupCardSize(map.getSize()?.x);

    sortedGeoArticles.forEach((art, idx) => {
      const lat = Number(art.lat);
      const lng = Number(art.lng);
      routeCoordinates.push([lat, lng]);

      const isSelected = isSameArticleId(selectedArticleId, art.id);
      const isHovered = isSameArticleId(hoveredArticleId, art.id);
      const laneColor = getPinColor(art);
      // Event topic badge label (falls back to lane title if uncategorized)
      const badgeLabel = art.category || (lanes.find((l) => l.id === art.lane)?.title || '');
      const yearStr = art.from ? formatTimeSpan(art.from, art.to, art.isToPresent) : '';

      // Event title RTL direction detection
      const isTitleRtl = /[\u0590-\u05FF\u0600-\u06FF]/.test(art.title || '') || (isRtl && !/[a-zA-Z]/.test(art.title || ''));
      const titleDir = isTitleRtl ? 'rtl' : 'ltr';

      // Marker icon with Felt-inspired clean styling and cross-highlighting (zero pulsing)
      const iconHtml = `
        <div class="group relative flex items-center justify-center cursor-pointer ${isSelected ? 'z-50' : (isHovered ? 'z-40' : 'z-10')}" data-pin-article-id="${art.id}">
        <div class="chronix-map-pin relative flex items-center justify-center transition-transform duration-200 ${isSelected
          ? 'scale-125'
          : (isHovered ? 'scale-130' : 'group-hover:scale-115')
        }">
          <!-- Outer circle -->
          <div class="relative w-8 h-8 rounded-full shadow-md flex items-center justify-center border-2 pointer-events-none transition-all duration-150 ${isSelected
          ? 'border-accent ring-4 ring-accent-ring/40'
          : (isHovered ? 'border-accent ring-4 ring-accent-ring/60 shadow-glow-accent' : 'border-surface-raised')
        }" style="background-color: ${laneColor};">
            <span class="text-caption font-bold text-white leading-none">${eventNumberMap[art.id] ?? idx + 1}</span>
          </div>
          <!-- Arrow pointer -->
          <div class="absolute -bottom-1 w-2 h-2 rotate-45 border-r border-b pointer-events-none ${isSelected ? 'border-accent bg-accent' : (isHovered ? 'border-accent bg-accent' : 'border-surface-raised')
        }" style="background-color: ${laneColor};"></div>
        </div>
          <!-- Compact event card bubble (desktop only - on mobile a tap opens the full popup card) -->
          ${!isMobile ? `<div dir="${titleDir}" class="chronix-pin-hover-tooltip ${isHovered && !isSelected ? 'flex' : 'hidden group-hover:flex'} absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-max max-w-[380px] p-1.5 rounded-md bg-surface-raised text-ink shadow-pop pointer-events-none border items-center gap-2 animate-in fade-in zoom-in-90 duration-150 z-50" style="border-color: ${laneColor};">
            ${art.imageUrl
          ? `<img src="${escapeHtml(art.imageUrl)}" alt="" loading="lazy" class="w-[54px] h-[54px] rounded shrink-0 object-cover bg-surface-sunken" style="object-position: ${Number(art.imagePositionX ?? 50)}% ${Number(art.imagePositionY ?? 50)}%;" onerror="this.style.display='none';" />`
          : ''}
            <span class="flex flex-col min-w-0 px-0.5 gap-0.5">
              <span class="text-xs font-semibold leading-snug break-words line-clamp-3" dir="${titleDir}">${escapeHtml(art.title)}</span>
              ${yearStr ? `<span class="flex items-start gap-1 min-w-0 text-[11px] font-medium leading-snug text-ink-muted"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 mt-[3px] text-ink-subtle"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><span class="min-w-0 break-words" dir="auto">${escapeHtml(yearStr)}</span></span>` : ''}
              ${art.locationName ? `<span class="flex items-start gap-1 min-w-0 text-[11px] font-medium leading-snug text-ink-muted"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 mt-[3px] text-ink-subtle"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg><span class="min-w-0 break-words" dir="auto">${escapeHtml(art.locationName)}</span></span>` : ''}
            </span>
          </div>` : ''}
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'chronix-custom-pin',
        iconSize: [32, 36],
        iconAnchor: [16, 36],
        popupAnchor: [0, -38]
      });

      // Raise the selected/hovered pin above others
      const marker = L.marker([lat, lng], {
        icon: customIcon,
        zIndexOffset: isSelected ? 1000 : (isHovered ? 2000 : 0)
      });

      // Build popup content
      const isPopupRtl = /[\u0590-\u05FF\u0600-\u06FF]/.test((art.title || '') + ' ' + (art.subtitle || ''));
      const popupDir = isPopupRtl ? 'rtl' : (isRtl ? 'rtl' : 'ltr');
      const popupAlign = isPopupRtl ? 'text-right' : (isRtl ? 'text-right' : 'text-left');
      const isEditedArt = Boolean(art.isEdited || art.is_edited || art.isManuallyEdited || art.is_manually_edited);
      const popupHtml = `
        <div class="chronix-popup-card chronix-popup-clickable flex flex-col p-3 text-ink font-sans ${popupAlign} cursor-pointer select-none" style="width: ${cardSize.w}px; height: ${cardSize.h}px;" dir="${popupDir}" data-article-id="${art.id}">
          <div class="flex items-start gap-2.5 shrink-0 pr-5">
            ${art.imageUrl
          ? `<div class="w-[72px] h-[72px] shrink-0 rounded-control overflow-hidden bg-surface-sunken border border-line">
                    <img src="${escapeHtml(art.imageUrl)}" alt="${escapeHtml(art.title)}" class="w-full h-full object-cover" style="object-position: ${Number(art.imagePositionX ?? 50)}% ${Number(art.imagePositionY ?? 50)}%;" onerror="this.parentElement.style.display='none';" />
                  </div>`
          : ''
        }
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 text-caption font-semibold text-accent uppercase tracking-wider mb-0.5">
                <span>#${eventNumberMap[art.id] ?? idx + 1}</span>
                ${yearStr ? `<span>•</span><span class="truncate">${escapeHtml(yearStr)}</span>` : ''}
                ${isEditedArt ? `<span class="inline-flex shrink-0 text-ink-subtle" title="${escapeHtml(t('eventDrawer.manuallyEditedTooltip'))}" aria-label="${escapeHtml(t('eventDrawer.manuallyEdited'))}"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg></span>` : ''}
              </div>
              <h3 class="text-sm font-bold leading-snug text-ink break-words line-clamp-3" dir="${titleDir}">${escapeHtml(art.title)}</h3>
            </div>
          </div>
          <div class="chronix-popup-desc-slot flex-1 min-h-0 mt-2 overflow-hidden">
            ${art.subtitle
          ? `<p class="chronix-popup-desc !m-0 text-[13px] leading-[1.45] text-ink-muted break-words" dir="auto" style="display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden;">${escapeInlineMarkdown(art.subtitle)}</p>`
          : ''
        }
          </div>
          ${(art.locationName || badgeLabel)
          ? `<div class="flex flex-wrap items-start gap-x-3 gap-y-1 min-w-0 shrink-0 mt-2 text-caption font-medium leading-snug text-ink-muted">
                  ${art.locationName ? `<span class="flex items-start gap-1 min-w-0 max-w-full">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 mt-[2px] text-ink-subtle"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                    <span class="min-w-0 break-words" dir="auto">${escapeHtml(art.locationName)}</span>
                  </span>` : ''}
                  ${badgeLabel ? `<span class="flex items-start gap-1.5 min-w-0 max-w-full">
                    <span class="w-2 h-2 rounded-full shrink-0 mt-[4px]" style="background-color: ${laneColor};"></span>
                    <span class="min-w-0 break-words text-ink-subtle" dir="auto">${escapeHtml(badgeLabel)}</span>
                  </span>` : ''}
                </div>`
          : ''
        }
          <div class="flex items-center gap-2 shrink-0 mt-2 pt-2 border-t border-line">
            <button type="button" data-action="details" data-article-id="${art.id}" class="w-full flex items-center justify-center gap-1 py-1.5 px-2 text-caption font-semibold rounded-control bg-accent-soft hover:bg-accent-soft/80 text-accent border border-accent/40 transition-colors cursor-pointer">
              <span>${t('eventDrawer.title')}</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            </button>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml, {
        className: 'chronix-leaflet-popup',
        minWidth: cardSize.w,
        maxWidth: cardSize.w,
        closeButton: true,
        // We frame the view ourselves in focusMarkerForCard; disable Leaflet's
        // own auto-pan so it never fights manual map movement.
        autoPan: false
      });

      // Remove Leaflet's default toggle listener so we fully control popup opening
      // on first click vs opening the details drawer on a second click.
      marker.off('click', marker._openPopup, marker);

      marker.on('popupopen', () => {
        marker.setZIndexOffset(1000);
        const popupEl = marker.getPopup()?.getElement();
        if (popupEl) {
          fitPopupDescription(popupEl);
          const detailsBtn = popupEl.querySelector('button[data-action="details"]');
          if (detailsBtn) {
            detailsBtn.onclick = (clickEvt) => {
              clickEvt.preventDefault();
              clickEvt.stopPropagation();
              if (onFocusArticleRef.current) onFocusArticleRef.current(art);
              if (onOpenDetailsRef.current) onOpenDetailsRef.current(art);
            };
          }
          const cardEl = popupEl.querySelector('.chronix-popup-clickable');
          if (cardEl) {
            cardEl.onclick = (clickEvt) => {
              if (clickEvt.target.closest('button[data-action="details"]')) return;
              if (onFocusArticleRef.current) onFocusArticleRef.current(art);
              if (onOpenDetailsRef.current) onOpenDetailsRef.current(art);
            };
          }
        }
        const frame = () => {
          if (!isRestoringPopupRef.current) {
            focusMarkerRef.current(marker, true);
          }
        };
        // On mobile, the popup card grows upward from the pin - if the map pane is too
        // short for the rendered card, grow it first (never shrink), THEN frame the pin
        // against the FINAL size once the pane's resize transition settles; otherwise the
        // pin would be positioned for the stale, smaller height and end up mid-map, not
        // at the bottom, once the pane finishes growing.
        if (isMobileRef.current && onRequestMapHeightRef.current) {
          requestAnimationFrame(() => {
            const popupEl = marker.getPopup()?.getElement();
            if (!popupEl) {
              frame();
              return;
            }
            const PIN_AND_MARGIN = 70; // pin marker height + bottom/top breathing room
            const grew = onRequestMapHeightRef.current(popupEl.offsetHeight + PIN_AND_MARGIN + getTopOverlayInset(map.getContainer()));
            // Matches App.jsx's split-pane `transition-[height] duration-150 ease-out`.
            setTimeout(frame, grew ? 180 : 0);
          });
        } else {
          frame();
        }
      });
      marker.on('popupclose', () => {
        if (selectedArticleId !== art.id) {
          marker.setZIndexOffset(0);
        }
      });

      marker.on('click', () => {
        // If a long press gesture was just completed, consume this click without action.
        if (longPressConsumedRef.current) {
          longPressConsumedRef.current = false;
          return;
        }

        if (isMobileRef.current) {
          const isAlreadyOpen = marker.isPopupOpen && marker.isPopupOpen();
          if (isAlreadyOpen) {
            // Second click on the pin in mobile: open event details drawer
            if (onFocusArticleRef.current) {
              onFocusArticleRef.current(art);
            }
            if (onOpenDetailsRef.current) {
              onOpenDetailsRef.current(art);
            }
          } else {
            // First click on the pin in mobile: open popup card and focus timeline on this event
            marker.openPopup();
            focusMarkerRef.current(marker, true);
            if (onFocusArticleRef.current) {
              onFocusArticleRef.current(art);
            }
          }
        } else {
          // Desktop: first click pins the compact bubble and opens the side details panel;
          // a second click just dismisses the bubble.
          const pinEl = marker.getElement();
          if (isSameArticleId(bubbleArticleIdRef.current, art.id)) {
            bubbleArticleIdRef.current = null;
            setPinBubble(marker, false);
            // Keep hover from immediately re-showing it until the pointer leaves the pin
            pinEl?.classList.add('chronix-pin-bubble-dismissed');
            return;
          }
          const prevMarker = markersRef.current[bubbleArticleIdRef.current];
          if (prevMarker) setPinBubble(prevMarker, false);
          bubbleArticleIdRef.current = art.id;
          setPinBubble(marker, true);
          if (onFocusArticleRef.current) {
            onFocusArticleRef.current(art);
          }
          if (onOpenDetailsRef.current) {
            onOpenDetailsRef.current(art);
          }
        }
      });

      marker.addTo(map);
      const markerEl = marker.getElement();
      markerEl?.addEventListener('mouseleave', () => {
        markerEl.classList.remove('chronix-pin-bubble-dismissed');
      });
      if (!isMobile && isSameArticleId(bubbleArticleIdRef.current, art.id)) {
        setPinBubble(marker, true);
      }
      markersRef.current[art.id] = marker;
    });

    // Restore or open the popup for the active/selected event:
    if (popupArticleIdToRestore && markersRef.current[popupArticleIdToRestore]) {
      try {
        isRestoringPopupRef.current = !isSelectionChange;
        const restoredMarker = markersRef.current[popupArticleIdToRestore];
        restoredMarker.openPopup();
        focusMarkerRef.current(restoredMarker, true);
      } catch (e) {
        // ignore
      } finally {
        isRestoringPopupRef.current = false;
      }
    }

    routeCoordinatesRef.current = routeCoordinates;

    // Auto-fit bounds ONLY ONCE when the timeline is first loaded
    if (!hasFittedBoundsRef.current && routeCoordinates.length > 0) {
      hasFittedBoundsRef.current = true;
      const isTargetingGeoMarker = selectedArticleId && markersRef.current[selectedArticleId];
      if (!isTargetingGeoMarker && !popupArticleIdToRestore) {
        try {
          const bounds = L.latLngBounds(routeCoordinates);
          map.fitBounds(bounds, { padding: [50, 50], maxZoom: 8, animate: false });
          const center = map.getCenter();
          const zoom = map.getZoom();
          const currentKey = timelineIdRef.current || (articlesRef.current[0]?.id ? `tl_${articlesRef.current.length}_${articlesRef.current[0].id}` : null);
          if (currentKey) {
            lastMapViewMap.set(currentKey, {
              center: [center.lat, center.lng],
              zoom
            });
          }
        } catch (e) {
          // ignore
        }
      }
    }
  }, [filteredGeoArticles, categories, selectedArticleId, isMobile, isExploring, isRtl, isDark]);

  const handleFitAllMarkers = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map || !routeCoordinatesRef.current || routeCoordinatesRef.current.length === 0) return;
    try {
      const bounds = L.latLngBounds(routeCoordinatesRef.current);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 8, animate: true });
      const center = map.getCenter();
      const zoom = map.getZoom();
      const currentKey = timelineIdRef.current || (articlesRef.current[0]?.id ? `tl_${articlesRef.current.length}_${articlesRef.current[0].id}` : null);
      if (currentKey) {
        lastMapViewMap.set(currentKey, {
          center: [center.lat, center.lng],
          zoom
        });
      }
    } catch (e) { }
  }, []);

  // 4. Focus on selected article (guided exploration / programmatic selection):
  //    If it has a marker:
  //      On mobile: open its popup - the 'popupopen' handler then frames the pin + card.
  //      On desktop: do not open popup; smoothly frame the pin in the visible map area.
  //    If it is a non-geographic event (no physical coordinates on Earth):
  //      Close any open popup and keep the current map view stable.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedArticleId) return;

    const marker = markersRef.current[selectedArticleId];
    if (marker) {
      if (isMobile) {
        if (!marker.isPopupOpen || !marker.isPopupOpen()) {
          try {
            marker.openPopup();
          } catch (e) { }
        }
      } else {
        const isPopupAlreadyOpen = marker.isPopupOpen && marker.isPopupOpen();
        if (isPopupAlreadyOpen) {
          focusMarker(marker, true);
        } else {
          try {
            map.closePopup();
          } catch (e) { }
          focusMarker(marker, false);
        }
      }
    } else {
      // Event without physical coordinates (Conceptual / Global event)
      const nonGeoArt = articles.find((a) => a.id === selectedArticleId);
      if (nonGeoArt) {
        try {
          map.closePopup();
        } catch (e) { }
      }
    }
  }, [selectedArticleId, isMobile, focusMarker, articles]);

  // Live sync of open popup card image position when article data changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const container = typeof map.getContainer === 'function' ? map.getContainer() : null;
    if (!container) return;
    const openCard = container.querySelector('.chronix-popup-card[data-article-id]');
    if (!openCard) return;
    const cardArticleId = openCard.getAttribute('data-article-id');
    const matchedArt = articles.find((a) => String(a.id) === String(cardArticleId));
    if (matchedArt) {
      const img = openCard.querySelector('img');
      if (img) {
        img.style.objectPosition = `${matchedArt.imagePositionX ?? 50}% ${matchedArt.imagePositionY ?? 50}%`;
      }
    }
  }, [articles]);

  // 4b. Location-less event: identify if active event has no coordinates
  const nonGeoActiveArticle = useMemo(() => {
    if (!selectedArticleId || isCenterPopupDismissed) return null;
    const art = articles.find((a) => a.id === selectedArticleId);
    return (art && !geoArticles.some((g) => g.id === art.id)) ? art : null;
  }, [selectedArticleId, isCenterPopupDismissed, articles, geoArticles]);

  return (
    <div className={`relative w-full h-full overflow-hidden select-none bg-surface-sunken ${className}`}>
      {/* Leaflet container */}
      <div
        ref={mapContainerRef}
        dir="ltr"
        className="w-full h-full z-0"
      />

      {/* Sleek Planetary/Global Event Orbit HUD */}
      {nonGeoActiveArticle && (() => {
        const laneColor = getPinColor(nonGeoActiveArticle);
        const badgeLabel = nonGeoActiveArticle.category || (lanes.find((l) => l.id === nonGeoActiveArticle.lane)?.title || '');
        const yearStr = nonGeoActiveArticle.from ? formatTimeSpan(nonGeoActiveArticle.from, nonGeoActiveArticle.to, nonGeoActiveArticle.isToPresent) : '';
        const isPopupRtl = /[\u0590-\u05FF\u0600-\u06FF]/.test((nonGeoActiveArticle.title || '') + ' ' + (nonGeoActiveArticle.subtitle || ''));
        const popupDir = isPopupRtl ? 'rtl' : (isRtl ? 'rtl' : 'ltr');
        const popupAlign = isPopupRtl ? 'text-right' : (isRtl ? 'text-right' : 'text-left');
        const eventNum = eventNumberMap[nonGeoActiveArticle.id];

        return (
          <div
            className="absolute top-14 sm:top-20 left-1/2 -translate-x-1/2 z-30 pointer-events-auto w-[92%] sm:w-auto sm:min-w-[320px] sm:max-w-md select-none animate-in fade-in zoom-in-95 duration-300"
            dir={popupDir}
          >
            <div className="relative overflow-hidden rounded-xl bg-surface-raised/90 backdrop-blur-xl border border-line shadow-panel p-3 sm:p-3.5 transition-colors">
              <div
                className="absolute top-0 left-0 right-0 h-0.5"
                style={{ backgroundColor: laneColor || 'rgb(var(--ink-subtle))' }}
              />

              <div className="flex items-start gap-3">
                {/* Pulsing Planetary Orb */}
                <div
                  className="relative flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl shrink-0 transition-transform shadow-glass-sm"
                  style={{
                    backgroundColor: `${laneColor}18` || 'rgba(var(--accent-rgb), 0.15)',
                    color: laneColor || 'var(--accent)',
                    border: `1px solid ${laneColor}35` || 'rgba(var(--accent-rgb), 0.3)'
                  }}
                >
                  <Globe className="w-5 h-5 animate-pulse" />
                  <span
                    className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-ping"
                    style={{ backgroundColor: laneColor || 'var(--accent)' }}
                  />
                </div>

                {/* Content */}
                <div className={`flex-1 min-w-0 ${popupAlign}`}>
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-accent-soft text-accent border border-accent/20">
                        <Sparkles className="w-2.5 h-2.5" />
                        {t('floatingMap.globalEventTitle') || 'Global / Conceptual Event'}
                      </span>
                      {yearStr && (
                        <span className="text-[11px] font-semibold text-accent/90 tabular-nums">
                          {yearStr}
                        </span>
                      )}
                      {badgeLabel && (
                        <span className="text-[11px] font-medium text-ink-subtle truncate max-w-[120px]">
                          • {badgeLabel}
                        </span>
                      )}
                    </div>

                    {/* Close / Dismiss button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsCenterPopupDismissed(true);
                      }}
                      className="p-1 rounded-lg text-ink-subtle hover:text-ink hover:bg-surface-hover/80 transition-colors cursor-pointer"
                      title={t('common.close') || 'Close'}
                      aria-label={t('common.close') || 'Close'}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Title & Edited indicator */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h4
                      onClick={() => {
                        if (onFocusArticle) onFocusArticle(nonGeoActiveArticle);
                        if (onOpenDetails) onOpenDetails(nonGeoActiveArticle);
                      }}
                      className="text-xs sm:text-sm font-bold text-ink leading-snug break-words hover:text-accent cursor-pointer transition-colors"
                      title={nonGeoActiveArticle.title}
                    >
                      {nonGeoActiveArticle.title}
                    </h4>
                    {Boolean(nonGeoActiveArticle.isEdited || nonGeoActiveArticle.is_edited || nonGeoActiveArticle.isManuallyEdited || nonGeoActiveArticle.is_manually_edited) && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-ink-muted bg-surface-sunken px-1.5 py-0.5 rounded border border-line/60 shrink-0"
                        title={t('eventDrawer.manuallyEditedTooltip')}
                      >
                        <Pencil className="w-2.5 h-2.5 text-accent shrink-0" />
                        <span>{t('eventDrawer.manuallyEdited')}</span>
                      </span>
                    )}
                  </div>

                  {/* Microcopy */}
                  <p className="text-[11px] text-ink-muted leading-tight mt-0.5 line-clamp-1">
                    {t('floatingMap.globalEventDesc') || 'Broad-scope event not anchored to a single location'}
                  </p>

                  {/* Quick Action to open details */}
                  <div className="flex items-center gap-2 mt-2 pt-2 border-t border-line">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onFocusArticle) onFocusArticle(nonGeoActiveArticle);
                        if (onOpenDetails) onOpenDetails(nonGeoActiveArticle);
                      }}
                      className="inline-flex items-center gap-1 text-caption font-semibold text-accent hover:underline cursor-pointer"
                    >
                      <span>{t('eventDrawer.title') || 'Event Details'}</span>
                      <ChevronRight className="w-3 h-3 rtl:rotate-180" />
                    </button>
                    {nonGeoActiveArticle.wikiUrl && (
                      <a
                        href={nonGeoActiveArticle.wikiUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-caption text-ink-subtle hover:text-accent transition-colors"
                        title={t('eventDrawer.wikiLink')}
                      >
                        <span className="truncate max-w-[100px]">{t('eventDrawer.source') || 'Wikipedia'}</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Floating Spatial Controls: Top Left Location Pills (Hidden on mobile to keep top area clean and unobstructed) */}
      {!isMobile && (
        <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
          <button
            type="button"
            onClick={handleFitAllMarkers}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-surface-raised/90 backdrop-blur-xl border border-line shadow-pop text-ink hover:border-line-strong transition-colors cursor-pointer"
            title={t('floatingMap.fitBoundsTooltip') || 'Fit all locations in view'}
          >
            <MapPin className="w-3.5 h-3.5 text-danger" />
            <span className="font-semibold">{filteredGeoArticles.length}</span>
            <span className="text-ink-subtle">{t('floatingMap.locations')}</span>
          </button>

          {filteredNonGeoArticles.length > 0 && (
            <button
              type="button"
              onClick={() => setShowGlobalEvents((prev) => !prev)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-warning-soft backdrop-blur-xl text-warning border border-warning/30 shadow-pop hover:border-warning/50 transition-colors cursor-pointer"
              title={t('floatingMap.globalEventsTooltip')}
            >
              <Info className="w-3.5 h-3.5 text-warning" />
              <span>{t('floatingMap.globalEventsBtn', { count: filteredNonGeoArticles.length })}</span>
            </button>
          )}
        </div>
      )}

      {/* Floating Spatial Controls Island: Zoom (+ / -) & Fit Bounds (Bottom Right) */}
      <div className="absolute bottom-4 right-4 z-20 flex flex-col items-center gap-1 bg-surface-raised/90 backdrop-blur-xl border border-line shadow-pop rounded-xl p-1 select-none">
        <button
          type="button"
          onClick={() => mapInstanceRef.current?.zoomIn()}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
          title={t('toolbar.zoomIn')}
          aria-label={t('toolbar.zoomIn')}
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => mapInstanceRef.current?.zoomOut()}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
          title={t('toolbar.zoomOut')}
          aria-label={t('toolbar.zoomOut')}
        >
          <Minus className="w-4 h-4" />
        </button>
        <div className="w-5 h-px bg-line my-0.5" />
        <button
          type="button"
          onClick={handleFitAllMarkers}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors cursor-pointer"
          title={t('floatingMap.fitBoundsTooltip') || 'Fit all locations in view'}
          aria-label={t('floatingMap.fitBoundsTooltip') || 'Fit all locations in view'}
        >
          <Navigation className="w-4 h-4" />
        </button>
      </div>

      {/* Global Events Drawer/Popup */}
      {showGlobalEvents && filteredNonGeoArticles.length > 0 && (
        <div
          className="absolute top-16 left-4 z-30 w-72 max-h-80 overflow-y-auto rounded-panel bg-surface-overlay border border-line shadow-panel p-3 text-ink animate-in fade-in slide-in-from-top-2"
          dir={isRtl ? 'rtl' : 'ltr'}
        >
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-line">
            <span className="text-xs font-bold text-warning">
              {t('floatingMap.globalEvents', { count: filteredNonGeoArticles.length })}
            </span>
            <button
              type="button"
              onClick={() => setShowGlobalEvents(false)}
              className="text-ink-subtle hover:text-ink text-xs font-bold cursor-pointer"
            >
              ✕
            </button>
          </div>
          <div className="space-y-1.5">
            {filteredNonGeoArticles.map((art) => (
              <button
                key={art.id}
                type="button"
                onClick={() => {
                  if (onSelectArticle) onSelectArticle(art);
                  setShowGlobalEvents(false);
                }}
                className={`w-full ${isRtl ? 'text-right' : 'text-left'} p-2 rounded-control hover:bg-surface-hover border border-transparent hover:border-line transition-all cursor-pointer`}
              >
                <div className="text-xs font-semibold break-words leading-snug text-ink">{art.title}</div>
                {art.from && (
                  <div className="text-caption text-ink-subtle mt-0.5">
                    {formatTimeSpan(art.from, art.to, art.isToPresent)}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Popup card styling fixes */}
      <style>{`
        .chronix-leaflet-popup .leaflet-popup-content-wrapper {
          background: rgb(var(--surface-overlay));
          color: rgb(var(--ink));
          border: 1px solid rgb(var(--line));
          border-radius: var(--radius-panel, 0.75rem);
          box-shadow: var(--shadow-pop);
          padding: 0;
        }
        .chronix-leaflet-popup .leaflet-popup-content {
          margin: 0;
          line-height: 1.4;
        }
        .chronix-leaflet-popup .leaflet-popup-tip {
          background: rgb(var(--surface-overlay));
        }

        .chronix-leaflet-popup .chronix-popup-card a {
          color: rgb(var(--ink-muted)) !important;
          text-decoration: none;
        }
        .chronix-leaflet-popup .chronix-popup-card a:hover {
          color: rgb(var(--ink)) !important;
        }
        .chronix-leaflet-popup a.leaflet-popup-close-button {
          color: rgb(var(--ink-subtle)) !important;
          padding: 8px 8px 0 0;
        }
        .chronix-leaflet-popup a.leaflet-popup-close-button:hover {
          color: rgb(var(--ink)) !important;
        }
        .leaflet-container {
          direction: ltr !important;
          font-family: inherit;
          background: rgb(var(--surface-sunken));
        }
        .leaflet-tooltip {
          left: 0 !important;
          top: 0 !important;
        }
        .chronix-pin-hover-tooltip[dir="rtl"] {
          direction: rtl;
          text-align: right;
        }
        .chronix-pin-hover-tooltip[dir="ltr"] {
          direction: ltr;
          text-align: left;
        }
        ${isDark && (TILE_PROVIDERS[tileProvider]?.invertInDark ?? true) ? `
        .leaflet-tile-pane {
          filter: brightness(0.6) invert(1) contrast(3) hue-rotate(200deg) saturate(0.3) brightness(0.7);
        }
        ` : ''}
        .chronix-custom-pin {
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          user-select: none;
          touch-action: manipulation;
        }
        .chronix-pin-cross-hovered {
          z-index: 2500 !important;
        }
        .chronix-pin-cross-hovered .chronix-map-pin {
          transform: scale(1.3) !important;
          filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.35));
        }
        .chronix-pin-cross-hovered .chronix-pin-hover-tooltip {
          display: flex !important;
        }
        .chronix-pin-bubble-open {
          z-index: 3000 !important;
        }
        .chronix-pin-bubble-open .chronix-pin-hover-tooltip {
          display: flex !important;
        }
        .chronix-pin-bubble-dismissed .chronix-pin-hover-tooltip {
          display: none !important;
        }
        @media (max-width: 768px) {
          .leaflet-bottom.leaflet-right {
            margin-bottom: 56px;
          }
        }
      `}</style>
    </div>
  );
}
