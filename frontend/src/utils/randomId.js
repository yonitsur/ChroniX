// 128-bit random hex for new timeline ids (S-09): a short Math.random() prefix lets two people's
// timelines on the same subject collide. crypto.randomUUID needs a secure context; getRandomValues
// does not, so it is the fallback (e.g. a LAN dev server over plain http).
export function randomHexId() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '');
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Array.from({ length: 4 }, () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')).join('');
}
