import { memo, useEffect, useRef } from 'react';
import {
  createTerrainModel, createTerrainFrames, sampleGridElevation, extractTerrainContours,
  extractLakeContours, sampleLakeLevels, quietAreaWeight, findTerrainSummits,
} from '../utils/topographicTerrain';
import { createTopographicRenderer } from '../utils/topographicRenderer';

const PALETTE = {
  paper: [249, 251, 248],
  lowland: [241, 246, 237],
  highland: [218, 228, 216],
  contour: 'rgba(83, 108, 91, 0.21)',
  index: 'rgba(65, 88, 76, 0.46)',
  ink: '#53685d',
  shore: 'rgba(62, 124, 131, 0.65)',
};
const BLOCKED_TARGET = 'button, a, input, textarea, select, [role="button"], [role="dialog"], [role="menu"], [data-topo-quiet]';
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function contourPath(geometry, cellSize) {
  const path = new Path2D();
  for (const polygon of geometry.coordinates) {
    for (const ring of polygon) {
      ring.forEach(([pointX, pointY], index) => {
        const pixelX = (pointX - 0.5) * cellSize;
        const pixelY = (pointY - 0.5) * cellSize;
        if (index === 0) path.moveTo(pixelX, pixelY);
        else path.lineTo(pixelX, pixelY);
      });
      path.closePath();
    }
  }
  return path;
}

function drawRelief(context, surface, grid, width, height) {
  const { values, columns, rows, cellSize } = grid;
  if (surface.width !== columns || surface.height !== rows) {
    surface.width = columns;
    surface.height = rows;
  }
  const surfaceContext = surface.getContext('2d');
  const image = surfaceContext.createImageData(columns, rows);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      const elevation = values[index];
      const gradientX = (values[row * columns + Math.min(columns - 1, column + 1)]
        - values[row * columns + Math.max(0, column - 1)]) / (cellSize * 9);
      const gradientY = (values[Math.min(rows - 1, row + 1) * columns + column]
        - values[Math.max(0, row - 1) * columns + column]) / (cellSize * 9);
      const light = (gradientX * 0.55 + gradientY * 0.55 + 0.63)
        / Math.sqrt(1 + gradientX ** 2 + gradientY ** 2);
      const shade = (light - 0.63) * 39;
      const altitude = clamp((elevation - 195) / 320, 0, 1);
      const quiet = grid.quietWeights[index] * 0.76;
      for (let channel = 0; channel < 3; channel++) {
        const land = PALETTE.lowland[channel] * (1 - altitude) + PALETTE.highland[channel] * altitude + shade;
        image.data[index * 4 + channel] = land * (1 - quiet) + PALETTE.paper[channel] * quiet;
      }
      image.data[index * 4 + 3] = 255;
    }
  }
  surfaceContext.putImageData(image, 0, 0);
  context.drawImage(surface, -cellSize / 2, -cellSize / 2, columns * cellSize, rows * cellSize);
}

function drawLake(context, surface, grid, lake, path, width, height, time) {
  const { columns, rows, values, cellSize } = grid;
  const surfaceContext = surface.getContext('2d');
  const image = surfaceContext.createImageData(columns, rows);
  for (let index = 0; index < values.length; index++) {
    const depth = clamp((lake.level - values[index]) / 85, 0, 1) ** 0.65;
    image.data[index * 4] = 208 - depth * 78;
    image.data[index * 4 + 1] = 231 - depth * 44;
    image.data[index * 4 + 2] = 227 - depth * 34;
    image.data[index * 4 + 3] = 255;
  }
  surfaceContext.putImageData(image, 0, 0);
  context.save();
  context.clip(path, 'evenodd');
  context.drawImage(surface, -cellSize / 2, -cellSize / 2, columns * cellSize, rows * cellSize);
  context.lineWidth = 0.7;
  context.strokeStyle = 'rgba(246, 255, 250, 0.32)';
  context.beginPath();
  for (let row = 0; row < height / 17; row++) {
    const pixelY = row * 17 + Math.sin(time * 0.48 + row * 1.9) * 2;
    for (let column = 0; column < width / 43; column++) {
      const pixelX = column * 43 + Math.sin(row * 7.3) * 21 + Math.sin(time * 0.23 + column) * 4;
      context.moveTo(pixelX, pixelY);
      context.lineTo(pixelX + 8 + Math.sin(row + column) * 4, pixelY - 1.2);
    }
  }
  context.stroke();
  context.restore();
  context.strokeStyle = 'rgba(248, 253, 246, 0.75)';
  context.lineWidth = 3;
  context.stroke(path);
  context.strokeStyle = PALETTE.shore;
  context.lineWidth = 0.9;
  context.stroke(path);
}

function drawContourLabels(context, geometries, cellSize, width, height, grid) {
  const placed = [];
  const mobile = width < 768;
  context.font = 'italic 10px Georgia, serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  for (const geometry of geometries) {
    if (geometry.value % 100 !== 0) continue;
    for (const polygon of geometry.coordinates) {
      const ring = polygon[0];
      if (ring.length * cellSize < 320) continue;
      for (const fraction of [0.19, 0.57, 0.83]) {
        if (placed.length >= (mobile ? 4 : 9)) break;
        const index = Math.floor((ring.length - 1) * fraction);
        const [pointX, pointY] = ring[index];
        let pixelX = (pointX - 0.5) * cellSize;
        let pixelY = (pointY - 0.5) * cellSize;
        for (let iteration = 0; iteration < 3; iteration++) {
          const difference = sampleGridElevation(grid, pixelX, pixelY) - geometry.value;
          const gradientX = (sampleGridElevation(grid, pixelX + 2, pixelY) - sampleGridElevation(grid, pixelX - 2, pixelY)) / 4;
          const gradientY = (sampleGridElevation(grid, pixelX, pixelY + 2) - sampleGridElevation(grid, pixelX, pixelY - 2)) / 4;
          const lengthSquared = gradientX * gradientX + gradientY * gradientY;
          if (lengthSquared < 0.001) break;
          pixelX -= clamp(difference * gradientX / lengthSquared, -12, 12);
          pixelY -= clamp(difference * gradientY / lengthSquared, -12, 12);
        }
        if (Math.abs(sampleGridElevation(grid, pixelX, pixelY) - geometry.value) > 1) continue;
        if (pixelX < 30 || pixelX > width - 30 || pixelY < 30 || pixelY > height - 30) continue;
        if (quietAreaWeight(pixelX / width, pixelY / height) > 0.12) continue;
        if (placed.some(point => Math.hypot(point.x - pixelX, point.y - pixelY) < 145)) continue;
        const before = ring[Math.max(0, index - 3)];
        const after = ring[Math.min(ring.length - 1, index + 3)];
        let angle = Math.atan2(after[1] - before[1], after[0] - before[0]);
        if (angle > Math.PI / 2) angle -= Math.PI;
        if (angle < -Math.PI / 2) angle += Math.PI;
        context.save();
        context.translate(pixelX, pixelY);
        context.rotate(angle);
        context.lineJoin = 'round';
        context.strokeStyle = 'rgba(244, 248, 240, 0.94)';
        context.lineWidth = 4;
        context.strokeText(`${geometry.value}`, 0, 0);
        context.fillStyle = PALETTE.ink;
        context.fillText(`${geometry.value}`, 0, 0);
        context.restore();
        placed.push({ x: pixelX, y: pixelY });
      }
    }
  }
}

let persistentTopoTime = 0;

export default memo(function TopographicBackground({ language = 'en' }) {
  const canvasRef = useRef(null);
  const terrainCanvasRef = useRef(null);
  const languageRef = useRef(language);
  languageRef.current = language;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!context) return undefined;
    const terrainCanvas = terrainCanvasRef.current;
    const renderer = createTopographicRenderer(terrainCanvas);
    const surface = document.createElement('canvas');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let animationFrame = 0;
    let lastFrame = 0;
    let time = persistentTopoTime;
    let terrainFrame = null;
    let labelGeometries = null;
    let disposed = false;
    let pointer = { x: 0, y: 0, targetX: 0, targetY: 0, strength: 0, active: false, pressed: false };
    let touchRelease = 0;
    let activeTouchId = null;

    const schedule = () => {
      if (!animationFrame && !disposed && !document.hidden) animationFrame = requestAnimationFrame(render);
    };

    function render(now) {
      animationFrame = 0;
      if (disposed || (document.hidden && lastFrame)) return;
      const frameInterval = 1000 / (renderer && activeTouchId !== null ? 60 : 30);
      if (!reducedMotion.matches && lastFrame && now - lastFrame < frameInterval - 0.8) {
        schedule();
        return;
      }
      const elapsed = lastFrame ? Math.min((now - lastFrame) / 1000, 0.08) : 1 / 30;
      lastFrame = now;
      if (!reducedMotion.matches) {
        time += elapsed * 0.65;
        persistentTopoTime = time;
      }
      const ease = 1 - Math.exp(-elapsed * (activeTouchId !== null ? 18 : 8));
      pointer.x += (pointer.targetX - pointer.x) * ease;
      pointer.y += (pointer.targetY - pointer.y) * ease;
      const targetStrength = reducedMotion.matches ? 0 : pointer.active ? (pointer.pressed ? -78 : 48) : 0;
      pointer.strength += (targetStrength - pointer.strength) * ease;
      const model = createTerrainModel(width, height, time);
      const grid = terrainFrame(time, { ...pointer, radius: clamp(width * 0.115, 90, 155) });
      const { cellSize } = grid;
      if (!labelGeometries) labelGeometries = extractTerrainContours(grid);
      const waterLevels = sampleLakeLevels(grid, model);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);
      const accelerated = renderer?.draw(grid, waterLevels, width, height, pixelRatio, time);
      terrainCanvas.style.visibility = accelerated ? 'visible' : 'hidden';
      if (!accelerated) {
        const geometries = extractTerrainContours(grid);
        const lakes = extractLakeContours(grid, model);
        drawRelief(context, surface, grid, width, height);
        context.lineJoin = 'round';
        for (const geometry of geometries) {
          context.strokeStyle = geometry.value % 100 === 0 ? PALETTE.index : PALETTE.contour;
          context.lineWidth = geometry.value % 100 === 0 ? 1.05 : 0.6;
          context.stroke(contourPath(geometry, cellSize));
        }
        for (const lake of lakes) {
          if (lake.coordinates.length) {
            drawLake(context, surface, grid, lake, contourPath(lake, cellSize), width, height, time);
          }
        }
      }
      drawContourLabels(context, labelGeometries, cellSize, width, height, grid);

      context.font = '500 10px "IBM Plex Mono", monospace';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      for (const peak of findTerrainSummits(grid, width, height)) {
        context.beginPath();
        context.moveTo(peak.x, peak.y - 4);
        context.lineTo(peak.x + 3.8, peak.y + 3);
        context.lineTo(peak.x - 3.8, peak.y + 3);
        context.closePath();
        context.strokeStyle = 'rgba(249, 251, 248, 0.92)';
        context.lineWidth = 2.5;
        context.stroke();
        context.fillStyle = PALETTE.ink;
        context.fill();
        const label = `${Math.round(peak.elevation)} m`;
        context.lineWidth = 3;
        context.strokeText(label, peak.x, peak.y + 14);
        context.fillText(label, peak.x, peak.y + 14);
      }

      context.strokeStyle = 'rgba(85, 113, 99, 0.16)';
      context.lineWidth = 0.6;
      context.beginPath();
      for (let pixelX = 38; pixelX < width; pixelX += 160) {
        for (let pixelY = 38; pixelY < height; pixelY += 160) {
          if (quietAreaWeight(pixelX / width, pixelY / height) > 0.2) continue;
          context.moveTo(pixelX - 2, pixelY);
          context.lineTo(pixelX + 2, pixelY);
          context.moveTo(pixelX, pixelY - 2);
          context.lineTo(pixelX, pixelY + 2);
        }
      }
      context.stroke();

      if (pointer.active) {
        const elevation = sampleGridElevation(grid, pointer.x, pointer.y);
        const waterColumn = clamp(Math.floor(pointer.x / cellSize), 0, grid.columns - 2);
        const waterRow = clamp(Math.floor(pointer.y / cellSize), 0, grid.rows - 2);
        const waterIndex = waterRow * grid.columns + waterColumn;
        const waterLevel = Math.max(waterLevels[waterIndex], waterLevels[waterIndex + 1],
          waterLevels[waterIndex + grid.columns], waterLevels[waterIndex + grid.columns + 1]);
        const water = elevation < waterLevel ? { level: waterLevel } : null;
        const isRtl = languageRef.current === 'he';
        const label = water
          ? `${water.level} m · ${Math.max(0, Math.round(water.level - elevation))} m ${isRtl ? 'עומק' : 'depth'}`
          : `${Math.round(elevation)} m`;
        context.strokeStyle = water ? PALETTE.shore : PALETTE.ink;
        context.lineWidth = 0.8;
        context.beginPath();
        context.arc(pointer.x, pointer.y, 4, 0, Math.PI * 2);
        context.moveTo(pointer.x - 10, pointer.y);
        context.lineTo(pointer.x - 6, pointer.y);
        context.moveTo(pointer.x + 6, pointer.y);
        context.lineTo(pointer.x + 10, pointer.y);
        context.stroke();
        context.font = '500 10px "IBM Plex Mono", monospace';
        const textWidth = context.measureText(label).width;
        const labelX = clamp(pointer.x + 17, 12, width - textWidth - 12);
        const labelY = clamp(pointer.y - 13, 16, height - 16);
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.direction = isRtl ? 'rtl' : 'ltr';
        context.strokeStyle = 'rgba(249, 251, 248, 0.95)';
        context.lineWidth = 4;
        context.strokeText(label, labelX, labelY);
        context.fillStyle = PALETTE.ink;
        context.fillText(label, labelX, labelY);
        context.direction = 'ltr';
      }
      if (!reducedMotion.matches) schedule();
    }

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      terrainCanvas.width = canvas.width;
      terrainCanvas.height = canvas.height;
      terrainFrame = createTerrainFrames(width, height, Math.max(4, Math.sqrt(width * height / (renderer ? 32000 : 14000))), time);
      labelGeometries = null;
      cancelAnimationFrame(animationFrame);
      lastFrame = 0;
      render(performance.now());
    };
    const updatePointer = event => {
      if (event.target instanceof Element && event.target.closest(BLOCKED_TARGET)) {
        pointer.active = false;
        pointer.pressed = false;
        schedule();
        return;
      }
      const bounds = canvas.getBoundingClientRect();
      const nextX = event.clientX - bounds.left;
      const nextY = event.clientY - bounds.top;
      if (!pointer.active) {
        pointer.x = nextX;
        pointer.y = nextY;
      }
      pointer.targetX = nextX;
      pointer.targetY = nextY;
      pointer.active = nextX >= 0 && nextX <= width && nextY >= 0 && nextY <= height;
      schedule();
    };
    const pointerMove = event => {
      if (event.pointerType !== 'touch') updatePointer(event);
    };
    const pointerDown = event => {
      if (event.button !== 0 || event.pointerType === 'touch') return;
      updatePointer(event);
      pointer.pressed = pointer.active;
    };
    const pointerUp = event => {
      if (event.pointerType === 'touch') return;
      pointer.pressed = false;
      schedule();
    };
    const touchStart = event => {
      clearTimeout(touchRelease);
      if (event.touches.length !== 1 || (event.target instanceof Element && event.target.closest(BLOCKED_TARGET))) {
        activeTouchId = null;
        pointer.active = false;
        return;
      }
      activeTouchId = event.touches[0].identifier;
      pointer.pressed = false;
      updatePointer(event.touches[0]);
    };
    const touchMove = event => {
      if (activeTouchId === null) return;
      if (event.touches.length !== 1) {
        activeTouchId = null;
        pointer.active = false;
        schedule();
        return;
      }
      const touch = Array.from(event.touches).find(item => item.identifier === activeTouchId);
      if (touch) updatePointer(touch);
    };
    const touchEnd = event => {
      if (activeTouchId === null || Array.from(event.touches).some(item => item.identifier === activeTouchId)) return;
      activeTouchId = null;
      touchRelease = window.setTimeout(() => { pointer.active = false; schedule(); }, 500);
    };
    const leave = () => {
      activeTouchId = null;
      pointer.active = false;
      pointer.pressed = false;
      schedule();
    };
    const pointerLeave = () => {
      if (activeTouchId === null) leave();
    };
    const visibility = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      lastFrame = 0;
      leave();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    window.addEventListener('pointermove', pointerMove, { passive: true });
    window.addEventListener('pointerdown', pointerDown, { passive: true });
    window.addEventListener('pointerup', pointerUp, { passive: true });
    window.addEventListener('touchstart', touchStart, { passive: true });
    window.addEventListener('touchmove', touchMove, { passive: true });
    window.addEventListener('touchend', touchEnd, { passive: true });
    window.addEventListener('touchcancel', leave, { passive: true });
    window.addEventListener('blur', leave);
    window.addEventListener('resize', resize, { passive: true });
    document.documentElement.addEventListener('pointerleave', pointerLeave, { passive: true });
    document.addEventListener('visibilitychange', visibility);
    reducedMotion.addEventListener('change', visibility);

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      clearTimeout(touchRelease);
      observer.disconnect();
      renderer?.dispose();
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerdown', pointerDown);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('touchstart', touchStart);
      window.removeEventListener('touchmove', touchMove);
      window.removeEventListener('touchend', touchEnd);
      window.removeEventListener('touchcancel', leave);
      window.removeEventListener('blur', leave);
      window.removeEventListener('resize', resize);
      document.documentElement.removeEventListener('pointerleave', pointerLeave);
      document.removeEventListener('visibilitychange', visibility);
      reducedMotion.removeEventListener('change', visibility);
    };
  }, []);

  return <>
    <canvas ref={terrainCanvasRef} aria-hidden="true" data-topographic-surface className="ambient-particles-canvas select-none pointer-events-none" />
    <canvas ref={canvasRef} aria-hidden="true" data-topographic-background className="ambient-particles-canvas select-none pointer-events-none" />
  </>;
});