import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseAndAnalyse } from '@/domain/ryql';
import { prisma } from '@/server/repositories/client';
import { runSearch, visibilityPredicate } from '@/server/repositories/search';
import {
  categoryOf,
  createCorpusSpace,
  dropCorpusSpace,
  hasCategory,
  isDeleted,
  isRestricted,
  keyOf,
  priorityOf,
  TOTAL,
  type FixtureHandles,
} from './fixtures/corpus-space';

let fixture: FixtureHandles;

/** Corpus item 6 (spec 02 §10): expected result-key sets over the fixture database. */
async function keysFor(query: string, options: { as?: 'user' | 'stranger'; crossSpace?: boolean } = {}) {
  const analysed = parseAndAnalyse(query, {
    spaceKey: fixture.spaceKey,
    isolated: false,
    crossSpace: options.crossSpace ?? false,
  });
  if (!analysed.ok) throw new Error(analysed.errors.map((error) => error.message).join('; '));

  const userId = options.as === 'stranger' ? fixture.strangerId : fixture.userId;
  const { rows, total } = await runSearch(analysed.query.expr, {
    visibility: visibilityPredicate(userId, []),
    limit: 600,
  });
  return { keys: rows.map((row) => row.key), total };
}

/** The same rule the fixture was built from, applied in TypeScript. */
function expectedKeys(predicate: (index: number) => boolean): string[] {
  const keys: string[] = [];
  for (let index = 0; index < TOTAL; index += 1) if (predicate(index)) keys.push(keyOf(index));
  return keys.sort();
}

/** What the fixture's own user sees: every ACTIVE row, restricted annex included. */
const visibleAndActive = (index: number) => !isDeleted(index);

beforeAll(async () => {
  fixture = await createCorpusSpace(prisma);
}, 120_000);

afterAll(async () => {
  await dropCorpusSpace(prisma, fixture);
  await prisma.$disconnect();
});

describe('corpus 6 — result sets over the fixture database', () => {
  it('the default scope is this space, live rows and ACTIVE status', async () => {
    const { keys, total } = await keysFor("key ~ '%'");
    expect(keys.sort()).toEqual(expectedKeys(visibleAndActive));
    expect(total).toBe(expectedKeys(visibleAndActive).length);
  });

  it('key ~ matches case-insensitively with % as the wildcard', async () => {
    const { keys } = await keysFor("key ~ 'fn-0%'");
    expect(keys.every((key) => key.startsWith('FN-0'))).toBe(true);
    expect(keys.length).toBe(expectedKeys((index) => visibleAndActive(index) && keyOf(index).startsWith('FN-0')).length);
  });

  it('an inline property matches by value', async () => {
    const { keys } = await keysFor("@Category = 'Safety'");
    expect(keys.sort()).toEqual(
      expectedKeys((index) => visibleAndActive(index) && hasCategory(index) && categoryOf(index) === 'Safety'),
    );
  });

  it('R3 / RD-027: a list-valued property matches by membership', async () => {
    const { keys } = await keysFor("@Tags = 'audit'");
    expect(keys.sort()).toEqual(expectedKeys((index) => visibleAndActive(index) && index % 3 === 0));
    const both = await keysFor("@Tags = 'safety' AND @Tags = 'audit'");
    expect(both.keys.sort()).toEqual(keys.sort());
  });

  it('IN is set membership over strict equality', async () => {
    const { keys } = await keysFor("@Priority IN ('High', 'Low')");
    expect(keys.sort()).toEqual(
      expectedKeys((index) => visibleAndActive(index) && priorityOf(index) !== 'Medium'),
    );
  });

  it('ordered comparison works on ISO dates as strings (research §3.3)', async () => {
    const { keys } = await keysFor("@'Release date' > '2026-05-15'");
    expect(keys.sort()).toEqual(expectedKeys((index) => visibleAndActive(index) && (index % 9) + 1 > 5));
  });

  it('an external property is queried with ext@ and is not an inline property', async () => {
    const external = await keysFor("ext@Approval = 'Signed off'");
    expect(external.keys.sort()).toEqual(expectedKeys((index) => visibleAndActive(index) && index % 50 === 0));
    const inline = await keysFor("@Approval = 'Signed off'");
    expect(inline.keys).toEqual([]);
  });

  it('a label matches (RD-008)', async () => {
    const { keys } = await keysFor("label = 'critical'");
    expect(keys.sort()).toEqual(expectedKeys((index) => visibleAndActive(index) && index % 50 === 0));
  });

  it('status and baseline scope: naming a baseline includes every status', async () => {
    const deleted = await keysFor("status = 'DELETED'");
    expect(deleted.keys.sort()).toEqual(expectedKeys((index) => isDeleted(index) && !isRestricted(index)));

    const frozen = await keysFor('baseline = 1');
    expect(frozen.keys.length).toBe(20);
    expect(frozen.keys).toContain('FN-001');
  });

  it('dependency direction: to walks child → parent, from walks parent → child (P1)', async () => {
    // FN-001 refines BR-001, so BR-001 is the parent of FN-001.
    const parents = await keysFor("to = 'BR-001'");
    expect(parents.keys).toContain('FN-001');
    expect(parents.keys).not.toContain('BR-001');

    const children = await keysFor("from = 'FN-001'");
    expect(children.keys).toEqual(['BR-001']);

    const byRelationship = await keysFor("to@refines = 'BR-001'");
    expect(byRelationship.keys.sort()).toEqual(parents.keys.sort());
    const wrongRelationship = await keysFor("to@verifies = 'BR-001'");
    expect(wrongRelationship.keys).toEqual([]);
  });

  it('traversal matches when at least one reached requirement satisfies the right side', async () => {
    const { keys } = await keysFor("to -> key = 'BR-002'");
    expect(keys).toContain('FN-002');
    expect(keys.every((key) => key.startsWith('FN-'))).toBe(true);
  });

  it('document and links fields find the defining document', async () => {
    const { keys } = await keysFor(`document = '${fixture.documentIds[1]}'`);
    expect(keys.every((key) => key.startsWith('BR-') || key.startsWith('IF-'))).toBe(true);
    expect(keys.length).toBeGreaterThan(0);
  });

  it('text matches the requirement body', async () => {
    const { keys } = await keysFor("text ~ '%behave predictably%'");
    expect(keys.length).toBe(expectedKeys(visibleAndActive).length);
  });
});

describe('corpus 5 — NULL semantics, two-valued with absence-as-false (RD-020)', () => {
  it("NOT (@Category = 'Functional') includes requirements with no Category at all", async () => {
    const { keys } = await keysFor("NOT (@Category = 'Functional')");
    expect(keys.sort()).toEqual(
      expectedKeys(
        (index) => visibleAndActive(index) && !(hasCategory(index) && categoryOf(index) === 'Functional'),
      ),
    );
    // The requirements with no Category are in the result, which is the whole point.
    expect(keys).toContain(keyOf(7));
  });

  it('!= behaves as NOT(=), not as SQL inequality', async () => {
    const notEqual = await keysFor("@Category != 'Functional'");
    const notOf = await keysFor("NOT (@Category = 'Functional')");
    expect(notEqual.keys.sort()).toEqual(notOf.keys.sort());
  });

  it('IS NULL means no row exists', async () => {
    const { keys } = await keysFor('@Category IS NULL');
    expect(keys.sort()).toEqual(expectedKeys((index) => visibleAndActive(index) && !hasCategory(index)));
  });

  it('IS NOT NULL is its exact complement', async () => {
    const present = await keysFor('@Category IS NOT NULL');
    expect(present.keys.sort()).toEqual(
      expectedKeys((index) => visibleAndActive(index) && hasCategory(index)),
    );
  });

  it('baseline IS NULL selects live rows, IS NOT NULL selects frozen ones (RD-006)', async () => {
    // Naming `baseline` — even as IS NULL — drops the ACTIVE default (spec 02 §8 rule 4),
    // so the DELETED rows come back too.
    const live = await keysFor('baseline IS NULL');
    expect(live.keys.length).toBe(TOTAL);
    const frozen = await keysFor('baseline IS NOT NULL');
    expect(frozen.keys.length).toBe(20);
  });
});

describe('visibility is not optional (rule X1–X3, RD-017)', () => {
  it('a restricted document hides its requirements from a user who may not view it', async () => {
    // The restricted annex holds BR-101 … BR-120.
    const asOwner = await keysFor("key ~ 'BR-1%'", { as: 'user' });
    const asStranger = await keysFor("key ~ 'BR-1%'", { as: 'stranger' });

    expect(asOwner.keys).toContain('BR-101');
    expect(asStranger.keys).not.toContain('BR-101');
    expect(asStranger.keys).toContain('BR-149');
  });

  it('rule X2: hidden requirements are omitted and not counted', async () => {
    const asOwner = await keysFor("key ~ '%'", { as: 'user' });
    const asStranger = await keysFor("key ~ '%'", { as: 'stranger' });

    expect(asStranger.total).toBe(asStranger.keys.length);
    expect(asStranger.total).toBeLessThan(asOwner.total);
    // Exactly the restricted, non-deleted rows are missing.
    const restrictedActive = expectedKeys((index) => isRestricted(index) && !isDeleted(index)).length;
    expect(asOwner.total - asStranger.total).toBe(restrictedActive);
  });
});
