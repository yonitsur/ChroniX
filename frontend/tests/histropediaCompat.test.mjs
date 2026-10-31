import test from 'node:test';
import assert from 'node:assert/strict';
import { Timeline, Article } from 'histropediajs';

test('HistropediaJS exposes all prototype hooks patched by TimelineView', () => {
  const requiredArticleMethods = [
    'getWidth',
    '_getWidth',
    'getHeight',
    '_getSizeCacheKey',
    '_ensureSizeCache',
    'updateCachedSize',
    'invalidateCaches',
    'getCurrentStyle',
    '_getCurrentStyle',
    'draw',
    'drawPeriodLinesAndConnectors',
    'updateIsMouseOverStar',
    'updateVisibility',
    'headerOverlapsWith',
  ];
  for (const method of requiredArticleMethods) {
    assert.equal(typeof Article.prototype[method], 'function', `Article.prototype.${method} must be a function`);
  }

  const requiredTimelineMethods = [
    'getArticleById',
    'hasArticle',
    'bringFront',
    'select',
    'getActiveArticle',
    'updateIsActiveStatus',
    'stack',
    'getFitToHeightRowSpacing',
    'redraw',
    'defaultRedraw',
    'render',
    'reposition',
    'drawTimeBands',
    'enqueueImageLoad',
    '_refreshAdaptiveArticleRuntimeOptions',
    '_resolveDefaultCardLayoutName',
    '_getLaneDistanceToBaseline',
    '_getTimelineDistanceToBaseline',
    '_getLaneRowSpacing',
    '_getAvailableHeightForArticle',
    '_getLaneArticleAvailableHeight',
    '_isLaneLayoutActive',
    'goToPixelAnim',
    'fitArticles',
    'setStartDate',
  ];
  for (const method of requiredTimelineMethods) {
    assert.equal(typeof Timeline.prototype[method], 'function', `Timeline.prototype.${method} must be a function`);
  }

  const portrait = Timeline.getCardLayout('portrait');
  const landscape = Timeline.getCardLayout('landscape');
  assert.ok(portrait && typeof portrait.draw === 'function' && typeof portrait.getIconBox === 'function' && typeof portrait.getConnectorEnd === 'function');
  assert.ok(landscape && typeof landscape.draw === 'function' && typeof landscape.getHeight === 'function');
});

test('Article._getSizeCacheKey returns an Array compatible with v1.7+ _ensureSizeCache', () => {
  const fakeArticle = Object.create(Article.prototype);
  fakeArticle.imageLoaded = false;
  fakeArticle.image = null;
  fakeArticle.isActive = false;
  fakeArticle.isStarred = false;
  fakeArticle.owner = { options: { article: { star: { visible: true } } }, getCanvasDpr: () => 1 };
  fakeArticle._getCurrentCardLayoutName = () => 'portrait';
  fakeArticle.getCurrentStyle = () => ({
    width: 150,
    height: 'auto',
    header: { height: 54, text: { font: '600 13px Inter', margin: 10, lineHeight: 18, numberOfLines: 4 } },
    subheader: { height: 26, text: { font: '500 11px Inter', margin: 10, lineHeight: 14, numberOfLines: 1 } },
    border: { width: 1 },
    image: { shape: 'natural', maxHeight: 200, margin: 0 },
    star: { width: 16, margin: 3 },
  });

  const baseKey = Article.prototype._getSizeCacheKey.call(fakeArticle);
  assert.ok(Array.isArray(baseKey), '_getSizeCacheKey in HistropediaJS v1.7+ should return an Array');

  let recomputed = 0;
  fakeArticle.updateCachedSize = function () {
    recomputed += 1;
    this._sizeValid = true;
    this._sizeCacheKey = this._getSizeCacheKey();
  };
  fakeArticle._getSizeCacheKey = function () {
    const key = Article.prototype._getSizeCacheKey.call(this);
    key.push(this.title || '', 'classic:Inter');
    return key;
  };

  fakeArticle.title = 'Moon Landing';
  fakeArticle._ensureSizeCache();
  assert.equal(recomputed, 1);

  // Second call with identical state hits cache without throwing `cacheKey.some is not a function`
  fakeArticle._ensureSizeCache();
  assert.equal(recomputed, 1);

  // Title mutation invalidates size cache cleanly
  fakeArticle.title = 'Apollo 11 Moon Landing';
  fakeArticle._ensureSizeCache();
  assert.equal(recomputed, 2);
});
