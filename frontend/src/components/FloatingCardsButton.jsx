import React, { useState, useRef, useEffect } from 'react';
import { LayoutList, GripVertical } from 'lucide-react';

/**
 * Floating button on the left edge that opens the Cards List Drawer.
 * Supports vertical dragging up and down so it doesn't obscure timeline text.
 * Persists chosen position in localStorage.
 */
export default function FloatingCardsButton({ count = 0, onClick, side = 'right' }) {
  // Read saved top percentage or default to 50%
  const [topPercent, setTopPercent] = useState(() => {
    try {
      const saved = localStorage.getItem('vt_cards_btn_top');
      if (saved !== null) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= 5 && parsed <= 95) {
          return parsed;
        }
      }
    } catch (e) {}
    return 50;
  });

  const [isDragging, setIsDragging] = useState(false);
  const buttonRef = useRef(null);
  const latestPercentRef = useRef(topPercent);

  // Keep latestPercentRef up to date
  useEffect(() => {
    latestPercentRef.current = topPercent;
  }, [topPercent]);

  // Drag state refs
  const dragInfoRef = useRef({
    isPointerDown: false,
    hasDragged: false,
    startY: 0,
    grabOffsetY: 0,
    pointerId: null,
  });

  const handlePointerDown = (e) => {
    // Only handle primary button (left mouse click or single touch)
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const buttonEl = buttonRef.current;
    if (!buttonEl) return;

    const containerEl = buttonEl.parentElement;
    if (!containerEl) return;

    const buttonRect = buttonEl.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();

    // Center of the button relative to the parent container
    const currentCenterY = buttonRect.top + buttonRect.height / 2 - containerRect.top;
    const pointerY = e.clientY - containerRect.top;

    dragInfoRef.current = {
      isPointerDown: true,
      hasDragged: false,
      startY: e.clientY,
      grabOffsetY: pointerY - currentCenterY,
      pointerId: e.pointerId,
    };

    try {
      buttonEl.setPointerCapture(e.pointerId);
    } catch (err) {}
  };

  const handlePointerMove = (e) => {
    if (!dragInfoRef.current.isPointerDown) return;

    const deltaY = Math.abs(e.clientY - dragInfoRef.current.startY);
    if (!dragInfoRef.current.hasDragged && deltaY > 4) {
      dragInfoRef.current.hasDragged = true;
      setIsDragging(true);
    }

    if (!dragInfoRef.current.hasDragged) return;

    const buttonEl = buttonRef.current;
    if (!buttonEl) return;
    const containerEl = buttonEl.parentElement;
    if (!containerEl) return;

    const containerRect = containerEl.getBoundingClientRect();
    const buttonHeight = buttonEl.offsetHeight;

    // Pointer Y relative to container
    const pointerY = e.clientY - containerRect.top;
    const targetCenterY = pointerY - dragInfoRef.current.grabOffsetY;

    // Keep within bounds with padding
    const padding = 16;
    const halfHeight = buttonHeight / 2;
    const minCenterY = halfHeight + padding;
    const maxCenterY = Math.max(minCenterY, containerRect.height - halfHeight - padding);

    const clampedCenterY = Math.max(minCenterY, Math.min(targetCenterY, maxCenterY));
    const newPercent = (clampedCenterY / containerRect.height) * 100;

    latestPercentRef.current = newPercent;
    setTopPercent(newPercent);
  };

  const handlePointerUp = (e) => {
    if (!dragInfoRef.current.isPointerDown) return;

    const buttonEl = buttonRef.current;
    if (buttonEl && dragInfoRef.current.pointerId !== null) {
      try {
        buttonEl.releasePointerCapture(dragInfoRef.current.pointerId);
      } catch (err) {}
    }

    const wasDragged = dragInfoRef.current.hasDragged;
    dragInfoRef.current.isPointerDown = false;
    setIsDragging(false);

    if (wasDragged) {
      try {
        localStorage.setItem('vt_cards_btn_top', latestPercentRef.current.toFixed(2));
      } catch (err) {}
    }
  };

  const handlePointerCancel = () => {
    if (dragInfoRef.current.isPointerDown) {
      const buttonEl = buttonRef.current;
      if (buttonEl && dragInfoRef.current.pointerId !== null) {
        try {
          buttonEl.releasePointerCapture(dragInfoRef.current.pointerId);
        } catch (err) {}
      }
      dragInfoRef.current.isPointerDown = false;
      setIsDragging(false);
    }
  };

  const handleClick = (e) => {
    // If user dragged the button, suppress click
    if (dragInfoRef.current.hasDragged) {
      e.preventDefault();
      e.stopPropagation();
      dragInfoRef.current.hasDragged = false;
      return;
    }
    if (onClick) {
      onClick();
    }
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={handleClick}
      style={{
        top: `${topPercent}%`,
        transform: 'translateY(-50%)',
      }}
      className={`absolute ${
        side === 'left'
          ? 'left-0 rounded-r-xl border-y border-r'
          : 'right-0 rounded-l-xl border-y border-l'
      } z-20 touch-none select-none py-2.5 px-1.5 shadow-lg backdrop-blur-md flex flex-col items-center gap-1.5 group ${
        isDragging
          ? 'cursor-grabbing transition-none bg-white dark:bg-slate-800 border-sky-400 dark:border-sky-500 shadow-2xl ring-2 ring-sky-400/40 scale-105'
          : 'cursor-grab transition-[background-color,border-color,box-shadow,transform] duration-150 bg-white/95 dark:bg-slate-900/95 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 hover:text-sky-600 dark:hover:text-sky-400 border-slate-300/80 dark:border-slate-700/80'
      }`}
      title="Click to open Cards List | Drag up/down to reposition"
      aria-label="Open Cards List (drag up or down to reposition)"
    >
      {/* Subtle Drag Grip Handle */}
      <div
        className={`flex items-center justify-center transition-colors ${
          isDragging ? 'text-sky-500' : 'text-slate-400 dark:text-slate-500 group-hover:text-sky-500'
        }`}
      >
        <GripVertical className="w-3.5 h-3.5 opacity-70 group-hover:opacity-100" />
      </div>

      {/* Cards Icon */}
      <LayoutList className="w-4 h-4 text-sky-500 group-hover:scale-110 transition-transform" />

      {/* Vertical Label */}
      <span
        className="text-[10px] font-bold text-slate-600 dark:text-slate-300 group-hover:text-sky-600 dark:group-hover:text-sky-400 select-none tracking-wider"
        style={{ writingMode: 'vertical-rl' }}
      >
        Cards ({count})
      </span>
    </button>
  );
}
