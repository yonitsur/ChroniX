import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROMPT_EXAMPLES,
  KIDS_PROMPT_EXAMPLES,
  PROMPT_SKILL_TAGS,
  resolvePromptSkillTag,
  getSmartShuffledExamples,
} from '../src/data/promptExamplesData.js';
import { en as enLocale } from '../src/locales/en.js';
import { he as heLocale } from '../src/locales/he.js';

const POOLS = [
  { mode: 'classic', list: PROMPT_EXAMPLES, expectedPerLang: 42, expectedPerTag: 6 },
  { mode: 'kids', list: KIDS_PROMPT_EXAMPLES, expectedPerLang: 28, expectedPerTag: 4 },
];

describe('promptExamplesData pools & skillTag pedagogy', () => {
  it('defines 7 distinct prompting skill tags', () => {
    assert.equal(PROMPT_SKILL_TAGS.length, 7);
    assert.equal(new Set(PROMPT_SKILL_TAGS).size, 7);
  });

  for (const { mode, list, expectedPerLang, expectedPerTag } of POOLS) {
    for (const lang of ['en', 'he']) {
      it(`${mode} (${lang}) has ${expectedPerLang} unique prompts evenly distributed across all 7 skill tags`, () => {
        const slice = list.filter((p) => p.lang === lang);
        assert.equal(slice.length, expectedPerLang);

        const seenPrompts = new Set();
        const tagCounts = new Map();

        for (const item of slice) {
          assert.equal(typeof item.prompt, 'string');
          assert.ok(item.prompt.trim().length >= 25, `Prompt too short: ${item.prompt}`);
          assert.ok(!seenPrompts.has(item.prompt), `Duplicate prompt: ${item.prompt}`);
          seenPrompts.add(item.prompt);

          const tag = resolvePromptSkillTag(item);
          assert.ok(PROMPT_SKILL_TAGS.includes(tag), `Unknown skillTag "${tag}" on: ${item.prompt}`);
          assert.equal(Boolean(item.isParallel), tag === 'parallel');
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }

        for (const expectedTag of PROMPT_SKILL_TAGS) {
          assert.equal(
            tagCounts.get(expectedTag),
            expectedPerTag,
            `Expected ${expectedPerTag} "${expectedTag}" prompts in ${mode}/${lang}, found ${tagCounts.get(expectedTag) || 0}`
          );
        }
      });
    }
  }
});

describe('getSmartShuffledExamples stratified anti-clump shuffle', () => {
  it('filters strictly by language and content mode and respects optional limit', () => {
    for (const { mode, expectedPerLang } of POOLS) {
      for (const lang of ['en', 'he']) {
        const full = getSmartShuffledExamples(lang, null, mode);
        assert.equal(full.length, expectedPerLang);
        assert.ok(full.every((p) => p.lang === lang));

        const limited = getSmartShuffledExamples(lang, 7, mode);
        assert.equal(limited.length, 7);
        assert.equal(new Set(limited.map((p) => resolvePromptSkillTag(p))).size, 7);
      }
    }
  });

  it('prevents adjacent identical skillTags across rounds and across the triplicated carousel seam', () => {
    for (const lang of ['he', 'en']) {
      for (let trial = 0; trial < 30; trial++) {
        const shuffled = getSmartShuffledExamples(lang, null, 'classic');
        const triplicated = [...shuffled, ...shuffled, ...shuffled];
        for (let i = 1; i < triplicated.length; i++) {
          assert.notEqual(
            resolvePromptSkillTag(triplicated[i - 1]),
            resolvePromptSkillTag(triplicated[i]),
            `Adjacent duplicate skillTag (${lang}) at index ${i - 1} -> ${i}`
          );
        }
      }
    }
  });
});

describe('locale translations for promptSkills & promptGuide', () => {
  const EXPECTED_GUIDE_SECTIONS = ['simple', 'focus', 'microTime', 'depth', 'parallel', 'fiction', 'language'];

  for (const [langCode, dict] of [['en', enLocale], ['he', heLocale]]) {
    it(`${langCode} defines all promptSkills and promptGuide sections (root & kidsMode)`, () => {
      for (const tag of PROMPT_SKILL_TAGS) {
        assert.equal(typeof dict.promptSkills?.[tag], 'string', `Missing ${langCode}.promptSkills.${tag}`);
        assert.ok(dict.promptSkills[tag].trim().length > 0);

        assert.equal(
          typeof dict.kidsMode?.promptSkills?.[tag],
          'string',
          `Missing ${langCode}.kidsMode.promptSkills.${tag}`
        );
        assert.ok(dict.kidsMode.promptSkills[tag].trim().length > 0);
      }

      for (const sec of EXPECTED_GUIDE_SECTIONS) {
        assert.equal(typeof dict.promptGuide?.sections?.[sec]?.title, 'string');
        assert.equal(typeof dict.promptGuide?.sections?.[sec]?.body, 'string');
        assert.equal(typeof dict.promptGuide?.sections?.[sec]?.example, 'string');

        assert.equal(typeof dict.kidsMode?.promptGuide?.sections?.[sec]?.title, 'string');
        assert.equal(typeof dict.kidsMode?.promptGuide?.sections?.[sec]?.body, 'string');
        assert.equal(typeof dict.kidsMode?.promptGuide?.sections?.[sec]?.example, 'string');
      }
    });
  }
});
