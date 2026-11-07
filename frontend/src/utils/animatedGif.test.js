import test from 'node:test';
import assert from 'node:assert/strict';
import { getGifFrameAt, isGifSource } from './animatedGif.js';

const gif = {
  frames: [{ canvas: 'a', start: 0 }, { canvas: 'b', start: 100 }, { canvas: 'c', start: 250 }],
  duration: 400,
};

test('picks the frame for a point in time and loops', () => {
  assert.equal(getGifFrameAt(gif, 0).frame.canvas, 'a');
  assert.equal(getGifFrameAt(gif, 99).frame.canvas, 'a');
  assert.equal(getGifFrameAt(gif, 100).frame.canvas, 'b');
  assert.equal(getGifFrameAt(gif, 399).frame.canvas, 'c');
  assert.equal(getGifFrameAt(gif, 420).frame.canvas, 'a');
});

test('reports the time until the next frame', () => {
  assert.equal(getGifFrameAt(gif, 40).nextIn, 60);
  assert.equal(getGifFrameAt(gif, 300).nextIn, 100);
});

test('single-frame GIFs never schedule another frame', () => {
  const still = { frames: [{ canvas: 'a', start: 0 }], duration: 0 };
  assert.equal(getGifFrameAt(still, 1234).nextIn, Infinity);
});

test('detects GIF sources', () => {
  assert.ok(isGifSource('https://x/y.GIF'));
  assert.ok(isGifSource('https://x/y.gif?v=1'));
  assert.ok(isGifSource('https://x/y.png', 'gif'));
  assert.ok(!isGifSource('https://x/y.png'));
});
