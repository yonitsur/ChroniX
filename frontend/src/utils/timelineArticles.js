import { compareDateParts } from './dateTime.js';

export function isSameArticleId(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

export function isRtlText(value) {
  return typeof value === 'string' && /[\u0590-\u05FF\u0600-\u06FF]/.test(value);
}

export function compareEventDates(a, b, useEndA = false, useEndB = false) {
  const dateA = useEndA && a?.to ? a.to : (a?.from || {});
  const dateB = useEndB && b?.to ? b.to : (b?.from || {});
  return compareDateParts(dateA, dateB);
}

export function getTimelineAnchorArticleIds(articles = []) {
  const anchorIds = new Set();
  if (!Array.isArray(articles) || articles.length === 0) return anchorIds;

  const addBoundaryIds = (items) => {
    let earliest = items[0];
    let latest = items[0];

    for (let index = 1; index < items.length; index += 1) {
      const article = items[index];
      if (compareEventDates(article, earliest) < 0) earliest = article;
      if (compareEventDates(article, latest, true, true) > 0) latest = article;
    }

    if (earliest?.id != null) anchorIds.add(String(earliest.id));
    if (latest?.id != null) anchorIds.add(String(latest.id));
  };

  addBoundaryIds(articles);

  const articlesByLane = new Map();
  articles.forEach((article) => {
    const laneKey = String(article.lane || 'default');
    const laneArticles = articlesByLane.get(laneKey) || [];
    laneArticles.push(article);
    articlesByLane.set(laneKey, laneArticles);
  });

  if (articlesByLane.size > 1) {
    articlesByLane.forEach(addBoundaryIds);
  }

  return anchorIds;
}
