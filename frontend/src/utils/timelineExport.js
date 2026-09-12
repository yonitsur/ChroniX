import { translations, SUPPORTED_LANGUAGES } from '../locales/translations.js';

// Resolve timeline export dictionary with fallback across all 11 languages
export function getExportDict(lang = 'en') {
  const dict = translations[lang]?.timelineExport || translations.en?.timelineExport || {};
  const dateDict = translations[lang]?.dates || translations.en?.dates || {};
  return { ...dict, dates: dateDict };
}

// Formats a single date part (year, month, day, precision) according to the specified language
export function formatDatePart(d, lang = 'en') {
  const dict = translations[lang]?.dates || translations.en.dates;

  if (!d) return '';
  if (typeof d === 'number') return String(d);
  if (typeof d === 'string') return d;
  if (d.year === undefined || d.year === null) return '';

  const y = Number(d.year);
  if (isNaN(y)) return String(d.year);

  if (d.precision === 'million-years' || Math.abs(y) >= 1000000) {
    const ma = Math.abs(y / 1000000);
    const maStr = ma % 1 === 0 ? ma.toFixed(0) : ma.toFixed(1);
    return `${maStr} ${dict.millionYearsAgo}`;
  }

  if (y < 0) {
    const absY = Math.abs(y);
    if (lang === 'ja' || lang === 'zh') {
      return `${dict.bce} ${absY}年`;
    }
    if (lang === 'ko') {
      return `${dict.bce} ${absY}년`;
    }
    return `${absY} ${dict.bce}`;
  }

  const monthIdx = Number(d.month) - 1;
  const monthName = dict.months?.[monthIdx] || d.month;

  if (d.month && d.day) {
    switch (lang) {
      case 'ja':
      case 'zh':
        return `${y}年${d.month}月${d.day}日`;
      case 'ko':
        return `${y}년 ${d.month}월 ${d.day}일`;
      case 'he':
        return `${d.day} ב${monthName} ${y}`;
      case 'ar':
        return `${d.day} ${monthName} ${y}`;
      case 'de':
        return `${d.day}. ${monthName} ${y}`;
      case 'es':
      case 'pt':
        return `${d.day} de ${monthName} de ${y}`;
      case 'fr':
      case 'hi':
        return `${d.day} ${monthName} ${y}`;
      default:
        return `${monthName} ${d.day}, ${y}`;
    }
  }

  if (d.month) {
    switch (lang) {
      case 'ja':
      case 'zh':
        return `${y}年${d.month}月`;
      case 'ko':
        return `${y}년 ${d.month}월`;
      case 'es':
      case 'pt':
        return `${monthName} de ${y}`;
      default:
        return `${monthName} ${y}`;
    }
  }

  if (lang === 'ja' || lang === 'zh') return `${y}年`;
  if (lang === 'ko') return `${y}년`;

  return `${y}`;
}

// Formats a date range / timespan (from – to)
export function formatTimeSpan(from, to, isToPresent, lang = 'en') {
  const dict = translations[lang]?.dates || translations.en.dates;
  const fromStr = formatDatePart(from, lang);

  if (isToPresent) {
    return fromStr ? `${fromStr} – ${dict.present}` : dict.present;
  }

  if (!to) return fromStr;
  const toStr = formatDatePart(to, lang);
  if (!fromStr) return toStr;
  if (fromStr === toStr) return fromStr;

  return `${fromStr} – ${toStr}`;
}

// Sorts articles chronologically: year -> month -> day
export function sortArticlesChronologically(articles = []) {
  return [...articles].sort((a, b) => {
    const aYear = a.from?.year ?? 0;
    const bYear = b.from?.year ?? 0;
    if (aYear !== bYear) return aYear - bYear;

    const aMonth = a.from?.month ?? 1;
    const bMonth = b.from?.month ?? 1;
    if (aMonth !== bMonth) return aMonth - bMonth;

    const aDay = a.from?.day ?? 1;
    const bDay = b.from?.day ?? 1;
    return aDay - bDay;
  });
}

// Resolves category or lane label for an article
export function getArticleCategoryOrLane(article, lanes = []) {
  if (article.category) return String(article.category).trim();
  const lane = lanes.find((l) => l.id === article.lane);
  if (lane?.title) return String(lane.title).trim();
  return '';
}

// Clean sanitization for filenames
export function sanitizeFilename(name, defaultName = 'chronix_timeline') {
  if (!name) return defaultName;
  return name.trim().replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
}

// Generates a human-friendly, structured plain text file (.txt)
export function generateTimelineText(timeline, lang = 'en') {
  const dict = getExportDict(lang);
  const title = timeline?.title || dict.untitledTimeline || 'Timeline';
  const description = timeline?.description || '';
  const overview = (timeline?.overview || '').trim();
  const lanes = timeline?.lanes || [];
  const articles = sortArticlesChronologically(timeline?.articles || []);
  const grounding = timeline?.grounding;

  const lines = [];

  // Header
  lines.push('='.repeat(70));
  lines.push(title);
  lines.push('='.repeat(70));
  if (description) {
    lines.push('');
    lines.push(description);
  }

  // Overview section
  if (overview) {
    lines.push('');
    lines.push('-'.repeat(70));
    lines.push(dict.narrativeOverview || 'Narrative Overview');
    lines.push('-'.repeat(70));
    lines.push(overview);
  }

  // Grounding / Sources section
  const hasSources = grounding?.is_grounded && Array.isArray(grounding.sources) && grounding.sources.length > 0;
  const hasQueries = Array.isArray(grounding?.search_queries) && grounding.search_queries.length > 0;
  if (hasSources || hasQueries) {
    lines.push('');
    lines.push('-'.repeat(70));
    lines.push(dict.sourcesGrounding || 'Sources & Grounding');
    lines.push('-'.repeat(70));

    if (hasSources) {
      lines.push(`${dict.webSources || 'Web Sources'}:`);
      grounding.sources.forEach((src, idx) => {
        const srcTitle = src.title ? `${src.title}: ` : '';
        lines.push(`  [${idx + 1}] ${srcTitle}${src.url}`);
      });
    }

    if (hasQueries) {
      lines.push('');
      lines.push(`${dict.searchQueries || 'Search Queries'}:`);
      grounding.search_queries.forEach((q) => {
        lines.push(`  • ${q}`);
      });
    }
  }

  // Chronological Events
  lines.push('');
  lines.push('-'.repeat(70));
  const eventsCountLabel = (dict.eventsCount || '{count} events').replace('{count}', articles.length);
  lines.push(`${dict.chronologicalEvents || 'Chronological Events'} (${eventsCountLabel})`);
  lines.push('-'.repeat(70));

  articles.forEach((art, index) => {
    const num = index + 1;
    const timeSpan = formatTimeSpan(art.from, art.to, art.isToPresent, lang);
    const categoryOrLane = getArticleCategoryOrLane(art, lanes);
    const subtitle = art.subtitle ? ` (${art.subtitle})` : '';

    lines.push('');
    lines.push(`${num}. ${art.title}${subtitle}`);
    if (timeSpan) {
      lines.push(`   ${dict.date || 'Date'}: ${timeSpan}`);
    }
    if (categoryOrLane) {
      lines.push(`   ${dict.categoryOrLane || 'Category / Lane'}: ${categoryOrLane}`);
    }
    if (art.locationName || (art.lat != null && art.lng != null)) {
      const locStr = art.locationName || `${art.lat}, ${art.lng}`;
      lines.push(`   ${dict.location || 'Location'}: ${locStr}`);
      if (art.googleMapsUrl) {
        lines.push(`   ${dict.googleMaps || 'Google Maps'}: ${art.googleMapsUrl}`);
      }
    }
    if (art.extract) {
      lines.push(`   ${dict.summary || 'Summary'}: ${art.extract}`);
    }
    if (art.wikiUrl) {
      lines.push(`   ${dict.wikipedia || 'Wikipedia'}: ${art.wikiUrl}`);
    }
  });

  lines.push('');
  lines.push('='.repeat(70));
  lines.push(dict.generatedBy || 'Generated by ChroniX - Interactive AI Timelines');
  lines.push('='.repeat(70));

  return lines.join('\r\n');
}

// Generates a rich Markdown document (.md)
export function generateTimelineMarkdown(timeline, lang = 'en') {
  const dict = getExportDict(lang);
  const title = timeline?.title || dict.untitledTimeline || 'Timeline';
  const description = timeline?.description || '';
  const overview = (timeline?.overview || '').trim();
  const lanes = timeline?.lanes || [];
  const articles = sortArticlesChronologically(timeline?.articles || []);
  const grounding = timeline?.grounding;

  const lines = [];

  lines.push(`# ${title}`);
  if (description) {
    lines.push('');
    lines.push(`> ${description}`);
  }

  // Overview
  if (overview) {
    lines.push('');
    lines.push(`## 📖 ${dict.narrativeOverview || 'Narrative Overview'}`);
    lines.push('');
    lines.push(overview);
  }

  // Grounding / Sources
  const hasSources = grounding?.is_grounded && Array.isArray(grounding.sources) && grounding.sources.length > 0;
  const hasQueries = Array.isArray(grounding?.search_queries) && grounding.search_queries.length > 0;
  if (hasSources || hasQueries) {
    lines.push('');
    lines.push(`## 🌐 ${dict.sourcesGrounding || 'Sources & Grounding'}`);
    if (hasSources) {
      lines.push('');
      lines.push(`### ${dict.webSources || 'Web Sources'}`);
      grounding.sources.forEach((src) => {
        lines.push(`- [${src.title || src.url}](${src.url})`);
      });
    }
    if (hasQueries) {
      lines.push('');
      lines.push(`### ${dict.searchQueries || 'Search Queries'}`);
      grounding.search_queries.forEach((q) => {
        lines.push(`- [${q}](https://www.google.com/search?q=${encodeURIComponent(q)})`);
      });
    }
  }

  // Events
  lines.push('');
  const eventsCountLabel = (dict.eventsCount || '{count} events').replace('{count}', articles.length);
  lines.push(`## ⏳ ${dict.chronologicalEvents || 'Chronological Events'} (${eventsCountLabel})`);

  articles.forEach((art, index) => {
    const num = index + 1;
    const timeSpan = formatTimeSpan(art.from, art.to, art.isToPresent, lang);
    const categoryOrLane = getArticleCategoryOrLane(art, lanes);

    lines.push('');
    lines.push(`### ${num}. ${art.title}`);
    if (art.subtitle) {
      lines.push(`*${art.subtitle}*`);
      lines.push('');
    }

    if (timeSpan) {
      lines.push(`- 📅 **${dict.date || 'Date'}:** ${timeSpan}`);
    }
    if (categoryOrLane) {
      lines.push(`- 🏷️ **${dict.categoryOrLane || 'Category / Lane'}:** ${categoryOrLane}`);
    }
    if (art.locationName || (art.lat != null && art.lng != null)) {
      const locStr = art.locationName || `${art.lat}, ${art.lng}`;
      const mapsLink = art.googleMapsUrl ? ` ([${dict.viewOnMaps || 'View on Maps'}](${art.googleMapsUrl}))` : '';
      lines.push(`- 📍 **${dict.location || 'Location'}:** ${locStr}${mapsLink}`);
    }

    if (art.extract) {
      lines.push('');
      lines.push(art.extract);
    }

    if (art.wikiUrl) {
      lines.push('');
      lines.push(`🔗 [${dict.wikipediaArticle || dict.wikipedia || 'Wikipedia Article'}](${art.wikiUrl})`);
    }

    lines.push('');
    lines.push('---');
  });

  lines.push('');
  lines.push(`*${dict.generatedBy || 'Generated by ChroniX - Interactive AI Timelines'}*`);

  return lines.join('\n');
}

// RFC 4180 CSV cell escaper
function escapeCsvCell(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

// Generates an Excel-ready CSV file with UTF-8 BOM (.csv)
export function generateTimelineCsv(timeline, lang = 'en') {
  const dict = getExportDict(lang);
  const lanes = timeline?.lanes || [];
  const articles = sortArticlesChronologically(timeline?.articles || []);

  const headers = [
    dict.csvIndex || '#',
    dict.csvDateSpan || 'Date Span',
    dict.csvStartYear || 'Start Year',
    dict.csvStartMonth || 'Start Month',
    dict.csvStartDay || 'Start Day',
    dict.csvEndYear || 'End Year',
    dict.csvEndMonth || 'End Month',
    dict.csvEndDay || 'End Day',
    dict.csvTitle || 'Title',
    dict.csvSubtitle || 'Subtitle',
    dict.csvCategoryOrLane || 'Category / Lane',
    dict.csvLocation || 'Location',
    dict.csvLatitude || 'Latitude',
    dict.csvLongitude || 'Longitude',
    dict.csvGoogleMaps || 'Google Maps Link',
    dict.csvSummary || 'Summary / Extract',
    dict.csvWikipedia || 'Wikipedia Link'
  ];

  const rows = [headers.map(escapeCsvCell).join(',')];

  articles.forEach((art, index) => {
    const timeSpan = formatTimeSpan(art.from, art.to, art.isToPresent, lang);
    const categoryOrLane = getArticleCategoryOrLane(art, lanes);
    const presentStr = dict.dates?.present || 'Present';

    const row = [
      index + 1,
      timeSpan,
      art.from?.year ?? '',
      art.from?.month ?? '',
      art.from?.day ?? '',
      art.to?.year ?? (art.isToPresent ? presentStr : ''),
      art.to?.month ?? '',
      art.to?.day ?? '',
      art.title || '',
      art.subtitle || '',
      categoryOrLane,
      art.locationName || '',
      art.lat ?? '',
      art.lng ?? '',
      art.googleMapsUrl || '',
      art.extract || '',
      art.wikiUrl || ''
    ];

    rows.push(row.map(escapeCsvCell).join(','));
  });

  // Prepend \uFEFF BOM for automatic UTF-8 detection in Microsoft Excel
  return '\uFEFF' + rows.join('\r\n');
}

// Triggers browser download of text/data files
export function downloadFile(content, filename, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Copies string to system clipboard with fallback
export async function copyToClipboard(text) {
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      console.warn('navigator.clipboard.writeText failed, falling back:', e);
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch (e) {
    console.error('Fallback copy to clipboard failed:', e);
    return false;
  }
}

// Opens a dedicated, clean, beautifully styled printable document and invokes window.print()
// to enable direct high-quality printing or "Save as PDF"
export function printTimelinePdf(timeline, lang = 'en', isRtl = null) {
  const dict = getExportDict(lang);
  const actualRtl = typeof isRtl === 'boolean' ? isRtl : (lang === 'he' || lang === 'ar');

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert(dict.printPopupBlocked || 'The print popup was blocked by your browser. Please allow popups and try again.');
    return false;
  }

  const title = timeline?.title || dict.untitledTimeline || 'Timeline';
  const description = timeline?.description || '';
  const overview = (timeline?.overview || '').trim();
  const lanes = timeline?.lanes || [];
  const articles = sortArticlesChronologically(timeline?.articles || []);
  const grounding = timeline?.grounding;

  const escapeHtml = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const hasSources = grounding?.is_grounded && Array.isArray(grounding.sources) && grounding.sources.length > 0;
  const totalEventsText = (dict.totalEvents || 'Total {count} events').replace('{count}', articles.length);
  const generatedDateFormatted = new Date().toLocaleDateString(lang);
  const generatedText = (dict.generatedAt || 'Generated: {date}').replace('{date}', generatedDateFormatted);

  const htmlContent = `<!DOCTYPE html>
<html lang="${lang}" dir="${actualRtl ? 'rtl' : 'ltr'}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} - ChroniX</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue",
        "Noto Sans Arabic", "Noto Sans Devanagari", "Noto Sans JP", "Noto Sans KR", "Noto Sans SC",
        "Rubik", "Heebo", "PingFang SC", "Hiragino Sans", "Apple SD Gothic Neo", Arial, sans-serif;
      color: #1e293b;
      background-color: #ffffff;
      line-height: 1.6;
      padding: 24px;
      max-width: 900px;
      margin: 0 auto;
    }
    html[dir="rtl"] body {
      text-align: right;
    }
    .no-print-bar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 12px 18px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
    }
    .no-print-bar h4 {
      font-size: 14px;
      font-weight: 600;
      color: #334155;
    }
    .no-print-btn {
      background: #4f46e5;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s;
    }
    .no-print-btn:hover {
      background: #4338ca;
    }
    .no-print-btn.secondary {
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #cbd5e1;
    }
    .no-print-btn.secondary:hover {
      background: #e2e8f0;
    }
    header {
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 18px;
      margin-bottom: 24px;
    }
    .brand-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #4f46e5;
      background: #eef2ff;
      padding: 4px 10px;
      border-radius: 6px;
      margin-bottom: 8px;
    }
    h1 {
      font-size: 26px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.3;
      margin-bottom: 8px;
    }
    .description {
      font-size: 14.5px;
      color: #475569;
      line-height: 1.6;
    }
    .meta-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin-top: 12px;
      font-size: 12px;
      color: #64748b;
    }
    .section-title {
      font-size: 17px;
      font-weight: 700;
      color: #1e293b;
      margin: 28px 0 14px 0;
      padding-bottom: 6px;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .overview-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-left: 4px solid #4f46e5;
      padding: 16px 20px;
      border-radius: 8px;
      font-size: 13.5px;
      line-height: 1.75;
      color: #334155;
      white-space: pre-line;
    }
    html[dir="rtl"] .overview-box {
      border-left: 1px solid #e2e8f0;
      border-right: 4px solid #4f46e5;
    }
    .sources-list {
      list-style: none;
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
      font-size: 12.5px;
    }
    .source-item {
      padding: 8px 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
    }
    .source-item a {
      color: #2563eb;
      text-decoration: none;
      font-weight: 500;
      word-break: break-all;
    }
    .events-container {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .event-card {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 16px 18px;
      background: #ffffff;
      page-break-inside: avoid;
      break-inside: avoid;
      margin-bottom: 14px;
    }
    .event-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }
    .event-title-group {
      flex: 1;
    }
    .event-title {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
    }
    .event-subtitle {
      font-size: 13px;
      color: #64748b;
      margin-top: 2px;
    }
    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 8px 0;
    }
    .badge {
      font-size: 11.5px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 6px;
      background: #f1f5f9;
      color: #334155;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .badge.date {
      background: #eef2ff;
      color: #4338ca;
    }
    .badge.category {
      background: #f0fdf4;
      color: #166534;
      border: 1px solid #bbf7d0;
    }
    .badge.location {
      background: #fff1f2;
      color: #9f1239;
      border: 1px solid #fecdd3;
    }
    .event-extract {
      font-size: 13px;
      color: #334155;
      line-height: 1.65;
      margin-top: 8px;
    }
    .event-link {
      margin-top: 8px;
      font-size: 11.5px;
    }
    .event-link a {
      color: #2563eb;
      text-decoration: none;
    }
    footer.doc-footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 16px;
      margin-top: 32px;
      text-align: center;
      font-size: 12px;
      color: #94a3b8;
    }
    @media print {
      @page {
        size: A4;
        margin: 15mm 12mm;
      }
      body {
        padding: 0;
        max-width: 100%;
        color: #000;
      }
      .no-print-bar {
        display: none !important;
      }
      .event-card {
        border-color: #cbd5e1;
        box-shadow: none;
      }
      a {
        text-decoration: none;
        color: #000;
      }
      .badge {
        border: 1px solid #cbd5e1;
      }
    }
  </style>
</head>
<body>
  <div class="no-print-bar">
    <h4>${escapeHtml(dict.printPdfView || 'Print / Save as PDF View')}</h4>
    <div style="display:flex;gap:8px;">
      <button class="no-print-btn" onclick="window.print()">
        <span>🖨️</span>
        <span>${escapeHtml(dict.printButton || 'Print / Save as PDF')}</span>
      </button>
      <button class="no-print-btn secondary" onclick="window.close()">
        <span>${escapeHtml(dict.close || 'Close')}</span>
      </button>
    </div>
  </div>

  <header>
    <div class="brand-badge">ChroniX</div>
    <h1>${escapeHtml(title)}</h1>
    ${description ? `<p class="description">${escapeHtml(description)}</p>` : ''}
    <div class="meta-bar">
      <span>${escapeHtml(totalEventsText)}</span>
      <span>•</span>
      <span>${escapeHtml(generatedText)}</span>
    </div>
  </header>

  ${
    overview
      ? `<section>
          <h2 class="section-title">📖 ${escapeHtml(dict.narrativeOverview || 'Narrative Overview')}</h2>
          <div class="overview-box">${escapeHtml(overview)}</div>
        </section>`
      : ''
  }

  ${
    hasSources
      ? `<section>
          <h2 class="section-title">🌐 ${escapeHtml(dict.webSources || dict.sourcesGrounding || 'Web Grounding Sources')}</h2>
          <ul class="sources-list">
            ${grounding.sources
              .slice(0, 8)
              .map(
                (src) =>
                  `<li class="source-item"><a href="${escapeHtml(src.url)}" target="_blank">${escapeHtml(src.title || src.url)}</a></li>`
              )
              .join('')}
          </ul>
        </section>`
      : ''
  }

  <section>
    <h2 class="section-title">⏳ ${escapeHtml(dict.chronologicalEvents || 'Chronological Events')}</h2>
    <div class="events-container">
      ${articles
        .map((art, idx) => {
          const timeSpan = formatTimeSpan(art.from, art.to, art.isToPresent, lang);
          const catOrLane = getArticleCategoryOrLane(art, lanes);
          const locStr = art.locationName || (art.lat != null && art.lng != null ? `${art.lat}, ${art.lng}` : '');

          return `
            <div class="event-card">
              <div class="event-header">
                <div class="event-title-group">
                  <div class="event-title">${idx + 1}. ${escapeHtml(art.title)}</div>
                  ${art.subtitle ? `<div class="event-subtitle">${escapeHtml(art.subtitle)}</div>` : ''}
                </div>
              </div>

              <div class="badges">
                ${timeSpan ? `<span class="badge date">📅 ${escapeHtml(timeSpan)}</span>` : ''}
                ${catOrLane ? `<span class="badge category">🏷️ ${escapeHtml(catOrLane)}</span>` : ''}
                ${locStr ? `<span class="badge location">📍 ${escapeHtml(locStr)}</span>` : ''}
              </div>

              ${art.extract ? `<p class="event-extract">${escapeHtml(art.extract)}</p>` : ''}
              ${
                art.wikiUrl
                  ? `<div class="event-link">🔗 <a href="${escapeHtml(art.wikiUrl)}" target="_blank">${escapeHtml(dict.wikipedia || 'Wikipedia')}</a></div>`
                  : ''
              }
            </div>
          `;
        })
        .join('')}
    </div>
  </section>

  <footer class="doc-footer">
    ${escapeHtml(dict.generatedBy || 'Generated with ChroniX - Interactive AI Timelines')}
  </footer>

  <script>
    window.addEventListener('load', function() {
      setTimeout(function() {
        try {
          window.focus();
          window.print();
        } catch(e) {}
      }, 350);
    });
  </script>
</body>
</html>`;

  printWindow.document.open();
  printWindow.document.write(htmlContent);
  printWindow.document.close();
  return true;
}
