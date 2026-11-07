export const WIKI_HOST_RE = /^([a-z0-9-]+)\.(?:m\.)?wikipedia\.org$/i;

export function getWikiLang(url) {
  try {
    return new URL(url).hostname.match(WIKI_HOST_RE)?.[1]?.toLowerCase() || null;
  } catch {
    return null;
  }
}

// Mobile (Minerva) skin fits the narrow drawer; desktop Vector would need horizontal scrolling.
// Wikimedia redirects *.m.wikipedia.org to *.wikipedia.org, which serves Vector on desktop User-Agents
// unless useformat=mobile is passed explicitly.
export function toEmbeddableWikiUrl(url, { isDark } = {}) {
  try {
    const u = new URL(url);
    const match = u.hostname.match(WIKI_HOST_RE);
    if (!match || !/^https?:$/.test(u.protocol) || !u.pathname.startsWith('/wiki/')) return null;
    u.protocol = 'https:';
    u.hostname = `${match[1].toLowerCase()}.wikipedia.org`;
    u.searchParams.set('useformat', 'mobile');
    const dark = typeof isDark === 'boolean'
      ? isDark
      : (typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));
    u.searchParams.set('minervanightmode', dark ? '1' : '0');
    return u.toString();
  } catch {
    return null;
  }
}
