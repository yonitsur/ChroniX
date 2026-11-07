// Guarded recovery for stale Vite lazy-loaded chunks after a new deployment.

export const CHUNK_RELOAD_STORAGE_KEY = 'chronix_chunk_reload_at';
export const CHUNK_RELOAD_COOLDOWN_MS = 15_000;

let inMemoryLastReloadAt = 0;

export function isDynamicImportError(error) {
  if (!error) return false;
  const target = error.payload || error;
  const name = typeof target?.name === 'string' ? target.name : '';
  const message = typeof target?.message === 'string'
    ? target.message
    : (typeof target === 'string' ? target : '');

  if (name === 'ChunkLoadError') return true;
  if (!message) return false;

  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Unable to preload CSS for/i.test(message) ||
    /Expected a JavaScript-or-Wasm module script/i.test(message)
  );
}

export function tryRecoverFromChunkError(error, options = {}) {
  if (!isDynamicImportError(error)) return false;

  const now = typeof options.now === 'number' ? options.now : Date.now();
  const storage = 'storage' in options
    ? options.storage
    : (typeof window !== 'undefined' ? window.sessionStorage : null);
  const reload = typeof options.reload === 'function'
    ? options.reload
    : (() => {
      if (typeof window !== 'undefined' && window.location) {
        window.location.reload();
      }
    });

  let lastReloadAt = inMemoryLastReloadAt;
  if (storage && typeof storage.getItem === 'function') {
    try {
      const stored = Number(storage.getItem(CHUNK_RELOAD_STORAGE_KEY) || 0);
      if (Number.isFinite(stored) && stored > lastReloadAt) {
        lastReloadAt = stored;
      }
    } catch {
      // sessionStorage may be unavailable in restricted/private contexts
    }
  }

  if (lastReloadAt > 0 && now - lastReloadAt < CHUNK_RELOAD_COOLDOWN_MS) {
    return false;
  }

  inMemoryLastReloadAt = now;
  if (storage && typeof storage.setItem === 'function') {
    try {
      storage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now));
    } catch {
      // ignore storage quota/security errors
    }
  }

  reload();
  return true;
}

export function resetChunkReloadGuardForTests() {
  inMemoryLastReloadAt = 0;
}

export function installVitePreloadErrorHandler(
  targetWindow = typeof window !== 'undefined' ? window : null,
  options = {}
) {
  if (!targetWindow || typeof targetWindow.addEventListener !== 'function') {
    return () => {};
  }
  if (targetWindow.__chronixPreloadHandlerInstalled && !options.force) {
    return () => {};
  }

  const onPreloadError = (event) => {
    const err = event?.payload || new Error('Failed to fetch dynamically imported module');
    if (tryRecoverFromChunkError(err, options)) {
      event?.preventDefault?.();
    }
  };

  targetWindow.addEventListener('vite:preloadError', onPreloadError);
  targetWindow.__chronixPreloadHandlerInstalled = true;

  return () => {
    targetWindow.removeEventListener('vite:preloadError', onPreloadError);
    targetWindow.__chronixPreloadHandlerInstalled = false;
  };
}
