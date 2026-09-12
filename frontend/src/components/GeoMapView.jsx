import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Minimize2,
  MapPin,
  ExternalLink,
  Navigation,
  Sparkles,
  Info,
  Calendar,
  Eye
} from 'lucide-react';
import { getLaneColor, getDistinctCategories, getCategoryColor } from '../data/laneColors';
import { useLanguage } from '../context/LanguageContext';

// Available basemap tile providers: 'osm' | 'esri' | 'carto'
// Set ACTIVE_TILE_PROVIDER to switch the active map provider.
const ACTIVE_TILE_PROVIDER = 'osm';
// const ACTIVE_TILE_PROVIDER = 'esri';

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

export default function GeoMapView({
  articles = [],
  lanes = [],
  selectedArticleId,
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
  hasRightDrawer = false
}) {
  const { t, formatDatePart, isRtl } = useLanguage();
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const tileLayerRef = useRef(null);
  const isRestoringPopupRef = useRef(false);
  const prevSelectedArticleIdRef = useRef(null);
  // Standalone popup (not tied to a pin) used for location-less events during the mobile tour.
  const centerPopupRef = useRef(null);
  const articlesRef = useRef(articles);
  articlesRef.current = articles;
  const onOpenDetailsRef = useRef(onOpenDetails);
  onOpenDetailsRef.current = onOpenDetails;
  const onFocusArticleRef = useRef(onFocusArticle);
  onFocusArticleRef.current = onFocusArticle;

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

  // Map lane ID to lane color
  const laneColorMap = useMemo(() => {
    const map = {};
    lanes.forEach((l, idx) => {
      map[l.id] = getLaneColor(l, idx, lanes);
    });
    return map;
  }, [lanes]);

  // In a single (non-split) timeline, color pins by their theme (`category`).
  const categories = useMemo(() => getDistinctCategories(articles), [articles]);
  const themedMode = lanes.length <= 1 && categories.length >= 2;

  // Resolves the color a pin should use: theme in single timelines, else lane.
  const getPinColor = (art) => {
    if (themedMode && art.category) {
      return getCategoryColor(art.category, categories);
    }
    return laneColorMap[art.lane] || (isDark ? '#38bdf8' : '#0284c7');
  };

  // Builds the same detail card as the pin popup, minus the pin number / location /
  // Google Maps link — used for events that have no coordinates (no pin to anchor to).
  const buildCenterPopupHtml = (art) => {
    const laneColor = getPinColor(art);
    const badgeLabel = themedMode && art.category
      ? art.category
      : (lanes.find((l) => l.id === art.lane)?.title || '');
    const yearStr = art.from ? formatDatePart(art.from) : '';
    const isPopupRtl = /[\u0590-\u05FF\u0600-\u06FF]/.test((art.title || '') + ' ' + (art.subtitle || ''));
    const popupDir = isPopupRtl ? 'rtl' : (isRtl ? 'rtl' : 'ltr');
    const popupAlign = isPopupRtl ? 'text-right' : (isRtl ? 'text-right' : 'text-left');
    return `
      <div class="chronix-popup-card chronix-popup-clickable p-3 max-w-[260px] text-ink font-sans ${popupAlign} cursor-pointer select-none" dir="${popupDir}" data-article-id="${art.id}">
        <div class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-warning mb-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.43 5.43A8.06 8.06 0 0 0 4 10c0 6 8 12 8 12a29.94 29.94 0 0 0 5-5"/><path d="M19.18 13.52A8.66 8.66 0 0 0 20 10a8 8 0 0 0-8-8 7.88 7.88 0 0 0-3.52.82"/><path d="M9.13 9.13A2.78 2.78 0 0 0 9 10a3 3 0 0 0 3 3 2.78 2.78 0 0 0 .87-.13"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
          <span>${t('floatingMap.noLocation')}</span>
        </div>
        ${
          art.imageUrl
            ? `<div class="w-full h-24 mb-2 rounded-control overflow-hidden bg-surface-sunken border border-line">
                <img src="${art.imageUrl}" alt="${art.title}" class="w-full h-full object-cover" onerror="this.style.display='none';" />
              </div>`
            : ''
        }
        ${
          yearStr
            ? `<div class="flex items-center gap-1.5 text-[10px] font-semibold text-accent uppercase tracking-wider mb-0.5"><span>#${eventNumberMap[art.id] ?? ''}</span>${yearStr ? `<span>•</span><span>${yearStr}</span>` : ''}</div>`
            : (eventNumberMap[art.id] ? `<div class="flex items-center gap-1.5 text-[10px] font-semibold text-accent uppercase tracking-wider mb-0.5"><span>#${eventNumberMap[art.id]}</span></div>` : '')
        }
        <h3 class="text-sm font-bold leading-snug mb-1 text-ink">${art.title}</h3>
        ${
          art.subtitle
            ? `<p class="text-[11px] text-ink-muted leading-tight mb-2 line-clamp-2">${art.subtitle}</p>`
            : ''
        }
        ${
          badgeLabel
            ? `<div class="flex items-center gap-1.5 mb-1"><span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${laneColor};"></span><span class="text-[11px] font-medium text-ink-subtle truncate">${badgeLabel}</span></div>`
            : ''
        }
        ${
          art.wikiUrl
            ? `<div class="flex items-center gap-2 pt-2 mt-1 border-t border-line"><a href="${art.wikiUrl}" target="_blank" rel="noreferrer" title="${t('eventDrawer.wikiLink')}" class="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 text-[11px] font-medium rounded-control bg-surface-raised hover:bg-surface-hover text-ink hover:text-accent border border-line transition-colors cursor-pointer shadow-control group"><span class="truncate">${t('eventDrawer.wikiLink')}</span><svg class="shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg></a></div>`
            : ''
        }
        <button type="button" data-action="details" class="w-full mt-2 flex items-center justify-center gap-1 py-1.5 px-2 text-[10px] font-semibold rounded-control bg-accent-soft hover:bg-accent-soft/80 text-accent border border-accent/40 transition-colors cursor-pointer">
          <span>${t('eventDrawer.title')}</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>
    `;
  };

  // Matches an article against the externally-supplied starred-only + lane/theme
  // filters, both synchronized from the timeline (null/false = show all).
  const matchesFilter = (art) => {
    if (filterStarredOnly && starredArticleIds && !starredArticleIds.has(art.id)) return false;
    if (!activeFilter?.items?.length) return true;
    const { mode, items } = activeFilter;
    const value = mode === 'theme' ? (art.category || '') : art.lane;
    return items.some((item) => item.matchKeys.includes(value));
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
    const initialHeight = container ? container.clientHeight || 600 : 600;
    // Calculate initial minZoom so the map covers the container completely with zero dead space:
    const initialMinZoom = Math.max(1, Math.ceil(Math.log2(Math.max(initialWidth, initialHeight, 1) / 256)));
    const worldBounds = L.latLngBounds(L.latLng(-85, -180), L.latLng(85, 180));

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
      minZoom: initialMinZoom,
      maxBounds: worldBounds,
      maxBoundsViscosity: 1.0,
      worldCopyJump: false
    }).setView([25, 10], Math.max(initialMinZoom, 2));

    // Add zoom control at bottom-right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    mapInstanceRef.current = map;

    const updateConstraints = () => {
      if (!mapInstanceRef.current) return;
      mapInstanceRef.current.invalidateSize();
      const size = mapInstanceRef.current.getSize();
      if (!size || size.x <= 0 || size.y <= 0) return;
      const requiredDimension = Math.max(size.x, size.y);
      const calculatedMinZoom = Math.max(1, Math.ceil(Math.log2(requiredDimension / 256)));
      if (mapInstanceRef.current.getMinZoom() !== calculatedMinZoom) {
        mapInstanceRef.current.setMinZoom(calculatedMinZoom);
      }
      if (mapInstanceRef.current.getZoom() < calculatedMinZoom) {
        mapInstanceRef.current.setZoom(calculatedMinZoom);
      }
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
        const articleId = card?.getAttribute('data-article-id');
        if (articleId) {
          const clickedArt = articlesRef.current.find((a) => String(a.id) === String(articleId));
          if (clickedArt) {
            if (onFocusArticleRef.current) onFocusArticleRef.current(clickedArt);
            if (onOpenDetailsRef.current) onOpenDetailsRef.current(clickedArt);
          }
        }
        return;
      }
      const otherAction = e.target.closest('a, button');
      if (otherAction) return; // User clicked external links (Wiki, Maps) or close button
      const card = e.target.closest('.chronix-popup-clickable');
      if (!card) return;
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
        e.preventDefault();
      }
    };

    container.addEventListener('click', handleContainerClick);
    container.addEventListener('pointerdown', handleContainerPointerDown);
    container.addEventListener('contextmenu', handleContextMenu);

    return () => {
      container.removeEventListener('click', handleContainerClick);
      container.removeEventListener('pointerdown', handleContainerPointerDown);
      container.removeEventListener('contextmenu', handleContextMenu);
      clearLongPressTimer();
      resizeObserver.disconnect();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // 2. Update Tiles on Theme or Provider Change (Live swap)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const providerKey = TILE_PROVIDERS[tileProvider] ? tileProvider : 'osm';
    const provider = TILE_PROVIDERS[providerKey];
    const tileUrl = provider.getUrl(isDark);
    const tileOptions = {
      ...provider.options(isDark)
    };

    const tileLayer = L.tileLayer(tileUrl, tileOptions);

    tileLayer.addTo(map);
    tileLayerRef.current = tileLayer;
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

    // On desktop with the right-side detail drawer open, offset the horizontal center
    // so the pin sits in the middle of the unobstructed map portion.
    const rightDrawerWidth = (!isMobile && hasRightDrawer && size.x > 768) ? 420 : 0;
    const pinX = (size.x - rightDrawerWidth) / 2;
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
  }, [isMobile, hasRightDrawer]);

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

    if (isSelectionChange && selectedArticleId) {
      if (isMobile) {
        popupArticleIdToRestore = selectedArticleId;
      } else {
        // Desktop: do not auto-open popup on event transition; cleanly reset/close any open popup
        popupArticleIdToRestore = null;
        try {
          map.closePopup();
        } catch (e) {}
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

    sortedGeoArticles.forEach((art, idx) => {
      const lat = Number(art.lat);
      const lng = Number(art.lng);
      routeCoordinates.push([lat, lng]);

      const isSelected = selectedArticleId === art.id;
      const laneColor = getPinColor(art);
      // Topic (single timeline) or lane (split timeline) label shown in the popup.
      const badgeLabel = themedMode && art.category
        ? art.category
        : (lanes.find((l) => l.id === art.lane)?.title || '');
      const yearStr = art.from ? formatDatePart(art.from) : '';
      const gMapsUrl =
        art.googleMapsUrl ||
        `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

      // Custom pulsing marker icon
      const iconHtml = `
        <div class="group relative flex items-center justify-center cursor-pointer transition-transform duration-200 ${
          isSelected ? 'scale-125 z-50' : 'hover:scale-115 z-10'
        }" data-pin-article-id="${art.id}">
          <!-- Pulse ring -->
          <div class="absolute -inset-2 rounded-full opacity-60 animate-ping pointer-events-none" style="background-color: ${laneColor}; animation-duration: 3s;"></div>
          <!-- Outer circle -->
          <div class="relative w-8 h-8 rounded-full shadow-lg flex items-center justify-center border-2 pointer-events-none ${
            isSelected ? 'border-accent ring-4 ring-accent-ring/40' : 'border-surface-raised'
          }" style="background-color: ${laneColor};">
            <span class="text-[11px] font-bold text-white leading-none">${eventNumberMap[art.id] ?? idx + 1}</span>
          </div>
          <!-- Arrow pointer -->
          <div class="absolute -bottom-1 w-2 h-2 rotate-45 border-r border-b pointer-events-none ${
            isSelected ? 'border-accent bg-accent' : 'border-surface-raised'
          }" style="background-color: ${laneColor};"></div>
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'chronix-custom-pin',
        iconSize: [32, 36],
        iconAnchor: [16, 36],
        popupAnchor: [0, -38]
      });

      // Raise the selected pin above any others sharing the exact same spot,
      // so overlapping events (e.g. 3, 4, 5 at one place) each surface when chosen.
      const marker = L.marker([lat, lng], {
        icon: customIcon,
        zIndexOffset: isSelected ? 1000 : 0
      });

      // Build popup content
      const isPopupRtl = /[\u0590-\u05FF\u0600-\u06FF]/.test((art.title || '') + ' ' + (art.subtitle || ''));
      const popupDir = isPopupRtl ? 'rtl' : (isRtl ? 'rtl' : 'ltr');
      const popupAlign = isPopupRtl ? 'text-right' : (isRtl ? 'text-right' : 'text-left');
      const popupHtml = `
        <div class="chronix-popup-card chronix-popup-clickable p-3 max-w-[260px] text-ink font-sans ${popupAlign} cursor-pointer select-none" dir="${popupDir}" data-article-id="${art.id}">
          ${
            art.imageUrl
              ? `<div class="w-full h-24 mb-2 rounded-control overflow-hidden bg-surface-sunken border border-line">
                  <img src="${art.imageUrl}" alt="${art.title}" class="w-full h-full object-cover" onerror="this.style.display='none';" />
                </div>`
              : ''
          }
          <div class="flex items-center gap-1.5 text-[10px] font-semibold text-accent uppercase tracking-wider mb-0.5">
            <span>#${eventNumberMap[art.id] ?? idx + 1}</span>
            ${yearStr ? `<span>•</span><span>${yearStr}</span>` : ''}
          </div>
          <h3 class="text-sm font-bold leading-snug mb-1 text-ink">${art.title}</h3>
          ${
            art.subtitle
              ? `<p class="text-[11px] text-ink-muted leading-tight mb-2 line-clamp-2">${art.subtitle}</p>`
              : ''
          }
          ${
            art.locationName
              ? `<div class="flex items-center gap-1.5 text-[11px] text-ink-muted font-medium mb-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-ink-subtle"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                  <span class="truncate">${art.locationName}</span>
                </div>`
              : ''
          }
          ${
            badgeLabel
              ? `<div class="flex items-center gap-1.5 mb-2.5">
                  <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${laneColor};"></span>
                  <span class="text-[11px] font-medium text-ink-subtle truncate">${badgeLabel}</span>
                </div>`
              : ''
          }
          <div class="flex items-center gap-2 pt-2 border-t border-line">
            ${
              art.wikiUrl
                ? `<a
                    href="${art.wikiUrl}"
                    target="_blank"
                    rel="noreferrer"
                    title="${t('eventDrawer.wikiLink')}"
                    class="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 text-[11px] font-medium rounded-control bg-surface-raised hover:bg-surface-hover text-ink hover:text-accent border border-line transition-colors cursor-pointer shadow-control group"
                  >
                    <span class="truncate">${t('eventDrawer.wikiLink')}</span>
                    <svg class="shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
                  </a>`
                : ''
            }
            <a
              href="${gMapsUrl}"
              target="_blank"
              rel="noreferrer"
              class="${art.wikiUrl ? 'p-1.5' : 'flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2'} rounded-control bg-surface-raised hover:bg-surface-hover text-ink hover:text-accent border border-line transition-colors cursor-pointer shadow-control group"
              title="${t('floatingMap.openGoogleMaps')}"
            >
              ${art.wikiUrl ? '' : `<span class="text-[11px] font-medium">${t('eventDrawer.googleMaps')}</span>`}
              <svg class="shrink-0 transition-transform group-hover:scale-110" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1 2-2h6"/></svg>
            </a>
          </div>
          <button type="button" data-action="details" class="w-full mt-2 flex items-center justify-center gap-1 py-1.5 px-2 text-[10px] font-semibold rounded-control bg-accent-soft hover:bg-accent-soft/80 text-accent border border-accent/40 transition-colors cursor-pointer">
            <span>${t('eventDrawer.title')}</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>
      `;

      marker.bindPopup(popupHtml, {
        className: 'chronix-leaflet-popup',
        maxWidth: 280,
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
        if (!isRestoringPopupRef.current) {
          focusMarker(marker, true);
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
            focusMarker(marker, true);
            if (onFocusArticleRef.current) {
              onFocusArticleRef.current(art);
            }
          }
        } else {
          // Desktop: open popup card, focus timeline on this event, and open event details drawer
          if (!marker.isPopupOpen()) {
            marker.openPopup();
            focusMarker(marker, true);
          }
          if (onFocusArticleRef.current) {
            onFocusArticleRef.current(art);
          }
          if (onOpenDetailsRef.current) {
            onOpenDetailsRef.current(art);
          }
        }
      });

      // On desktop (both during guided exploration and normal timeline selection), show a small
      // permanent label beside the FOCUSED/selected pin only, with the place name — so the current
      // location stays legible whatever language the OSM tiles are in. textContent keeps it injection-safe.
      if (!isMobile && isSelected && art.locationName) {
        const hasRtlChars = /[\u0590-\u05FF\u0600-\u06FF]/.test(art.locationName || '');
        const hasLtrChars = /[a-zA-Z]/.test(art.locationName || '');
        const isLocRtl = hasRtlChars || (isRtl && !hasLtrChars);
        const labelEl = document.createElement('span');
        labelEl.className = 'chronix-pin-label-text';
        labelEl.dir = isLocRtl ? 'rtl' : 'ltr';
        labelEl.setAttribute('dir', isLocRtl ? 'rtl' : 'ltr');
        labelEl.textContent = art.locationName;
        marker.bindTooltip(labelEl, {
          permanent: true,
          interactive: false,
          direction: isRtl ? 'left' : 'right',
          offset: isRtl ? [-14, -18] : [14, -18],
          className: `chronix-pin-label${isLocRtl ? ' chronix-pin-label-rtl' : ''}`,
          opacity: 1
        });
        marker.on('tooltipopen', (e) => {
          if (e.tooltip && e.tooltip.getElement()) {
            e.tooltip.getElement().setAttribute('dir', isLocRtl ? 'rtl' : 'ltr');
          }
        });
      }

      marker.addTo(map);
      const tooltip = marker.getTooltip();
      if (tooltip && tooltip.getElement()) {
        const hasRtlChars = /[\u0590-\u05FF\u0600-\u06FF]/.test(art.locationName || '');
        const hasLtrChars = /[a-zA-Z]/.test(art.locationName || '');
        const isLocRtl = hasRtlChars || (isRtl && !hasLtrChars);
        tooltip.getElement().setAttribute('dir', isLocRtl ? 'rtl' : 'ltr');
      }
      markersRef.current[art.id] = marker;
    });

    // Restore or open the popup for the active/selected event:
    if (popupArticleIdToRestore && markersRef.current[popupArticleIdToRestore]) {
      try {
        isRestoringPopupRef.current = !isSelectionChange;
        markersRef.current[popupArticleIdToRestore].openPopup();
      } catch (e) {
        // ignore
      } finally {
        isRestoringPopupRef.current = false;
      }
    }

    // Auto-fit bounds if no article is selected/open yet
    if (!selectedArticleId && !popupArticleIdToRestore && routeCoordinates.length > 0) {
      try {
        const bounds = L.latLngBounds(routeCoordinates);
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 8, animate: false });
      } catch (e) {
        // ignore
      }
    }
  }, [filteredGeoArticles, laneColorMap, themedMode, categories, isDark, selectedArticleId, isMobile, isExploring, isRtl, focusMarker]);

  // 4. Focus on selected article (guided exploration / programmatic selection):
  //    On mobile: open its popup — the 'popupopen' handler then frames the pin + card.
  //    On desktop: do not open popup; smoothly frame the pin in the visible map area.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedArticleId) return;

    const marker = markersRef.current[selectedArticleId];
    if (!marker) return;

    if (isMobile) {
      if (!marker.isPopupOpen || !marker.isPopupOpen()) {
        try {
          marker.openPopup();
        } catch (e) {}
      }
    } else {
      try {
        map.closePopup();
      } catch (e) {}
      focusMarker(marker, false);
    }
  }, [selectedArticleId, isMobile, focusMarker]);

  // 4b. Location-less event during the mobile guided tour: there's no pin to open, so
  //     show the same detail card as a standalone popup centered on the map — this keeps
  //     the tour from feeling stuck on events that have no coordinates.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const closeCenterPopup = () => {
      if (centerPopupRef.current) {
        try {
          map.closePopup(centerPopupRef.current);
        } catch (e) {}
        centerPopupRef.current = null;
      }
    };

    if (!isMobile || !isExploring || !selectedArticleId) {
      closeCenterPopup();
      return;
    }

    const art = articles.find((a) => a.id === selectedArticleId);
    const hasCoords = art && geoArticles.some((g) => g.id === art.id);
    if (!art || hasCoords) {
      closeCenterPopup();
      return;
    }

    closeCenterPopup();
    // Anchor near the bottom of the map: a Leaflet popup grows upward from its point, so a
    // bottom anchor keeps the whole card (incl. its top caption) visible on short mobile panes.
    const size = map.getSize();
    const anchorLatLng = size && size.y > 0
      ? map.containerPointToLatLng(L.point(size.x / 2, size.y - 16))
      : map.getCenter();
    const popup = L.popup({
      className: 'chronix-leaflet-popup chronix-centered-popup',
      maxWidth: 280,
      closeButton: true,
      autoPan: false
    })
      .setLatLng(anchorLatLng)
      .setContent(buildCenterPopupHtml(art));
    centerPopupRef.current = popup;
    popup.openOn(map);

    return closeCenterPopup;
  }, [selectedArticleId, isMobile, isExploring, articles, geoArticles]);

  return (
    <div className={`relative w-full h-full overflow-hidden select-none bg-surface-sunken ${className}`}>
      {/* Leaflet container */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Floating Stats Pill: Top Left */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-control text-xs font-medium bg-surface-raised border border-line shadow-panel text-ink">
          <MapPin className="w-3.5 h-3.5 text-danger" />
          <span className="font-semibold">{filteredGeoArticles.length}</span>
          <span className="text-ink-subtle">{t('floatingMap.locations')}</span>
        </div>

        {filteredNonGeoArticles.length > 0 && (
          <button
            type="button"
            onClick={() => setShowGlobalEvents((prev) => !prev)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-control text-xs font-medium bg-warning-soft text-warning border border-warning/40 shadow-panel hover:bg-warning-soft/80 transition-all cursor-pointer"
            title={t('floatingMap.globalEventsTooltip')}
          >
            <Info className="w-3.5 h-3.5 text-warning" />
            <span>{t('floatingMap.globalEventsBtn', { count: filteredNonGeoArticles.length })}</span>
          </button>
        )}
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
                <div className="text-xs font-semibold line-clamp-1 text-ink">{art.title}</div>
                {art.from && (
                  <div className="text-[10px] text-ink-subtle mt-0.5">
                    {formatDatePart(art.from)}
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
          box-shadow: 0 12px 24px -4px rgba(0, 0, 0, 0.28);
          padding: 0;
        }
        .chronix-leaflet-popup .leaflet-popup-content {
          margin: 0;
          line-height: 1.4;
        }
        .chronix-leaflet-popup .leaflet-popup-tip {
          background: rgb(var(--surface-overlay));
        }
        /* Center popup for location-less events: amber accent frame, no downward spike. */
        .chronix-centered-popup .leaflet-popup-tip-container {
          display: none;
        }
        .chronix-centered-popup .leaflet-popup-content-wrapper {
          border-color: rgb(var(--warning));
          box-shadow: 0 0 0 1px rgb(var(--warning)), 0 16px 28px -4px rgba(0, 0, 0, 0.32);
        }
        .chronix-leaflet-popup .chronix-popup-card a {
          color: rgb(var(--ink-muted)) !important;
          text-decoration: none;
        }
        .chronix-leaflet-popup .chronix-popup-card a:hover {
          color: rgb(var(--accent)) !important;
        }
        .chronix-leaflet-popup a.leaflet-popup-close-button {
          color: rgb(var(--ink-subtle)) !important;
          padding: 8px 8px 0 0;
        }
        .chronix-leaflet-popup a.leaflet-popup-close-button:hover {
          color: rgb(var(--ink)) !important;
        }
        .chronix-pin-label.leaflet-tooltip {
          background: rgb(var(--surface-raised));
          color: rgb(var(--ink));
          border: 1px solid rgb(var(--line));
          border-radius: var(--radius-control, 0.5rem);
          padding: 2px 7px;
          font-size: 11px;
          font-weight: 600;
          line-height: 1.25;
          max-width: 170px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
          pointer-events: none;
        }
        .chronix-pin-label.leaflet-tooltip::before {
          display: none;
        }
        .chronix-pin-label.leaflet-tooltip.chronix-pin-label-rtl,
        .chronix-pin-label.leaflet-tooltip[dir="rtl"] {
          direction: rtl;
          text-align: right;
        }
        .chronix-pin-label.leaflet-tooltip:not(.chronix-pin-label-rtl):not([dir="rtl"]) {
          direction: ltr;
          text-align: left;
        }
        .chronix-pin-label-text {
          display: inline;
        }
        .chronix-pin-label-text[dir="rtl"] {
          direction: rtl;
          text-align: right;
        }
        .chronix-pin-label-text[dir="ltr"] {
          direction: ltr;
          text-align: left;
        }
        ${isDark && (TILE_PROVIDERS[tileProvider]?.invertInDark ?? true) ? `
        .leaflet-tile-pane {
          filter: brightness(0.6) invert(1) contrast(3) hue-rotate(200deg) saturate(0.3) brightness(0.7);
        }
        ` : ''}
        .leaflet-container {
          font-family: inherit;
          background: rgb(var(--surface-sunken));
        }
        .chronix-custom-pin {
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          user-select: none;
          touch-action: manipulation;
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
