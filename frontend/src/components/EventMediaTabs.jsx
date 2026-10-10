import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Loader2, Play } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { searchEventVideos } from '../api';

const WIKI_HOST_RE = /^([a-z0-9-]+)\.(?:m\.)?wikipedia\.org$/i;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const MAX_SAVED_VIDEOS = 12;
const videoCache = new Map();

// Saved videos come from timeline data (possibly someone else's shared timeline), so re-validate them.
export function sanitizeVideos(list) {
  if (!Array.isArray(list)) return null;
  return list
    .filter((video) => video && typeof video.videoId === 'string' && VIDEO_ID_RE.test(video.videoId))
    .slice(0, MAX_SAVED_VIDEOS)
    .map((video) => ({
      videoId: video.videoId,
      title: typeof video.title === 'string' ? video.title : '',
      channel: typeof video.channel === 'string' ? video.channel : '',
      publishedAt: typeof video.publishedAt === 'string' ? video.publishedAt : '',
      thumbnail: typeof video.thumbnail === 'string' && video.thumbnail.startsWith('https://i.ytimg.com/') ? video.thumbnail : '',
    }));
}

export function getWikiLang(url) {
  try {
    return new URL(url).hostname.match(WIKI_HOST_RE)?.[1]?.toLowerCase() || null;
  } catch {
    return null;
  }
}

// Mobile (Minerva) skin fits the narrow drawer; desktop Vector would need horizontal scrolling.
export function toEmbeddableWikiUrl(url) {
  try {
    const u = new URL(url);
    const match = u.hostname.match(WIKI_HOST_RE);
    if (!match || !/^https?:$/.test(u.protocol) || !u.pathname.startsWith('/wiki/')) return null;
    u.protocol = 'https:';
    u.hostname = `${match[1].toLowerCase()}.m.wikipedia.org`;
    if (document.documentElement.classList.contains('dark')) u.searchParams.set('minervanightmode', '1');
    return u.toString();
  } catch {
    return null;
  }
}

function youTubeSearchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function PanelSpinner() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <Loader2 className="w-5 h-5 animate-spin text-ink-subtle" />
    </div>
  );
}

function OpenExternalLink({ href, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 shrink-0 px-2.5 py-1 rounded-full bg-surface-raised hover:bg-surface-hover border border-line text-caption font-medium text-ink transition-colors cursor-pointer"
    >
      <span>{children}</span>
      <ExternalLink className="w-3 h-3 text-ink-subtle" />
    </a>
  );
}

export function WikipediaPanel({ url, title }) {
  const { t } = useLanguage();
  const [isLoaded, setIsLoaded] = useState(false);
  const src = useMemo(() => toEmbeddableWikiUrl(url), [url]);
  if (!src) return null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-line text-xs">
        <span dir="auto" className="truncate font-medium text-ink-muted">{title}</span>
        <OpenExternalLink href={url}>{t('eventDrawer.openInNewTab')}</OpenExternalLink>
      </div>
      <div className="relative flex-1 min-h-0 bg-surface-sunken">
        {!isLoaded && <PanelSpinner />}
        <iframe
          src={src}
          title={title || 'Wikipedia'}
          className="absolute inset-0 w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setIsLoaded(true)}
        />
      </div>
    </div>
  );
}

export function VideosPanel({ query, lang, savedVideos = null, onVideosFound }) {
  const { t, language } = useLanguage();
  const cacheKey = `${lang || ''}|${query}`;
  const [result, setResult] = useState(() => (
    savedVideos ? { configured: true, items: savedVideos } : videoCache.get(cacheKey) || null
  ));
  const [selected, setSelected] = useState(null);
  const onVideosFoundRef = useRef(onVideosFound);
  useEffect(() => {
    onVideosFoundRef.current = onVideosFound;
  });

  useEffect(() => {
    if (savedVideos) return undefined;
    const cached = videoCache.get(cacheKey);
    if (cached) {
      onVideosFoundRef.current?.(cached.items || []);
      return undefined;
    }
    const controller = new AbortController();
    searchEventVideos(query, lang, controller.signal)
      .then((data) => {
        if (data.configured && !data.error) {
          videoCache.set(cacheKey, data);
          onVideosFoundRef.current?.(data.items || []);
        }
        setResult(data);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setResult({ configured: true, items: [], error: 'unavailable' });
      });
    return () => controller.abort();
  }, [cacheKey, query, lang, savedVideos]);

  if (!result) {
    return (
      <div className="relative flex-1 min-h-0">
        <PanelSpinner />
      </div>
    );
  }

  const items = result.items || [];
  if (items.length === 0) {
    const message = !result.configured || result.error ? t('eventDrawer.videosUnavailable') : t('eventDrawer.videosEmpty');
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-xs text-ink-subtle">{message}</p>
        <OpenExternalLink href={youTubeSearchUrl(query)}>{t('eventDrawer.searchOnYouTube')}</OpenExternalLink>
      </div>
    );
  }

  const activeId = selected?.id || items[0].videoId;
  const playerSrc = `https://www.youtube-nocookie.com/embed/${activeId}?rel=0&playsinline=1${selected?.autoplay ? '&autoplay=1' : ''}`;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="relative w-full aspect-video shrink-0 bg-black">
        <iframe
          key={activeId}
          src={playerSrc}
          title={items.find((item) => item.videoId === activeId)?.title || 'YouTube'}
          className="absolute inset-0 w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>

      <ul className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-2">
        {items.map((item) => {
          const isActive = item.videoId === activeId;
          const published = item.publishedAt ? new Date(item.publishedAt) : null;
          return (
            <li key={item.videoId}>
              <button
                type="button"
                onClick={() => setSelected({ id: item.videoId, autoplay: true })}
                aria-current={isActive ? 'true' : undefined}
                className={`w-full flex items-start gap-3 p-2 rounded-xl border text-start transition-colors cursor-pointer ${
                  isActive ? 'bg-surface-hover border-line-strong' : 'bg-surface-raised border-line hover:bg-surface-hover'
                }`}
              >
                <span className="relative w-28 aspect-video shrink-0 rounded-lg overflow-hidden bg-surface-sunken">
                  {item.thumbnail && (
                    <img src={item.thumbnail} alt="" loading="lazy" className="w-full h-full object-cover" />
                  )}
                  {isActive && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Play className="w-4 h-4 text-white fill-white" />
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1 space-y-1">
                  <span dir="auto" className="block text-xs font-semibold text-ink leading-snug line-clamp-2">{item.title}</span>
                  <span dir="auto" className="block text-caption text-ink-subtle truncate">
                    {item.channel}
                    {published && !isNaN(published) ? ` · ${published.toLocaleDateString(language)}` : ''}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between gap-2 px-4 py-2 border-t border-line shrink-0">
        <span className="text-caption text-ink-faint">{t('eventDrawer.videosDisclaimer')}</span>
        <OpenExternalLink href={youTubeSearchUrl(query)}>{t('eventDrawer.searchOnYouTube')}</OpenExternalLink>
      </div>
    </div>
  );
}
