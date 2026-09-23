import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/server/repositories/client';
import { createApiToken } from '@/server/repositories/api-tokens';
import { createCorpusSpace, dropCorpusSpace, keyOf, type FixtureHandles } from '../fixtures/corpus-space';
import { call } from './support';

/**
 * spec: 08-api-surface.md §1–§2, with rule X3 over HTTP: "Every endpoint enforces the same
 * permission and visibility rules as the UI … There is no privileged API path."
 */

let fixture: FixtureHandles;
let userToken = '';
let strangerToken = '';

const LIST = '/spaces/{spaceKey}/requirements';
const ONE = '/spaces/{spaceKey}/requirements/{key}';
const RESTRICTED = new Set(Array.from({ length: 20 }, (_, n) => keyOf(400 + n)));

type Page = { items: Array<{ key: string; recordId: string; dependencies?: Array<{ key: string; restricted: boolean; title: string | null }> }>; hasMore: boolean; nextCursor: string | null };

beforeAll(async () => {
  fixture = await createCorpusSpace(prisma);
  userToken = (await createApiToken({ userId: fixture.userId, name: 'ci', scopes: ['read', 'edit', 'export'], spaceKeys: [] })).token;
  strangerToken = (await createApiToken({ userId: fixture.strangerId, name: 'ci', scopes: ['read', 'export'], spaceKeys: [] })).token;
}, 180_000);

afterAll(async () => {
  await prisma.apiToken.deleteMany({ where: { userId: { in: [fixture.userId, fixture.strangerId] } } });
  await prisma.documentViewGate.deleteMany({ where: { document: { spaceId: fixture.spaceId } } });
  await dropCorpusSpace(prisma, fixture);
  await prisma.$disconnect();
});

async function walk(token: string, query: Record<string, string>): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | null = null;
  for (let pages = 0; pages < 1_000; pages += 1) {
    const response = await call('GET', LIST, { spaceKey: fixture.spaceKey }, {
      token,
      query: { ...query, ...(cursor ? { cursor } : {}) },
    });
    expect(response.status).toBe(200);
    const page = response.body as Page;
    keys.push(...page.items.map((item) => item.key));
    if (!page.hasMore) {
      expect(page.nextCursor).toBeNull();
      return keys;
    }
    cursor = page.nextCursor;
  }
  throw new Error('Too many pages.');
}

describe('GET /spaces/{spaceKey}/requirements', () => {
  it('lists every live requirement the caller may see when there is no query', async () => {
    const mine = await walk(userToken, { limit: '600' });
    const theirs = await walk(strangerToken, { limit: '600' });
    expect(mine.length - theirs.length).toBe([...RESTRICTED].filter((key) => mine.includes(key)).length);
    expect(theirs.filter((key) => RESTRICTED.has(key))).toEqual([]);
  });

  it('pages by cursor, in key order, covering the result exactly once', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 97 }), async (limit) => {
        const keys = await walk(userToken, { q: "key ~ 'FN-%'", limit: String(limit) });
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys).toEqual([...keys].sort());
        expect(keys.length).toBe((await walk(userToken, { q: "key ~ 'FN-%'", limit: '600' })).length);
      }),
      { numRuns: 8 },
    );
  });

  it('neither skips nor repeats a row when rows are inserted between pages (RD-068)', async () => {
    const first = await call('GET', LIST, { spaceKey: fixture.spaceKey }, { token: userToken, query: { q: "key ~ 'FN-%'", limit: '10' } });
    const page = first.body as Page;
    // A row sorting before the cursor arrives after the first page was read.
    const inserted = await prisma.requirement.create({
      data: {
        spaceId: fixture.spaceId,
        key: 'FN-000',
        upperKey: 'FN-000',
        uid: 'uid-inserted',
        title: 'Late',
        bodyHtml: '',
        bodySearch: '',
        anchorPath: '0',
        originVersionId: (await prisma.document.findUniqueOrThrow({ where: { id: fixture.documentIds[0]! } })).currentVersionId,
      },
    });
    try {
      const second = await call('GET', LIST, { spaceKey: fixture.spaceKey }, {
        token: userToken,
        query: { q: "key ~ 'FN-%'", limit: '10', cursor: page.nextCursor! },
      });
      const secondKeys = (second.body as Page).items.map((item) => item.key);
      // An offset would have repeated the tenth row; the cursor carries on after it.
      expect(secondKeys[0]! > page.items.at(-1)!.key).toBe(true);
      expect(secondKeys).not.toContain(page.items.at(-1)!.key);
    } finally {
      await prisma.requirement.delete({ where: { id: inserted.id } });
    }
  });

  it('caps limit at 600 and refuses an unknown expansion', async () => {
    const tooMany = await call('GET', LIST, { spaceKey: fixture.spaceKey }, { token: userToken, query: { limit: '601' } });
    expect(tooMany.status).toBe(400);
    expect(tooMany.headers.get('content-type')).toBe('application/problem+json');
    const bad = await call('GET', LIST, { spaceKey: fixture.spaceKey }, { token: userToken, query: { expand: 'everything' } });
    expect(bad.status).toBe(400);
  });

  it('refuses a cursor it did not issue', async () => {
    const forged = await call('GET', LIST, { spaceKey: fixture.spaceKey }, { token: userToken, query: { cursor: 'not-a-cursor' } });
    expect(forged.status).toBe(422);
  });

  it('answers an invalid query with the RQL diagnostics embedded (spec 02 §9)', async () => {
    const response = await call('GET', LIST, { spaceKey: fixture.spaceKey }, { token: userToken, query: { q: "key = 'FN-001' AND AND" } });
    expect(response.status).toBe(400);
    const body = response.body as { code: string; errors: Array<{ offset: number; message: string }> };
    expect(body.code).toBe('QUERY_INVALID');
    expect(body.errors[0]?.offset).toBeGreaterThan(0);
  });

  it('expands dependencies, showing a hidden target as restricted (rule X2)', async () => {
    const response = await call('GET', LIST, { spaceKey: fixture.spaceKey }, {
      token: strangerToken,
      query: { q: `key = '${keyOf(100)}'`, expand: 'dependencies,properties' },
    });
    const [item] = (response.body as Page).items;
    expect(item?.recordId).toBe(`${fixture.spaceKey}/${keyOf(100)}/current`);
    const edge = item?.dependencies?.find((entry) => entry.key === keyOf(400));
    expect(edge).toMatchObject({ restricted: true, title: null });
  });
});

describe('GET /spaces/{spaceKey}/requirements/{key}', () => {
  it('returns a visible requirement and 404s a hidden one exactly like a missing one (RD-064)', async () => {
    expect((await call('GET', ONE, { spaceKey: fixture.spaceKey, key: keyOf(400) }, { token: userToken })).status).toBe(200);
    const hidden = await call('GET', ONE, { spaceKey: fixture.spaceKey, key: keyOf(400) }, { token: strangerToken });
    const missing = await call('GET', ONE, { spaceKey: fixture.spaceKey, key: 'NOPE-1' }, { token: strangerToken });
    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(404);
  });

  it('reads a frozen snapshot with ?baseline=', async () => {
    const response = await call('GET', ONE, { spaceKey: fixture.spaceKey, key: keyOf(0) }, {
      token: userToken,
      query: { baseline: String(fixture.baselineNumber) },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ baseline: fixture.baselineNumber, recordId: `${fixture.spaceKey}/${keyOf(0)}/${fixture.baselineNumber}` });
  });
});
