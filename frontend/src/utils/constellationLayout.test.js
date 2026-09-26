import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSTELLATIONS } from '../data/constellations.js';
import { getZone, projectConstellation, placeConstellationLabel, createBackgroundStars, findNearestConstellation } from './constellationLayout.js';

test('mobile has twenty-six groups and desktop has thirty including the zodiac set and Horologium/Centaurus', () => {
  assert.equal(CONSTELLATIONS.filter((_, index) => getZone(index, 390).visible).length, 26);
  assert.equal(CONSTELLATIONS.filter((_, index) => getZone(index, 1440).visible).length, 30);
  assert.equal(getZone(17, 1440).visible, true);
  assert.equal(getZone(21, 390).visible, true);
  assert.equal(getZone(29, 1440).visible, true);
  assert.equal(getZone(22, 390).visible, true);
  assert.ok(getZone(0, 1440).prominence > getZone(15, 1440).prominence * 2);
});

test('outer groups visit every quadrant instead of remaining anchored in corners', () => {
  const corners = new Set();
  for (const index of [17, 18, 19, 20]) {
    const pose = projectConstellation(CONSTELLATIONS[index], index, 1440, 900, 0, true);
    assert.ok(pose.outer && pose.prominence >= 0.78 && pose.z >= 0.90);
    assert.ok(pose.centerX < 1440 * 0.15 || pose.centerX > 1440 * 0.85);
    assert.ok(pose.centerY < 900 * 0.15 || pose.centerY > 900 * 0.82);
    corners.add(`${pose.centerX < 720}:${pose.centerY < 450}`);
    assert.ok(CONSTELLATIONS[index].stars.length >= 3 && CONSTELLATIONS[index].stars.length <= 5);
    assert.ok(CONSTELLATIONS[index].lines.every(line => line.every(starIndex => starIndex < CONSTELLATIONS[index].stars.length)));
    const visited = new Set([0, 75, 150, 225].map(time => {
      const moving = projectConstellation(CONSTELLATIONS[index], index, 1440, 900, time);
      return `${moving.centerX < 720}:${moving.centerY < 450}`;
    }));
    assert.equal(visited.size, 4);
    const initial = projectConstellation(CONSTELLATIONS[index], index, 1440, 900, 0);
    const later = projectConstellation(CONSTELLATIONS[index], index, 1440, 900, 12);
    assert.ok(Math.hypot(initial.centerX - later.centerX, initial.centerY - later.centerY) > 70);
    const opposite = projectConstellation(CONSTELLATIONS[index], index, 1440, 900, 150);
    assert.ok(Math.hypot(initial.centerX - opposite.centerX, initial.centerY - opposite.centerY) > 700);
  }
  assert.equal(corners.size, 4);
});

test('mobile additions are compact and dim, with clearance throughout a full orbit', () => {
  for (const index of [15, 17]) {
    const zone = getZone(index, 390);
    assert.ok(zone.z < 0.5 && zone.prominence <= 0.44);
    assert.ok(CONSTELLATIONS[index].stars.length >= 3 && CONSTELLATIONS[index].stars.length <= 5);
    assert.ok(CONSTELLATIONS[index].lines.every(line => line.every(starIndex => starIndex < CONSTELLATIONS[index].stars.length)));
  }
  for (const [width, height] of [[320, 640], [390, 844], [430, 932], [767, 1024]]) {
    for (let time = 0; time <= 360; time += 3) {
      const poses = CONSTELLATIONS.map((data, index) => getZone(index, width).visible
        ? projectConstellation(data, index, width, height, time) : null);
      for (const index of [15, 17]) {
        const bounds = poses[index].bounds;
        for (let otherIndex = 0; otherIndex < poses.length; otherIndex++) {
          if (!poses[otherIndex] || otherIndex === index) continue;
          const other = poses[otherIndex].bounds;
          const gapX = Math.max(0, bounds.left - other.right, other.left - bounds.right);
          const gapY = Math.max(0, bounds.top - other.bottom, other.top - bounds.bottom);
          assert.ok(Math.hypot(gapX, gapY) >= 8,
            `${CONSTELLATIONS[index].id} crowds ${CONSTELLATIONS[otherIndex].id} at ${width}px, ${time}s`);
        }
      }
    }
  }
});

test('Monoceros stays between Orion and Canis Major throughout their orbit', () => {
  const angle = (pose, width, height) => Math.atan2((pose.centerY / height - 0.48) / 0.38, (pose.centerX / width - 0.5) / 0.41);
  const angularDistance = (first, second) => Math.abs(Math.atan2(Math.sin(first - second), Math.cos(first - second)));
  for (const [width, height] of [[768, 1024], [1280, 720], [1440, 900], [1920, 1080]]) {
    for (let time = 0; time <= 300; time += 3) {
      const [orion, canisMajor, monoceros] = [0, 10, 21].map(index =>
        angle(projectConstellation(CONSTELLATIONS[index], index, width, height, time), width, height));
      assert.ok(Math.abs(angularDistance(orion, monoceros) + angularDistance(monoceros, canisMajor)
        - angularDistance(orion, canisMajor)) < 0.00001);
    }
  }
});

test('continuous orbit preserves constellation geometry and viewport framing', () => {
  for (const [width, height] of [[320, 640], [390, 844], [768, 1024], [1440, 900]]) {
    CONSTELLATIONS.forEach((data, index) => {
      if (!getZone(index, width).visible) return;
      for (const time of [0, 30, 75, 100, 150, 220, 300, 360]) {
        const pose = projectConstellation(data, index, width, height, time);
        assert.ok(pose.bounds.left >= 11.99 && pose.bounds.right <= width - 11.99);
        assert.ok(pose.bounds.top >= 17.99 && pose.bounds.bottom <= height - 17.99);
        for (let starIndex = 1; starIndex < data.stars.length; starIndex++) {
          const original = Math.hypot((data.stars[starIndex].x - data.stars[0].x) * data.width / 160,
            (data.stars[starIndex].y - data.stars[0].y) * data.height / 160);
          const projected = Math.hypot(pose.stars[starIndex].sx - pose.stars[0].sx, pose.stars[starIndex].sy - pose.stars[0].sy);
          assert.ok(Math.abs(projected - original * pose.scale) < 0.00001);
        }
      }
    });
  }
});

test('motion is continuous, bounded, and static under reduced motion', () => {
  const data = CONSTELLATIONS[0];
  const initial = projectConstellation(data, 0, 1440, 900, 0);
  const later = projectConstellation(data, 0, 1440, 900, 30);
  const next = projectConstellation(data, 0, 1440, 900, 30 + 1 / 60);
  assert.ok(Math.hypot(initial.centerX - later.centerX, initial.centerY - later.centerY) > 3);
  const soon = projectConstellation(data, 0, 1440, 900, 3);
  assert.ok(Math.hypot(initial.centerX - soon.centerX, initial.centerY - soon.centerY) > 6);
  assert.ok(Math.hypot(next.centerX - later.centerX, next.centerY - later.centerY) < 0.4);
  assert.deepEqual(projectConstellation(data, 0, 1440, 900, 0, true), projectConstellation(data, 0, 1440, 900, 400, true));
});

test('groups complete an orbit rather than reversing through a tiny arc', () => {
  for (const [width, height, period, index] of [[1440, 900, 300, 0], [390, 844, 360, 10]]) {
    const poses = [0, 0.25, 0.5, 0.75, 1].map(fraction =>
      projectConstellation(CONSTELLATIONS[index], index, width, height, period * fraction));
    assert.ok(poses[0].centerX < width * 0.25);
    assert.ok(poses[1].centerY < height * 0.30);
    assert.ok(poses[2].centerX > width * 0.75);
    assert.ok(poses[3].centerY > height * 0.65);
    assert.ok(Math.hypot(poses[0].centerX - poses[4].centerX, poses[0].centerY - poses[4].centerY) < 50);
  }
});

test('labels avoid interface content or stay hidden when there is no space', () => {
  const bounds = { left: 50, right: 140, top: 120, bottom: 240 };
  const obstacles = [{ left: 0, right: 390, top: 0, bottom: 100 }];
  const label = placeConstellationLabel(bounds, 100, 28, 390, 844, obstacles);
  assert.ok(label.y >= 108);
  assert.equal(placeConstellationLabel(bounds, 100, 28, 390, 844,
    [{ left: 0, top: 0, right: 390, bottom: 844 }]), null);
});

test('background stars are deterministic, sparse, and quiet behind the prompt', () => {
  const stars = createBackgroundStars(390, 844);
  assert.deepEqual(stars, createBackgroundStars(390, 844));
  assert.ok(stars.length >= 45 && stars.length < 60);
  assert.ok(createBackgroundStars(3840, 2160).length <= 180);
  const central = stars.filter(star => Math.abs(star.x - 0.5) < 0.15 && Math.abs(star.y - 0.43) < 0.15);
  assert.ok(central.length > 0 && central.every(star => star.alpha < 0.10));
});

test('hover and finger movement select only one nearby constellation', () => {
  const poses = [{ stars: [{ sx: 40, sy: 100 }] }, null, { stars: [{ sx: 210, sy: 600 }] }];
  assert.equal(findNearestConstellation(poses, 50, 110).index, 0);
  assert.equal(findNearestConstellation(poses, 200, 580).index, 2);
  assert.equal(findNearestConstellation(poses, 350, 300).index, -1);
  const neighboring = [{ stars: [{ sx: 100, sy: 100 }] }, { stars: [{ sx: 130, sy: 100 }] }];
  assert.equal(findNearestConstellation(neighboring, 117, 100, 76, 0).index, 0);
});

test('Cygnus label finds free space when the header blocks all four preferred positions', () => {
  const bounds = { left: 180, right: 350, top: 18, bottom: 112 };
  const header = { left: 0, right: 640, top: 0, bottom: 150 };
  const label = placeConstellationLabel(bounds, 100, 28, 640, 700, [header]);
  assert.ok(label);
  assert.ok(label.y >= header.bottom + 8);
  assert.ok(label.x >= 10 && label.x + 100 <= 630 && label.y + 28 <= 690);
  assert.equal(placeConstellationLabel(bounds, 700, 28, 640, 700, []), null);
});

test('mobile additions clear existing groups and desktop outer groups remain spaced apart', () => {
  for (const [width, height] of [[320, 640], [390, 844], [430, 932], [767, 1024], [768, 1024], [1280, 720], [1440, 900], [1920, 1080]]) {
    const added = width < 768 ? [18, 19, 20] : [17, 18, 19, 20];
    for (let time = 0; time <= 360; time += 3) {
      const poses = CONSTELLATIONS.map((data, index) => getZone(index, width).visible
        ? projectConstellation(data, index, width, height, time) : null);
      for (const index of added) {
        const bounds = poses[index].bounds;
        for (let otherIndex = 0; otherIndex < poses.length; otherIndex++) {
          if (!poses[otherIndex] || otherIndex === index) continue;
          if (width >= 768 && !getZone(otherIndex, width).outer) continue;
          const other = poses[otherIndex].bounds;
          const gap = Math.hypot(Math.max(0, bounds.left - other.right, other.left - bounds.right),
            Math.max(0, bounds.top - other.bottom, other.top - bounds.bottom));
          assert.ok(gap >= 8, `${CONSTELLATIONS[index].id} crowds ${CONSTELLATIONS[otherIndex].id} at ${width}px, ${time}s`);
        }
      }
    }
  }
});