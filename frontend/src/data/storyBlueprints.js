// Story Studio blueprints: the structure of a personal timeline, not sample content.
// Each blueprint describes who the story is about (people), how it is laid out (lanes),
// the handful of anchor moments worth asking about first, and how chapters (time bands)
// can be derived. buildStoryTimeline() turns a blueprint + the user's answers into a
// TimelineData object entirely on the client - no AI, no credits.
//
// Strings are bilingual ({ en, he }). `{p1}` / `{p2}` placeholders are replaced with the
// people's names. Pure module (no React / import.meta) so it runs under node --test.

import { parseFuzzyDate, toTimelineDate, fuzzyDateToDecimal } from '../utils/fuzzyDate.js';
import { randomHexId } from '../utils/randomId.js';

export const STORY_LANE_COLORS = ['#925434', '#2563a2', '#2e6b56', '#6e395e', '#b87326', '#3f6f8f'];
const BAND_ALPHA = 0.09;

const L = (en, he) => ({ en, he });

// Shared chapter-name suggestions offered as one-click chips.
const LIFE_CHAPTERS = [
  L('Childhood', 'ילדות'), L('School years', 'שנות בית הספר'), L('Army / National service', 'צבא / שירות לאומי'),
  L('University', 'לימודים'), L('Career', 'קריירה'), L('Raising a family', 'גידול המשפחה'), L('Retirement', 'פרישה'),
];

export const STORY_BLUEPRINTS = [
  {
    key: 'lifeStory',
    icon: 'User',
    name: L('Life story', 'סיפור חיים'),
    tagline: L('One person\'s life - a gift, a birthday, a tribute.', 'החיים של אדם אחד - למתנה, ליום הולדת עגול או למחווה.'),
    people: [{ id: 'p1', label: L('Whose story is it?', 'של מי הסיפור?'), placeholder: L('e.g. Grandpa Arthur', 'למשל: סבא אברהם'), fallback: L('Someone special', 'מישהו מיוחד') }],
    title: L('The Life of {p1}', 'סיפור החיים של {p1}'),
    lanes: [
      { id: 'life', title: L('{p1}\'s life', 'החיים של {p1}') },
      { id: 'family', title: L('Family', 'משפחה') },
      { id: 'work', title: L('Work & passions', 'עבודה ותחביבים') },
    ],
    anchors: [
      { id: 'born', lane: 'life', place: true, rank: 9, label: L('When and where was {p1} born?', 'מתי ואיפה {p1} נולד/ה?'), eventTitle: L('{p1} is born', '{p1} נולד/ה'), category: L('Milestones', 'ציוני דרך') },
      { id: 'school', lane: 'life', span: true, place: true, rank: 5, label: L('School years (from - to)', 'שנות בית הספר (מ- עד)'), eventTitle: L('School years', 'שנות בית הספר'), category: L('Education', 'לימודים') },
      { id: 'firstJob', lane: 'work', place: true, rank: 6, label: L('First job - when and where?', 'העבודה הראשונה - מתי ואיפה?'), eventTitle: L('First job', 'העבודה הראשונה'), category: L('Work', 'עבודה') },
      { id: 'married', lane: 'family', place: true, rank: 8, label: L('Wedding - when and where?', 'החתונה - מתי ואיפה?'), eventTitle: L('{p1} gets married', 'החתונה של {p1}'), category: L('Family', 'משפחה') },
      { id: 'firstChild', lane: 'family', rank: 7, label: L('First child born', 'הילד/ה הראשון/ה נולד/ה'), eventTitle: L('First child is born', 'הילד/ה הראשון/ה נולד/ה'), category: L('Family', 'משפחה') },
      { id: 'retired', lane: 'work', rank: 5, label: L('Retirement', 'פרישה'), eventTitle: L('Retirement', 'פרישה לגמלאות'), category: L('Work', 'עבודה') },
    ],
    chapterSuggestions: LIFE_CHAPTERS,
    autoChapters: [],
  },
  {
    key: 'couple',
    icon: 'Heart',
    name: L('Couple & wedding', 'זוגיות וחתונה'),
    tagline: L('Two paths that meet - perfect for a wedding or anniversary.', 'שני מסלולים שנפגשים - מושלם לחתונה או ליום נישואין.'),
    people: [
      { id: 'p1', label: L('First partner', 'בן/בת הזוג הראשון/ה'), placeholder: L('e.g. Claire', 'למשל: נועה'), fallback: L('Partner 1', 'בן/בת זוג 1') },
      { id: 'p2', label: L('Second partner', 'בן/בת הזוג השני/ה'), placeholder: L('e.g. Ethan', 'למשל: איתי'), fallback: L('Partner 2', 'בן/בת זוג 2') },
    ],
    title: L('{p1} & {p2}', '{p1} ו{p2}'),
    lanes: [
      { id: 'p1', title: L('{p1}\'s path', 'הדרך של {p1}') },
      { id: 'p2', title: L('{p2}\'s path', 'הדרך של {p2}') },
      { id: 'together', title: L('Together', 'ביחד') },
    ],
    anchors: [
      { id: 'p1born', lane: 'p1', place: true, rank: 8, label: L('When and where was {p1} born?', 'מתי ואיפה {p1} נולד/ה?'), eventTitle: L('{p1} is born', '{p1} נולד/ה'), category: L('Childhood', 'ילדות') },
      { id: 'p2born', lane: 'p2', place: true, rank: 8, label: L('When and where was {p2} born?', 'מתי ואיפה {p2} נולד/ה?'), eventTitle: L('{p2} is born', '{p2} נולד/ה'), category: L('Childhood', 'ילדות') },
      { id: 'met', lane: 'together', place: true, rank: 10, label: L('When and where did you meet?', 'מתי ואיפה נפגשתם?'), eventTitle: L('{p1} & {p2} meet', '{p1} ו{p2} נפגשים'), category: L('Our story', 'הסיפור שלנו') },
      { id: 'movedIn', lane: 'together', place: true, rank: 6, label: L('Moved in together', 'עברתם לגור יחד'), eventTitle: L('Moving in together', 'עוברים לגור יחד'), category: L('Our story', 'הסיפור שלנו') },
      { id: 'engaged', lane: 'together', place: true, rank: 8, label: L('The proposal', 'ההצעה'), eventTitle: L('The proposal', 'ההצעה'), category: L('Our story', 'הסיפור שלנו') },
      { id: 'wedding', lane: 'together', place: true, rank: 10, label: L('The wedding', 'החתונה'), eventTitle: L('The wedding', 'החתונה'), category: L('Our story', 'הסיפור שלנו') },
    ],
    chapterSuggestions: [L('Childhood', 'ילדות'), L('Student years', 'שנות הלימודים'), L('First home', 'הבית הראשון'), L('Engaged', 'מאורסים')],
    autoChapters: [
      { id: 'beforeMet', title: L('Before we met', 'לפני שנפגשנו'), from: 'start', to: ['met'] },
      { id: 'together', title: L('Together', 'ביחד'), from: 'met', to: ['wedding', 'now'] },
      { id: 'married', title: L('Married', 'נשואים'), from: 'wedding', to: ['now'] },
    ],
  },
  {
    key: 'child',
    icon: 'Baby',
    name: L('Child growing up', 'ילד/ה גדל/ה'),
    tagline: L('From the first day - firsts, birthdays and big steps.', 'מהיום הראשון - הפעם הראשונה, ימי הולדת וצעדים גדולים.'),
    people: [{ id: 'p1', label: L('Child\'s name', 'שם הילד/ה'), placeholder: L('e.g. Leo', 'למשל: יואב'), fallback: L('Our child', 'הילד/ה שלנו') }],
    title: L('{p1} Growing Up', '{p1} גדל/ה'),
    lanes: [
      { id: 'child', title: L('{p1}', '{p1}') },
      { id: 'family', title: L('Family', 'המשפחה') },
    ],
    anchors: [
      { id: 'born', lane: 'child', place: true, rank: 10, label: L('When and where was {p1} born?', 'מתי ואיפה {p1} נולד/ה?'), eventTitle: L('{p1} is born!', '{p1} נולד/ה!'), category: L('Milestones', 'ציוני דרך') },
      { id: 'firstSteps', lane: 'child', rank: 7, label: L('First steps', 'הצעדים הראשונים'), eventTitle: L('First steps', 'הצעדים הראשונים'), category: L('Firsts', 'פעם ראשונה') },
      { id: 'firstWord', lane: 'child', rank: 6, label: L('First word', 'המילה הראשונה'), eventTitle: L('First word', 'המילה הראשונה'), category: L('Firsts', 'פעם ראשונה') },
      { id: 'daycare', lane: 'child', place: true, rank: 5, label: L('Started daycare / preschool', 'התחלת גן'), eventTitle: L('First day of preschool', 'היום הראשון בגן'), category: L('School', 'בית ספר') },
      { id: 'school', lane: 'child', place: true, rank: 8, label: L('First day of school', 'היום הראשון בבית הספר'), eventTitle: L('First day of school', 'היום הראשון בכיתה א\''), category: L('School', 'בית ספר') },
      { id: 'sibling', lane: 'family', rank: 7, label: L('A sibling is born (optional)', 'נולד/ה אח/ות (לא חובה)'), eventTitle: L('A new sibling', 'אח/ות חדש/ה'), category: L('Family', 'משפחה') },
    ],
    chapterSuggestions: [L('Summer vacation', 'החופש הגדול'), L('New home', 'הבית החדש')],
    autoChapters: [
      { id: 'ages', type: 'ages', anchor: 'born', ranges: [
        { id: 'baby', title: L('Baby', 'תינוק/ת'), from: 0, to: 1 },
        { id: 'toddler', title: L('Toddler', 'פעוט/ה'), from: 1, to: 3 },
        { id: 'preschool', title: L('Preschool', 'גן'), from: 3, to: 6 },
        { id: 'school', title: L('School years', 'בית הספר'), from: 6, to: 12 },
        { id: 'teen', title: L('Teen years', 'גיל ההתבגרות'), from: 12, to: 18 },
      ] },
    ],
  },
  {
    key: 'familyHistory',
    icon: 'Network',
    name: L('Family history', 'היסטוריה משפחתית'),
    tagline: L('Roots, journeys and generations - two sides that become one family.', 'שורשים, מסעות ודורות - שני צדדים שהופכים למשפחה אחת.'),
    people: [
      { id: 'p1', label: L('One side of the family (surname)', 'צד אחד של המשפחה (שם משפחה)'), placeholder: L('e.g. Mercier', 'למשל: כהן'), fallback: L('Father\'s', 'האב') },
      { id: 'p2', label: L('The other side (surname, optional)', 'הצד השני (שם משפחה, לא חובה)'), placeholder: L('e.g. Lindqvist', 'למשל: לוי'), fallback: L('Mother\'s', 'האם') },
    ],
    title: L('The {p1} Family Story', 'סיפור משפחת {p1}'),
    lanes: [
      { id: 'p1', title: L('The {p1} side', 'משפחת {p1}') },
      { id: 'p2', title: L('The {p2} side', 'משפחת {p2}') },
      { id: 'shared', title: L('Our family', 'המשפחה שלנו') },
    ],
    anchors: [
      { id: 'p1origin', lane: 'p1', place: true, rank: 7, label: L('Earliest thing you know about the {p1} side', 'הדבר המוקדם ביותר שידוע על משפחת {p1}'), eventTitle: L('The {p1} family\'s roots', 'השורשים של משפחת {p1}'), category: L('Roots', 'שורשים') },
      { id: 'p1move', lane: 'p1', place: true, rank: 8, label: L('A big move or migration ({p1} side)', 'מעבר גדול או הגירה (משפחת {p1})'), eventTitle: L('The {p1} family moves', 'משפחת {p1} עוברת'), category: L('Journeys', 'מסעות') },
      { id: 'p2origin', lane: 'p2', place: true, rank: 7, label: L('Earliest thing you know about the {p2} side', 'הדבר המוקדם ביותר שידוע על משפחת {p2}'), eventTitle: L('The {p2} family\'s roots', 'השורשים של משפחת {p2}'), category: L('Roots', 'שורשים') },
      { id: 'p2move', lane: 'p2', place: true, rank: 8, label: L('A big move or migration ({p2} side)', 'מעבר גדול או הגירה (משפחת {p2})'), eventTitle: L('The {p2} family moves', 'משפחת {p2} עוברת'), category: L('Journeys', 'מסעות') },
      { id: 'joined', lane: 'shared', place: true, rank: 10, label: L('When did the two families join (a wedding)?', 'מתי שתי המשפחות התחברו (חתונה)?'), eventTitle: L('The two families join', 'שתי המשפחות מתאחדות'), category: L('Family', 'משפחה') },
    ],
    chapterSuggestions: [L('The old country', 'בארץ המוצא'), L('The journey', 'המסע'), L('New beginnings', 'התחלה חדשה'), L('The next generation', 'הדור הבא')],
    autoChapters: [
      { id: 'twoFamilies', title: L('Two families', 'שתי משפחות'), from: 'start', to: ['joined'] },
      { id: 'oneFamily', title: L('One family', 'משפחה אחת'), from: 'joined', to: ['now'] },
    ],
  },
  {
    key: 'trip',
    icon: 'Plane',
    name: L('A journey or trip', 'מסע או טיול'),
    tagline: L('Day by day, place by place - a trip you want to remember.', 'יום אחרי יום, מקום אחרי מקום - טיול שרוצים לזכור.'),
    people: [{ id: 'p1', label: L('Where did you go?', 'לאן נסעתם?'), placeholder: L('e.g. Japan', 'למשל: יפן'), fallback: L('Our trip', 'הטיול שלנו') }],
    title: L('Our Trip to {p1}', 'הטיול שלנו ל{p1}'),
    lanes: [{ id: 'journey', title: L('The journey', 'המסע') }],
    anchors: [
      { id: 'depart', lane: 'journey', place: true, rank: 9, label: L('Departure - when and from where?', 'יציאה לדרך - מתי ומאיפה?'), eventTitle: L('Setting off', 'יוצאים לדרך'), category: L('Travel', 'דרכים') },
      { id: 'return', lane: 'journey', place: true, rank: 9, label: L('Coming home', 'חוזרים הביתה'), eventTitle: L('Home again', 'חוזרים הביתה'), category: L('Travel', 'דרכים') },
    ],
    chapterSuggestions: [L('First week', 'השבוע הראשון'), L('The road trip', 'הטיול בדרכים'), L('The city', 'העיר')],
    autoChapters: [{ id: 'trip', title: L('{p1}', '{p1}'), from: 'depart', to: ['return'] }],
    momentsHint: L('Add each stop or highlight below - a place and a date is enough.', 'הוסיפו כל תחנה או רגע מיוחד למטה - מקום ותאריך מספיקים.'),
  },
  {
    key: 'career',
    icon: 'Briefcase',
    name: L('Career or project', 'קריירה או פרויקט'),
    tagline: L('Studies, roles and achievements - a professional journey.', 'לימודים, תפקידים והישגים - מסע מקצועי.'),
    people: [{ id: 'p1', label: L('Whose career?', 'הקריירה של מי?'), placeholder: L('e.g. Dana', 'למשל: דנה'), fallback: L('Me', 'אני') }],
    title: L('{p1}: A Career Journey', '{p1}: המסע המקצועי'),
    lanes: [
      { id: 'work', title: L('Roles', 'תפקידים') },
      { id: 'learning', title: L('Learning', 'לימודים') },
      { id: 'wins', title: L('Projects & recognition', 'פרויקטים והישגים') },
    ],
    anchors: [
      { id: 'studies', lane: 'learning', span: true, place: true, rank: 7, label: L('Studies (from - to)', 'לימודים (מ- עד)'), eventTitle: L('Studies', 'לימודים'), category: L('Education', 'השכלה') },
      { id: 'firstJob', lane: 'work', place: true, rank: 8, label: L('First real job', 'העבודה הרצינית הראשונה'), eventTitle: L('First job', 'העבודה הראשונה'), category: L('Roles', 'תפקידים') },
      { id: 'milestone', lane: 'wins', rank: 9, label: L('Proudest achievement', 'ההישג הכי גדול'), eventTitle: L('A proud milestone', 'הישג גדול'), category: L('Achievements', 'הישגים') },
      { id: 'current', lane: 'work', place: true, toPresent: true, rank: 8, label: L('Current role - since when?', 'התפקיד הנוכחי - ממתי?'), eventTitle: L('Current role', 'התפקיד הנוכחי'), category: L('Roles', 'תפקידים') },
    ],
    chapterSuggestions: [L('Early career', 'תחילת הדרך'), L('Building expertise', 'בניית מומחיות'), L('Leadership', 'ניהול')],
    autoChapters: [],
  },
  {
    key: 'memorial',
    icon: 'Flower2',
    name: L('In memory', 'לזכר'),
    tagline: L('Honour someone\'s life and the people they touched.', 'לכבד את החיים של מישהו ואת האנשים שנגע בהם.'),
    people: [{ id: 'p1', label: L('Who are you remembering?', 'את מי אתם זוכרים?'), placeholder: L('e.g. Miriam', 'למשל: מרים'), fallback: L('Someone special', 'מישהו מיוחד') }],
    title: L('In Memory of {p1}', 'לזכרו/ה של {p1}'),
    lanes: [
      { id: 'life', title: L('{p1}\'s life', 'החיים של {p1}') },
      { id: 'family', title: L('Family & friends', 'משפחה וחברים') },
      { id: 'legacy', title: L('Legacy', 'מורשת') },
    ],
    anchors: [
      { id: 'born', lane: 'life', place: true, rank: 9, label: L('When and where was {p1} born?', 'מתי ואיפה {p1} נולד/ה?'), eventTitle: L('{p1} is born', '{p1} נולד/ה'), category: L('Life', 'חיים') },
      { id: 'married', lane: 'family', place: true, rank: 8, label: L('Marriage (optional)', 'נישואים (לא חובה)'), eventTitle: L('{p1} gets married', 'החתונה של {p1}'), category: L('Family', 'משפחה') },
      { id: 'passed', lane: 'life', place: true, rank: 9, label: L('When did {p1} pass away?', 'מתי {p1} הלך/ה לעולמו/ה?'), eventTitle: L('{p1} passes away', '{p1} - יום הפטירה'), category: L('Life', 'חיים') },
    ],
    chapterSuggestions: LIFE_CHAPTERS,
    autoChapters: [{ id: 'aLife', title: L('A life', 'החיים'), from: 'born', to: ['passed'] }],
  },
  {
    key: 'custom',
    icon: 'Sparkles',
    name: L('Something else', 'משהו אחר'),
    tagline: L('A pet, a house, a team, a hobby - you choose the lanes.', 'חיית מחמד, בית, קבוצה, תחביב - אתם בוחרים את המסלולים.'),
    people: [],
    title: L('', ''),
    customLanes: true,
    lanes: [],
    anchors: [],
    chapterSuggestions: [],
    autoChapters: [],
  },
];

const BY_KEY = Object.fromEntries(STORY_BLUEPRINTS.map((b) => [b.key, b]));

export function getStoryBlueprint(key) {
  return BY_KEY[key] || null;
}

export function pickLang(value, lang = 'en') {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[lang] ?? value.en ?? '';
}

/** Names used for {p1}/{p2} substitution: the user's answer, else the blueprint fallback. */
export function resolvePeopleNames(blueprint, answers = {}, lang = 'en') {
  const names = {};
  for (const p of blueprint?.people || []) {
    const typed = (answers.people?.[p.id] || '').trim();
    names[p.id] = typed || pickLang(p.fallback, lang);
  }
  return names;
}

export function fillTemplate(value, names, lang = 'en') {
  return pickLang(value, lang).replace(/\{(p\d)\}/g, (_, id) => names[id] ?? '').replace(/\s{2,}/g, ' ').trim();
}

/** A fresh, empty set of answers for a blueprint. */
export function emptyStoryAnswers(blueprint, { initialName = '' } = {}) {
  const people = {};
  (blueprint?.people || []).forEach((p, i) => { people[p.id] = i === 0 ? initialName : ''; });
  return {
    people,
    anchors: {},
    chapters: [],
    hiddenAutoChapters: [],
    moments: [],
    customLanes: blueprint?.customLanes ? [{ id: 'lane-1', title: '' }] : [],
    title: '',
    overview: '',
  };
}

function resolveLanes(blueprint, answers, names, lang) {
  if (blueprint.customLanes) {
    const rows = (answers.customLanes || []).filter((l) => (l.title || '').trim());
    const list = rows.length ? rows : [{ id: 'main', title: lang === 'he' ? 'ציר הזמן' : 'Timeline' }];
    return list.map((l, i) => ({ id: l.id || `lane-${i + 1}`, title: l.title.trim(), color: STORY_LANE_COLORS[i % STORY_LANE_COLORS.length], order: i + 1 }));
  }
  const lanes = blueprint.lanes.map((l, i) => ({
    id: l.id,
    title: (answers.laneTitles?.[l.id] || '').trim() || fillTemplate(l.title, names, lang),
    color: STORY_LANE_COLORS[i % STORY_LANE_COLORS.length],
    order: i + 1,
  }));
  // Lanes added outside the Studio (e.g. in the Edit panel) are carried through untouched.
  for (const extra of answers.extraLanes || []) {
    if (!extra?.id || lanes.some((l) => l.id === extra.id)) continue;
    lanes.push({ color: STORY_LANE_COLORS[lanes.length % STORY_LANE_COLORS.length], order: lanes.length + 1, ...extra });
  }
  return lanes;
}

// A moment's "what happened" text becomes the event's description (the drawer's story text).
// Marked custom so a Wikipedia link added later never replaces it.
const storyText = (story) => {
  const text = (story || '').trim();
  return text ? { extract: text, extractIsCustom: true } : {};
};

/** Anchor answers -> articles. Only anchors with a readable date become events. */
function anchorArticles(blueprint, answers, names, lang, now, laneIds) {
  const out = [];
  for (const a of blueprint.anchors) {
    const ans = answers.anchors?.[a.id];
    const from = parseFuzzyDate(ans?.date, { lang, now });
    if (!from) continue;
    // `to` is asked for span anchors; for others it round-trips an end date added outside the Studio.
    const to = parseFuzzyDate(ans?.to, { lang, now });
    const place = (ans?.place || '').trim();
    const article = {
      id: ans.articleId || `ss-${a.id}`,
      title: (ans.title || '').trim() || fillTemplate(a.eventTitle, names, lang),
      subtitle: (ans?.note || '').trim(),
      ...storyText(ans?.story),
      lane: (ans?.lane && laneIds.has(ans.lane)) ? ans.lane : a.lane,
      category: pickLang(a.category, lang),
      rank: a.rank ?? 5,
      from: toTimelineDate(from),
      storyAnchor: a.id,
      provenance: 'user',
    };
    if (to && fuzzyDateToDecimal(to) >= fuzzyDateToDecimal(from)) article.to = toTimelineDate(to);
    if (a.toPresent) article.isToPresent = true;
    if (from.circa || to?.circa) article.circa = true;
    if (place) article.locationName = place;
    out.push(article);
  }
  return out;
}

function momentArticles(answers, laneIds, fallbackLane, lang, now) {
  const out = [];
  (answers.moments || []).forEach((m, i) => {
    const title = (m.title || '').trim();
    const from = parseFuzzyDate(m.date, { lang, now });
    if (!title || !from) return;
    const to = parseFuzzyDate(m.to, { lang, now });
    const article = {
      id: m.articleId || `ss-m-${m.id || i}`,
      title,
      subtitle: (m.note || '').trim(),
      ...storyText(m.story),
      lane: laneIds.has(m.lane) ? m.lane : fallbackLane,
      category: typeof m.category === 'string' ? m.category.trim().slice(0, 60) : '',
      rank: Number.isInteger(m.rank) && m.rank >= 1 && m.rank <= 10 ? m.rank : 5,
      from: toTimelineDate(from),
      provenance: 'user',
      // Drafted by AI from the user's photos (the AI-first photo import): shown as such.
      ...(m.ai ? { aiWritten: true } : {}),
    };
    if (to && fuzzyDateToDecimal(to) >= fuzzyDateToDecimal(from)) article.to = toTimelineDate(to);
    if (from.circa || to?.circa) article.circa = true;
    const place = (m.place || '').trim();
    if (place) article.locationName = place;
    out.push(article);
  });
  return out;
}

const decimalToDate = (dec) => {
  const year = Math.floor(dec);
  const month = Math.min(12, Math.max(1, Math.floor((dec - year) * 12) + 1));
  return { year, month, precision: 'month' };
};

/**
 * Chapters the blueprint can infer from anchors, e.g. "Before we met" / "Together" for a couple,
 * or age bands for a child. Returned with their decimal span so callers can render or filter them.
 */
export function computeAutoChapters(blueprint, answers, { lang = 'en', now = new Date(), names } = {}) {
  const resolvedNames = names || resolvePeopleNames(blueprint, answers, lang);
  const nowDec = now.getFullYear() + now.getMonth() / 12;
  const anchorDec = {};
  for (const a of blueprint.anchors) {
    const d = parseFuzzyDate(answers.anchors?.[a.id]?.date, { lang, now });
    if (d) anchorDec[a.id] = fuzzyDateToDecimal(d);
  }
  const allDecs = Object.values(anchorDec);
  (answers.moments || []).forEach((m) => {
    const d = parseFuzzyDate(m.date, { lang, now });
    if (d) allDecs.push(fuzzyDateToDecimal(d));
  });
  const startDec = allDecs.length ? Math.min(...allDecs) : null;

  const chapters = [];
  for (const rule of blueprint.autoChapters || []) {
    if (rule.type === 'ages') {
      const birth = anchorDec[rule.anchor];
      if (birth == null) continue;
      for (const r of rule.ranges) {
        const from = birth + r.from;
        if (from > nowDec) break;
        chapters.push({ id: `auto-${r.id}`, title: fillTemplate(r.title, resolvedNames, lang), fromDec: from, toDec: Math.min(birth + r.to, nowDec) });
      }
      continue;
    }
    const fromDec = rule.from === 'start' ? startDec : anchorDec[rule.from];
    if (fromDec == null) continue;
    let toDec = null;
    for (const target of rule.to) {
      if (target === 'now') { toDec = nowDec; break; }
      if (anchorDec[target] != null) { toDec = anchorDec[target]; break; }
    }
    if (toDec == null || toDec <= fromDec) continue;
    chapters.push({ id: `auto-${rule.id}`, title: fillTemplate(rule.title, resolvedNames, lang), fromDec, toDec });
  }
  return chapters;
}

// Who the story is for (chosen at the end of the Studio). Saved with the story and sent with AI
// wording requests to set their tone; it never changes the timeline's content.
export const STORY_OCCASIONS = ['keepsake', 'gift', 'family', 'memorial'];

/** The occasion in effect: the one chosen, or "in memory" for the memorial story type. */
export function storyOccasion(blueprint, answers) {
  if (answers && typeof answers.occasion === 'string') return STORY_OCCASIONS.includes(answers.occasion) ? answers.occasion : '';
  return blueprint?.key === 'memorial' ? 'memorial' : '';
}

/**
 * Build a ready-to-open personal TimelineData object from a blueprint and the user's answers.
 * Returns { timeline, stats }. Never calls the network.
 */
export function buildStoryTimeline(blueprint, answers = {}, { lang = 'en', now = new Date(), id = null } = {}) {
  if (!blueprint) throw new Error('Unknown story blueprint');
  const names = resolvePeopleNames(blueprint, answers, lang);
  const lanes = resolveLanes(blueprint, answers, names, lang);
  const laneIds = new Set(lanes.map((l) => l.id));
  const fallbackLane = lanes[0].id;

  const articles = [
    ...anchorArticles(blueprint, answers, names, lang, now, laneIds),
    ...momentArticles(answers, laneIds, fallbackLane, lang, now),
  ];

  const hidden = new Set(answers.hiddenAutoChapters || []);
  const autoChapters = computeAutoChapters(blueprint, answers, { lang, now, names });
  const bands = autoChapters
    .filter((c) => !hidden.has(c.id))
    .map((c) => ({ id: c.id, title: c.title, from: decimalToDate(c.fromDec), to: decimalToDate(c.toDec) }));
  (answers.chapters || []).forEach((c, i) => {
    const title = (c.title || '').trim();
    const from = parseFuzzyDate(c.from, { lang, now });
    const to = parseFuzzyDate(c.to, { lang, now });
    if (!title || !from || !to || fuzzyDateToDecimal(to) < fuzzyDateToDecimal(from)) return;
    bands.push({ id: c.bandId || `ch-${c.id || i}`, title, from: toTimelineDate(from), to: toTimelineDate(to) });
  });
  bands.forEach((b, i) => { b.color = colorToBand(STORY_LANE_COLORS[i % STORY_LANE_COLORS.length]); });

  const suggestedTitle = fillTemplate(blueprint.title, names, lang);
  const title = (answers.title || '').trim() || suggestedTitle;
  const slug = slugify(title) || 'story';

  const timeline = {
    id: id || `${randomHexId()}-${slug}`,
    title,
    description: '',
    overview: (answers.overview || '').trim(),
    timeScale: 'calendar',
    lanes,
    timeBands: bands,
    articles,
    isFictional: false,
    isPersonal: true,
    // Hand-authored unless AI wrote part of it (the AI-first photo import): AI-written personal
    // timelines show their overview like other AI timelines and drop the "not AI" footer.
    isManual: !answers.aiAssisted,
    creationSource: 'manual',
    // Enough to re-open this timeline in the Studio later (see storyStudioSync.js).
    storyStudio: {
      blueprint: blueprint.key,
      version: 2,
      people: { ...(answers.people || {}) },
      hiddenAutoChapters: [...hidden],
      autoWritten: autoChapters.filter((c) => !hidden.has(c.id)).map((c) => c.id),
      ...(answers.aiAssisted ? { aiAssisted: true } : {}),
      ...(STORY_OCCASIONS.includes(answers.occasion) ? { occasion: answers.occasion } : {}),
    },
  };

  return {
    timeline,
    stats: {
      events: articles.length,
      chapters: bands.length,
      lanes: lanes.length,
      places: articles.filter((a) => a.locationName).length,
      suggestedTitle,
    },
  };
}

/**
 * The timeline as it is shown and saved: a story type's built-in lanes that ended up with no
 * events (say "Work & passions" when nothing was told about work) are left out, so the canvas
 * has no empty rows. The Studio still offers them in its forms, so a moment can be added to one
 * later and it comes back. Lanes the person named themselves (a free-form story's lanes, or
 * ones added in the Edit panel) are always kept, and so is at least one lane.
 */
export function withoutEmptyStoryLanes(timeline, blueprint) {
  if (!timeline || !blueprint || blueprint.customLanes || !Array.isArray(timeline.lanes)) return timeline;
  const builtIn = new Set((blueprint.lanes || []).map((l) => l.id));
  const used = new Set((timeline.articles || []).map((a) => a.lane));
  const lanes = timeline.lanes.filter((l) => !builtIn.has(l.id) || used.has(l.id));
  if (!lanes.length || lanes.length === timeline.lanes.length) return timeline;
  return { ...timeline, lanes: lanes.map((l, i) => ({ ...l, order: i + 1 })) };
}

function colorToBand(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${BAND_ALPHA})`;
}

function slugify(text) {
  return (text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}
