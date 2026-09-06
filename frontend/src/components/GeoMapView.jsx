import React, { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Maximize2,
  Minimize2,
  Layers,
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

export default function GeoMapView({
  articles = [],
  lanes = [],
  selectedArticleId,
  onSelectArticle,
  theme = 'light',
  className = ''
}) {
  const { t, formatDatePart, isRtl } = useLanguage();
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const tileLayerRef = useRef(null);

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

  // 1. Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Destroy existing instance if any
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
      worldCopyJump: true,
      maxBoundsViscosity: 0.8
    }).setView([25, 10], 2);

    // Add zoom control at bottom-right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    mapInstanceRef.current = map;

    // Resize observer to ensure full rendering when container size changes
    const resizeObserver = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.invalidateSize();
        } catch (e) {
          // ignore during unmount
        }
      }
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // 2. Update Tiles on Theme Change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const tileUrl = isDark
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

    const tileLayer = L.tileLayer(tileUrl, {
      subdomains: 'abcd',
      maxZoom: 19,
      opacity: 0.95
    });

    tileLayer.addTo(map);
    tileLayerRef.current = tileLayer;
  }, [isDark]);

  // 3. Render Markers & Polyline
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear previous markers
    Object.values(markersRef.current).forEach((marker) => marker.remove());
    markersRef.current = {};

    if (geoArticles.length === 0) return;

    // Sort chronologically for polyline
    const sortedGeoArticles = [...geoArticles].sort((a, b) => {
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
      const yearStr = art.from ? formatDatePart(art.from) : '';
      const gMapsUrl =
        art.googleMapsUrl ||
        `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

      // Custom pulsing marker icon
      const iconHtml = `
        <div class="group relative flex items-center justify-center cursor-pointer transition-transform duration-200 ${
          isSelected ? 'scale-125 z-50' : 'hover:scale-115 z-10'
        }">
          <!-- Pulse ring -->
          <div class="absolute -inset-2 rounded-full opacity-60 animate-ping" style="background-color: ${laneColor}; animation-duration: 3s;"></div>
          <!-- Outer circle -->
          <div class="relative w-8 h-8 rounded-full shadow-lg flex items-center justify-center border-2 ${
            isSelected ? 'border-amber-400 ring-4 ring-amber-400/40' : 'border-white dark:border-slate-900'
          }" style="background-color: ${laneColor};">
            <span class="text-[11px] font-bold text-white leading-none">${idx + 1}</span>
          </div>
          <!-- Arrow pointer -->
          <div class="absolute -bottom-1 w-2 h-2 rotate-45 border-r border-b ${
            isSelected ? 'border-amber-400 bg-amber-400' : 'border-white dark:border-slate-900'
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

      const marker = L.marker([lat, lng], { icon: customIcon });

      // Build popup content
      const isPopupHebrew = /[\u0590-\u05FF]/.test((art.title || '') + ' ' + (art.subtitle || ''));
      const popupDir = isPopupHebrew ? 'rtl' : (isRtl ? 'rtl' : 'ltr');
      const popupAlign = isPopupHebrew ? 'text-right' : (isRtl ? 'text-right' : 'text-left');
      const popupHtml = `
        <div class="chronix-popup-card p-3 max-w-[260px] text-slate-800 dark:text-slate-100 font-sans ${popupAlign}" dir="${popupDir}">
          ${
            art.imageUrl
              ? `<div class="w-full h-24 mb-2 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <img src="${art.imageUrl}" alt="${art.title}" class="w-full h-full object-cover" onerror="this.style.display='none';" />
                </div>`
              : ''
          }
          <div class="flex items-center gap-1.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400 uppercase tracking-wider mb-0.5">
            <span>#${idx + 1}</span>
            ${yearStr ? `<span>•</span><span>${yearStr}</span>` : ''}
          </div>
          <h3 class="text-sm font-bold leading-snug mb-1">${art.title}</h3>
          ${
            art.subtitle
              ? `<p class="text-[11px] text-slate-500 dark:text-slate-400 leading-tight mb-2 line-clamp-2">${art.subtitle}</p>`
              : ''
          }
          ${
            art.locationName
              ? `<div class="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 font-medium mb-2.5">
                  <span>📍</span>
                  <span class="truncate">${art.locationName}</span>
                </div>`
              : ''
          }
          <div class="flex items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
            <button
              id="popup-select-${art.id}"
              class="flex-1 text-center py-1.5 px-2 text-[11px] font-medium rounded-lg bg-sky-500 hover:bg-sky-600 text-white transition-colors cursor-pointer"
            >
              ${t('floatingMap.showDetails')}
            </button>
            <a
              href="${gMapsUrl}"
              target="_blank"
              rel="noreferrer"
              class="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors"
              title="${t('floatingMap.openGoogleMaps')}"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
            </a>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml, {
        className: 'chronix-leaflet-popup',
        maxWidth: 280,
        closeButton: true
      });

      marker.on('click', () => {
        if (onSelectArticle) {
          onSelectArticle(art);
        }
      });

      marker.on('popupopen', () => {
        const btn = document.getElementById(`popup-select-${art.id}`);
        if (btn) {
          btn.onclick = () => {
            if (onSelectArticle) onSelectArticle(art);
          };
        }
      });

      marker.addTo(map);
      markersRef.current[art.id] = marker;
    });

    // Auto-fit bounds if no article is selected yet
    if (!selectedArticleId && routeCoordinates.length > 0) {
      try {
        const bounds = L.latLngBounds(routeCoordinates);
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 8, animate: false });
      } catch (e) {
        // ignore
      }
    }
  }, [geoArticles, laneColorMap, themedMode, categories, isDark]);

  // 4. Focus on selected article
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedArticleId) return;

    const marker = markersRef.current[selectedArticleId];
    if (marker) {
      const latLng = marker.getLatLng();
      map.flyTo(latLng, Math.max(map.getZoom(), 6), {
        duration: 1.2,
        easeLinearity: 0.25
      });
      setTimeout(() => {
        try {
          marker.openPopup();
        } catch (e) {}
      }, 700);
    }
  }, [selectedArticleId]);

  // Fit all markers
  const handleFitAll = () => {
    const map = mapInstanceRef.current;
    if (!map || geoArticles.length === 0) return;
    const coords = geoArticles.map((a) => [Number(a.lat), Number(a.lng)]);
    try {
      const bounds = L.latLngBounds(coords);
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 10, animate: true });
    } catch (e) {}
  };

  return (
    <div className={`relative w-full h-full overflow-hidden select-none bg-slate-900 ${className}`}>
      {/* Leaflet container */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Floating Control Overlay: Top Right */}
      <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
        <button
          type="button"
          onClick={handleFitAll}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white/90 dark:bg-slate-900/90 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 shadow-md backdrop-blur-md border border-slate-200/80 dark:border-slate-700/80 transition-all hover:scale-105 active:scale-95 cursor-pointer"
          title={t('toolbar.fitAll')}
        >
          <Maximize2 className="w-3.5 h-3.5 text-sky-500" />
          <span>{t('toolbar.fitAll')}</span>
        </button>
      </div>

      {/* Floating Stats Pill: Top Left */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border border-slate-200/80 dark:border-slate-700/80 shadow-md text-slate-700 dark:text-slate-200">
          <MapPin className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
          <span className="font-semibold">{geoArticles.length}</span>
          <span className="text-slate-400 dark:text-slate-500">{t('floatingMap.locations')}</span>
        </div>

        {nonGeoArticles.length > 0 && (
          <button
            type="button"
            onClick={() => setShowGlobalEvents((prev) => !prev)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-amber-500/10 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 border border-amber-500/30 backdrop-blur-md shadow-md hover:bg-amber-500/20 transition-all cursor-pointer"
            title={t('floatingMap.globalEventsTooltip')}
          >
            <Info className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span>{t('floatingMap.globalEventsBtn', { count: nonGeoArticles.length })}</span>
          </button>
        )}
      </div>

      {/* Global Events Drawer/Popup */}
      {showGlobalEvents && nonGeoArticles.length > 0 && (
        <div
          className="absolute top-16 left-4 z-30 w-72 max-h-80 overflow-y-auto rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-slate-800 shadow-2xl p-4 text-slate-800 dark:text-slate-100 animate-in fade-in slide-in-from-top-2"
          dir={isRtl ? 'rtl' : 'ltr'}
        >
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 dark:border-slate-800">
            <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
              {t('floatingMap.globalEvents', { count: nonGeoArticles.length })}
            </span>
            <button
              type="button"
              onClick={() => setShowGlobalEvents(false)}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-xs font-bold cursor-pointer"
            >
              ✕
            </button>
          </div>
          <div className="space-y-2">
            {nonGeoArticles.map((art) => (
              <button
                key={art.id}
                type="button"
                onClick={() => {
                  if (onSelectArticle) onSelectArticle(art);
                  setShowGlobalEvents(false);
                }}
                className={`w-full ${isRtl ? 'text-right' : 'text-left'} p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 transition-all cursor-pointer`}
              >
                <div className="text-xs font-semibold line-clamp-1">{art.title}</div>
                {art.from && (
                  <div className="text-[10px] text-slate-400 mt-0.5">
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
          background: ${isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.98)'};
          color: ${isDark ? '#f8fafc' : '#0f172a'};
          border: 1px solid ${isDark ? 'rgba(51, 65, 85, 0.6)' : 'rgba(226, 232, 240, 0.9)'};
          border-radius: 1rem;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
          backdrop-filter: blur(12px);
          padding: 0;
        }
        .chronix-leaflet-popup .leaflet-popup-content {
          margin: 0;
          line-height: 1.4;
        }
        .chronix-leaflet-popup .leaflet-popup-tip {
          background: ${isDark ? '#0f172a' : '#ffffff'};
        }
        .leaflet-container {
          font-family: inherit;
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
