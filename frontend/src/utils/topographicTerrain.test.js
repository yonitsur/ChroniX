import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTerrainModel, sampleTerrainGrid, extractLakeContours,
  extractTerrainContours, quietAreaWeight, CONTOUR_INTERVAL,
  createTerrainFrames, sampleGridElevation, sampleLakeLevels, findTerrainSummits,
} from './topographicTerrain.js';

test('terrain is deterministic, continuous in time, and gently alive', () => {
  const initial = createTerrainModel(1440, 900, 0);
  const repeat = createTerrainModel(1440, 900, 0);
  const next = createTerrainModel(1440, 900, 1 / 30);
  const later = createTerrainModel(1440, 900, 15);
  let totalMotion = 0;
  for (let pixelY = 0; pixelY <= 900; pixelY += 30) {
    for (let pixelX = 0; pixelX <= 1440; pixelX += 30) {
      const elevation = initial.sample(pixelX, pixelY);
      assert.equal(elevation, repeat.sample(pixelX, pixelY));
      assert.ok(Number.isFinite(elevation) && elevation > 50 && elevation < 620);
      assert.ok(Math.abs(elevation - next.sample(pixelX, pixelY)) < 1);
      totalMotion += Math.abs(elevation - later.sample(pixelX, pixelY));
    }
  }
  assert.ok(totalMotion > 500);
});

test('water boundaries are exact level sets of the rendered elevation grid', () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const time of [0, 18, 65]) {
      const model = createTerrainModel(width, height, time);
      const grid = sampleTerrainGrid(model, 6);
      const lakes = extractLakeContours(grid, model);
      assert.equal(lakes.length, 2);
      for (const lake of lakes) {
        assert.ok(lake.coordinates.length > 0, 'both natural depressions retain water');
        for (const polygon of lake.coordinates) {
          for (const ring of polygon) {
            for (const [contourX, contourY] of ring) {
              const gridX = contourX - 0.5;
              const gridY = contourY - 0.5;
              if (gridX < 0 || gridY < 0 || gridX >= grid.columns - 1 || gridY >= grid.rows - 1) continue;
              const column = Math.floor(gridX);
              const row = Math.floor(gridY);
              const fractionX = gridX - column;
              const fractionY = gridY - row;
              const upper = grid.values[row * grid.columns + column] * (1 - fractionX)
                + grid.values[row * grid.columns + column + 1] * fractionX;
              const lower = grid.values[(row + 1) * grid.columns + column] * (1 - fractionX)
                + grid.values[(row + 1) * grid.columns + column + 1] * fractionX;
              assert.ok(Math.abs(upper * (1 - fractionY) + lower * fractionY - lake.level) < 0.001);
            }
          }
        }
      }
      const lines = extractTerrainContours(grid);
      assert.ok(lines.filter(line => line.coordinates.length).length > 12);
      assert.equal(lines[1].value - lines[0].value, CONTOUR_INTERVAL);
    }
  }
});

test('cursor changes local terrain and shoreline without agitating the content area', () => {
  const base = createTerrainModel(1440, 900);
  const lifted = createTerrainModel(1440, 900, 0, { x: 180, y: 620, strength: 52, radius: 140 });
  assert.ok(lifted.sample(180, 620) - base.sample(180, 620) > 45);
  const depressed = createTerrainModel(1440, 900, 0, { x: 180, y: 620, strength: -78, radius: 140 });
  assert.ok(depressed.sample(180, 620) - base.sample(180, 620) < -70);
  assert.equal(lifted.sample(1000, 300), base.sample(1000, 300));
  const originalLakes = extractLakeContours(sampleTerrainGrid(base), base);
  const changedLakes = extractLakeContours(sampleTerrainGrid(lifted), lifted);
  assert.notDeepEqual(originalLakes[0].coordinates, changedLakes[0].coordinates);
  assert.ok(quietAreaWeight(0.5, 0.43) > 0.99);
  assert.ok(quietAreaWeight(0.1, 0.43) < 0.01);
  const center = createTerrainModel(1440, 900, 0, { x: 720, y: 387, strength: 52 });
  assert.ok(center.sample(720, 387) - base.sample(720, 387) < 12);
});

test('cached animation remains continuous across keyframes and samples the displayed grid', () => {
  const frame = createTerrainFrames(800, 600, 8);
  let previous = null;
  for (let time = 0; time < 14; time += 1 / 30) {
    const grid = frame(time);
    const elevation = sampleGridElevation(grid, 130, 180);
    if (previous !== null) assert.ok(Math.abs(elevation - previous) < 0.2);
    previous = elevation;
    assert.equal(sampleGridElevation(grid, 80, 80), grid.values[10 * grid.columns + 10]);
  }
  const baseline = sampleGridElevation(frame(14), 160, 400);
  const lifted = sampleGridElevation(frame(14, { x: 160, y: 400, strength: 48, radius: 120 }), 160, 400);
  assert.ok(lifted - baseline > 40);
});

test('upper ridge and both lower shoulders frame a gently varied prompt plain', () => {
  const model = createTerrainModel(1440, 900);
  assert.ok(model.sample(720, 54) > 320);
  assert.ok(model.sample(43, 855) > 260);
  assert.ok(model.sample(1397, 855) > 260);
  const central = [0.32, 0.44, 0.56, 0.68].map(relativeY => model.sample(720, 900 * relativeY));
  assert.ok(Math.max(...central) - Math.min(...central) > 12);
  assert.ok(Math.max(...central) < 280);
  const later = createTerrainModel(1440, 900, 3);
  let activeSamples = 0;
  for (let row = 1; row < 10; row++) {
    for (let column = 1; column < 16; column++) {
      if (Math.abs(later.sample(column * 90, row * 90) - model.sample(column * 90, row * 90)) > 1) activeSamples++;
    }
  }
  assert.ok(activeSamples > 65);
});

test('water masks stay below their level and retain water around a raised lake center', () => {
  const model = createTerrainModel(1000, 700, 0, { x: 145, y: 483, strength: 92, radius: 70 });
  const grid = sampleTerrainGrid(model, 6);
  const levels = sampleLakeLevels(grid, model);
  let westCount = 0;
  let eastCount = 0;
  levels.forEach((level, index) => {
    if (!level) return;
    assert.ok(grid.values[index] < level);
    if (level === 156) westCount++;
    if (level === 164) eastCount++;
  });
  assert.ok(westCount > 25 && eastCount > 25);
  assert.ok(extractLakeContours(grid, model).every(lake => lake.coordinates.length > 0));
});

test('summit markers identify separated local maxima and report the displayed elevation', () => {
  const model = createTerrainModel(1440, 900);
  const grid = sampleTerrainGrid(model, 6);
  const summits = findTerrainSummits(grid, 1440, 900);
  assert.ok(summits.length >= 3 && summits.length <= 7);
  for (const summit of summits) {
    assert.equal(summit.elevation, sampleGridElevation(grid, summit.x, summit.y));
    assert.ok(quietAreaWeight(summit.x / 1440, summit.y / 900) < 0.3);
    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        if (!offsetX && !offsetY) continue;
        assert.ok(summit.elevation > sampleGridElevation(grid, summit.x + offsetX * 6, summit.y + offsetY * 6));
      }
    }
    assert.ok(summits.every(other => other === summit || Math.hypot(other.x - summit.x, other.y - summit.y) >= 150));
  }
  const slope = { columns: 21, rows: 21, cellSize: 20, values: Float32Array.from({ length: 441 }, (_, index) => 280 + index % 21) };
  assert.deepEqual(findTerrainSummits(slope, 400, 400), []);
});