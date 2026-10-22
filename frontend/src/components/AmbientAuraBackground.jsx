import React, { useRef, useEffect, useState, memo } from 'react';
import { CONSTELLATIONS } from '../data/constellations';
import { useLanguage } from '../context/LanguageContext';
import TopographicBackground from './TopographicBackground';
import { getZone, projectConstellation, placeConstellationLabel, createBackgroundStars, findNearestConstellation } from '../utils/constellationLayout';
import { getActiveSkySkin, drawSkinBackgroundStar, drawSkinConstellationLines, drawSkinStar } from '../utils/constellationSkins';

export { getZone };

const SKY_CONTROL_SELECTOR = 'button, input, textarea, a, select, header, h1, h2, p, svg, [role="button"], [role="menu"], [role="dialog"], [role="listbox"], [data-home-prompt], [data-prompt-examples-track], [data-trivia-ticker]';

let persistentElapsedSeconds = 0;

const AstronomicalConstellationsCanvas = memo(function AstronomicalConstellationsCanvas({
  language = 'en',
  isRtl = false,
  floatingBadgeRef,
  badgeTextRef,
}) {
  const canvasRef = useRef(null);
  const languageRef = useRef(language);
  languageRef.current = language;
  const isRtlRef = useRef(isRtl);
  isRtlRef.current = isRtl;
  const requestObstaclesRef = useRef(null);

  useEffect(() => {
    // When language or text direction changes, UI elements reflow (LTR/RTL).
    // Re-measure obstacles after DOM updates so badge placement respects new layout,
    // without resetting canvas animation or constellation state.
    const frameId = requestAnimationFrame(() => {
      requestObstaclesRef.current?.();
    });
    return () => cancelAnimationFrame(frameId);
  }, [language, isRtl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId = 0;
    let width = window.innerWidth;
    let height = window.innerHeight;
    let pixelRatio = 1;
    let elapsedSeconds = persistentElapsedSeconds;
    let lastFrame = 0;
    let disposed = false;
    let interactionBlocked = false;
    let obstacles = [];
    let obstacleFrame = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let backgroundStars = [];
    let approachedIndex = -1;
    const activeConstellations = CONSTELLATIONS.map((data, index) => ({
      data, index, alignment: 0, proximity: 0, lastPose: null,
    }));
    const schedule = () => {
      if (!animationFrameId && !disposed && !document.hidden) animationFrameId = requestAnimationFrame(render);
    };
    const hideBadge = () => {
      if (floatingBadgeRef.current) floatingBadgeRef.current.style.opacity = '0';
    };
    const measureObstacles = () => {
      obstacleFrame = 0;
      const root = canvas.closest('.home-screen-bg') || document;
      obstacles = Array.from(root.querySelectorAll('header, [data-home-prompt], [data-prompt-examples-track], [data-trivia-ticker], h1, h2, p, button, svg'))
        .map(element => element.getBoundingClientRect())
        .filter(rect => rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < height && rect.right > 0 && rect.left < width);
    };
    const requestObstacles = event => {
      if (event?.type === 'scroll' && event.target instanceof Element && event.target.matches('[data-prompt-examples-track]')) return;
      if (!obstacleFrame) obstacleFrame = requestAnimationFrame(() => { measureObstacles(); schedule(); });
    };
    requestObstaclesRef.current = requestObstacles;
    const isBlocked = target => Boolean(target instanceof Element && target.closest(SKY_CONTROL_SELECTOR))
      || Boolean(document.activeElement?.closest('[data-home-prompt], [role="dialog"], [role="menu"]'));

    let mouse = { x: -9999, y: -9999, targetX: -9999, targetY: -9999 };

    let pinnedIndex = -1;
    let pinTimeoutId = null;
    let pointerStart = null;
    let activeTouch = null;

    const unpin = () => {
      pinnedIndex = -1;
      if (pinTimeoutId) {
        clearTimeout(pinTimeoutId);
        pinTimeoutId = null;
      }
      schedule();
    };

    const clearPointer = () => {
      mouse.targetX = -9999;
      mouse.targetY = -9999;
      hideBadge();
      schedule();
    };
    const updatePointer = (clientX, clientY, target) => {
      interactionBlocked = isBlocked(target);
      if (interactionBlocked) {
        clearPointer();
        unpin();
        return;
      }
      mouse.targetX = clientX;
      mouse.targetY = clientY;
      schedule();
    };
    const handlePointerMove = event => {
      if (event.pointerType === 'touch') return;
      updatePointer(event.clientX, event.clientY, event.target);
    };
    const handlePointerLeave = () => {
      if (!activeTouch) clearPointer();
    };
    const pinAt = (clientX, clientY, target) => {
      if (isBlocked(target)) return;
      const poses = activeConstellations.map(item => getZone(item.index, width).visible ? item.lastPose : null);
      const nearest = findNearestConstellation(poses, clientX, clientY, 48, approachedIndex);
      if (nearest.index === pinnedIndex || nearest.index < 0) {
        unpin();
        return;
      }
      pinnedIndex = nearest.index;
      interactionBlocked = false;
      requestObstacles();
      if (pinTimeoutId) clearTimeout(pinTimeoutId);
      pinTimeoutId = setTimeout(unpin, 3500);
      schedule();
    };
    const handlePointerDown = event => {
      if (event.pointerType === 'touch' || event.button !== 0) return;
      updatePointer(event.clientX, event.clientY, event.target);
      pointerStart = interactionBlocked ? null : { x: event.clientX, y: event.clientY, time: performance.now() };
    };
    const handlePointerUp = event => {
      if (event.pointerType === 'touch' || !pointerStart) return;
      const start = pointerStart;
      pointerStart = null;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 16 && performance.now() - start.time < 650) {
        pinAt(event.clientX, event.clientY, event.target);
      }
    };
    const handlePointerCancel = event => {
      pointerStart = null;
      if (event.pointerType !== 'touch') clearPointer();
    };
    const cancelTouch = () => {
      activeTouch = null;
      unpin();
      clearPointer();
    };
    const handleTouchStart = event => {
      if (event.touches.length !== 1 || isBlocked(event.target)) {
        cancelTouch();
        return;
      }
      const touch = event.touches[0];
      activeTouch = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: performance.now(), moved: false };
      unpin();
      updatePointer(touch.clientX, touch.clientY, event.target);
      requestObstacles();
    };
    const handleTouchMove = event => {
      if (!activeTouch) return;
      if (event.touches.length !== 1) {
        cancelTouch();
        return;
      }
      const touch = Array.from(event.touches).find(item => item.identifier === activeTouch.id);
      if (!touch) return;
      if (Math.hypot(touch.clientX - activeTouch.x, touch.clientY - activeTouch.y) > 12) activeTouch.moved = true;
      updatePointer(touch.clientX, touch.clientY, document.elementFromPoint(touch.clientX, touch.clientY));
    };
    const handleTouchEnd = event => {
      if (!activeTouch) return;
      const touch = Array.from(event.changedTouches).find(item => item.identifier === activeTouch.id);
      if (!touch) return;
      const tapped = !activeTouch.moved && performance.now() - activeTouch.time < 650;
      activeTouch = null;
      clearPointer();
      if (tapped) pinAt(touch.clientX, touch.clientY, document.elementFromPoint(touch.clientX, touch.clientY));
    };
    const handleFocus = () => {
      interactionBlocked = isBlocked(document.activeElement);
      if (interactionBlocked) {
        unpin();
        clearPointer();
      }
      requestObstacles();
    };
    const handleBlur = () => {
      pointerStart = null;
      cancelTouch();
    };
    const handleFocusOut = () => queueMicrotask(() => { if (!disposed) handleFocus(); });

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', handlePointerLeave, { passive: true });
    window.addEventListener('pointerdown', handlePointerDown, { passive: true });
    window.addEventListener('pointerup', handlePointerUp, { passive: true });
    window.addEventListener('pointercancel', handlePointerCancel, { passive: true });
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', cancelTouch, { passive: true });

    const handleResize = () => {
      if (!canvas) return;
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width || window.innerWidth;
      height = bounds.height || window.innerHeight;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      pinnedIndex = -1;
      activeTouch = null;
      approachedIndex = -1;
      backgroundStars = createBackgroundStars(width, height);
      activeConstellations.forEach(item => { item.alignment = 0; item.proximity = 0; item.lastPose = null; });
      measureObstacles();
      cancelAnimationFrame(animationFrameId);
      lastFrame = 0;
      render(performance.now());
    };
    window.addEventListener('resize', handleResize, { passive: true });
    const handleVisibilityChange = () => {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
      lastFrame = 0;
      handleBlur();
      schedule();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('focusin', handleFocus);
    document.addEventListener('focusout', handleFocusOut);
    document.addEventListener('scroll', requestObstacles, { capture: true, passive: true });
    window.addEventListener('blur', handleBlur);
    reducedMotion.addEventListener('change', handleVisibilityChange);

    function render(now) {
      animationFrameId = 0;
      if (disposed || (document.hidden && lastFrame)) return;
      const elapsed = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 1 / 60;
      lastFrame = now;
      if (!reducedMotion.matches) {
        elapsedSeconds += elapsed * (width < 768 ? 2.2 : 1.0);
        persistentElapsedSeconds = elapsedSeconds;
      }
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Smooth mouse damping (when active on desktop)
      if (mouse.targetX > -1000) {
        if (mouse.x < -1000) {
          mouse.x = mouse.targetX;
          mouse.y = mouse.targetY;
        } else {
          const easing = reducedMotion.matches ? 1 : 1 - Math.exp(-elapsed * 12);
          mouse.x += (mouse.targetX - mouse.x) * easing;
          mouse.y += (mouse.targetY - mouse.y) * easing;
        }
      } else {
        mouse.x = -9999;
        mouse.y = -9999;
      }

      const isDark = document.documentElement.classList.contains('dark');
      const isToy = document.documentElement.classList.contains('theme-toy');
      const skySkin = getActiveSkySkin();
      const isHebrew = languageRef.current === 'he' || (typeof document !== 'undefined' && (document.documentElement.lang === 'he' || document.dir === 'rtl'));

      const TOY_PALETTE = ['#facc15', '#38bdf8', '#fb7185', '#4ade80', '#c084fc', '#fb923c'];

      const traceToyStarPath = (cx, cy, outerR, innerR) => {
        ctx.beginPath();
        for (let pt = 0; pt < 10; pt++) {
          const r = pt % 2 === 0 ? outerR : innerR;
          const angle = -Math.PI / 2 + (pt * Math.PI) / 5;
          const px = cx + Math.cos(angle) * r;
          const py = cy + Math.sin(angle) * r;
          if (pt === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      };

      ctx.globalAlpha = 1;
      for (let bIdx = 0; bIdx < backgroundStars.length; bIdx++) {
        const star = backgroundStars[bIdx];
        const shimmer = reducedMotion.matches
          ? 1
          : 0.50 + Math.pow(Math.sin(elapsedSeconds * 0.75 + star.phase), 2) * 0.50;
        const offsetX = reducedMotion.matches ? 0 : Math.sin(elapsedSeconds * 0.06 + star.phase) * 2;
        const offsetY = reducedMotion.matches ? 0 : Math.cos(elapsedSeconds * 0.05 + star.phase) * 1.5;
        const sx = star.x * width + offsetX;
        const sy = star.y * height + offsetY;

        if (skySkin) {
          drawSkinBackgroundStar(ctx, skySkin, isDark, star, bIdx, sx, sy, shimmer);
        } else if (isToy) {
          const toyColor = TOY_PALETTE[bIdx % TOY_PALETTE.length];
          ctx.save();
          if (isDark) {
            ctx.globalAlpha = Math.min(0.92, Math.max(0.45, star.alpha * (0.95 + shimmer * 0.35)));
            const r = Math.max(2.6, star.radius * 2.4);
            if (bIdx % 3 === 0) {
              // Plump mini 5-pointed 3D toy star
              ctx.lineJoin = 'round';
              traceToyStarPath(sx, sy + 1.5, r * 1.35, r * 0.68);
              ctx.fillStyle = '#0f172a';
              ctx.fill();

              traceToyStarPath(sx, sy, r * 1.35, r * 0.68);
              ctx.fillStyle = toyColor;
              ctx.strokeStyle = '#0f172a';
              ctx.lineWidth = 1.4;
              ctx.fill();
              ctx.stroke();
            } else {
              // 3D Toy Block Stud / Peg
              ctx.beginPath();
              ctx.arc(sx, sy + 1.5, r, 0, Math.PI * 2);
              ctx.fillStyle = '#0f172a';
              ctx.fill();

              ctx.beginPath();
              ctx.arc(sx, sy, r, 0, Math.PI * 2);
              ctx.fillStyle = toyColor;
              ctx.strokeStyle = '#0f172a';
              ctx.lineWidth = 1.3;
              ctx.fill();
              ctx.stroke();
            }
          } else {
            // Day Mode Toy Background Stars: compact size, vibrant and clearly visible
            ctx.globalAlpha = Math.min(0.78, Math.max(0.42, star.alpha * (0.88 + shimmer * 0.35)));
            const r = Math.max(1.7, star.radius * 1.55);
            if (bIdx % 3 === 0) {
              ctx.lineJoin = 'round';
              traceToyStarPath(sx, sy + 1.0, r * 1.28, r * 0.64);
              ctx.fillStyle = 'rgba(15, 23, 42, 0.32)';
              ctx.fill();

              traceToyStarPath(sx, sy, r * 1.28, r * 0.64);
              ctx.fillStyle = toyColor;
              ctx.strokeStyle = 'rgba(15, 23, 42, 0.62)';
              ctx.lineWidth = 1.0;
              ctx.fill();
              ctx.stroke();
            } else {
              ctx.beginPath();
              ctx.arc(sx, sy + 1.0, r, 0, Math.PI * 2);
              ctx.fillStyle = 'rgba(15, 23, 42, 0.30)';
              ctx.fill();

              ctx.beginPath();
              ctx.arc(sx, sy, r, 0, Math.PI * 2);
              ctx.fillStyle = toyColor;
              ctx.strokeStyle = 'rgba(15, 23, 42, 0.58)';
              ctx.lineWidth = 0.95;
              ctx.fill();
              ctx.stroke();
            }
          }
          ctx.restore();
        } else {
          ctx.fillStyle = isDark
            ? `rgba(214, 216, 224, ${star.alpha * (0.85 + shimmer * 0.15)})`
            : `rgba(44, 64, 112, ${star.alpha * (0.75 + shimmer * 0.45)})`;
          ctx.beginPath();
          ctx.arc(sx, sy, star.radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const hasActiveMouse = !interactionBlocked && mouse.x > -1000;
      let hoveredIndex = -1;
      let nearestDistance = Infinity;
      const poses = activeConstellations.map(item => {
        if (!getZone(item.index, width).visible) return null;
        return projectConstellation(item.data, item.index, width, height, elapsedSeconds, reducedMotion.matches);
      });
      if (hasActiveMouse && pinnedIndex === -1) {
        const nearest = findNearestConstellation(poses, mouse.x, mouse.y, 76, approachedIndex);
        approachedIndex = nearest.index;
        nearestDistance = nearest.distance;
        if (nearestDistance < (activeTouch ? 48 : 42)) hoveredIndex = nearest.index;
      } else approachedIndex = -1;
      let highestAlignment = 0;
      let bestItem = null;
      let bestBounds = null;

      for (let i = 0; i < activeConstellations.length; i++) {
        const item = activeConstellations[i];
        const pose = poses[i];
        if (!pose) continue;
        const { data } = item;
        item.lastPose = pose;
        const isHovered = !interactionBlocked && (pinnedIndex === i || hoveredIndex === i);
        const targetAlignment = isHovered ? 1 : 0;
        item.alignment = reducedMotion.matches ? targetAlignment
          : item.alignment + (targetAlignment - item.alignment) * (1 - Math.exp(-elapsed * (isHovered ? 7 : 4.5)));
        if (!isHovered && item.alignment < 0.005) item.alignment = 0;
        const targetProximity = approachedIndex === i ? Math.max(0, 1 - nearestDistance / 76) : 0;
        item.proximity = reducedMotion.matches ? targetProximity
          : item.proximity + (targetProximity - item.proximity) * (1 - Math.exp(-elapsed * 9));
        const twinkle = reducedMotion.matches ? 0 : Math.sin(elapsedSeconds * 0.65 + i * 1.7) * 0.035;
        const emphasis = Math.min(1, item.alignment + item.proximity * 0.28);
        ctx.globalAlpha = pose.prominence + (1 - pose.prominence) * emphasis;

        if (item.alignment > highestAlignment) {
          highestAlignment = item.alignment;
          bestItem = item;
          bestBounds = pose.bounds;
        }
        const starCoords = pose.stars.map(star => ({
          ...star,
          projectedRadius: (star.mag < 0 ? 3.2 : star.mag < 1 ? 2.7 : star.mag < 2 ? 2.15 : star.mag < 3 ? 1.65 : 1.1)
            * (width < 768 ? 0.82 : 1),
        }));

        const lineAlpha = item.alignment * (isDark ? 0.5 : 0.75);

        // 1. In Day mode (or non-Toy mode), draw constellation lines before stars so stars sit on top with visible outlines.
        //    In Toy Night mode, the star's #0f172a outline/lip matches the night sky (which carves the star's delicate shape,
        //    but would erase a black gap into the yellow line if drawn after it). So in Toy Night mode we draw the dark
        //    outer line stroke first, then the stars with their #0f172a outlines, and then the continuous #facc15 inner line.
        const traceConstellationLines = () => {
          ctx.beginPath();
          for (let l = 0; l < data.lines.length; l++) {
            const [fromIdx, toIdx] = data.lines[l];
            const p1 = starCoords[fromIdx];
            const p2 = starCoords[toIdx];
            if (p1 && p2) {
              ctx.moveTo(p1.sx, p1.sy);
              ctx.lineTo(p2.sx, p2.sy);
            }
          }
        };

        if (item.alignment > 0 && skySkin) {
          drawSkinConstellationLines(ctx, skySkin, isDark, item.alignment, traceConstellationLines, pose.bounds);
        } else if (item.alignment > 0) {
          traceConstellationLines();

          if (isToy) {
            ctx.save();
            ctx.globalAlpha = Math.min(1, item.alignment * (isDark ? 0.92 : 0.88));
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.setLineDash([]);
            ctx.strokeStyle = isDark ? '#0f172a' : 'rgba(15, 23, 42, 0.68)';
            ctx.lineWidth = isDark ? 4.6 : 3.4;
            ctx.stroke();

            if (!isDark) {
              ctx.strokeStyle = '#0ea5e9';
              ctx.lineWidth = 1.8;
              ctx.stroke();
            }
            ctx.restore();
          } else if (isDark) {
            ctx.strokeStyle = `rgba(228, 228, 234, ${Math.min(0.8, lineAlpha)})`;
            ctx.lineWidth = item.alignment > 0.3 ? 1.4 : 0.95;
            ctx.stroke();
          } else {
            // Day mode: soft ink bleed under a crisp navy chart line
            if (item.alignment > 0.12) {
              ctx.strokeStyle = `rgba(70, 104, 168, ${lineAlpha * 0.16})`;
              ctx.lineWidth = 3;
              ctx.stroke();
            }
            ctx.strokeStyle = `rgba(34, 54, 100, ${Math.min(0.62, lineAlpha * 0.85)})`;
            ctx.lineWidth = item.alignment > 0.3 ? 1.1 : 0.8;
            ctx.stroke();
          }
        }

        // 2. Draw Stars
        for (let s = 0; s < starCoords.length; s++) {
          const star = starCoords[s];
          const baseStarAlpha = Math.min(
            1,
            Math.max(0.38, 1 - star.mag * 0.11 + twinkle + emphasis * 0.25)
          );

          if (skySkin) {
            const skinPulse = reducedMotion.matches
              ? 1
              : 0.92 + Math.sin(elapsedSeconds * 1.5 + s * 1.5 + i * 2.2) * 0.08;
            drawSkinStar(ctx, skySkin, isDark, star, s, i, item.alignment, baseStarAlpha, skinPulse);
          } else if (isToy) {
            const starPulse = reducedMotion.matches
              ? 1
              : 0.94 + Math.sin(elapsedSeconds * 1.6 + s * 1.4 + i * 2.1) * 0.08;
            const outerR = isDark
              ? Math.max(4.2, star.projectedRadius * 2.75 * starPulse * (1 + item.alignment * 0.22))
              : Math.max(2.9, star.projectedRadius * 1.85 * starPulse * (1 + item.alignment * 0.22));
            const innerR = outerR * 0.52;
            const lipOffset = isDark
              ? Math.max(1.8, outerR * 0.32)
              : Math.max(1.05, outerR * 0.24);

            let starFill = isDark ? '#facc15' : '#f59e0b'; // Richer gold in daylight so it stands out on light sky
            if (star.color === 'blue') starFill = isDark ? '#38bdf8' : '#0ea5e9';
            else if (star.color === 'warm') starFill = isDark ? '#fb923c' : '#f97316';
            else if ((s + i) % 4 === 1) starFill = isDark ? '#fb7185' : '#f43f5e';
            else if ((s + i) % 4 === 2) starFill = isDark ? '#4ade80' : '#22c55e';
            if (item.alignment > 0.35) starFill = isDark ? '#fde047' : '#facc15';

            ctx.save();
            ctx.globalAlpha = isDark
              ? Math.min(1, Math.max(0.75, baseStarAlpha + 0.3))
              : Math.min(0.96, Math.max(0.70, baseStarAlpha * 0.88 + emphasis * 0.28));
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';

            // 1. 3D Toy Star Bottom Lip Shadow
            traceToyStarPath(star.sx, star.sy + lipOffset, outerR, innerR);
            ctx.fillStyle = isDark ? '#0f172a' : 'rgba(15, 23, 42, 0.42)';
            ctx.strokeStyle = isDark ? '#0f172a' : 'rgba(15, 23, 42, 0.42)';
            ctx.lineWidth = isDark ? 2.2 : 1.2;
            ctx.fill();
            ctx.stroke();

            // 2. Main Plump 5-Pointed Toy Star
            traceToyStarPath(star.sx, star.sy, outerR, innerR);
            ctx.fillStyle = starFill;
            ctx.strokeStyle = isDark ? '#0f172a' : 'rgba(15, 23, 42, 0.72)';
            ctx.lineWidth = isDark ? 2.0 : 1.25;
            ctx.fill();
            ctx.stroke();

            // 3. Cute Specular Toy Shine Dot (in Day mode; in Dark mode drawn after inner line if aligned)
            if ((!isDark || item.alignment === 0) && outerR >= (isDark ? 5.2 : 3.5)) {
              ctx.beginPath();
              ctx.arc(star.sx - outerR * 0.18, star.sy - outerR * 0.18, Math.max(0.95, outerR * 0.15), 0, Math.PI * 2);
              ctx.fillStyle = '#ffffff';
              ctx.fill();
            }
            ctx.restore();
          } else if (isDark) {
            // Night Mode: Diamond-white and champagne starlight over deep dark graphite
            let r = 248, g = 250, b = 255;
            let haloR = 210, haloG = 230, haloB = 255;

            if (star.color === 'warm') {
              r = 255; g = 231; b = 186;
              haloR = 248; haloG = 220; haloB = 161;
            } else if (star.color === 'blue') {
              r = 215; g = 238; b = 255;
              haloR = 165; haloG = 215; haloB = 255;
            }

            const fillStar = `rgba(${r}, ${g}, ${b}, ${baseStarAlpha})`;

            if (star.mag < 2.0) {
              const haloRadius = star.projectedRadius * (2.8 + item.alignment * 0.8);
              const halo = ctx.createRadialGradient(star.sx, star.sy, 0, star.sx, star.sy, haloRadius);
              const haloAlpha = 0.35 + item.alignment * 0.25;
              halo.addColorStop(0, `rgba(${haloR}, ${haloG}, ${haloB}, ${Math.min(0.75, haloAlpha)})`);
              halo.addColorStop(0.45, `rgba(${haloR}, ${haloG}, ${haloB}, ${Math.min(0.35, haloAlpha * 0.45)})`);
              halo.addColorStop(1, `rgba(${haloR}, ${haloG}, ${haloB}, 0)`);
              ctx.beginPath();
              ctx.arc(star.sx, star.sy, haloRadius, 0, Math.PI * 2);
              ctx.fillStyle = halo;
              ctx.fill();
            }

            ctx.beginPath();
            ctx.arc(star.sx, star.sy, Math.max(0.9, star.projectedRadius), 0, Math.PI * 2);
            ctx.fillStyle = fillStar;
            ctx.fill();

            if (star.mag < 2.6) {
              ctx.beginPath();
              ctx.arc(star.sx, star.sy, Math.max(0.5, star.projectedRadius * 0.44), 0, Math.PI * 2);
              const coreColor = star.color === 'warm'
                ? `rgba(255, 244, 185, ${Math.min(1, baseStarAlpha + 0.3)})`
                : `rgba(255, 255, 255, ${Math.min(1, baseStarAlpha + 0.35)})`;
              ctx.fillStyle = coreColor;
              ctx.fill();
            }
          } else {
            // Day Mode: printed star-atlas ink on a pale sky (navy, bronze, cobalt)
            let r = 30, g = 46, b = 88;
            let glintR = 44, glintG = 66, glintB = 118;
            let haloR = 72, haloG = 102, haloB = 160;

            if (star.color === 'warm') {
              r = 138; g = 86; b = 26;
              glintR = 160; glintG = 104; glintB = 38;
              haloR = 196; haloG = 140; haloB = 64;
            } else if (star.color === 'blue') {
              r = 38; g = 84; b = 152;
              glintR = 52; glintG = 100; glintB = 170;
              haloR = 86; haloG = 132; haloB = 200;
            }

            const starPulse = reducedMotion.matches
              ? 1
              : 0.88 + Math.sin(elapsedSeconds * 1.5 + s * 1.5 + i * 2.2) * 0.12;
            const radius = Math.max(1.2, star.projectedRadius * 1.08 * starPulse);

            // 1. Soft diffuse halo
            if (star.mag < 2.3) {
              const haloRadius = radius * (2.8 + item.alignment * 1.2);
              const halo = ctx.createRadialGradient(star.sx, star.sy, 0, star.sx, star.sy, haloRadius);
              const haloAlpha = (0.12 + item.alignment * 0.12) * starPulse;
              halo.addColorStop(0, `rgba(${haloR}, ${haloG}, ${haloB}, ${haloAlpha})`);
              halo.addColorStop(0.45, `rgba(${haloR}, ${haloG}, ${haloB}, ${haloAlpha * 0.42})`);
              halo.addColorStop(1, `rgba(${haloR}, ${haloG}, ${haloB}, 0)`);
              ctx.beginPath();
              ctx.arc(star.sx, star.sy, haloRadius, 0, Math.PI * 2);
              ctx.fillStyle = halo;
              ctx.fill();
            }

            // 2. Slender, needle-fine 4-pointed Celestial Diamond Glint (✦) for major stars
            if (star.mag < 2.15) {
              const spikeLen = radius * (1.70 + item.alignment * 0.95 + (starPulse - 0.88) * 1.8);
              const waist = Math.max(0.32, radius * 0.18);
              const glintAlpha = Math.min(0.5, (0.2 + item.alignment * 0.28) * starPulse);
              ctx.beginPath();
              ctx.moveTo(star.sx, star.sy - spikeLen);
              ctx.quadraticCurveTo(star.sx + waist, star.sy - waist, star.sx + spikeLen, star.sy);
              ctx.quadraticCurveTo(star.sx + waist, star.sy + waist, star.sx, star.sy + spikeLen);
              ctx.quadraticCurveTo(star.sx - waist, star.sy + waist, star.sx - spikeLen, star.sy);
              ctx.quadraticCurveTo(star.sx - waist, star.sy - waist, star.sx, star.sy - spikeLen);
              ctx.closePath();
              ctx.fillStyle = `rgba(${glintR}, ${glintG}, ${glintB}, ${glintAlpha})`;
              ctx.fill();
            }

            // 3. Crisp solid star disc (anchors the glint)
            ctx.beginPath();
            ctx.arc(star.sx, star.sy, radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(0.92, baseStarAlpha + 0.22)})`;
            ctx.fill();
          }
        }

        if (isToy && isDark && item.alignment > 0) {
          ctx.save();
          ctx.globalAlpha = Math.min(1, item.alignment * 0.92);
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.setLineDash([]);
          traceConstellationLines();
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 2.2;
          ctx.stroke();

          for (let s = 0; s < starCoords.length; s++) {
            const star = starCoords[s];
            const baseStarAlpha = Math.min(
              1,
              Math.max(0.38, 1 - star.mag * 0.11 + twinkle + emphasis * 0.25)
            );
            const starPulse = reducedMotion.matches
              ? 1
              : 0.94 + Math.sin(elapsedSeconds * 1.6 + s * 1.4 + i * 2.1) * 0.08;
            const outerR = Math.max(4.2, star.projectedRadius * 2.75 * starPulse * (1 + item.alignment * 0.22));
            const innerR = outerR * 0.52;

            let starFill = '#facc15';
            if (star.color === 'blue') starFill = '#38bdf8';
            else if (star.color === 'warm') starFill = '#fb923c';
            else if ((s + i) % 4 === 1) starFill = '#fb7185';
            else if ((s + i) % 4 === 2) starFill = '#4ade80';
            if (item.alignment > 0.35) starFill = '#fde047';

            ctx.globalAlpha = Math.min(1, Math.max(0.75, baseStarAlpha + 0.3));
            // Re-fill only the delicate visible interior (inside the 2.0px #0f172a stroke) so the line endpoint
            // tucks cleanly underneath the star without any #0f172a gap cutting the line.
            traceToyStarPath(star.sx, star.sy, Math.max(1.8, outerR - 1.35), Math.max(1.0, innerR - 1.0));
            ctx.fillStyle = starFill;
            ctx.fill();

            if (outerR >= 5.2) {
              ctx.beginPath();
              ctx.arc(star.sx - outerR * 0.18, star.sy - outerR * 0.18, Math.max(0.95, outerR * 0.15), 0, Math.PI * 2);
              ctx.fillStyle = '#ffffff';
              ctx.fill();
            }
          }
          ctx.restore();
        }

      }

      ctx.globalAlpha = 1;
      if (highestAlignment > 0.15 && bestItem && !interactionBlocked && floatingBadgeRef?.current && badgeTextRef?.current) {
        const data = bestItem.data;
        const labelText = isHebrew ? data.nameHe : data.nameEn;
        if (badgeTextRef.current.textContent !== labelText) {
          badgeTextRef.current.textContent = labelText;
        }
        const position = placeConstellationLabel(bestBounds, badgeTextRef.current.offsetWidth,
          badgeTextRef.current.offsetHeight, width, height, obstacles);
        if (position) {
          const alpha = Math.min(1, Math.max(0, (highestAlignment - 0.15) / 0.55));
          floatingBadgeRef.current.style.opacity = alpha.toFixed(2);
          floatingBadgeRef.current.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
        } else hideBadge();
      } else if (floatingBadgeRef?.current) {
        floatingBadgeRef.current.style.opacity = '0';
      }

      if (!reducedMotion.matches) schedule();
    }

    handleResize();
    window.addEventListener('chronix:visual-theme-change', schedule);

    return () => {
      disposed = true;
      requestObstaclesRef.current = null;
      cancelAnimationFrame(animationFrameId);
      cancelAnimationFrame(obstacleFrame);
      if (pinTimeoutId) clearTimeout(pinTimeoutId);
      if (floatingBadgeRef?.current) floatingBadgeRef.current.style.opacity = '0';
      window.removeEventListener('chronix:visual-theme-change', schedule);
      window.removeEventListener('pointermove', handlePointerMove);
      document.documentElement.removeEventListener('pointerleave', handlePointerLeave);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', cancelTouch);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('focusin', handleFocus);
      document.removeEventListener('focusout', handleFocusOut);
      document.removeEventListener('scroll', requestObstacles, true);
      reducedMotion.removeEventListener('change', handleVisibilityChange);
    };
  }, []);

  return <canvas ref={canvasRef} data-constellation-sky className="ambient-particles-canvas select-none pointer-events-none" />;
});

/**
 * Top-tier Living Ambient Canvas Background
 * Supports 3 distinctive aesthetic modes in night mode,
 * and adaptive daylight-optimized alternatives in day mode.
 */
const defaultDayMode = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_DAY_BACKGROUND)
  ? import.meta.env.VITE_DAY_BACKGROUND.toLowerCase()
  : 'constellations';

function AmbientAuraBackground({ mode = 'particles', dayMode = defaultDayMode }) {
  const containerRef = useRef(null);
  const floatingBadgeRef = useRef(null);
  const badgeTextRef = useRef(null);
  const rafRef = useRef(null);

  // Reactive theme tracking
  const [isDark, setIsDark] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    return false;
  });

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  // Safely get active language
  let langContext = null;
  try {
    langContext = useLanguage();
  } catch (e) {}
  const language = langContext?.language || (typeof document !== 'undefined' ? document.documentElement.lang : 'en');
  const isRtl = langContext?.isRtl ?? (language === 'he');

  useEffect(() => {
    if (mode === 'particles') return;

    const el = containerRef.current;
    if (!el) return;

    let targetX = 50;
    let targetY = 32;
    let currentX = 50;
    let currentY = 32;

    const handlePointerMove = (e) => {
      if (e.pointerType === 'touch') return;
      targetX = (e.clientX / window.innerWidth) * 100;
      targetY = (e.clientY / window.innerHeight) * 100;
    };

    let active = true;
    const updateLoop = () => {
      if (!active) return;
      currentX += (targetX - currentX) * 0.08;
      currentY += (targetY - currentY) * 0.08;
      el.style.setProperty('--mouse-x', `${currentX.toFixed(2)}%`);
      el.style.setProperty('--mouse-y', `${currentY.toFixed(2)}%`);
      rafRef.current = requestAnimationFrame(updateLoop);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    rafRef.current = requestAnimationFrame(updateLoop);

    return () => {
      active = false;
      window.removeEventListener('pointermove', handlePointerMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [mode]);

  return (
    <>
      <div
        ref={containerRef}
        aria-hidden="true"
        data-home-ambient={mode === 'particles' ? (isDark ? 'night' : dayMode) : undefined}
        className="ambient-aurora-wrap select-none pointer-events-none transition-opacity duration-500"
        style={{ '--mouse-x': '50%', '--mouse-y': '32%' }}
      >
        {/* ── Mode 1: The Architectural Time-Grid & Focal Glow ── */}
        {mode === 'grid' && (
          <>
            <div className="ambient-hero-focal" />
            <div className="ambient-cursor-spotlight" />
          </>
        )}

        {/* ── Mode 2: Deep Atmospheric Aurora ── */}
        {mode === 'aurora' && (
          <>
            <div className="ambient-aurora-orb ambient-aurora-orb-1" />
            <div className="ambient-aurora-orb ambient-aurora-orb-2" />
            <div className="ambient-aurora-orb ambient-aurora-orb-3" />
            <div className="ambient-cursor-spotlight" style={{ opacity: 0.6 }} />
          </>
        )}

        {/* ── Mode 3: Dynamic Astronomical or Daylight Aesthetic ── */}
        {mode === 'particles' && (
          <>
            {dayMode === 'topo' && !isDark ? (
              <TopographicBackground language={language} />
            ) : (
              <AstronomicalConstellationsCanvas
                language={language}
                isRtl={isRtl}
                floatingBadgeRef={floatingBadgeRef}
                badgeTextRef={badgeTextRef}
              />
            )}
          </>
        )}
      </div>

      {/* Top-Level Floating Badge for Constellations */}
      {mode === 'particles' && (isDark || dayMode === 'constellations') && (
        <div
          ref={floatingBadgeRef}
          aria-hidden="true"
          className="fixed pointer-events-none z-40 select-none will-change-transform opacity-0 transition-opacity duration-150"
          style={{ top: 0, left: 0, transform: 'translate3d(-9999px, -9999px, 0)' }}
        >
          <div
            ref={badgeTextRef}
            className="constellation-floating-badge px-3 py-1 rounded-full text-[11.5px] font-semibold tracking-wide whitespace-nowrap"
          />
        </div>
      )}
    </>
  );
}

export default memo(AmbientAuraBackground);
