// Non-outer zones use evenly spaced orbit slots (360/26 deg) at radius 0.93; the
// 4 outer/corner zones (indices 17-20) are fixed anchors the tests rely on by index.
const DESKTOP_ZONES = [
  [0.119, 0.48, 1.15, 1], [0.215, 0.714, 0.82, 0.72],
  [0.87, 0.565, 1.12, 0.94], [0.635, 0.81, 0.82, 0.64],
  [0.283, 0.771, 0.77, 0.62], [0.365, 0.15, 0.62, 0.46],
  [0.785, 0.714, 0.85, 0.72], [0.785, 0.246, 0.80, 0.64],
  [0.454, 0.129, 0.66, 0.50], [0.87, 0.395, 1.03, 0.88],
  [0.162, 0.316, 0.96, 0.86], [0.635, 0.15, 0.77, 0.62],
  [0.717, 0.189, 0.64, 0.52], [0.283, 0.189, 0.83, 0.72],
  [0.717, 0.771, 0.62, 0.62], [0.838, 0.316, 0.61, 0.42],
  [0.881, 0.48, 0.60, 0.42],
  [0.94, 0.12, 0.92, 0.82, 0, true],
  [0.06, 0.12, 0.92, 0.80, 0, true],
  [0.94, 0.90, 0.90, 0.78, 0, true],
  [0.06, 0.90, 0.90, 0.78, 0, true],
  [0.13, 0.395, 0.52, 0.72],
  [0.13, 0.565, 0.62, 0.48],
  [0.162, 0.644, 0.65, 0.46],
  [0.215, 0.246, 0.60, 0.44],
  [0.546, 0.831, 0.68, 0.50],
  [0.365, 0.81, 0.64, 0.46],
  [0.546, 0.129, 0.62, 0.48],
  [0.838, 0.644, 0.52, 0.38],
  [0.454, 0.831, 0.75, 0.55],
];

// Evenly spaced orbit slots (360/26 deg), alternating inner ring and outer corner-hugging path.
const MOBILE_ZONES = {
  0: [0.458, 0.163, 0.97, 1],
  1: [0.195, 0.628, 0.71, 0.72],
  2: [0.834, 0.556, 0.76, 0.82],
  3: [0.458, 0.797, 0.77, 0.62],
  7: [0.195, 0.332, 0.73, 0.60],
  9: [0.758, 0.268, 0.94, 0.88],
  10: [0.156, 0.48, 0.60, 0.60],
  11: [0.622, 0.778, 0.42, 0.68],
  12: [0.863, 0.657, 0.54, 0.50, 0, true],
  13: [0.863, 0.303, 0.34, 0.42, 0, true],
  14: [0.549, 0.857, 0.50, 0.55, 0, true],
  15: [0.733, 0.793, 0.43, 0.40, 0, true],
  16: [0.549, 0.103, 0.35, 0.44, 0, true],
  17: [0.758, 0.692, 0.46, 0.44],
  18: [0.91, 0.48, 0.39, 0.46, 0, true],
  19: [0.102, 0.571, 0.38, 0.46, 0, true],
  20: [0.834, 0.404, 0.38, 0.44],
  21: [0.355, 0.835, 0.35, 0.42, 0, true],
  22: [0.622, 0.182, 0.46, 0.36],
  23: [0.193, 0.228, 0.48, 0.34, 0, true],
  24: [0.733, 0.167, 0.40, 0.28, 0, true],
  25: [0.304, 0.743, 0.44, 0.32],
  26: [0.304, 0.217, 0.40, 0.28],
  27: [0.355, 0.125, 0.34, 0.26, 0, true],
  28: [0.102, 0.389, 0.40, 0.30, 0, true],
  29: [0.193, 0.732, 0.40, 0.30, 0, true],
};

export function getZone(index, width) {
  const desktop = DESKTOP_ZONES[index];
  const zone = width < 768 ? MOBILE_ZONES[index] : desktop;
  const [anchorX, anchorY, scale, prominence, phaseSeconds = 0, outer = false] = zone || desktop || MOBILE_ZONES[index] || [0.5, 0.5, 0, 0];
  return { anchorX, anchorY, z: scale, prominence, phaseSeconds, outer, visible: Boolean(zone) };
}

export function projectConstellation(data, index, width, height, time = 0, reducedMotion = false) {
  const zone = getZone(index, width);
  const mobile = width < 768;
  const clock = (reducedMotion ? 0 : time) + zone.phaseSeconds;
  const orbitalAngle = clock * Math.PI * 2 / (mobile ? 360 : 300);
  const relativeX = zone.anchorX - 0.5;
  const relativeY = zone.anchorY - 0.48;
  const orbitRadius = Math.min(1, Math.max(0.82, Math.hypot(relativeX / 0.41, relativeY / 0.38)));
  const initialAngle = Math.atan2(relativeY / 0.38, relativeX / 0.41);
  const orbitCosine = Math.cos(initialAngle + orbitalAngle);
  const orbitSine = Math.sin(initialAngle + orbitalAngle);
  const outerRadius = 1 / (orbitCosine ** 4 + orbitSine ** 4) ** 0.25;
  const orbitX = orbitCosine * (zone.outer ? 0.47 * outerRadius : 0.41 * orbitRadius);
  const orbitY = orbitSine * (zone.outer ? 0.44 * outerRadius : 0.38 * orbitRadius);
  const drift = reducedMotion ? 0 : zone.outer ? (mobile ? 3 : 8) : (mobile ? 9 : 20);
  const centerX = (0.5 + orbitX) * width + Math.sin(clock * 0.14 + index * 1.7) * drift;
  const centerY = (0.48 + orbitY) * height + Math.cos(clock * 0.115 + index * 2.3) * drift * 0.7;
  const angle = reducedMotion ? 0 : Math.sin(clock * 0.10 + index * 0.8) * 0.06;
  const breathing = reducedMotion ? 1 : 1 + Math.sin(clock * 0.14 + index) * 0.012;
  const scale = (mobile ? Math.max(62, Math.min(95, width * 0.22)) : Math.max(105, Math.min(175, width * 0.11))) * zone.z * breathing;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const stars = data.stars.map(star => {
    const localX = (star.x - 0.5) * scale * data.width / 160;
    const localY = (star.y - 0.5) * scale * data.height / 160;
    return { ...star, sx: centerX + localX * cosine - localY * sine, sy: centerY + localX * sine + localY * cosine };
  });
  const left = Math.min(...stars.map(star => star.sx));
  const right = Math.max(...stars.map(star => star.sx));
  const top = Math.min(...stars.map(star => star.sy));
  const bottom = Math.max(...stars.map(star => star.sy));
  const offsetX = Math.max(12 - left, Math.min(0, width - 12 - right));
  const offsetY = Math.max(18 - top, Math.min(0, height - 18 - bottom));
  for (const star of stars) {
    star.sx += offsetX;
    star.sy += offsetY;
  }
  return {
    ...zone, stars, centerX: centerX + offsetX, centerY: centerY + offsetY, scale,
    bounds: { left: left + offsetX, right: right + offsetX, top: top + offsetY, bottom: bottom + offsetY },
  };
}

export function createBackgroundStars(width, height) {
  let seed = 81273;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const count = Math.min(180, Math.max(45, Math.round(width * height / 7500)));
  return Array.from({ length: count }, () => {
    const x = random();
    const y = random();
    const centerWeight = Math.exp(-2 * (((x - 0.5) / 0.30) ** 4 + ((y - 0.43) / 0.32) ** 4));
    return {
      x, y, radius: 0.45 + random() * 0.45,
      alpha: (0.10 + random() * 0.17) * (1 - centerWeight * 0.80),
      phase: random() * Math.PI * 2,
    };
  });
}

export function findNearestConstellation(poses, x, y, radius = 76, preferredIndex = -1) {
  let index = -1;
  let distance = radius;
  poses.forEach((pose, poseIndex) => {
    if (!pose) return;
    const starDistance = Math.min(...pose.stars.map(star => Math.hypot(star.sx - x, star.sy - y)));
    const adjustedDistance = starDistance - (poseIndex === preferredIndex ? 7 : 0);
    if (starDistance < radius && adjustedDistance < distance) {
      index = poseIndex;
      distance = adjustedDistance;
    }
  });
  return {
    index,
    distance: index < 0 ? Infinity : Math.min(...poses[index].stars.map(star => Math.hypot(star.sx - x, star.sy - y))),
  };
}

export function placeConstellationLabel(bounds, labelWidth, labelHeight, width, height, obstacles = []) {
  if (labelWidth > width - 20 || labelHeight > height - 20) return null;
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  const candidates = [
    { x: centerX - labelWidth / 2, y: bounds.top - labelHeight - 12 },
    { x: centerX - labelWidth / 2, y: bounds.bottom + 12 },
    { x: bounds.right + 12, y: centerY - labelHeight / 2 },
    { x: bounds.left - labelWidth - 12, y: centerY - labelHeight / 2 },
  ];
  const fit = candidate => {
    const left = Math.max(10, Math.min(width - labelWidth - 10, candidate.x));
    const top = Math.max(10, Math.min(height - labelHeight - 10, candidate.y));
    const right = left + labelWidth;
    const bottom = top + labelHeight;
    if (obstacles.some(rect => left < rect.right + 8 && right > rect.left - 8 && top < rect.bottom + 8 && bottom > rect.top - 8)) return null;
    return { x: left, y: top };
  };
  for (const candidate of candidates) {
    const position = fit(candidate);
    if (position) return position;
  }
  const fallback = [{ x: centerX - labelWidth / 2, y: centerY - labelHeight / 2 }];
  for (const rect of obstacles) {
    const left = rect.left - labelWidth - 9;
    const right = rect.right + 9;
    const top = rect.top - labelHeight - 9;
    const bottom = rect.bottom + 9;
    fallback.push(
      { x: centerX - labelWidth / 2, y: top },
      { x: centerX - labelWidth / 2, y: bottom },
      { x: left, y: centerY - labelHeight / 2 },
      { x: right, y: centerY - labelHeight / 2 },
      { x: left, y: top }, { x: right, y: top },
      { x: left, y: bottom }, { x: right, y: bottom },
    );
  }
  const positions = fallback.map(fit).filter(Boolean);
  positions.sort((first, second) =>
    Math.hypot(first.x + labelWidth / 2 - centerX, first.y + labelHeight / 2 - centerY)
    - Math.hypot(second.x + labelWidth / 2 - centerX, second.y + labelHeight / 2 - centerY));
  if (positions.length) return positions[0];
  return null;
}