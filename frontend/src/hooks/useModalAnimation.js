import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Custom hook to provide smooth enter and exit transitions for modals, dialogs,
 * and mobile bottom sheets, along with a touch swipe-down gesture to dismiss.
 *
 * @param {boolean} isOpen - External open state
 * @param {function} onClose - External close handler
 * @param {object} [options]
 * @param {number} [options.duration=250] - Animation duration in ms
 * @param {number} [options.swipeThreshold=50] - Downward drag distance (px) to trigger close
 * @returns {{
 *   isRendered: boolean,
 *   isVisible: boolean,
 *   handleClose: () => void,
 *   dragHandleProps: { onTouchStart: (e: any) => void, onTouchEnd: (e: any) => void }
 * }}
 */
export function useModalAnimation(isOpen, onClose, options = {}) {
  const { duration = 250, swipeThreshold = 50 } = options;
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);
  const touchStartYRef = useRef(0);
  const isClosingRef = useRef(false);

  // Sync external isOpen changes
  useEffect(() => {
    let timer;
    let rafId;

    if (isOpen) {
      isClosingRef.current = false;
      setIsRendered(true);
      // Wait a frame before making visible so the initial offscreen/hidden state is rendered
      rafId = requestAnimationFrame(() => {
        rafId = requestAnimationFrame(() => {
          setIsVisible(true);
        });
      });
    } else {
      setIsVisible(false);
      timer = setTimeout(() => {
        setIsRendered(false);
        isClosingRef.current = false;
      }, duration);
    }

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timer);
    };
  }, [isOpen, duration]);

  // Request an animated close
  const handleClose = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    setIsVisible(false);
    setTimeout(() => {
      setIsRendered(false);
      isClosingRef.current = false;
      onClose?.();
    }, duration);
  }, [onClose, duration]);

  // Touch handlers for drag handle / header swipe down
  const handleTouchStart = useCallback((e) => {
    if (e.touches && e.touches[0]) {
      touchStartYRef.current = e.touches[0].clientY;
    }
  }, []);

  const handleTouchEnd = useCallback((e) => {
    if (e.changedTouches && e.changedTouches[0]) {
      const deltaY = e.changedTouches[0].clientY - touchStartYRef.current;
      if (deltaY > swipeThreshold) {
        handleClose();
      }
    }
    touchStartYRef.current = 0;
  }, [handleClose, swipeThreshold]);

  return {
    isRendered,
    isVisible,
    handleClose,
    dragHandleProps: {
      onTouchStart: handleTouchStart,
      onTouchEnd: handleTouchEnd,
    },
  };
}

export default useModalAnimation;
