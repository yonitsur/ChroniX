// Wikipedia enrichment of personal timelines on the client: which events are sent, how answers are
// applied, wrong links dismissed for good, illustrative covers, the timeline's history list, and the
// world-events layer prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENRICH_VERSION, eventsForEnrichment, applyEnrichment, linksOfKind, illustrativeCover, timelineHistoryLinks,
  dismissContextLink, dropPlaceLinks, worldEventsSubject, worldEventsPrompt,
} from '../src/utils/personalEnrichment.js';
import { applyEventExtras } from '../src/data/storyStudioSync.js';

const PINSK = { kind: 'place', name: 'Pinsk', title: 'Pinsk', url: 'https://en.wikipedia.org/wiki/Pinsk', lang: 'en' };
const ALIYAH = { kind: 'event', name: 'Third Aliyah', title: 'Third Aliyah', url: 'https://en.wikipedia.org/wiki/Third_Aliyah', lang: 'en' };
const PIC = { url: 'https://upload.wikimedia.org/x/Pinsk.jpg', file: 'Pinsk.jpg', place: 'Pinsk', fileUrl: 'https://commons.wikimedia.org/wiki/File:Pinsk.jpg' };

test('eventsForEnrichment sends events not enriched yet, with what the server needs', () => {
  const articles = [
    { id: 1, title: 'Born', subtitle: 'In Pinsk', extract: 'Long story', from: { year: 1901 }, locationName: 'Pinsk', lat: 52.1, lng: 26.1, contextLinks: [PINSK], rank: 8 },
    { id: 'b', title: 'Done', from: { year: 1920 }, enrichV: ENRICH_VERSION },
    { id: 'c', title: 'Photo', from: { year: 1930 }, to: { year: 1932 }, imageUrl: 'https://cdn/x.webp' },
  ];
  const sent = eventsForEnrichment(articles);
  assert.deepEqual(sent.map((e) => e.id), ['1', 'c']);
  assert.deepEqual(
    { ...sent[0] },
    { id: '1', title: 'Born', text: 'In Pinsk Long story', year: 1901, to_year: null, place: 'Pinsk', lat: 52.1, lng: 26.1, has_image: false, place_link: PINSK, rank: 8 },
  );
  assert.equal(sent[1].has_image, true);
  assert.equal(sent[1].to_year, 1932);
  assert.equal(eventsForEnrichment(articles, { force: true }).length, 3);
});

test('applyEnrichment adds links and a picture, never replaces a cover, honours dismissals', () => {
  const articles = [
    { id: 'a', title: 'Emigrated', contextLinks: [PINSK] },
    { id: 'b', title: 'Has photo', imageUrl: 'https://cdn/me.webp' },
    { id: 'c', title: 'Not sent' },
  ];
  const result = {
    links: { a: [PINSK, ALIYAH], b: [ALIYAH] },
    images: { a: PIC, b: PIC },
  };
  const next = applyEnrichment(articles, result, ['a', 'b'], [`b|${ALIYAH.url}`]);
  assert.deepEqual(next[0].contextLinks, [PINSK, ALIYAH]); // no duplicate place link
  assert.equal(next[0].imageUrl, PIC.url);
  assert.equal(next[0].imageSource, 'wikimedia');
  assert.deepEqual(next[0].imageIllustrative, { url: PIC.url, place: 'Pinsk', file: 'Pinsk.jpg', fileUrl: PIC.fileUrl });
  assert.equal(next[1].imageUrl, 'https://cdn/me.webp');
  assert.equal(next[1].contextLinks, undefined); // dismissed for this event
  assert.equal(next[0].enrichV, ENRICH_VERSION);
  assert.equal(next[1].enrichV, ENRICH_VERSION); // checked, even with nothing new
  assert.equal(next[2], articles[2]);
  assert.equal(applyEnrichment(articles, result, []), null);
});

test('linksOfKind only returns plain Wikipedia article links', () => {
  for (const url of ['javascript:alert(1)', 'https://evil.example/wiki/x', 'http://en.wikipedia.org/wiki/x', 'https://en.wikipedia.org/w/index.php?x']) {
    assert.deepEqual(linksOfKind({ contextLinks: [{ ...ALIYAH, url }] }, 'event'), [], url);
  }
  assert.deepEqual(linksOfKind({ contextLinks: [PINSK, ALIYAH] }, 'place'), [PINSK]);
  assert.deepEqual(linksOfKind({}, 'event'), []);
});

test('the illustrative badge only shows while the Wikimedia picture is still the cover', () => {
  const art = { imageUrl: PIC.url, imageIllustrative: { url: PIC.url, fileUrl: PIC.fileUrl, place: 'Pinsk' } };
  assert.equal(illustrativeCover(art).place, 'Pinsk');
  assert.equal(illustrativeCover({ ...art, imageUrl: 'https://cdn/new-photo.webp' }), null);
  assert.equal(illustrativeCover({ ...art, imageIllustrative: { ...art.imageIllustrative, fileUrl: 'https://evil/x' } }), null);
});

test('dismissContextLink: a place goes from every event, a historical link from one; both remembered', () => {
  const tl = {
    id: 't',
    articles: [
      { id: 1, contextLinks: [PINSK, ALIYAH] },
      { id: 2, contextLinks: [PINSK, ALIYAH] },
      { id: 3 },
    ],
  };
  const noPlace = dismissContextLink(tl, PINSK.url);
  assert.deepEqual(noPlace.articles.map((a) => (a.contextLinks || []).map((l) => l.kind)), [['event'], ['event'], []]);
  assert.deepEqual(noPlace.dismissedLinks, [PINSK.url]);
  const noAliyah = dismissContextLink(noPlace, ALIYAH.url, 2);
  assert.deepEqual(noAliyah.articles[0].contextLinks, [ALIYAH]);
  assert.equal('contextLinks' in noAliyah.articles[1], false);
  assert.deepEqual(noAliyah.dismissedLinks, [PINSK.url, `2|${ALIYAH.url}`]);
  assert.equal(dismissContextLink(tl, 'https://en.wikipedia.org/wiki/Nowhere'), null);
  // A later run doesn't bring them back.
  const again = applyEnrichment(noAliyah.articles, { links: { 1: [PINSK], 2: [ALIYAH] } }, [1, 2], noAliyah.dismissedLinks);
  assert.deepEqual(again.map((a) => (a.contextLinks || []).map((l) => l.kind)), [['event'], [], []]);
});

test('timelineHistoryLinks lists each historical article once, in time order', () => {
  const kishinev = { ...ALIYAH, name: 'Kishinev pogrom', title: 'Kishinev pogrom', url: 'https://en.wikipedia.org/wiki/Kishinev_pogrom' };
  const list = timelineHistoryLinks({
    articles: [
      { id: 'a', from: { year: 1921 }, contextLinks: [ALIYAH, PINSK] },
      { id: 'b', from: { year: 1903 }, contextLinks: [kishinev] },
      { id: 'c', from: { year: 1919 }, contextLinks: [ALIYAH] },
    ],
  });
  assert.deepEqual(list.map((l) => [l.name, l.firstYear, l.eventIds]), [['Kishinev pogrom', 1903, ['b']], ['Third Aliyah', 1919, ['a', 'c']]]);
});

test('world events layer: span and main places of the story', () => {
  const s = worldEventsSubject({
    articles: [
      { from: { year: 1901 }, locationName: 'Pinsk, Belarus' },
      { from: { year: 1921 }, to: { year: 1925 }, locationName: 'Haifa, Israel' },
      { from: { year: 1948 }, locationName: '5 Herzl St, Haifa, Israel' },
    ],
  });
  assert.deepEqual(s, { from: 1901, to: 1948, places: ['Israel', 'Belarus'] });
  assert.equal(worldEventsPrompt(s, 'en'), 'Major world and regional historical events in Israel, Belarus, 1901–1948');
  assert.match(worldEventsPrompt(s, 'he'), /1901–1948/);
  assert.equal(worldEventsSubject({ articles: [] }), null);
});

test('Story Studio drops a place link once the place changes', () => {
  const extras = { a1: { contextLinks: [PINSK, ALIYAH], lat: 52.1, lng: 26.1, placeForCoords: 'Pinsk' } };
  const [same] = applyEventExtras([{ id: 'a1', locationName: 'Pinsk' }], extras);
  assert.deepEqual(same.contextLinks, [PINSK, ALIYAH]);
  const [moved] = applyEventExtras([{ id: 'a1', locationName: 'Haifa' }], extras);
  assert.deepEqual(moved.contextLinks, [ALIYAH]);
  assert.equal(moved.lat, undefined);
  assert.equal('contextLinks' in dropPlaceLinks({ contextLinks: [PINSK] }), false);
});
