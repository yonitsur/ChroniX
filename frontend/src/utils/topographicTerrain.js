import { contours } from 'd3-contour';
import { createNoise2D } from 'simplex-noise';

let seed = 73129;
const noise = createNoise2D(() => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
});

export const CONTOUR_INTERVAL = 20;
export const CONTOUR_LEVELS = Array.from({ length: 24 }, (_, index) => 100 + index * CONTOUR_INTERVAL);
export const LAKES = [
  { x: 0.145, y: 0.69, radiusX: 0.086, radiusY: 0.145, level: 156, depth: 132, bend: 0.48 },
  { x: 0.835, y: 0.735, radiusX: 0.074, radiusY: 0.105, level: 164, depth: 116, bend: -0.62 },
];

const smoothstep = (lower, upper, value) => {
  const fraction = Math.max(0, Math.min(1, (value - lower) / (upper - lower)));
  return fraction * fraction * (3 - 2 * fraction);
};

export function quietAreaWeight(relativeX, relativeY) {
  const dy = (relativeY - 0.46) / (relativeY < 0.46 ? 0.20 : 0.28);
  const dx = (relativeX - 0.5) / 0.285;
  return Math.exp(-1.6 * (dx ** 4 + dy ** 4));
}

export function createTerrainModel(width, height, time = 0, interaction = null) {
  const scale = Math.max(420, Math.min(width, height * 1.35));
  const driftX = Math.sin(time * 0.085) * 0.21;
  const driftY = Math.cos(time * 0.067) * 0.18;
  const breathing = Math.sin(time * 0.16) * 9;

  const sample = (pixelX, pixelY) => {
    const relativeX = pixelX / width;
    const relativeY = pixelY / height;
    const worldX = pixelX / scale;
    const worldY = pixelY / scale;
    const warpX = noise(worldX * 3.1 + driftX, worldY * 3.1 + driftY);
    const warpY = noise(worldX * 3.1 + 19 + driftX, worldY * 3.1 + 7 + driftY);
    const terrainX = relativeX + warpX * 0.026 + Math.sin(time * 0.12 + relativeY * 5) * 0.009;
    const terrainY = relativeY + warpY * 0.025 + Math.cos(time * 0.095 + relativeX * 6) * 0.008;
    const quiet = quietAreaWeight(relativeX, relativeY);
    const broadNoise = noise(worldX * 3.8 + driftX, worldY * 3.8 + driftY);
    const detail = noise(worldX * 12 + warpX * 0.7, worldY * 12 + warpY * 0.7);
    const fine = noise(worldX * 27, worldY * 27);

    const westSpine = 0.085 + 0.12 * Math.sin(terrainY * 5.2 + 0.5)
      + 0.022 * Math.sin(terrainY * 18);
    const westEnvelope = Math.exp(-(((terrainY - 0.12) / 0.41) ** 4));
    const westRelief = Math.exp(-(((terrainX - westSpine) / 0.09) ** 2))
      * westEnvelope * (225 + 48 * noise(terrainY * 9, 1.4));

    const eastSpine = 0.91 - 0.075 * Math.sin(terrainY * 5.6)
      + 0.022 * Math.sin(terrainY * 19 + 1.5);
    const eastEnvelope = Math.exp(-(((terrainY - 0.16) / 0.48) ** 4));
    const eastRelief = Math.exp(-(((terrainX - eastSpine) / 0.105) ** 2))
      * eastEnvelope * (280 + 48 * noise(terrainY * 8, 6.3));

    const plateauEdge = terrainY + 0.038 * noise(terrainX * 7, 12)
      + detail * 0.009;
    const plateau = smoothstep(0.80, 0.925, plateauEdge)
      * smoothstep(0.18, 0.34, terrainX) * (1 - smoothstep(0.67, 0.85, terrainX)) * 147;
    const northCrest = 0.055 + 0.03 * Math.sin(terrainX * 10 + 0.7);
    const northRidge = 155 * Math.exp(-(((terrainY - northCrest) / 0.10) ** 2))
      * smoothstep(0.13, 0.34, terrainX) * (1 - smoothstep(0.66, 0.88, terrainX));
    // Graceful north spur hill enriching the space above the brand logo
    const northSpur = 155 * Math.exp(-(((terrainY - 0.20) / 0.10) ** 2 + ((terrainX - 0.48) / 0.16) ** 2));
    const southwestShoulder = 144 * Math.exp(-(((terrainX + 0.025) / 0.19) ** 2 + ((terrainY - 1.02) / 0.18) ** 2));
    const southeastShoulder = 128 * Math.exp(-(((terrainX - 1.015) / 0.19) ** 2 + ((terrainY - 1.015) / 0.17) ** 2));
    const lowDivide = 35 * Math.exp(-(((terrainY - 0.60 - 0.04 * Math.sin(terrainX * 7)) / 0.20) ** 2
      + ((terrainX - 0.51) / 0.30) ** 4));
    const relief = Math.hypot(westRelief, eastRelief, northRidge) + northSpur + plateau + southwestShoulder + southeastShoulder;
    const dissection = (broadNoise * 24 + detail * 9 + fine * 2.4)
      * smoothstep(15, 170, relief);

    let elevation = 181 + 52 * (1 - terrainY) + broadNoise * 8
      + (relief + dissection + breathing * relief / 300) * (1 - quiet * 0.84)
      + lowDivide * (1 - quiet * 0.35);

    for (const lake of LAKES) {
      const lakeY = (terrainY - lake.y) / lake.radiusY;
      const lakeX = (terrainX - lake.x) / lake.radiusX + lake.bend * Math.sin(lakeY * 2.1);
      const basinRadius = lakeX * lakeX * (1.2 + 0.3 * Math.sin(lakeY * 5)) + lakeY * lakeY;
      const mainBasin = lake.depth * Math.exp(-1.6 * basinRadius);
      const armX = lakeX - 0.63 + lakeY * 0.35;
      const armY = lakeY + 0.55;
      const armBasin = lake.depth * 0.72 * Math.exp(-3.1 * (armX * armX + armY * armY * 0.85));
      const junction = Math.max(0, 16 - Math.abs(mainBasin - armBasin));
      const basin = Math.max(mainBasin, armBasin) + junction * junction / 64;
      const shoreDetail = noise(worldX * 23 + 7, worldY * 23 + 4) * 7;
      elevation -= basin * (1 + shoreDetail / lake.depth);
    }

    if (interaction && Math.abs(interaction.strength) > 0.001) {
      const distance = Math.hypot(pixelX - interaction.x, pixelY - interaction.y);
      const radius = interaction.radius || 140;
      const influence = Math.max(0, 1 - (distance / radius) ** 2);
      elevation += influence ** 3 * interaction.strength * (1 - quiet * 0.78);
    }

    return elevation;
  };

  return { sample, width, height, lakes: LAKES };
}

export function sampleTerrainGrid(model, cellSize = 6) {
  const columns = Math.ceil(model.width / cellSize) + 1;
  const rows = Math.ceil(model.height / cellSize) + 1;
  const values = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      values[row * columns + column] = model.sample(column * cellSize, row * cellSize);
    }
  }
  return { values, columns, rows, cellSize };
}

export function createTerrainFrames(width, height, cellSize, startTime = 0) {
  const interval = 6;
  let fromTime = startTime;
  let previous = sampleTerrainGrid(createTerrainModel(width, height, fromTime), cellSize);
  let next = sampleTerrainGrid(createTerrainModel(width, height, fromTime + interval), cellSize);
  let future = new Float32Array(previous.values.length);
  let futureModel = createTerrainModel(width, height, fromTime + interval * 2);
  let futureRow = 0;
  const { columns, rows } = previous;
  const output = { ...previous, values: new Float32Array(previous.values.length) };
  const quietWeights = Float32Array.from(previous.values, (_, index) =>
    quietAreaWeight((index % columns) * cellSize / width, Math.floor(index / columns) * cellSize / height));
  output.quietWeights = quietWeights;

  return (time, interaction = null) => {
    if (time >= fromTime + interval) {
      while (futureRow < rows) {
        for (let column = 0; column < columns; column++) {
          future[futureRow * columns + column] = futureModel.sample(column * cellSize, futureRow * cellSize);
        }
        futureRow++;
      }
      previous = next;
      next = { ...next, values: future };
      fromTime += interval;
      future = new Float32Array(previous.values.length);
      futureModel = createTerrainModel(width, height, fromTime + interval * 2);
      futureRow = 0;
    }
    const fraction = Math.max(0, Math.min(1, (time - fromTime) / interval));
    for (let index = 0; index < output.values.length; index++) {
      let elevation = previous.values[index] * (1 - fraction) + next.values[index] * fraction;
      if (interaction && Math.abs(interaction.strength) > 0.001) {
        const distanceX = (index % columns) * cellSize - interaction.x;
        const distanceY = Math.floor(index / columns) * cellSize - interaction.y;
        const radius = interaction.radius || 140;
        const influence = Math.max(0, 1 - (distanceX * distanceX + distanceY * distanceY) / (radius * radius));
        elevation += influence ** 3 * interaction.strength * (1 - quietWeights[index] * 0.78);
      }
      output.values[index] = elevation;
    }
    const lastRow = Math.min(rows, futureRow + 4);
    for (; futureRow < lastRow; futureRow++) {
      for (let column = 0; column < columns; column++) {
        future[futureRow * columns + column] = futureModel.sample(column * cellSize, futureRow * cellSize);
      }
    }
    return output;
  };
}

export function sampleGridElevation(grid, pixelX, pixelY) {
  const gridX = Math.max(0, Math.min(grid.columns - 1.000001, pixelX / grid.cellSize));
  const gridY = Math.max(0, Math.min(grid.rows - 1.000001, pixelY / grid.cellSize));
  const column = Math.floor(gridX);
  const row = Math.floor(gridY);
  const fractionX = gridX - column;
  const fractionY = gridY - row;
  const upper = grid.values[row * grid.columns + column] * (1 - fractionX)
    + grid.values[row * grid.columns + column + 1] * fractionX;
  const lower = grid.values[(row + 1) * grid.columns + column] * (1 - fractionX)
    + grid.values[(row + 1) * grid.columns + column + 1] * fractionX;
  return upper * (1 - fractionY) + lower * fractionY;
}

export function containsPoint(ring, pointX, pointY) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentX, currentY] = ring[index];
    const [previousX, previousY] = ring[previous];
    if ((currentY > pointY) !== (previousY > pointY)
      && pointX < (previousX - currentX) * (pointY - currentY) / (previousY - currentY) + currentX) {
      inside = !inside;
    }
  }
  return inside;
}

export function findTerrainSummits(grid, width, height) {
  const candidates = [];
  const { columns, rows, values, cellSize } = grid;
  for (let row = 1; row < rows - 1; row++) {
    for (let column = 1; column < columns - 1; column++) {
      const pixelX = column * cellSize;
      const pixelY = row * cellSize;
      const elevation = values[row * columns + column];
      if (elevation < 260 || pixelX < 26 || pixelX > width - 26 || pixelY < 24 || pixelY > height - 32) continue;
      if (quietAreaWeight(pixelX / width, pixelY / height) > 0.3) continue;
      let summit = true;
      for (let offsetY = -1; offsetY <= 1 && summit; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (offsetX === 0 && offsetY === 0) continue;
          if (values[(row + offsetY) * columns + column + offsetX] >= elevation) {
            summit = false;
            break;
          }
        }
      }
      if (!summit) continue;
      const radius = Math.min(width * 0.06, 36);
      const shoulder = (sampleGridElevation(grid, pixelX - radius, pixelY)
        + sampleGridElevation(grid, pixelX + radius, pixelY)
        + sampleGridElevation(grid, pixelX, pixelY - radius)
        + sampleGridElevation(grid, pixelX, pixelY + radius)) / 4;
      if (elevation - shoulder < 5) continue;
      candidates.push({ x: pixelX, y: pixelY, elevation });
    }
  }
  const selected = [];
  const separation = width < 768 ? 90 : 150;
  for (const candidate of candidates.sort((first, second) => second.elevation - first.elevation)) {
    if (selected.some(peak => Math.hypot(peak.x - candidate.x, peak.y - candidate.y) < separation)) continue;
    selected.push(candidate);
    if (selected.length >= (width < 768 ? 5 : 7)) break;
  }
  return selected;
}

export function extractTerrainContours(grid) {
  return contours().size([grid.columns, grid.rows]).thresholds(CONTOUR_LEVELS)(grid.values);
}

function lakeSeedIndex(grid, model, lake) {
  const seedColumn = Math.round(lake.x * model.width / grid.cellSize);
  const seedRow = Math.round(lake.y * model.height / grid.cellSize);
  const seedIndex = seedRow * grid.columns + seedColumn;
  if (grid.values[seedIndex] < lake.level) return seedIndex;
  const radiusX = Math.ceil(lake.radiusX * model.width / grid.cellSize);
  const radiusY = Math.ceil(lake.radiusY * model.height / grid.cellSize);
  let nearest = -1;
  let nearestDistance = Infinity;
  for (let row = Math.max(0, seedRow - radiusY); row <= Math.min(grid.rows - 1, seedRow + radiusY); row++) {
    for (let column = Math.max(0, seedColumn - radiusX); column <= Math.min(grid.columns - 1, seedColumn + radiusX); column++) {
      const distance = ((column - seedColumn) / radiusX) ** 2 + ((row - seedRow) / radiusY) ** 2;
      if (grid.values[row * grid.columns + column] < lake.level && distance < nearestDistance) {
        nearestDistance = distance;
        nearest = row * grid.columns + column;
      }
    }
  }
  return nearest;
}

export function sampleLakeLevels(grid, model) {
  const levels = new Float32Array(grid.values.length);
  const queue = new Int32Array(grid.values.length);
  for (const lake of model.lakes) {
    const seedIndex = lakeSeedIndex(grid, model, lake);
    if (seedIndex < 0) continue;
    let head = 0;
    let tail = 1;
    queue[0] = seedIndex;
    levels[seedIndex] = lake.level;
    while (head < tail) {
      const index = queue[head++];
      const column = index % grid.columns;
      const row = Math.floor(index / grid.columns);
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          const nextColumn = column + offsetX;
          const nextRow = row + offsetY;
          if (nextColumn < 0 || nextColumn >= grid.columns || nextRow < 0 || nextRow >= grid.rows) continue;
          const nextIndex = nextRow * grid.columns + nextColumn;
          if (levels[nextIndex] || grid.values[nextIndex] >= lake.level) continue;
          levels[nextIndex] = lake.level;
          queue[tail++] = nextIndex;
        }
      }
    }
  }
  return levels;
}

export function extractLakeContours(grid, model) {
  const submerged = Float32Array.from(grid.values, elevation => -elevation);
  const generator = contours().size([grid.columns, grid.rows]);
  return model.lakes.map(lake => {
    const geometry = generator.contour(submerged, -lake.level);
    const seedIndex = lakeSeedIndex(grid, model, lake);
    const seedX = seedIndex % grid.columns + 0.5;
    const seedY = Math.floor(seedIndex / grid.columns) + 0.5;
    const coordinates = geometry.coordinates.filter(polygon =>
      seedIndex >= 0 && containsPoint(polygon[0], seedX, seedY)
      && !polygon.slice(1).some(hole => containsPoint(hole, seedX, seedY)));
    return { ...geometry, coordinates, level: lake.level };
  });
}