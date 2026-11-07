export function fireConfetti(options) {
  return import('canvas-confetti')
    .then((mod) => {
      const fn = mod?.default || mod;
      if (typeof fn === 'function') {
        return fn(options);
      }
      return null;
    })
    .catch(() => null);
}
