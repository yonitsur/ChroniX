import React, { useState, useEffect, Suspense } from 'react';

/**
 * Defers loading and mounting a React.lazy child until `isOpen` becomes true at
 * least once, then keeps it mounted so exit animations (e.g. useModalAnimation)
 * and internal panel/player state behave identically to eager mounting.
 */
export default function LazyMount({ isOpen, fallback = null, children }) {
  const [hasOpened, setHasOpened] = useState(Boolean(isOpen));

  useEffect(() => {
    if (isOpen && !hasOpened) {
      setHasOpened(true);
    }
  }, [isOpen, hasOpened]);

  if (!isOpen && !hasOpened) return null;
  return <Suspense fallback={fallback}>{children}</Suspense>;
}
