import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Loader2, Play } from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';
import { searchEventVideos } from '../api';

const WIKI_HOST_RE = /^([a-z0-9-]+)\.(?:m\.)?wikipedia\.org$/i;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const DISAMBIG_PAREN_RE = /\s*\([^)]+\)\s*$/;
const TITLE_DELIMITER_RE = /\s*(?::|–|—|\s-\s|\|)\s*/;
const FRAMING_PREFIX_EN_RE = /^(?:the\s+)?(?:(?:epic|complete|brief|illustrated|full)\s+)?(?:journeys?|life(?:\s+and\s+times)?|story|history|chronicle|adventures?|reign|career)\s+of\s+/i;
const FRAMING_PREFIX_HE_RE = /^(?:ציר\s+ה?זמן\s+של)\s+/;
const HE_STRUCTURAL_SUFFIX_RE = /\s+בחלוקה\s+ל.*$/;
const LIST_HEADER_RE = /^(?:(?:the\s+)?\d+\b|top\s+\d+\b|אירועים\s+היסטוריים\b|עמים[,،]?\s+שבטים)/i;
const MODEL_PAREN_RE = /^\s*\((?:Mk\s*\d+|[A-Z]{1,3}\d+[A-Z0-9-]*)\)\s*$/i;
const MAX_SAVED_VIDEOS = 12;
const videoCache = new Map();

export function stripWikiDisambiguation(title) {
  return (title || '').replace(DISAMBIG_PAREN_RE, '').trim();
}

export function extractTimelineSubject(timelineTitle, articles = [], timelineTags = []) {
  if (!timelineTitle || typeof timelineTitle !== 'string') {
    return { subject: '', subjectEn: '' };
  }
  const parts = timelineTitle.trim().split(TITLE_DELIMITER_RE);
  const hasDelimiter = parts.length > 1;
  const rawPrefix = (parts[0] || '').replace(HE_STRUCTURAL_SUFFIX_RE, '').trim();
  const cleanedPrefix = rawPrefix
    .replace(FRAMING_PREFIX_EN_RE, '')
    .replace(FRAMING_PREFIX_HE_RE, '')
    .trim();

  const isListHeader = LIST_HEADER_RE.test(cleanedPrefix);
  const titleLow = timelineTitle.toLowerCase();
  const prefixWords = cleanedPrefix ? cleanedPrefix.split(/\s+/).length : 0;

  let matchedArt = null;
  let matchedWiki = '';
  for (const a of (Array.isArray(articles) ? articles : [])) {
    const wt = stripWikiDisambiguation(a?.wikiTitle || '');
    if (!wt || wt.length < 3) continue;
    const wtWords = wt.split(/\s+/).length;
    if (wtWords > 4) continue;
    if (titleLow.includes(wt.toLowerCase())) {
      if (wt.toLowerCase() === cleanedPrefix.toLowerCase() || wtWords >= 2 || prefixWords <= 3) {
        if (wt.length > matchedWiki.length) {
          matchedWiki = wt;
          matchedArt = a;
        }
      }
    }
  }

  let subject = '';
  if (!isListHeader) {
    if (hasDelimiter && prefixWords >= 1 && prefixWords <= 4) {
      subject = cleanedPrefix;
    } else if (matchedWiki) {
      subject = matchedWiki;
    } else if (!hasDelimiter && prefixWords >= 1 && prefixWords <= 3) {
      subject = cleanedPrefix;
    }
  }

  let subjectEn = '';
  if (subject && /[^\x00-\x7F]/.test(subject)) {
    const subjLow = subject.toLowerCase();
    const artWithEn = (
      (matchedArt?.wikiTitleEn && matchedArt)
      || (Array.isArray(articles)
        ? articles.find((a) => stripWikiDisambiguation(a?.wikiTitle || '').toLowerCase() === subjLow && a?.wikiTitleEn)
        : null)
    );
    if (artWithEn?.wikiTitleEn) {
      subjectEn = stripWikiDisambiguation(artWithEn.wikiTitleEn);
    } else if (Array.isArray(timelineTags) && timelineTags.length > 0) {
      const firstTag = (timelineTags[0] || '').trim();
      if (firstTag && !/[^\x00-\x7F]/.test(firstTag) && firstTag.split(/\s+/).length <= 4) {
        subjectEn = firstTag;
      }
    }
  }

  return { subject, subjectEn };
}

export function buildEventVideoQuery(
  article,
  { displayWikiTitle = '', timelineTitle = '', timelineTags = [], articles = [] } = {},
) {
  if (!article) return { query: '', context: '' };

  const cleanWiki = stripWikiDisambiguation(displayWikiTitle || article.wikiTitle || '');
  const rawTitle = (article.title || '').trim();
  const cleanTitle = rawTitle
    .replace(DISAMBIG_PAREN_RE, (m) => (MODEL_PAREN_RE.test(m) ? m : ''))
    .trim();

  const { subject, subjectEn } = extractTimelineSubject(timelineTitle, articles, timelineTags);
  const wikiEqualsSubject = Boolean(cleanWiki && subject && cleanWiki.toLowerCase() === subject.toLowerCase());
  const wikiSharedCount = cleanWiki && Array.isArray(articles)
    ? articles.filter((a) => stripWikiDisambiguation(a?.wikiTitle || '').toLowerCase() === cleanWiki.toLowerCase()).length
    : 0;

  let eventFocus = '';
  if (!cleanWiki || wikiEqualsSubject) {
    if (wikiEqualsSubject && /[^\x00-\x7F]/.test(cleanTitle)) {
      const latinMatch = cleanTitle.match(/[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z0-9-]+)*/);
      eventFocus = latinMatch ? latinMatch[0].trim() : cleanTitle;
    } else {
      eventFocus = cleanTitle || cleanWiki;
    }
  } else if (!subject && wikiSharedCount >= 2 && cleanTitle && cleanTitle.split(/\s+/).length <= 8) {
    eventFocus = cleanTitle;
  } else {
    eventFocus = cleanWiki;
    const idx = cleanTitle.toLowerCase().indexOf(cleanWiki.toLowerCase());
    if (idx >= 0) {
      const after = cleanTitle.slice(idx + cleanWiki.length).replace(/^[\s:,-]+/, '').trim();
      const afterWords = after ? after.split(/\s+/) : [];
      const sameScript = Boolean(after) && (/[^\x00-\x7F]/.test(cleanWiki) === /[^\x00-\x7F]/.test(after));
      if (after && afterWords.length >= 1 && afterWords.length <= 2 && sameScript && !/[()]/.test(after)) {
        eventFocus = `${cleanWiki} ${after}`;
      }
    }
  }

  if (!eventFocus) {
    return { query: subject || '', context: '' };
  }

  const focusLow = eventFocus.toLowerCase();
  const subjTokens = [subject, subjectEn]
    .filter(Boolean)
    .flatMap((s) => [s.toLowerCase(), ...s.toLowerCase().split(/\s+/).filter((w) => w.length >= 5)]);
  const alreadyHasSubject = !subject || subjTokens.some((tok) => focusLow.includes(tok));

  if (alreadyHasSubject) {
    return { query: eventFocus, context: subject || '' };
  }

  const focusIsAscii = !/[^\x00-\x7F]/.test(eventFocus) && /[A-Za-z]{3,}/.test(eventFocus);
  const subjIsNonAscii = /[^\x00-\x7F]/.test(subject);
  const effectiveSubject = (focusIsAscii && subjIsNonAscii && subjectEn) ? subjectEn : subject;

  return {
    query: `${effectiveSubject} ${eventFocus}`.trim(),
    context: effectiveSubject,
  };
}

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

export function VideosPanel({ query, lang, context = '', savedVideos = null, onVideosFound }) {
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
    searchEventVideos(query, lang, controller.signal, context || null)
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
  }, [cacheKey, query, lang, context, savedVideos]);

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
