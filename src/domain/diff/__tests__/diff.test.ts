import { describe, expect, it } from 'vitest';
import {
  classifyPair,
  comparableBody,
  comparableProperties,
  DEFAULT_COMPARE,
  DEFAULT_IGNORE,
  diffSides,
  isDefaultFieldSet,
  modifiedKeys,
  parseDiffRequest,
  setDiff,
  wordDiff,
  type ComparableRow,
} from '..';

/** spec: 05-baselines-and-diff.md §5.1–5.2; RD-047 */

const row = (overrides: Partial<ComparableRow> & { key: string }): ComparableRow => ({
  title: 'A title',
  bodyHtml: '<p>The body.</p>',
  bodySearch: 'The body.',
  inlineProperties: [],
  externalProperties: [],
  dependencies: [],
  ...overrides,
});

const verdict = (
  left: ComparableRow | undefined,
  right: ComparableRow | undefined,
  compare = DEFAULT_COMPARE,
  ignore = DEFAULT_IGNORE,
) => classifyPair(left, right, compare, ignore);

describe('classifyPair (spec 05 §5.2)', () => {
  it('right only is added, left only is removed', () => {
    expect(verdict(undefined, row({ key: 'FN-1' })).kind).toBe('added');
    expect(verdict(row({ key: 'FN-1' }), undefined).kind).toBe('removed');
  });

  it('identical rows are unchanged', () => {
    expect(verdict(row({ key: 'FN-1' }), row({ key: 'FN-1' }))).toEqual({ kind: 'unchanged', changed: [] });
  });

  it('a changed title is modified, and says so', () => {
    const outcome = verdict(row({ key: 'FN-1' }), row({ key: 'FN-1', title: 'Another title' }));
    expect(outcome).toEqual({ kind: 'modified', changed: ['title'] });
  });

  it('a changed body is modified', () => {
    const outcome = verdict(
      row({ key: 'FN-1' }),
      row({ key: 'FN-1', bodySearch: 'The body, rewritten.', bodyHtml: '<p>The body, rewritten.</p>' }),
    );
    expect(outcome.changed).toEqual(['body']);
  });

  it('reports every changed field, not just the first', () => {
    const outcome = verdict(
      row({ key: 'FN-1' }),
      row({
        key: 'FN-1',
        title: 'New',
        bodySearch: 'New body',
        inlineProperties: [{ searchName: 'status', value: 'Draft', valueIndex: 0 }],
      }),
    );
    expect(outcome.changed).toEqual(['title', 'body', 'inlineProperties']);
  });

  it('a field the compare set excludes cannot make a pair modified', () => {
    const left = row({ key: 'FN-1', dependencies: [{ relationship: 'satisfies', targetKey: 'BR-1' }] });
    const right = row({ key: 'FN-1' });

    expect(verdict(left, right).kind).toBe('unchanged');
    expect(verdict(left, right, { ...DEFAULT_COMPARE, dependencies: true }).changed).toEqual(['dependencies']);
  });

  it('external properties are compared only when asked (RD-010 is about freezing them)', () => {
    const left = row({ key: 'FN-1', externalProperties: [{ searchName: 'approval', value: 'Pending', valueIndex: 0 }] });
    const right = row({ key: 'FN-1' });

    expect(verdict(left, right).kind).toBe('unchanged');
    expect(verdict(left, right, { ...DEFAULT_COMPARE, externalProperties: true }).changed).toEqual([
      'externalProperties',
    ]);
  });
});

describe('the ignore set (spec 05 §5.2 step 3, RD-047)', () => {
  const plain = row({ key: 'FN-1', bodyHtml: '<p>Hello <em>there</em>.</p>', bodySearch: 'Hello there.' });
  const formatted = row({ key: 'FN-1', bodyHtml: '<p>Hello <strong>there</strong>.</p>', bodySearch: 'Hello there.' });

  it('ignores formatting by comparing bodySearch, which has none', () => {
    expect(verdict(plain, formatted).kind).toBe('unchanged');
  });

  it('sees the formatting change once that ignore is off', () => {
    const outcome = verdict(plain, formatted, DEFAULT_COMPARE, { ...DEFAULT_IGNORE, formatting: false });
    expect(outcome.changed).toEqual(['body']);
  });

  it('with formatting compared, a swapped image is still ignorable', () => {
    const before = row({ key: 'FN-1', bodyHtml: '<p><img src="/a.png" alt="" /> Text</p>' });
    const after = row({ key: 'FN-1', bodyHtml: '<p><img src="/b.png" alt="" /> Text</p>' });

    expect(verdict(before, after, DEFAULT_COMPARE, { formatting: false, images: true, hyperlinks: true }).kind).toBe(
      'unchanged',
    );
    expect(
      verdict(before, after, DEFAULT_COMPARE, { formatting: false, images: false, hyperlinks: true }).changed,
    ).toEqual(['body']);
  });

  it('with formatting compared, a changed href is ignorable but changed link text is not', () => {
    const before = row({ key: 'FN-1', bodyHtml: '<p><a href="https://a.test">Spec</a></p>' });
    const sameText = row({ key: 'FN-1', bodyHtml: '<p><a href="https://b.test">Spec</a></p>' });
    const newText = row({ key: 'FN-1', bodyHtml: '<p><a href="https://a.test">Standard</a></p>' });

    const ignore = { formatting: false, images: true, hyperlinks: true };
    expect(verdict(before, sameText, DEFAULT_COMPARE, ignore).kind).toBe('unchanged');
    expect(verdict(before, newText, DEFAULT_COMPARE, ignore).changed).toEqual(['body']);
  });

  it('comparableBody returns bodySearch under the default ignores — the whole set at once', () => {
    expect(comparableBody(plain, DEFAULT_IGNORE)).toBe('Hello there.');
    expect(comparableBody(plain, { ...DEFAULT_IGNORE, formatting: false })).toContain('<em>');
  });
});

describe('property comparison is a set comparison', () => {
  it('ignores the order the columns happened to be in', () => {
    const left = row({
      key: 'FN-1',
      inlineProperties: [
        { searchName: 'status', value: 'Draft', valueIndex: 0 },
        { searchName: 'priority', value: 'High', valueIndex: 0 },
      ],
    });
    const right = row({
      key: 'FN-1',
      inlineProperties: [
        { searchName: 'priority', value: 'High', valueIndex: 0 },
        { searchName: 'status', value: 'Draft', valueIndex: 0 },
      ],
    });
    expect(verdict(left, right).kind).toBe('unchanged');
  });

  it('sees a changed value, an added name and a removed one', () => {
    const base = [{ searchName: 'status', value: 'Draft', valueIndex: 0 }];
    expect(comparableProperties(base)).toBe('status=Draft');
    expect(
      verdict(row({ key: 'FN-1', inlineProperties: base }), row({ key: 'FN-1', inlineProperties: [] })).changed,
    ).toEqual(['inlineProperties']);
  });

  it('distinguishes the members of a list-valued property (RD-027)', () => {
    const one = [{ searchName: 'tags', value: 'safety', valueIndex: 0 }];
    const two = [
      { searchName: 'tags', value: 'safety', valueIndex: 0 },
      { searchName: 'tags', value: 'audit', valueIndex: 1 },
    ];
    expect(verdict(row({ key: 'FN-1', inlineProperties: one }), row({ key: 'FN-1', inlineProperties: two })).changed)
      .toEqual(['inlineProperties']);
  });
});

describe('diffSides (spec 05 §5.2 step 1)', () => {
  const left = [row({ key: 'FN-1' }), row({ key: 'FN-2', title: 'Before' })];
  const right = [row({ key: 'FN-2', title: 'After' }), row({ key: 'FN-3' })];

  it('pairs by key, not by id — the whole point is comparing across snapshots', () => {
    const outcome = diffSides(left, right, DEFAULT_COMPARE, DEFAULT_IGNORE, ['added', 'removed', 'modified', 'unchanged'], 600);

    expect(outcome.summary).toEqual({ added: 1, removed: 1, modified: 1, unchanged: 0 });
    expect(outcome.rows.map((entry) => [entry.key, entry.kind])).toEqual([
      ['FN-1', 'removed'],
      ['FN-2', 'modified'],
      ['FN-3', 'added'],
    ]);
  });

  it('pairs case-insensitively, as keys are', () => {
    const outcome = diffSides([row({ key: 'fn-1' })], [row({ key: 'FN-1' })], DEFAULT_COMPARE, DEFAULT_IGNORE, ['unchanged'], 600);
    expect(outcome.summary.unchanged).toBe(1);
  });

  it('filters the rows it returns while still counting every pair', () => {
    const outcome = diffSides(left, right, DEFAULT_COMPARE, DEFAULT_IGNORE, ['modified'], 600);

    expect(outcome.rows).toHaveLength(1);
    expect(outcome.total).toBe(1);
    // The summary is the truth about the whole comparison, not about the page.
    expect(outcome.summary).toEqual({ added: 1, removed: 1, modified: 1, unchanged: 0 });
  });

  it('stops at the limit but still reports the true total (spec 05 §5.4)', () => {
    const many = Array.from({ length: 10 }, (_, index) => row({ key: `FN-${index}` }));
    const outcome = diffSides([], many, DEFAULT_COMPARE, DEFAULT_IGNORE, ['added'], 4);

    expect(outcome.rows).toHaveLength(4);
    expect(outcome.total).toBe(10);
    expect(outcome.summary.added).toBe(10);
  });

  it('names the modified keys, which is what isModified() must return', () => {
    const outcome = diffSides(left, right, DEFAULT_COMPARE, DEFAULT_IGNORE, ['modified'], 600);
    expect(modifiedKeys(outcome)).toEqual(['FN-2']);
  });
});

describe('wordDiff (spec 05 §5.2 step 5)', () => {
  it('marks only the words that changed', () => {
    const segments = wordDiff('The system shall log every access.', 'The system shall log each access.');
    expect(segments.filter((segment) => segment.kind === 'removed').map((s) => s.text.trim())).toEqual(['every']);
    expect(segments.filter((segment) => segment.kind === 'added').map((s) => s.text.trim())).toEqual(['each']);
  });

  it('rejoins to the original on each side', () => {
    const before = 'one two three four';
    const after = 'one three four five';
    const segments = wordDiff(before, after);

    const left = segments.filter((s) => s.kind !== 'added').map((s) => s.text).join('');
    const right = segments.filter((s) => s.kind !== 'removed').map((s) => s.text).join('');
    expect(left).toBe(before);
    expect(right).toBe(after);
  });

  it('runs of one kind become one segment', () => {
    const segments = wordDiff('a b c', 'a x y z c');
    expect(segments.filter((segment) => segment.kind === 'added')).toHaveLength(1);
  });

  it('handles an empty side', () => {
    expect(wordDiff('', 'new text').every((segment) => segment.kind === 'added')).toBe(true);
    expect(wordDiff('old text', '').every((segment) => segment.kind === 'removed')).toBe(true);
    expect(wordDiff('', '')).toEqual([]);
  });

  it('falls back to whole sides rather than costing a page render', () => {
    const huge = Array.from({ length: 2_000 }, (_, index) => `word${index}`).join(' ');
    const segments = wordDiff(huge, `${huge} extra`);
    expect(segments.map((segment) => segment.kind)).toEqual(['removed', 'added']);
  });
});

describe('setDiff', () => {
  it('splits into added, removed and kept', () => {
    expect(setDiff(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'], kept: ['b'] });
  });

  it('is order-independent', () => {
    expect(setDiff(['b', 'a'], ['a', 'b'])).toEqual({ added: [], removed: [], kept: ['a', 'b'] });
  });
});

describe('parseDiffRequest', () => {
  it('fills the documented defaults (spec 05 §5.1)', () => {
    const request = parseDiffRequest({ left: ' baseline = 1 ', right: "key ~ 'FN-%'" });

    expect(request.left).toBe('baseline = 1');
    expect(request.compare).toEqual(DEFAULT_COMPARE);
    expect(request.ignore).toEqual(DEFAULT_IGNORE);
    expect(request.limit).toBe(600);
    expect(request.filter).toEqual(['added', 'removed', 'modified', 'unchanged']);
  });

  it('accepts form values as well as booleans', () => {
    const request = parseDiffRequest({ compare: { dependencies: 'on' }, ignore: { formatting: 'false' } });
    expect(request.compare.dependencies).toBe(true);
    expect(request.ignore.formatting).toBe(false);
  });

  it('clamps the limit to the export threshold (spec 05 §5.4)', () => {
    expect(parseDiffRequest({ limit: 99_999 }).limit).toBe(2_000);
    expect(parseDiffRequest({ limit: 0 }).limit).toBe(1);
  });

  it('refuses an empty filter rather than returning nothing', () => {
    expect(parseDiffRequest({ filter: [] }).filter).toHaveLength(4);
    expect(parseDiffRequest({ filter: ['modified', 'nonsense'] }).filter).toEqual(['modified']);
  });

  it('knows when the request is the set isModified() is defined over (RD-013)', () => {
    expect(isDefaultFieldSet(DEFAULT_COMPARE, DEFAULT_IGNORE)).toBe(true);
    expect(isDefaultFieldSet({ ...DEFAULT_COMPARE, dependencies: true }, DEFAULT_IGNORE)).toBe(false);
    expect(isDefaultFieldSet(DEFAULT_COMPARE, { ...DEFAULT_IGNORE, formatting: false })).toBe(false);
  });
});
