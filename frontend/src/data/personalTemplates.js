// Personal timeline starter templates & builder for the "Build Your Own Timeline" flow.
// These are hand-authored, non-AI sample timelines the user can edit or replace.
// Template UI names/descriptions are localized via locale files (buildOwn.templates.*);
// the sample event CONTENT below is authored in English + Hebrew, falling back to English.

import { DEFAULT_LANE_COLORS } from './laneColors';

// Short id + a lucide icon name so the modal can render a small gallery.
export const PERSONAL_TEMPLATE_META = [
  { key: 'familyStory', icon: 'Users' },
  { key: 'lifeStory', icon: 'User' },
  { key: 'familyTree', icon: 'Network' },
];

// Click-to-fill title ideas shown for the "blank canvas" option.
// Localized copies live under buildOwn.exampleChips in each locale; this is the English fallback.
export const PERSONAL_TITLE_IDEAS = [
  'Our Family Tree',
  "Grandma's Life Story",
  'Our Immigration Story',
  'My Life So Far',
  'Our Wedding',
  "Baby's First Year",
];

// Sample event content per template. Each entry: { title, description, lanes, articles }.
const TEMPLATE_CONTENT = {
  familyStory: {
    en: {
      title: 'The Rossi Family - A Family Story',
      description: 'A sample family timeline. Replace these events with your own family\'s story.',
      lanes: [{ id: 'main', title: 'Our Family', color: DEFAULT_LANE_COLORS[0], order: 1 }],
      articles: [
        { id: 's1', title: 'Nonno Giovanni is born', subtitle: 'The eldest of five, born in a small village.', category: 'Births', from: { year: 1921, month: 4, day: 12, precision: 'day' }, locationName: 'Naples, Italy', lat: 40.8518, lng: 14.2681 },
        { id: 's2', title: 'Giovanni & Maria marry', subtitle: 'Married the spring after the war ended.', category: 'Milestones', from: { year: 1946, month: 6, day: 2, precision: 'day' } },
        { id: 's3', title: 'The family emigrates', subtitle: 'Sailed across the ocean in search of work.', category: 'Journeys', from: { year: 1952, month: 9, precision: 'month' }, locationName: 'Ellis Island, New York', lat: 40.6995, lng: -74.0396 },
        { id: 's4', title: 'Opened the family bakery', subtitle: 'Three generations would work behind this counter.', category: 'Milestones', from: { year: 1958, precision: 'year' }, to: { year: 1994, precision: 'year' } },
        { id: 's5', title: 'Mom (Elena) is born', subtitle: 'The first of the family born in the new country.', category: 'Births', from: { year: 1961, month: 11, day: 3, precision: 'day' } },
        { id: 's6', title: 'Family reunion - 100 guests', subtitle: 'The whole family, together under one roof.', category: 'Gatherings', from: { year: 2018, month: 7, day: 14, precision: 'day' } },
      ],
    },
    he: {
      title: 'סיפורה של המשפחה שלנו',
      description: 'ציר זמן משפחתי לדוגמה. החליפו את האירועים בסיפור של המשפחה שלכם.',
      lanes: [{ id: 'main', title: 'המשפחה שלנו', color: DEFAULT_LANE_COLORS[0], order: 1 }],
      articles: [
        { id: 's1', title: 'סבא נולד', subtitle: 'הבן הבכור במשפחה, נולד בעיירה קטנה.', category: 'לידות', from: { year: 1948, month: 4, day: 12, precision: 'day' } },
        { id: 's2', title: 'סבא וסבתא נפגשים ומתחתנים', subtitle: 'התחלה של משפחה חדשה.', category: 'ציוני דרך', from: { year: 1972, month: 6, day: 15, precision: 'day' } },
        { id: 's3', title: 'מעבר לבית המשפחתי', subtitle: 'הבית שבו גדלו הילדים ונאספו הזיכרונות.', category: 'מסעות', from: { year: 1976, month: 9, precision: 'month' } },
        { id: 's4', title: 'אמא נולדה', subtitle: 'הילדה הראשונה במשפחה.', category: 'לידות', from: { year: 1978, month: 11, day: 3, precision: 'day' } },
        { id: 's5', title: 'הטיול המשפחתי הגדול', subtitle: 'כל המשפחה יחד בהרפתקה בלתי נשכחת.', category: 'מפגשים', from: { year: 2019, month: 7, day: 14, precision: 'day' } },
      ],
    },
    kids_en: {
      title: 'Our Awesome Family Story',
      description: 'A sample family adventure! Edit these events or add your own family memories.',
      lanes: [{ id: 'main', title: 'Our Family', color: DEFAULT_LANE_COLORS[0], order: 1 }],
      articles: [
        { id: 's1', title: 'Grandpa & Grandma meet', subtitle: 'Where our family adventure began!', category: 'Family', from: { year: 1980, precision: 'year' } },
        { id: 's2', title: 'Mom & Dad start our family', subtitle: 'Moving into our first home together.', category: 'Home', from: { year: 2010, precision: 'year' } },
        { id: 's3', title: 'I was born!', subtitle: 'The day I joined the family.', category: 'Birthdays', from: { year: 2015, month: 5, day: 10, precision: 'day' } },
        { id: 's4', title: 'We adopted our family pet', subtitle: 'Our furry best friend came home!', category: 'Pets', from: { year: 2019, month: 8, precision: 'month' } },
        { id: 's5', title: 'Best family vacation ever', subtitle: 'Exploring, laughing, and making memories together.', category: 'Trips', from: { year: 2023, month: 7, precision: 'month' } },
      ],
    },
    kids_he: {
      title: 'הסיפור המגניב של המשפחה שלנו',
      description: 'ציר זמן משפחתי לדוגמה! תוכלו לערוך את האירועים ולהוסיף את הזיכרונות של המשפחה שלכם.',
      lanes: [{ id: 'main', title: 'המשפחה שלנו', color: DEFAULT_LANE_COLORS[0], order: 1 }],
      articles: [
        { id: 's1', title: 'סבא וסבתא נפגשים', subtitle: 'כאן התחיל הסיפור של המשפחה שלנו!', category: 'משפחה', from: { year: 1980, precision: 'year' } },
        { id: 's2', title: 'ההורים מקימים את הבית שלנו', subtitle: 'המעבר לבית הראשון של המשפחה.', category: 'בית', from: { year: 2010, precision: 'year' } },
        { id: 's3', title: 'היום שבו נולדתי!', subtitle: 'היום שבו הצטרפתי למשפחה.', category: 'ימי הולדת', from: { year: 2015, month: 5, day: 10, precision: 'day' } },
        { id: 's4', title: 'אימצנו חיית מחמד', subtitle: 'החבר הכי טוב שלנו על ארבע הצטרף למשפחה!', category: 'חיות מחמד', from: { year: 2019, month: 8, precision: 'month' } },
        { id: 's5', title: 'החופשה המשפחתית הכי כיפית', subtitle: 'טיול מלא בהרפתקאות, צחוק וזיכרונות מיוחדים.', category: 'טיולים', from: { year: 2023, month: 7, precision: 'month' } },
      ],
    },
  },

  lifeStory: {
    en: {
      title: 'A Life Story',
      description: 'A sample life timeline. Replace these milestones with your own.',
      lanes: [{ id: 'main', title: 'My Life', color: DEFAULT_LANE_COLORS[5], order: 1 }],
      articles: [
        { id: 'l1', title: 'Born', subtitle: 'Where it all began.', category: 'Milestones', from: { year: 1950, month: 3, day: 8, precision: 'day' } },
        { id: 'l2', title: 'First day of school', subtitle: 'A small backpack and a big morning.', category: 'Education', from: { year: 1956, month: 9, day: 1, precision: 'day' } },
        { id: 'l3', title: 'University years', subtitle: 'Studied, worked, and grew up fast.', category: 'Education', from: { year: 1968, precision: 'year' }, to: { year: 1972, precision: 'year' } },
        { id: 'l4', title: 'Got married', subtitle: 'The best decision, they always said.', category: 'Family', from: { year: 1975, month: 5, day: 20, precision: 'day' } },
        { id: 'l5', title: 'First child is born', subtitle: 'Everything changed for the better.', category: 'Family', from: { year: 1978, month: 2, day: 14, precision: 'day' } },
        { id: 'l6', title: 'Retired', subtitle: 'The start of a new chapter.', category: 'Career', from: { year: 2015, precision: 'year' } },
      ],
    },
    he: {
      title: 'סיפור חיים',
      description: 'ציר זמן אישי לדוגמה. החליפו את האירועים בציוני הדרך שלכם.',
      lanes: [{ id: 'main', title: 'החיים שלי', color: DEFAULT_LANE_COLORS[5], order: 1 }],
      articles: [
        { id: 'l1', title: 'לידה', subtitle: 'המקום והיום שבהם הכל התחיל.', category: 'ציוני דרך', from: { year: 1980, month: 3, day: 8, precision: 'day' } },
        { id: 'l2', title: 'היום הראשון בבית הספר', subtitle: 'ילקוט חדש והתרגשות גדולה.', category: 'לימודים', from: { year: 1986, month: 9, day: 1, precision: 'day' } },
        { id: 'l3', title: 'שנות הלימודים והצבא', subtitle: 'חברים חדשים, אתגרים וצמיחה.', category: 'לימודים', from: { year: 1998, precision: 'year' }, to: { year: 2004, precision: 'year' } },
        { id: 'l4', title: 'הקמת משפחה', subtitle: 'פרק חדש ומרגש בחיים.', category: 'משפחה', from: { year: 2007, month: 5, day: 20, precision: 'day' } },
        { id: 'l5', title: 'הגשמת חלום גדול', subtitle: 'רגע מיוחד שנזכור תמיד.', category: 'הישגים', from: { year: 2018, precision: 'year' } },
      ],
    },
    kids_en: {
      title: 'My Story So Far!',
      description: 'A sample timeline of your cool milestones! Edit or replace these with your own.',
      lanes: [{ id: 'main', title: 'My Adventures', color: DEFAULT_LANE_COLORS[5], order: 1 }],
      articles: [
        { id: 'l1', title: 'The Day I Was Born!', subtitle: 'Where my big adventure began!', category: 'Milestones', from: { year: 2015, month: 3, day: 8, precision: 'day' } },
        { id: 'l2', title: 'Learned to ride a bike', subtitle: 'Zooming down the street without training wheels!', category: 'Achievements', from: { year: 2020, month: 4, precision: 'month' } },
        { id: 'l3', title: 'First day of 1st Grade', subtitle: 'New backpack, new friends, and lots of fun.', category: 'School', from: { year: 2021, month: 9, day: 1, precision: 'day' } },
        { id: 'l4', title: 'Started my favorite hobby', subtitle: 'Practicing, playing, and getting better every week!', category: 'Hobbies', from: { year: 2022, precision: 'year' }, isToPresent: true },
        { id: 'l5', title: 'Awesome trip / trophy moment', subtitle: 'An unforgettable day I am super proud of!', category: 'Achievements', from: { year: 2024, month: 6, precision: 'month' } },
      ],
    },
    kids_he: {
      title: 'הסיפור שלי עד היום!',
      description: 'ציר זמן אישי לדוגמה! החליפו את האירועים ברגעים הכי מיוחדים ומגניבים שלכם.',
      lanes: [{ id: 'main', title: 'ההרפתקאות שלי', color: DEFAULT_LANE_COLORS[5], order: 1 }],
      articles: [
        { id: 'l1', title: 'היום שבו נולדתי!', subtitle: 'כאן התחילה ההרפתקה הגדולה שלי!', category: 'ציוני דרך', from: { year: 2015, month: 3, day: 8, precision: 'day' } },
        { id: 'l2', title: 'למדתי לרכוב על אופניים', subtitle: 'פעם ראשונה בלי גלגלי עזר!', category: 'הישגים', from: { year: 2020, month: 4, precision: 'month' } },
        { id: 'l3', title: 'היום הראשון בכיתה א׳', subtitle: 'ילקוט חדש, חברים חדשים והמון התרגשות.', category: 'בית ספר', from: { year: 2021, month: 9, day: 1, precision: 'day' } },
        { id: 'l4', title: 'התחלתי את החוג האהוב עליי', subtitle: 'מתאמנים, נהנים ומשתפרים משבוע לשבוע!', category: 'תחביבים', from: { year: 2022, precision: 'year' }, isToPresent: true },
        { id: 'l5', title: 'טיול מיוחד או ניצחון בטורניר', subtitle: 'יום בלתי נשכח שאני ממש גאה בו!', category: 'הישגים', from: { year: 2024, month: 6, precision: 'month' } },
      ],
    },
  },

  familyTree: {
    en: {
      title: 'Our Family Tree',
      description: 'A sample family tree by generation. Replace with your own relatives.',
      lanes: [{ id: 'main', title: 'Generations', color: DEFAULT_LANE_COLORS[2], order: 1 }],
      articles: [
        { id: 't1', title: 'Great-grandparents', subtitle: 'The oldest branch we know of.', category: 'Generation 1', from: { year: 1890, precision: 'year' }, to: { year: 1965, precision: 'year' } },
        { id: 't2', title: 'Grandparents', subtitle: 'Where the family stories begin.', category: 'Generation 2', from: { year: 1920, precision: 'year' }, to: { year: 2001, precision: 'year' } },
        { id: 't3', title: 'Parents', subtitle: 'Their marriage and their children.', category: 'Generation 3', from: { year: 1952, precision: 'year' }, isToPresent: true },
        { id: 't4', title: 'Our generation', subtitle: 'Siblings, cousins, and their families.', category: 'Generation 4', from: { year: 1980, precision: 'year' }, isToPresent: true },
        { id: 't5', title: 'The youngest branch', subtitle: 'The newest additions to the family.', category: 'Generation 5', from: { year: 2010, precision: 'year' }, isToPresent: true },
      ],
    },
    he: {
      title: 'עץ המשפחה שלנו',
      description: 'עץ משפחה לדוגמה לפי דורות. החליפו בבני המשפחה שלכם.',
      lanes: [{ id: 'main', title: 'דורות במשפחה', color: DEFAULT_LANE_COLORS[2], order: 1 }],
      articles: [
        { id: 't1', title: 'סבא-רבא וסבתא-רבתא', subtitle: 'השורשים הראשונים של המשפחה שלנו.', category: 'דור 1', from: { year: 1920, precision: 'year' }, to: { year: 2000, precision: 'year' } },
        { id: 't2', title: 'סבא וסבתא', subtitle: 'הסיפורים והמסורות שעוברים במשפחה.', category: 'דור 2', from: { year: 1950, precision: 'year' }, isToPresent: true },
        { id: 't3', title: 'ההורים, הדודים והדודות', subtitle: 'הדור שהקים את המשפחות שלנו.', category: 'דור 3', from: { year: 1980, precision: 'year' }, isToPresent: true },
        { id: 't4', title: 'אנחנו, האחים ובני הדודים', subtitle: 'הדור הצעיר של המשפחה!', category: 'דור 4', from: { year: 2010, precision: 'year' }, isToPresent: true },
      ],
    },
  },
};

function shortId() {
  return Math.random().toString(36).slice(2, 10);
}

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

function resolveTemplateContent(templateKey, lang = 'en', contentMode = 'classic') {
  const tpl = TEMPLATE_CONTENT[templateKey];
  if (!tpl) return null;
  if (contentMode === 'kids') {
    const kidsKey = `kids_${lang}`;
    if (tpl[kidsKey]) return tpl[kidsKey];
    if (tpl.kids_en && lang === 'en') return tpl.kids_en;
  }
  return tpl[lang] || tpl.en;
}

/**
 * Return the lanes of a starter template as a simple [{ id, title }] list,
 * used to seed the editable topics list in the creation modal.
 */
export function getTemplateLanes(templateKey, lang = 'en', contentMode = 'classic') {
  const content = resolveTemplateContent(templateKey, lang, contentMode);
  if (!content) return [];
  return content.lanes.map((l) => ({ id: l.id, title: l.title }));
}

/**
 * Build a valid, ready-to-edit personal TimelineData object locally (no AI/backend call).
 */
export function buildPersonalTimeline({ title = '', description = '', templateKey = null, lang = 'en', lanes = null, contentMode = 'classic' } = {}) {
  const trimmedTitle = (title || '').trim();
  const useTemplate = templateKey && templateKey !== 'blank' && TEMPLATE_CONTENT[templateKey];
  const content = useTemplate ? resolveTemplateContent(templateKey, lang, contentMode) : null;

  const slug = slugify(trimmedTitle) || 'personal';
  const id = `${shortId()}-${slug}`;

  // Resolve the lanes: use the user-edited list if provided, otherwise the template/blank defaults.
  let finalLanes;
  const editedLanes = Array.isArray(lanes)
    ? lanes.filter((l) => (l && (l.title || '').trim()) || (l && l.id))
    : null;

  if (editedLanes && editedLanes.length > 0) {
    const usedIds = new Set();
    finalLanes = editedLanes.map((l, idx) => {
      let laneId = (l.id || '').trim() || slugify(l.title) || `lane-${idx + 1}`;
      while (usedIds.has(laneId)) laneId = `${laneId}-${idx + 1}`;
      usedIds.add(laneId);
      return {
        id: laneId,
        title: (l.title || '').trim() || trimmedTitle || 'Timeline',
        color: DEFAULT_LANE_COLORS[idx % DEFAULT_LANE_COLORS.length],
        order: idx + 1,
      };
    });
  } else if (useTemplate) {
    finalLanes = content.lanes.map((l) => ({ ...l }));
  } else {
    finalLanes = [{ id: 'main', title: trimmedTitle || 'Timeline', color: DEFAULT_LANE_COLORS[0], order: 1 }];
  }

  const validLaneIds = new Set(finalLanes.map((l) => l.id));
  const fallbackLaneId = finalLanes[0].id;

  // Template articles reference the original template lane ids (preserved when only titles were edited);
  // reassign any orphaned article to the first lane so nothing points at a removed lane.
  const articles = useTemplate
    ? content.articles.map((a) => {
        const laneRef = a.lane || content.lanes[0].id;
        return { ...a, lane: validLaneIds.has(laneRef) ? laneRef : fallbackLaneId };
      })
    : [];

  return {
    id,
    title: trimmedTitle || (content ? content.title : ''),
    description: description || (content ? content.description : ''),
    timeScale: 'calendar',
    lanes: finalLanes,
    timeBands: [],
    articles,
    isFictional: false,
    isPersonal: true,
    isManual: true,
  };
}
