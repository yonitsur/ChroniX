import React, { useEffect, useRef, useState } from 'react';
import { Move, Check } from './icons/ThemeIcons';
import { useLanguage } from '../context/LanguageContext';
import useAutoFocalPoint from '../hooks/useAutoFocalPoint';

const clampPercent = (value) => Math.max(0, Math.min(100, value));

// Same frame as the event drawer's media: a fixed 16:10 box, cover-cropped around the
// event's saved focal point (or an automatically chosen one when none is saved). With
// `onPositionChange`, a Move button lets the owner drag the photo inside the frame; the
// new focal point is saved when a drag ends.
export default function PositionablePhoto({
  src,
  candidates,
  alt = '',
  positionX,
  positionY,
  onPositionChange,
  className = '',
  onError,
}) {
  const { t } = useLanguage();
  const [position, setPosition] = useState({ x: positionX ?? 50, y: positionY ?? 50 });
  const [isPositioning, setIsPositioning] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState(null);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const frameRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const positionRef = useRef(position);
  positionRef.current = position;

  const candidateList = Array.isArray(candidates) && candidates.length > 0
    ? candidates
    : (src ? [src] : []);
  const activeSrc = candidateList[Math.min(candidateIndex, Math.max(0, candidateList.length - 1))] || src;

  useEffect(() => {
    setCandidateIndex(0);
  }, [src]);

  const hasSavedPosition = positionX != null && positionY != null;
  const autoPosition = useAutoFocalPoint(activeSrc, frameRef, !hasSavedPosition && loadedSrc === activeSrc);

  useEffect(() => {
    if (dragRef.current) return;
    setPosition({ x: positionX ?? autoPosition?.x ?? 50, y: positionY ?? autoPosition?.y ?? 50 });
  }, [activeSrc, positionX, positionY, autoPosition?.x, autoPosition?.y]);

  const handlePointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const image = imageRef.current;
    if (!image?.naturalWidth || !image?.naturalHeight) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      position: positionRef.current,
      moved: false,
    };
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    const image = imageRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !image) return;
    const rect = image.getBoundingClientRect();
    const coverScale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
    const overflowX = Math.max(0, image.naturalWidth * coverScale - rect.width);
    const overflowY = Math.max(0, image.naturalHeight * coverScale - rect.height);
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    const next = {
      x: overflowX > 0 ? clampPercent(drag.position.x - (dx / overflowX) * 100) : drag.position.x,
      y: overflowY > 0 ? clampPercent(drag.position.y - (dy / overflowY) * 100) : drag.position.y,
    };
    positionRef.current = next;
    setPosition(next);
  };

  const handlePointerEnd = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.moved) onPositionChange?.(positionRef.current);
  };

  const dragLabel = t('eventDrawer.dragImageToPosition');

  return (
    <div ref={frameRef} className={`relative w-full aspect-[16/10] max-h-[260px] overflow-hidden bg-surface-sunken group ${className}`}>
      <img
        ref={imageRef}
        src={activeSrc}
        alt={alt}
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={() => setLoadedSrc(activeSrc)}
        onError={(e) => {
          if (candidateIndex + 1 < candidateList.length) {
            setCandidateIndex((idx) => idx + 1);
            return;
          }
          onError?.(e);
        }}
        className="w-full h-full object-cover select-none pointer-events-none bg-white"
        style={{
          objectPosition: `${position.x}% ${position.y}%`,
          transition: isPositioning ? 'none' : 'object-position 350ms ease-out',
        }}
      />

      {onPositionChange && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsPositioning((value) => !value);
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className={`absolute top-2.5 start-2.5 flex items-center justify-center rounded-full border transition-all cursor-pointer backdrop-blur-md shadow-pop z-10 ${
            isPositioning
              ? 'px-3 py-1.5 h-8 bg-accent text-accent-fg border-accent font-medium text-xs gap-1.5 shadow-md'
              : 'w-8 h-8 bg-black/65 text-white border-white/20 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/85'
          }`}
          title={isPositioning ? t('common.confirm') : t('eventDrawer.adjustImagePosition')}
          aria-label={isPositioning ? t('common.confirm') : t('eventDrawer.adjustImagePosition')}
          aria-pressed={isPositioning}
        >
          {isPositioning ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>{t('common.confirm') || 'Done'}</span>
            </>
          ) : (
            <Move className="w-3.5 h-3.5" />
          )}
        </button>
      )}

      {isPositioning && (
        <div
          className="absolute inset-0 touch-none cursor-move bg-black/20 backdrop-blur-[1px]"
          role="application"
          aria-label={dragLabel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="absolute left-1/2 bottom-3 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/75 backdrop-blur-md px-3 py-1.5 text-caption font-semibold text-white pointer-events-none shadow-pop border border-white/20">
            {dragLabel}
          </span>
        </div>
      )}
    </div>
  );
}
